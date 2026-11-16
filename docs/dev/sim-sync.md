# Sim sync

The browser's side of a sim's connection to the server: `src/lib/sim-sync/`. For the sim a `LogStore` has open it registers the sim when the device's own work needs it, keeps one socket to the sim object, resumes, sends the store's pending commits one at a time and feeds what arrives to `LogStore.receive`; it holds this tab's lock, claims the unsent commits of tabs that are gone, and publishes one state with the save state. This is plan 2 of the sim message log ([the outline](../superpowers/plans/2026-11-15-sim-log-store-outline.html)). Nothing on any page uses it yet: `/sim` moves onto it in plan 3. The store it serves is [sim-store.md](sim-store.md); the server is [sim-object.md](sim-object.md); registration is [auth.md](auth.md), Registering a sim.

The directory imports only `$lib/sim-log`, `$lib/sim-stream/*`, `$lib/sim-store/*` and its own files. Nothing in it imports `$app/*`, `$env/*` or `$lib/server/*`. Everything that reaches a browser API goes through a port (below); `browserPorts()` is the only place that touches one. Every wait is the injected clock's.

## Files

| Where                                 | What                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/sim-sync/ports.ts`           | The ports (`Clock`, `SocketLike`, `LocksLike`, `ChannelLike`, `NetSignals`), `SyncStore`, `BrowserPorts`, `browserPorts()`, `realClock`, `errorName` |
| `src/lib/sim-sync/backoff.ts`         | `backoffDelay`: the one backoff                                                                                                                      |
| `src/lib/sim-sync/register.ts`        | `registerSim`, `registerAnswerOf`, `RegisterGate`: the request, its answers, one at a time                                                           |
| `src/lib/sim-sync/sim-socket.ts`      | `SimSocket`: one sim's connection, its resume and its sends; `SocketView`                                                                            |
| `src/lib/sim-sync/tabs.ts`            | `TabPresence`: this tab's lock, who is gone, hearing when a tab goes                                                                                 |
| `src/lib/sim-sync/save-state.ts`      | `saveState`: the save state as a pure function                                                                                                       |
| `src/lib/sim-sync/sim-sync.svelte.ts` | `SimSync`: ties the store, registration, the socket and tabs; `SyncState`                                                                            |
| `src/lib/sim-sync/test/fakes.ts`      | `FakeClock`, `FakeNet`, `FakeLocks`, `FakeBus`, `FakeFetch`, `microtasks`: fakes of the ports                                                        |
| `src/lib/sim-sync/test/hub.ts`        | `FakeHub`, `FakeSocket`, `settle`: a fake of the sim object and its sockets                                                                          |

## Invariants

Each holds after every public call of the socket, the sync object and the tab presence returns.

| #   | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | One in flight, after the resume. A socket has at most one append unanswered, and sends none on a connection until a resume answer on it ended with `more: false` and no other resume is outstanding or owed                                                                                                                                                                                                                                               |
| S2  | Only what the store hands out, for its own sim. Every append is the store's `head()` read at the moment of sending, sent only when the store is ready and its sim is the socket's                                                                                                                                                                                                                                                                         |
| S3  | Frames go to the sim they came from. Every `receive` names the socket's sim id; a socket whose sim is no longer the store's is stopped; the events of a stopped, detached or replaced socket are ignored                                                                                                                                                                                                                                                  |
| S4  | The client never confirms or discards on its own. A commit leaves pending only through the store's `receive`, or through `dropPending` on an `invalid` refusal naming the commit in flight. `not-writer`, `limit`, `full`, `newer`, `gone`, a close, `taken`, sign-in and quota leave every commit pending and stored                                                                                                                                     |
| S5  | Registration only for the device's own work. The request is sent only when the store says it is needed and the sim has something to send; never for a look; one request at a time per browser                                                                                                                                                                                                                                                             |
| S6  | No socket without a registered or foreign sim. A socket is made only when the store says registered, for a sim with no record on this device (a look), or for a sim that needs registration and has a confirmed tip (it is read, nothing is posted). A look's read socket is kept while its registration is in flight, retrying or refused with `sign-in`, `quota` or `failed`. `taken` with nothing confirmed stops the socket and none is made after it |
| S7  | Dev sends nothing. With `live: false`, no fetch is made and no socket is opened                                                                                                                                                                                                                                                                                                                                                                           |
| S8  | Claims only from gone tabs. Pending records are claimed only from owners whose tab lock is free, never from this tab; without Web Locks, from every other owner, at open only                                                                                                                                                                                                                                                                             |
| S9  | The save state is honest. Never `saved` while anything is pending or held, or while the store is stopped with something pending or held; never `device` (saved on this device) while local storage has failed                                                                                                                                                                                                                                             |
| S10 | Every wait is the clock's. Every timer goes through the injected clock; reconnect delays follow `backoffDelay`; nothing reconnects after a terminal close or refusal                                                                                                                                                                                                                                                                                      |

## The ports and building a `SimSync`

A port is the browser thing the client talks to. `browserPorts()` (call it only in a browser) returns:

| Port        | Is                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `origin`    | `location.origin`; the socket URL is `ws`/`wss` of it plus `/api/sims/<simId>/stream`          |
| `fetch`     | `fetch`                                                                                        |
| `WebSocket` | the `WebSocket` constructor                                                                    |
| `clock`     | `realClock`: `Date.now` and the platform's timers                                              |
| `random`    | `Math.random`                                                                                  |
| `locks`     | `navigator.locks`, or null when the browser has none or withholds it                           |
| `channel`   | `new BroadcastChannel('sfh-sim')`, or null when there is none or it throws                     |
| `net`       | `online()`, `visible()` and `watch(fn)` over `online`, `offline` and `visibilitychange` events |

`new SimSync(options)` takes those and five more:

| Option  | Is                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `store` | the page's `LogStore` (a `SyncStore`: `LogStore` is assignable to it; `ports.spec.ts` checks it against a real one)                   |
| `db`    | the store's database, used only for `pendingOwners`; null when the store has none                                                     |
| `tabId` | the store's `tabId`: this tab's lock and the owner of its records                                                                     |
| `live`  | `!dev` (`$app/environment`). False: nothing is fetched or opened (the dev server never answers an upgrade); tabs and claims still run |
| `build` | the page's release, compared with `hello.build`                                                                                       |

One `SimSync` per store. Two in one tab would contend for the tab's lock, and both would register, open sockets and claim records for one store. The tab id is minted for each document with `newId()` and for each `TabPresence`; it never comes from `sessionStorage` (a duplicated tab copies it) and is never reused, so a free lock means gone for good. A record is written under a tab id only once that tab's lock is held: the store is opened only after `await sync.start()`.

## The life of a `SimSync`

| Call                  | Does                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start()`             | Takes this tab's lock (`TabPresence.start`), then subscribes to the store, the network and the news that a watched tab has gone. Once: a second call returns the first call's promise. A `stop()` while it waits for the lock leaves no lock held and no subscription                                                                 |
| `open(simId \| null)` | In place of `store.open`; never call `store.open` directly. Rejects before `start()` has resolved, after `stop()`, and when the store's open rejects (not retried). Does nothing for the sim already open and ready when no open is under way. Opens run one after another in call order, so the last call wins (see Opening)         |
| `retryRegistration()` | From `sign-in`, `quota`, `taken`, `failed` or `retrying` (nothing otherwise): clears the wait and posts again now when the evaluation finds something to send. The attempt count starts again                                                                                                                                         |
| `stop()`              | Final. Stops the socket and the retry timer, unsubscribes, then releases the tab's lock and closes the channel; makes one last publish (no socket). Afterwards every handler (a registration answer, a retry timer, a network or visibility signal, a store notification) returns at once, no socket is opened and no request is sent |
| `state`               | A rune (`$state.raw`), replaced when anything in it changes: `{ live, registration, socket, buildMismatch, save }`                                                                                                                                                                                                                    |
| `subscribe(fn)`       | Called after every change of `state`; returns the unsubscribe. A subscriber that throws stops later subscribers hearing that update                                                                                                                                                                                                   |

After `stop()` the page must not edit the store it gave this `SimSync`: the tab's lock is released and other tabs may take its unsent records. Nothing here can enforce that. To work on, make a new store and a new `SimSync` with a new tab id. Call `store.settle()` before `stop()` when a draft must be committed.

`SyncState`:

| Field           | Is                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live`          | the option                                                                                                                                                    |
| `registration`  | `idle` (nothing to do), `none` (a look), `waiting` (the first write has not landed), `registering`, `retrying`, `sign-in`, `taken`, `quota`, `failed`, `done` |
| `socket`        | the socket's `SocketView`, or `OFF_VIEW` when there is none                                                                                                   |
| `buildMismatch` | `socket.serverBuild` is set and is not `build`; changes nothing else: the tab keeps saving, the page offers a reload                                          |
| `save`          | the save state                                                                                                                                                |

A page never shows a sim's id (URL, copy, share) before `registration` is `done`.

### Opening

`open` runs, in its turn:

1. Reads `db.pendingOwners(simId)` (nothing when the store's storage has failed or there is no database; a database that cannot answer counts as no owners).
2. Of the owners other than this tab, asks `TabPresence.goneOwners` which have a free lock.
3. `store.open(simId, { claim: gone })`.
4. Watches each owner that is still alive, so that its records are claimed when it goes (not without a lock of the tab's own).

Before the store's open, the socket is stopped (the socket cannot see an open start: the store notifies at its end), so no socket lives across a reopen. After each `await`, the open checks whether `stop()` came: an open not yet at the store's open when `stop()` comes does not open, claims nothing, watches nothing, and rejects. The evaluation runs again when each open ends.

## The socket

`SimSocket` is one sim's connection for its life, made by `SimSync` and held until the sim changes or `stop()`. `start()` connects (or waits for `online`); `view` says where it is; `onChange` is told after every change of the view. It subscribes to the store and the network itself.

```ts
interface SocketView {
  phase: 'off' | 'connecting' | 'catching-up' | 'live' | 'offline' | 'waiting' | 'halted';
  halt: 'gone' | 'diverged' | 'protocol' | 'broken' | null;
  hold: 'not-writer' | 'limit' | 'full' | 'newer' | null;
  write: boolean | null; // the last access frame on this connection
  serverBuild: string | null; // the last hello's build
  inFlight: string | null; // the id of the append awaiting its answer
}
```

The socket's own `close()` of a connection (stop, a timeout, offline, a halt, `reconnect`) detaches it at once: its later events, its own `close` included, are ignored, so nothing reconnects, sends or reports on them. After every call out to code it does not own (a store method, which notifies synchronously, and `onChange`) it checks that it is still the running, current socket, so a store subscriber may `stop()` or `reconnect()` it from inside a notification.

### The connection

| Event                                               | Does                                                                                                                                                                       | Phase                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `start()`, online                                   | Connects: a new `WebSocket`, a 10 s hello timer. A new connection clears `write`, `inFlight`, a `not-writer` and a `limit` hold; `full` and `newer` stay                   | `connecting`         |
| `start()`, offline                                  | Waits for `online`                                                                                                                                                         | `offline`            |
| `hello`, `protocol` not 1                           | Closes 1000, never reconnects                                                                                                                                              | `halted`, `protocol` |
| `hello`                                             | Sets the store's server dataset when the frame has one (before anything is sent: store invariant I11), records `serverBuild`, sends the resume, arms the ping when visible | `catching-up`        |
| `hello` without a dataset                           | Sets nothing: the store's `head()` stays null while the dataset is unknown, so nothing is sent                                                                             | `catching-up`        |
| no `hello` in 10 s                                  | Closes 1000, waits `backoffDelay(attempt++)`, connects again                                                                                                               | `waiting`            |
| a close from the far side, code 4410                | Never reconnects                                                                                                                                                           | `halted`, `gone`     |
| any other close                                     | Drops its timers, clears the connection's state, waits `backoffDelay(attempt++)`, connects again                                                                           | `waiting`            |
| a socket constructor that throws                    | As a failed attempt; logs `[sim-sync] socket failed <name>` once per `SimSocket`                                                                                           | `waiting`            |
| `offline`                                           | Closes 1000, cancels the timers, waits                                                                                                                                     | `offline`            |
| `online` while `offline` or `waiting`               | Connects at once (the attempt count is kept). While connecting or connected: nothing                                                                                       | `connecting`         |
| `visible` while `waiting`                           | Connects at once                                                                                                                                                           | `connecting`         |
| `visible` while connected                           | Pings at once and keeps pinging                                                                                                                                            |                      |
| the ping timer, every 30 s while visible            | Sends `ping`; starts a 10 s deadline unless one runs (a ping while the last is unanswered does not push the deadline back)                                                 |                      |
| any frame within 10 s of a ping (a `pong` included) | Clears the deadline                                                                                                                                                        |                      |
| no frame within 10 s of a ping                      | The connection is dead: closes 1000, waits `backoffDelay(attempt++)`, connects again                                                                                       | `waiting`            |
| `hidden`                                            | Stops the pings; a deadline already running keeps running                                                                                                                  |                      |
| `reconnect()`                                       | Closes 1000 and connects now, keeping the attempt count; nothing when halted, offline, stopped or not started                                                              | `connecting`         |
| `stop()`                                            | Closes 1000, cancels every timer, unsubscribes; final                                                                                                                      | `off`                |

Ignored: a message that is not a string or not one of the four known frames, a second `hello`, any frame before `hello`, an `error` event (it is followed by `close`).

`backoffDelay(attempt, random)` is `min(30 s, 1 s * 2^attempt)` times `1 - 0.2 + 0.4 * random()`, rounded; a negative, fractional or NaN attempt is clamped to a whole number of at least 0. The connection's attempt count goes back to 0 when an append of this connection is confirmed, and when an answer reaches the tip with nothing pending or held (not on `hello`: a server that closes on every append would otherwise never back off).

### Resume

The resume is `{ type: 'resume', after: store.tipSeq }`. It is sent when the store is ready on this socket's sim, no resume is outstanding and no `limit` backoff runs; otherwise it is owed (it counts as outstanding, so nothing is sent) and goes out when it can. The connection is `live` only when an answer reached the tip and nothing is outstanding, owed or stalled.

| Event                                                | Does                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| every `commits` frame                                | `store.receive(simId, commits)`, with the socket's sim id, whatever the frame                                                                                                                                                                                                                                            |
| the last frame of an answer, `more: true`            | Resumes again from `tipSeq`, once the store's tip has moved past the `after` just answered; otherwise stalls the connection (a backstop)                                                                                                                                                                                 |
| the last frame of an answer, `more: false`           | Caught up: `live`, unless something is outstanding, owed or stalled. Resets the `limit` backoff                                                                                                                                                                                                                          |
| `receive` answers `gap`, nothing outstanding or owed | Resumes from the tip                                                                                                                                                                                                                                                                                                     |
| `receive` answers `stale` with `why: 'not-ready'`    | Owes a resume and is not caught up: the store was opening. It is sent when the store is ready on the sim; a store turning ready on this sim owes one in any case                                                                                                                                                         |
| `receive` answers `stale` with `why: 'other-sim'`    | Nothing applied, nothing asked                                                                                                                                                                                                                                                                                           |
| `receive` answers `future` (a newer build's commit)  | Stalls the connection: it stays connected, is never `live`, sends no further resume and no append, for the connection's life (a reconnect resumes again; the hold `newer` still stops sends). Hold `newer` lasts for the `SimSocket` and never replaces `full`. Not while a resume is owed: the owed one is sent instead |
| `receive` throws (a stored commit will not fold)     | Logs `[sim-sync] receive failed <name>`, closes 1000, halts `broken`. No reconnect loop                                                                                                                                                                                                                                  |
| `refused`, `id: null`, `gone`                        | The resume went past the tip: the device's log is not this sim's. Halts `diverged`; the commits stay                                                                                                                                                                                                                     |
| `refused`, `id: null`, any other reason              | Owes the resume and sends it after `backoffDelay(limitAttempt++)`; nothing is sent meanwhile. On a stalled connection nothing is owed and no backoff runs. A reason other than `limit` is logged once per `SimSocket` as `[sim-sync] resume refused <reason>`                                                            |
| a close during a resume                              | The next connection resumes from what was applied; the `limit` backoff is cancelled                                                                                                                                                                                                                                      |

A refusal with no id is taken as the resume's (the object also refuses an oversized frame this way; the store never hands out one). `limit` covers both size and rate. A connection is never stalled while a resume is owed.

### Appends

The send attempt tests its own conditions, never call order, and runs from frames, refusals, timers and every store notification, the ones inside `receive` and `setServerDataset` included. It sends `{ type: 'append', commit: store.head() }` only when all hold: this is the running, current socket and the hello came; the store is ready on this socket's sim; the phase is `live` (caught up, no resume outstanding, owed or stalled); no append is in flight; no hold and no halt; `write` is true. A `head()` of null sends nothing. Because the store notifies at the end of each write, a commit it was holding back until stored is sent as soon as it is.

| Answer                                      | Does                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a `commits` frame holding the in-flight id  | The append is confirmed, accepted or a duplicate whatever the store answers: clears `inFlight`, starts both backoffs again, sends the next. A duplicate gets no frame; its copy on the stream is the answer |
| `refused` naming the in-flight id, `behind` | Sends the head again once the store's tip is past the parent sent; when a resume is outstanding, owed or stalled, waits; otherwise resumes first                                                            |
| `refused` naming it, `invalid`              | The one refusal that discards: `store.dropPending(id)`, then the next. It means version skew                                                                                                                |
| `refused` naming it, `not-writer`           | Hold `not-writer`, until an `access` frame says `write: true` or a new connection                                                                                                                           |
| `refused` naming it, `limit`                | Hold `limit`, lifted after `backoffDelay(limitAttempt++)` or by a new connection; covers size and rate                                                                                                      |
| `refused` naming it, `full`                 | Hold `full`, for the life of the `SimSocket`                                                                                                                                                                |
| `refused` naming it, `newer`                | Hold `newer`, for the life of the `SimSocket`                                                                                                                                                               |
| `refused` naming it, `gone`                 | The sim was taken down: halts `gone`                                                                                                                                                                        |
| `refused` naming any other id               | Ignored                                                                                                                                                                                                     |
| `access`                                    | Sets `write`. `write: true` lifts a `not-writer` hold and never another                                                                                                                                     |
| a close with an append in flight            | The append is forgotten. The next connection's resume shows whether it was stored (then it never goes again) or the socket sends it again                                                                   |

Every refusal but `invalid` keeps the commit pending and stored (S4). A `full` or `newer` hold survives reconnects, and `SimSync` does not try to clear it by making a new socket for the same sim.

### Holds and halts

| Value             | What the owner does                                                                              | Ends                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| hold `not-writer` | When the tab becomes visible with something pending or held, `reconnect()` (below); nothing else | An `access` frame with `write: true`, or a new connection |
| hold `limit`      | Nothing                                                                                          | The socket's own wait, or a new connection                |
| hold `full`       | Reports it. Never retries and never reconnects to clear it                                       | Never for this `SimSocket`                                |
| hold `newer`      | Reports it and offers a reload                                                                   | Never for this `SimSocket`                                |
| halt `gone`       | Reports it                                                                                       | Final: a close 4410, or `gone` on an append               |
| halt `diverged`   | Reports it; the commits stay                                                                     | Final: a resume refused `gone`                            |
| halt `protocol`   | Reports it                                                                                       | Final: a hello of another protocol                        |
| halt `broken`     | Reports it                                                                                       | Final: the store could not fold a stored commit           |

A halted socket is final: it has closed its connection and cleared its timers, and every handler does nothing for it. `SimSync` keeps it rather than stopping it, so that `state.socket` carries the halt and the save state can say why; it is replaced when the store's sim changes.

The owner never calls `dropPending` or confirms anything itself, never sends appends itself and never starts a second `SimSocket` for the sim while one runs, and never reads `inFlight` as lost after a close.

## Registration

`registerSim(fetch, simId, clock)` posts `POST /api/sims` with `content-type: application/json` and the body `{ simId }` and nothing else: no title (the server names the sim by its default), no other header, the browser's default same-origin credentials. It is aborted after 30 s on the clock; the timer is cancelled when an answer comes. A thrown or aborted fetch is `retry`. An aborted request whose response was lost may have created a pseudonymous account on the server, and the retry can create another; this is inherent to a timeout.

| Status                                                      | Answer    | The client                                                                                      |
| ----------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| 200 or 201, `simId` matches, `created` a boolean            | `ok`      | Records it on the device (`store.markRegistered`) and goes on                                   |
| 200 or 201, a body that cannot be read or has another shape | `retry`   | The sim was registered; asking again is safe (200, `created: false`)                            |
| 200 or 201 naming another sim                               | `bug`     | A real fault: state `failed`                                                                    |
| 401                                                         | `sign-in` | Waits for `retryRegistration()`; the commits stay                                               |
| 403 with `code: 'quota'`                                    | `quota`   | Waits                                                                                           |
| 409                                                         | `taken`   | The edits stay on the device, unsent; nothing is posted for this sim again                      |
| 429, 5xx                                                    | `retry`   | Backs off (the server sends no hint of when): `backoffDelay(attempt++)`; `online` posts at once |
| anything else                                               | `bug`     | State `failed`; logs `[sim-sync] registration refused <status> <code>`                          |

One request at a time per browser: `RegisterGate` runs each job under the Web Lock `sfh-register`. Without Web Locks (a null port), or once a lock request has failed before its job started, it runs them one at a time within the tab only. A job that throws releases the gate; a gate that rejects counts as `retry`. The job re-reads the caller's token inside the gate and does not post when the registration is no longer wanted (the sim changed, `stop()` came).

The evaluation runs after every store notification, registration answer, timer and network signal, and does nothing unless `live`, no open is under way, the store has a sim and is ready:

| Store `registration`                         | State         | Does                                                                               |
| -------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `done`                                       | `done`        | Makes the socket                                                                   |
| `none` (a look)                              | `none`        | Makes the socket (a read); registers nothing                                       |
| `wait` (minted here, first write not landed) | `waiting`     | Nothing: the sim is not stored yet                                                 |
| `needed`, pending or held commits            | `registering` | Posts once through the gate; makes the socket too when the sim has a confirmed tip |
| `needed`, nothing pending or held            | `idle`        | Posts nothing; makes the socket only when the sim has a confirmed tip              |

So a sim needing registration with confirmed commits is read meanwhile (it is on the server: another tab of this device registered it, or this device stored it before), and one with none and nothing to send is neither registered nor read: a sim another tab minted and has not registered yet shows nothing from the server in this tab until the tab reopens it. The two `needed` rows apply only when no request or wait is in force: in `registering`, `retrying`, `sign-in`, `taken`, `quota` and `failed` the state stays and nothing is posted.

What an answer does:

| Answer             | Does                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`               | `markRegistered` (the store says `done`, the evaluation makes the socket). Only a socket that existed before the answer and whose `write` is not `true` is reconnected, to pick up write; one the evaluation makes is new and is left alone |
| `taken`            | State `taken`. A socket for a sim with no confirmed tip is stopped and none is made after it; one with a confirmed tip keeps reading. Nothing is sent for the sim                                                                           |
| `sign-in`, `quota` | The state; an existing read socket stays open                                                                                                                                                                                               |
| `retry`            | State `retrying`, a timer on the clock                                                                                                                                                                                                      |
| `bug`              | State `failed`; the log line                                                                                                                                                                                                                |

An answer that comes after the sim changed (or after `stop()`) is ignored: every `await` re-reads the token.

## Tabs and claims

`TabPresence` is how a tab says it is alive and learns when another is not. It never claims anything itself; `SimSync` does, through `LogStore.open(simId, { claim })` and `LogStore.claim(owners)` ([sim-store.md](sim-store.md), Opening a sim and claiming).

| Name                          | Is                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Web Lock `sfh-tab:<tabId>`    | Held by a tab for as long as it lives; the browser frees it when the tab goes, however it goes |
| `BroadcastChannel('sfh-sim')` | Carries `{ type: 'here', tabId, reply }` and nothing else; a malformed message is ignored      |
| Web Lock `sfh-register`       | The registration gate (above)                                                                  |

| Call                          | Does                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start()`                     | Requests this tab's lock, resolves `true` once it is held and the tab has announced itself (`here`, `reply: false`). Resolves `false`, announcing nothing, when there is no Web Locks or the request failed (logged): from then on the tab behaves as with no Web Locks and answers no announcement |
| `goneOwners(owners)`          | Of the owners other than this tab, those whose lock is not held (`locks.query()`). Without Web Locks: every owner but this tab                                                                                                                                                                      |
| `watch(owner)`                | Requests the owner's lock, releases it at once when granted (it is granted only when the owner is gone), then tells `onGone` once per owner until the owner announces itself again. Never this tab; nothing without locks or after `stop()`                                                         |
| a heard `here` of another tab | Watches that tab, and answers `here` with `reply: true` when it was not a reply and this tab holds its lock: both watch each other                                                                                                                                                                  |
| `stop()`                      | Releases the lock, aborts the watches (nothing is told), closes the channel                                                                                                                                                                                                                         |

How `SimSync` uses them: at open, owners with a free lock are claimed in the store's open (step 3 of Opening); owners still alive are watched; when `onGone(owner)` fires it calls `store.claim([owner])` on the sim the store has open then, and logs `[sim-sync] claim failed <name>` if the claim rejects. A second `onGone` for one owner (a late announcement) claims again and finds nothing. Before `presence.stop()`, `SimSync` has stopped sending and closed its sockets: only then may other tabs take this tab's records.

When `start()` resolves `false` there is no watch and no `onGone` claim: claims happen at open only, from every other owner (S8). When the tab has the lock, a tab that is closing but still holds its lock is not gone, and two live tabs each watching the other never hear the other go.

### Becoming visible

On `visible`, when the store has something pending or held and the socket's `hold` is `not-writer` or its `write` is `false`, `SimSync` calls `socket.reconnect()`, so a sign-in made in another tab or window is picked up by the new connection. With nothing pending or held, or on a socket that writes, nothing happens; a halted socket's `reconnect()` does nothing.

## The save state

`saveState(input)` is pure. `SaveInput` is `{ live, local, pendingCount, heldCount, stopped, registration, socket }`; the result is `{ kind, why }` data (no user-facing text here). `kind` is `saved`, `saving`, `device` (saved on this device only) or `unsaved` (not saved anywhere yet).

The order:

1. Nothing pending and nothing held: `saved`. A stop counts only when something is pending or held, so a look at a sim the store has stopped as stale reads `saved`, while held commits in a stopped store do not.
2. The first of these that holds names `why`; none holds, or `local` is `'writing'`: `saving`. Otherwise `unsaved` when `local` is `'failed'`, else `device`.

| Order | Condition                                                   | `why`                                              |
| ----- | ----------------------------------------------------------- | -------------------------------------------------- |
| 1     | the socket is halted                                        | its halt: `gone`, `diverged`, `protocol`, `broken` |
| 2     | the socket's hold is `full` or `newer`                      | `full`, `newer`                                    |
| 3     | `stopped` is `stale` or `future`                            | `stale`, `future`                                  |
| 4     | `stopped` is `unknown-dataset` and the socket is `live`     | `unknown-dataset`                                  |
| 5     | not `live` (dev)                                            | `dev`                                              |
| 6     | registration `sign-in`, `taken` or `quota`                  | the same word                                      |
| 7     | registration `failed`                                       | `register-failed`                                  |
| 8     | registration `retrying`                                     | `unreachable`                                      |
| 9     | registration `registering` or `waiting`                     | none: `saving`                                     |
| 10    | the hold is `not-writer`, or `write` is `false`             | `no-write`                                         |
| 11    | the socket is `offline`                                     | `offline`                                          |
| 12    | the socket is `waiting` or `off`                            | `unreachable`                                      |
| 13    | anything else (connecting, catching up, live, hold `limit`) | none: `saving`                                     |

A `unknown-dataset` stop while the socket is still connecting is `saving`: the hello will bring the dataset. The result never says `device` while `local` is `'failed'`, and is `saved` exactly when nothing is pending or held (a seeded property test pins S9 over arbitrary inputs).

## Logs

Client logs are `console.error('[sim-sync] <reason>', ...)` with a status, a protocol code or an error's name only; never a commit, ruleset, name, label, id, token or identity.

| Line                                              | When                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `[sim-sync] registration refused <status> <code>` | A `bug` answer: the HTTP status and the protocol `code`, or `-`                  |
| `[sim-sync] registration handling failed <name>`  | A throw while an answer was handled (a subscriber's, say); once per `SimSync`    |
| `[sim-sync] receive failed <name>`                | `store.receive` threw; the socket halts `broken`                                 |
| `[sim-sync] socket failed <name>`                 | The `WebSocket` constructor threw; once per `SimSocket`                          |
| `[sim-sync] resume refused <reason>`              | A resume refused for a reason other than `limit` or `gone`; once per `SimSocket` |
| `[sim-sync] claim failed <name>`                  | `store.claim` rejected                                                           |
| `[sim-sync] tab lock failed: <name>`              | The tab's own lock could not be had                                              |
| `[sim-sync] tab watch failed: <name>`             | A watch failed other than by abort                                               |
| `[sim-sync] tab post failed: <name>`              | A channel post threw                                                             |

## What is not built

- The page: `/sim` on `LogStore` and `SimSync`, the copy for each `why`, the notices (plan 3).
- The client's end-to-end tests: no page drives `SimSync` until plan 3, which proves the real socket under the CSP, offline, two tabs and a dead connection against `npm run preview`.
- A remix when the sim answers `taken` or write is lost: the edits stay on the device, unsent, until the sharing unit.
- Claiming the edits a live tab left on another sim: when a tab moves to another sim with unsent edits on the one it leaves, they stay under that tab, which still holds its lock, until it reopens that sim or closes. `onGone` claims on whatever sim the store has open at that moment.

## Known limits

- No sync under `npm run dev` (`live: !dev`): no fetch, no socket.
- With no Web Locks, claims happen at open only (a live tab in such a browser can lose unsent records to a tab that opens the same sim) and registration is one at a time per tab only. A tab whose own lock request failed, among tabs that have Web Locks, holds no lock, so the others see it as gone and may claim its records when they open the sim.
- A first signed-out registration whose answer is lost leaves a pseudonymous account on the server, and the retry is another: the person's own sim can read as `taken`, edits unsent, until the sharing unit. A persistently malformed 200 (a proxy page) is retried for ever, bounded only by the backoff.
- A pseudonymous session that expires leaves the device's sims read-only: edits stay on the device, `sign-in` waits for `retryRegistration()`.
- A store with no database that opens a known id treats it as a look and never registers it.
- A `limit` refusal covers size as well as rate: a commit re-applied past the size limit is retried at the backoff's cap for ever. An `invalid` refusal can drop a version the store has re-applied since it was sent (version skew).
- A `hello` with no dataset after one that had it leaves the store on the last dataset it knew (an older server after a rollback).
- A subscriber that throws inside `SimSync`'s publish loop stops later subscribers hearing that update.
- The sim object's send queue is not bounded for a client that never reads (the resume budgets bound the rate only; sim-object.md, For the next units).
- The specs ran in Chromium and WebKit, not Firefox.

## Tests

All specs are colocated and run without timers: time is `FakeClock`, work is held on promises, and the tests await the code's own signals. The test titles carry a row prefix: `C` the connection and resume, `A` the appends, `P` registration, `T` tabs, `V` the save state, `Y` the sync object's scenarios, `S` the invariants.

| Command                                                                | Runs                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest --run --project server src/lib/sim-sync`                   | Node: `backoff`, `register`, `sim-socket`, `tabs`, `save-state` (with a seeded property), `sim-sync` (over a real `LogStore` on `memorySimDb`), `ports` (the store satisfies `SyncStore`) and the fakes' own specs `test/fakes.spec.ts`, `test/hub.spec.ts` |
| `npx vitest --run --project server src/lib/sim-sync src/lib/sim-store` | The client and the store it serves                                                                                                                                                                                                                          |
| `npx vitest --run --project client src/lib/sim-sync`                   | Chromium: `browser.svelte.spec.ts`, `TabPresence` over real Web Locks and a real `BroadcastChannel` (a tab hears another go; two watchers both hear it). `SFH_BROWSER=webkit` runs it in WebKit ([testing.md](testing.md))                                  |

The fakes (`test/fakes.ts`) are deterministic and say in their doc comments what they do not do: `FakeClock` fires timers only on `advance`; `FakeLocks` grants on a later microtask, never inside `request()`, as the real ones do; `FakeFetch` answers through a handler (the hub's `registrar()` answers 201 or 200 for a registered sim) and records every header; `FakeBus` delivers by microtask; `FakeNet` fires the signals. `FakeHub` (`test/hub.ts`) behaves as the real sim object does, and where this document and the hub differ, [sim-object.md](sim-object.md) wins: `hello` carries the dataset; a writer's first open of an empty sim stores a server-authored start commit, so a first resume returns a commit the client did not make; a resume answer is capped and its last frame carries `more` (`frameSize` and `pageSize` split it); a `resume` clears the socket's resumed mark until an answer ends `more: false`, and a socket that is not caught up gets no live commits; a second `resume` while one is outstanding is refused `limit` with `id: null`; a commit already in the log sent again gets no frame; `ping` is answered `pong`; the append checks run in the real order; frames are delivered only on `step()` or `flush()`; after the client's own `close()` the socket goes through CLOSING and fires its own `close` once. Its stored hash is not a real chain, and it models neither the rate bucket nor the resume budgets (`refuseNext` and `refuseResume` force a refusal).
