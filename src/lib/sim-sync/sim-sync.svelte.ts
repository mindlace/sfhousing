// The object a page holds for its store (the sim log sync plan, Tasks 13 and 14): it holds this
// tab's lock, opens a sim with the unsent records of tabs that are gone and watches the live
// ones (claiming a tab's records when it goes), registers the store's sim when the device's own
// work needs it (the registration table, rows P), keeps one SimSocket for the sim, reconnects a
// socket that cannot write when the page becomes visible, and publishes one state with the save
// state. Every wait is the injected clock's; nothing here touches a browser API but the ports
// it is given.
import type { SimDb } from '$lib/sim-store/sim-db';
import { backoffDelay } from './backoff';
import { errorName, type BrowserPorts, type NetEvent, type SyncStore } from './ports';
import { RegisterGate, registerSim, type RegisterAnswer } from './register';
import { saveState, type RegState, type SaveState } from './save-state';
import { OFF_VIEW, SimSocket, type SocketView } from './sim-socket';
import { TabPresence } from './tabs';

export interface SimSyncOptions extends BrowserPorts {
  store: SyncStore;
  /** The store's database, for pendingOwners only; null when it has none. */
  db: SimDb | null;
  /** The store's tabId: this tab's lock and the owner of its records. */
  tabId: string;
  /** False under npm run dev: nothing is fetched or opened (decision 12). */
  live: boolean;
  /** The page's release, compared with hello.build. */
  build: string;
}

export interface SyncState {
  live: boolean;
  registration: RegState;
  /** OFF_VIEW when no socket. */
  socket: SocketView;
  buildMismatch: boolean;
  save: SaveState;
}

/** States in which the evaluation posts nothing of its own: a request or a rule holds it. */
const HOLDING: ReadonlySet<RegState> = new Set<RegState>([
  'registering',
  'retrying',
  'sign-in',
  'taken',
  'quota',
  'failed'
]);

/** States retryRegistration() posts again from (P14). */
const RETRYABLE: ReadonlySet<RegState> = new Set<RegState>([
  'sign-in',
  'quota',
  'taken',
  'failed',
  'retrying'
]);

/** One per store (two in one tab would contend for its lock and its records). */
export class SimSync {
  readonly #o: SimSyncOptions;
  readonly #gate: RegisterGate;
  /** The first start() call's promise; a later call returns it. */
  #starting: Promise<void> | null = null;
  /** start() has resolved (not stopped meanwhile): open may run. */
  #running = false;
  /** This tab's presence; made by start(). */
  #presence: TabPresence | null = null;
  /**
   * The tab holds its lock and announced itself: other owners are watched and claimed when they
   * go. False (no Web Locks, or the lock could not be had): claims at open only (S8).
   */
  #watchTabs = false;
  /** The opens in call order: each waits for the one before it, so the last call wins. */
  #opens: Promise<void> = Promise.resolve();
  /** Final (P17): every handler returns at once. */
  #stopped = false;
  /** Advanced when the sim changes and on stop: an answer or a turn of an older one is stale. */
  #token = 0;
  /** The sim the last evaluation saw the store on. */
  #sim: string | null = null;
  #reg: RegState = 'idle';
  /** Registration retries in a row (P10); reset by retryRegistration() and an ok answer. */
  #regAttempt = 0;
  #cancelRetry: (() => void) | null = null;
  /** A throw while handling a registration answer has been logged (once per SimSync). */
  #loggedAnswer = false;
  /** The socket of #sim, or null. Only its view changes are heard. */
  #socket: SimSocket | null = null;
  /** SimSync.open calls under way: no socket is made while the store may be reopening. */
  #opening = 0;
  #unsubscribe: (() => void)[] = [];
  #subscribers: (() => void)[] = [];
  #state = $state.raw<SyncState>({
    live: false,
    registration: 'idle',
    socket: OFF_VIEW,
    buildMismatch: false,
    save: { kind: 'saved', why: null }
  });

  constructor(o: SimSyncOptions) {
    this.#o = o;
    this.#gate = new RegisterGate(o.locks);
    this.#state = this.#next();
  }

  /** A rune ($state.raw), replaced on every change. */
  get state(): SyncState {
    return this.#state;
  }

  /** Called after every change of `state`. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.#subscribers = [...this.#subscribers, fn];
    return () => {
      this.#subscribers = this.#subscribers.filter((f) => f !== fn);
    };
  }

  /**
   * Takes this tab's lock (TabPresence), then subscribes to the store, the network and the
   * news that a watched tab has gone. Once: a second call returns the first call's promise
   * (after stop() with no earlier call, a resolved one). The page opens the
   * store only through open(), after this has resolved, so no record is written under this
   * tab's id before its lock is held. When the lock cannot be had (no Web Locks, or the request
   * failed) the tab announces nothing and watches no one: other tabs' records are claimed at
   * open only (S8). A stop() while this waits leaves no lock held and subscribes to nothing.
   */
  start(): Promise<void> {
    if (this.#starting !== null) return this.#starting;
    if (this.#stopped) return Promise.resolve();
    this.#starting = this.#start();
    return this.#starting;
  }

  async #start(): Promise<void> {
    const o = this.#o;
    const presence = new TabPresence({ tabId: o.tabId, locks: o.locks, channel: o.channel });
    this.#presence = presence;
    const held = await presence.start();
    if (this.#stopped) return; // stop() has stopped the presence too
    this.#watchTabs = held;
    this.#unsubscribe = [
      ...(held ? [presence.onGone((owner) => this.#onGone(owner))] : []),
      o.store.subscribe(() => this.#evaluate()),
      o.net.watch((e) => this.#onNet(e))
    ];
    this.#running = true;
    this.#evaluate();
  }

  /**
   * Opens a sim in the store, with the unsent records of the tabs that are gone (their lock is
   * free; without Web Locks, every other owner), and watches the other owners so that their
   * records are claimed when they go (never while they hold their lock: S8). Nothing when that
   * sim is already open and ready and no open is under way (F14). Opens run one after another
   * in call order, so the last call wins. Rejects when called before start() has resolved or
   * after stop() (an open waiting for its turn when stop() comes does not open the store,
   * claims nothing and watches nothing), or when the store's open rejects (no retry, decision
   * 17). The socket is stopped before the store is reopened: no socket lives across a reopen
   * (the socket cannot see one start).
   */
  async open(simId: string | null): Promise<void> {
    if (this.#stopped) throw new Error('SimSync: stopped');
    if (!this.#running) throw new Error('SimSync: open before start');
    const store = this.#o.store;
    // Only with no open under way: a store open queued behind another (or a claim) still shows
    // the old sim ready, and this call must queue its own so the last call wins.
    if (this.#opening === 0 && simId !== null && store.ready && store.simId === simId) return;
    this.#leave();
    this.#opening += 1;
    const turn = this.#opens.then(() => this.#openInTurn(simId));
    this.#opens = turn.then(
      () => {},
      () => {}
    );
    try {
      await turn;
    } finally {
      this.#opening -= 1;
      this.#evaluate();
    }
  }

  /** One open, when the opens before it are done (T8). */
  async #openInTurn(simId: string | null): Promise<void> {
    const o = this.#o;
    const store = o.store;
    const presence = this.#presence as TabPresence;
    if (this.#stopped) throw new Error('SimSync: stopped');
    let owners: string[] = [];
    if (simId !== null && o.db !== null && store.local !== 'failed') {
      // A database that cannot answer: no owners (the store's own read reports the failure).
      owners = await o.db.pendingOwners(simId).catch((): string[] => []);
      if (this.#stopped) throw new Error('SimSync: stopped');
    }
    const others = owners.filter((owner) => owner !== o.tabId);
    let gone: string[] = [];
    if (others.length > 0) {
      // The lock table cannot be read: claim no one now; the watches below find who goes.
      gone = await presence.goneOwners(others).catch((): string[] => []);
    }
    if (this.#stopped) throw new Error('SimSync: stopped');
    await store.open(simId, { claim: gone });
    // Without a lock of its own the tab claims at open only (S8): it watches no one.
    if (this.#stopped || !this.#watchTabs) return;
    for (const owner of others) if (!gone.includes(owner)) presence.watch(owner);
  }

  /** T9: a watched tab has gone (its lock is free): its unsent records are this tab's now. */
  #onGone(owner: string): void {
    if (this.#stopped) return;
    // A second call for the same owner (a late announcement) finds nothing left to take.
    void this.#o.store
      .claim([owner])
      .catch((e: unknown) => console.error('[sim-sync] claim failed', errorName(e)));
  }

  /** P14: post the registration again now (from sign-in, quota, taken, failed or retrying). */
  retryRegistration(): void {
    if (this.#stopped || !RETRYABLE.has(this.#reg)) return;
    this.#cancelTimer();
    this.#regAttempt = 0;
    this.#reg = 'idle';
    this.#evaluate();
  }

  /**
   * Final: sets stopped, advances the token, stops the socket and the timer, unsubscribes, then
   * releases this tab's lock. Every handler returns at once afterwards (P17). Once the lock is
   * released other tabs may take the store's unsent records: the page must not edit the store
   * it gave this SimSync after stop() (nothing here can prevent it).
   */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#running = false;
    this.#token += 1;
    this.#cancelTimer();
    const socket = this.#socket;
    this.#socket = null;
    socket?.stop();
    for (const u of this.#unsubscribe) u();
    this.#unsubscribe = [];
    // Nothing is sent from here on: only now may other tabs find this one gone.
    this.#presence?.stop();
    // The last state: no socket. Nothing is published after it.
    this.#publish(true);
  }

  // ---- the evaluation (the registration table) ----

  /**
   * Run after every store notification, registration answer, timer and network signal. The
   * store notifies synchronously inside its calls, the socket's receive included: stopping the
   * socket from here is safe (the socket re-checks that it is current after every call out).
   */
  #evaluate(): void {
    if (this.#stopped) return; // P17
    const store = this.#o.store;
    const sim = store.simId;
    if (sim !== this.#sim) this.#switchTo(sim); // P13
    if (this.#o.live && this.#opening === 0 && sim !== null && store.ready) {
      const r = store.registration;
      if (r === 'done' || r === 'none') {
        // P2, P6: a registered sim, or a look.
        this.#reg = r;
        this.#ensureSocket(sim);
        if (!this.#still(sim)) return;
      } else if (r === 'wait') {
        this.#reg = 'waiting'; // P3
      } else {
        // 'needed'. A sim with confirmed commits is on the server: read it meanwhile (P15), and
        // keep reading it after taken (P8).
        if (store.tipSeq > 0) {
          this.#ensureSocket(sim);
          if (!this.#still(sim)) return;
        }
        if (!HOLDING.has(this.#reg)) {
          if (store.pendingCount > 0 || store.heldCount > 0)
            this.#register(sim); // P4
          else this.#reg = 'idle'; // P5
        }
      }
    }
    this.#publish();
  }

  /**
   * The evaluation of `sim` may go on after a call out (a socket's start tells SimSync's
   * subscribers, who may stop it or open another sim): not stopped, no open under way, and the
   * store still on `sim`. When this is false the call out's own evaluation has run or will.
   */
  #still(sim: string): boolean {
    return !this.#stopped && this.#opening === 0 && this.#o.store.simId === sim;
  }

  /** P13: the store's sim changed. */
  #switchTo(sim: string | null): void {
    this.#leave();
    this.#sim = sim;
  }

  /** Stops the socket, cancels the timer, makes every request under way stale; idle. */
  #leave(): void {
    this.#token += 1;
    this.#cancelTimer();
    this.#regAttempt = 0;
    this.#reg = 'idle';
    this.#stopSocket();
  }

  #stopSocket(): void {
    const socket = this.#socket;
    this.#socket = null;
    socket?.stop();
  }

  #cancelTimer(): void {
    this.#cancelRetry?.();
    this.#cancelRetry = null;
  }

  /** A SimSocket for `sim` unless one runs (a halted one stays: it is final and says why). */
  #ensureSocket(sim: string): void {
    if (this.#socket !== null) return;
    const o = this.#o;
    const socket: SimSocket = new SimSocket({
      store: o.store,
      simId: sim,
      origin: o.origin,
      WebSocket: o.WebSocket,
      clock: o.clock,
      random: o.random,
      net: o.net,
      onChange: () => {
        if (!this.#stopped && this.#socket === socket) this.#publish();
      }
    });
    this.#socket = socket;
    socket.start();
  }

  // ---- registration ----

  /** P4: one request through the gate; its turn re-reads the token before posting (P16). */
  #register(sim: string): void {
    this.#reg = 'registering';
    const token = this.#token;
    const o = this.#o;
    void this.#gate
      .run(() =>
        token === this.#token && !this.#stopped
          ? registerSim(o.fetch, sim, o.clock)
          : Promise.resolve(null)
      )
      .then(
        (a): RegisterAnswer | null => a,
        (): RegisterAnswer => ({ kind: 'retry' }) // the gate failed: as an unanswered request
      )
      .then((a) => {
        if (a === null || token !== this.#token || this.#stopped) return; // P12, P16, P17
        this.#answer(sim, a);
      })
      .catch((e: unknown) => {
        // A throw while handling the answer (a subscriber's, say): the state stays as it is.
        if (this.#loggedAnswer) return;
        this.#loggedAnswer = true;
        console.error('[sim-sync] registration handling failed', errorName(e));
      });
  }

  /** What one registration answer does (P6 to P11), then the evaluation. */
  #answer(sim: string, a: RegisterAnswer): void {
    const store = this.#o.store;
    switch (a.kind) {
      case 'ok': {
        // P6: only a socket that existed before the answer and cannot write reconnects; one the
        // evaluation inside markRegistered makes is new and is left alone (F11).
        const before = this.#socket;
        this.#regAttempt = 0;
        void store.markRegistered(sim); // tells subscribers at once; never rejects
        if (this.#stopped) return;
        if (before !== null && this.#socket === before && before.view.write !== true) {
          before.reconnect();
        }
        break;
      }
      case 'taken':
        // P8: nothing is sent for the sim; a socket stays only to read a sim the server has.
        this.#reg = 'taken';
        if (store.tipSeq === 0) this.#stopSocket();
        break;
      case 'sign-in': // P7
      case 'quota': // P9
        this.#reg = a.kind;
        break;
      case 'retry': {
        // P10: backed off as the socket is; online posts at once.
        this.#reg = 'retrying';
        const token = this.#token;
        this.#cancelTimer();
        this.#cancelRetry = this.#o.clock.after(
          backoffDelay(this.#regAttempt++, this.#o.random),
          () => {
            this.#cancelRetry = null;
            if (this.#stopped || token !== this.#token) return;
            this.#reg = 'idle';
            this.#evaluate();
          }
        );
        break;
      }
      case 'bug':
        // P11: a status and a protocol code only.
        this.#reg = 'failed';
        console.error('[sim-sync] registration refused', a.status, a.code ?? '-');
        break;
    }
    this.#evaluate();
  }

  #onNet(e: NetEvent): void {
    if (this.#stopped) return;
    if (e === 'online' && this.#reg === 'retrying') {
      // P10: online posts at once.
      this.#cancelTimer();
      this.#reg = 'idle';
    }
    if (e === 'visible') {
      // Decision 14: a socket that cannot write, with something to send, connects again: a
      // sign-in made in another tab or window is picked up by the new connection.
      const socket = this.#socket;
      const store = this.#o.store;
      if (
        socket !== null &&
        (store.pendingCount > 0 || store.heldCount > 0) &&
        (socket.view.hold === 'not-writer' || socket.view.write === false)
      ) {
        socket.reconnect(); // nothing when halted; tells subscribers, who may stop SimSync
      }
    }
    this.#evaluate();
  }

  // ---- the state ----

  #next(): SyncState {
    const o = this.#o;
    const store = o.store;
    const socket = this.#socket?.view ?? OFF_VIEW;
    return {
      live: o.live,
      registration: this.#reg,
      socket,
      buildMismatch: socket.serverBuild !== null && socket.serverBuild !== o.build,
      save: saveState({
        live: o.live,
        local: store.local,
        pendingCount: store.pendingCount,
        heldCount: store.heldCount,
        stopped: store.stopped,
        registration: this.#reg,
        socket
      })
    };
  }

  /**
   * Replaces the state when anything in it changed, then tells the subscribers. Nothing once
   * stopped, but for the one final publish stop() makes.
   */
  #publish(final = false): void {
    if (this.#stopped && !final) return;
    const next = this.#next();
    const now = this.#state;
    if (
      next.live === now.live &&
      next.registration === now.registration &&
      next.socket === now.socket &&
      next.buildMismatch === now.buildMismatch &&
      next.save.kind === now.save.kind &&
      next.save.why === now.save.why
    ) {
      return;
    }
    this.#state = next;
    for (const fn of this.#subscribers) fn();
  }
}
