// SimSync against a real store over the in-memory database, the fake sim object (FakeHub), the
// fake fetch (registration answers), the fake clock, locks and network signals. No timers: time
// moves only by clock.advance. The hub stores a start commit when a writer opens an empty sim
// (as the real object does), so a sim this tab made holds that commit before its own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '$lib/ids/base58';
import { DEFAULT_SIM_NAME, type Commit } from '$lib/sim-log';
import { mockConsole } from '$lib/server/test/mock-console';
import { LogStore } from '$lib/sim-store/log-store.svelte';
import { memorySimDb, type SimDb } from '$lib/sim-store/sim-db';
import { DS, draftOf, nameChange, stamped } from '$lib/sim-store/test/commits';
import type { LocksLike } from './ports';
import { OFF_VIEW, type SocketView } from './sim-socket';
import { SimSync, type SimSyncOptions } from './sim-sync.svelte';
import { TAB_LOCK_PREFIX } from './tabs';
import {
  FakeBus,
  FakeClock,
  FakeFetch,
  FakeLocks,
  FakeNet,
  microtasks,
  type FetchAnswer
} from './test/fakes';
import { FakeHub, settle } from './test/hub';

afterEach(() => {
  vi.restoreAllMocks();
});

const ORIGIN = 'http://localhost:4173';
const stamp = () => ({ datasetVersion: DS, build: 'test' });
const namesOf = (cs: Commit[]) => cs.map((c) => (c.changes[0] as { value: string }).value);

interface World {
  hub: FakeHub;
  clock: FakeClock;
  net: FakeNet;
  locks: FakeLocks;
  bus: FakeBus;
  fetch: FakeFetch;
  db: SimDb;
}
function world(): World {
  const hub = new FakeHub({ strict: true });
  return {
    hub,
    clock: new FakeClock(),
    net: new FakeNet(),
    locks: new FakeLocks(),
    bus: new FakeBus(),
    fetch: new FakeFetch(hub.registrar()),
    db: memorySimDb()
  };
}
/** A tab: its store and its SimSync over the world's ports, started. */
async function tab(
  w: World,
  tabId: string,
  o: Partial<SimSyncOptions> & { db?: SimDb | null } = {}
) {
  const t = unstarted(w, tabId, o);
  await t.sync.start();
  return t;
}
/** A tab whose SimSync is not started yet. */
function unstarted(
  w: World,
  tabId: string,
  o: Partial<SimSyncOptions> & { db?: SimDb | null } = {}
) {
  const db = o.db === undefined ? w.db : o.db;
  const store = new LogStore({ db, tabId, stamp });
  const sync = new SimSync({
    store,
    db,
    tabId,
    live: true,
    build: 'b',
    origin: ORIGIN,
    fetch: w.fetch.fetch,
    WebSocket: w.hub.WebSocket,
    clock: w.clock,
    random: () => 0.5,
    locks: w.locks,
    channel: w.bus.channel(),
    net: w.net,
    ...o
  });
  return { store, sync };
}
const sims = (w: World) => w.fetch.calls.map((c) => (c.body as { simId: string }).simId);

describe('SimSync: registration and the socket', () => {
  it('Y1 P1 under live: false nothing leaves the browser; the save state says dev', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a', { live: false });
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(w.fetch.calls).toEqual([]);
    expect(w.hub.sockets).toEqual([]);
    expect(sync.state.registration).toBe('idle');
    expect(sync.state.live).toBe(false);
    expect(sync.state.save).toEqual({ kind: 'device', why: 'dev' });
  });

  it('Y2 P2 a look registers nothing; a sim with no record here gets a read socket', async () => {
    const w = world();
    const sim = newId();
    w.hub.register(sim);
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    await settle(w.hub, store);
    expect(w.hub.sockets).toEqual([]);
    await sync.open(sim);
    await settle(w.hub, store);
    expect(w.fetch.calls).toEqual([]);
    expect(w.hub.sockets.map((s) => s.url)).toEqual([expect.stringContaining(sim)]);
    expect(sync.state.registration).toBe('none');
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('Y3 P3 P4 P6 a first edit registers once it is stored, then opens one socket and saves', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    expect(sync.state.registration).toBe('waiting');
    expect(w.fetch.calls).toEqual([]);
    await settle(w.hub, store);
    expect(sims(w)).toEqual([store.simId]);
    expect((await w.db.read(store.simId!)).sim?.registered).toBe(true);
    expect(w.hub.sockets).toHaveLength(1); // F11: the new socket is not reconnected
    expect(w.hub.sockets[0].closedWith).toBeNull();
    // The object's start commit, then the tab's own.
    expect(namesOf(w.hub.commits(store.simId!))).toEqual([DEFAULT_SIM_NAME, 'A']);
    expect(sync.state.registration).toBe('done');
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('Y4 P10 offline, a first edit retries with backoff and saves at once when online', async () => {
    const w = world();
    w.net.set('offline');
    w.fetch.handler = () => 'network';
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.registration).toBe('retrying');
    expect(sync.state.save).toEqual({ kind: 'device', why: 'unreachable' });
    expect(w.clock.nextDelay()).toBe(1000);
    w.clock.advance(999);
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(1);
    w.clock.advance(1);
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(2);
    expect(w.clock.nextDelay()).toBe(2000); // the backoff grows
    w.fetch.handler = w.hub.registrar();
    w.net.set('online');
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(3);
    expect(w.hub.sockets).toHaveLength(1);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
    expect(namesOf(w.hub.commits(store.simId!))).toEqual([DEFAULT_SIM_NAME, 'A']);
  });

  it('P14 retryRegistration while retrying posts at once and starts the backoff again', async () => {
    const w = world();
    w.fetch.handler = () => 'network';
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.clock.advance(1000);
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(2);
    expect(w.clock.nextDelay()).toBe(2000);
    sync.retryRegistration();
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(3);
    expect(sync.state.registration).toBe('retrying');
    expect(w.clock.nextDelay()).toBe(1000); // the old timer is gone, the attempt count reset
    w.clock.advance(1000);
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(4);
  });

  it('Y5 P7 P14 401 keeps the commits and opens nothing until retryRegistration', async () => {
    const w = world();
    w.fetch.handler = () => ({ status: 401, body: { error: 'x', code: 'sign_in' } });
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.registration).toBe('sign-in');
    expect(sync.state.save).toEqual({ kind: 'device', why: 'sign-in' });
    w.clock.advance(300_000);
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(1);
    expect(w.hub.sockets).toEqual([]);
    expect(store.pendingCount).toBe(1);
    w.fetch.handler = w.hub.registrar();
    sync.retryRegistration();
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(2);
    expect(w.hub.sockets).toHaveLength(1);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('P14 retryRegistration does nothing while nothing is held back', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.registration).toBe('done');
    sync.retryRegistration();
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(1);
    expect(w.hub.sockets).toHaveLength(1);
  });

  it('Y6 P8 taken on a sim with nothing on the server keeps the commits and stops the socket', async () => {
    const w = world();
    const sim = newId();
    w.hub.register(sim);
    w.hub.write = false;
    w.fetch.handler = () => ({ status: 409, body: { error: 'x', code: 'taken' } });
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    store.rename('Mine');
    await settle(w.hub, store);
    expect(store.tipSeq).toBe(0);
    expect(sync.state.registration).toBe('taken');
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(w.hub.sockets).toHaveLength(1);
    expect(store.pendingCount).toBe(1);
    expect(w.hub.commits(sim)).toEqual([]);
    expect(sync.state.socket.phase).toBe('off');
    expect(sync.state.save).toEqual({ kind: 'device', why: 'taken' });
    // Later edits and signals open nothing and post nothing.
    store.rename('Mine again');
    w.net.set('offline');
    w.net.set('online');
    w.clock.advance(300_000);
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.fetch.calls).toHaveLength(1);
  });

  it('Y24 P8 taken on a sim that exists on the server keeps the read socket and sends nothing', async () => {
    const w = world();
    const sim = newId();
    w.hub.register(sim);
    w.hub.write = false;
    w.hub.foreign(sim, draftOf(0, [nameChange('Theirs')]));
    w.fetch.handler = () => ({ status: 409, body: { error: 'x', code: 'taken' } });
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    expect(store.tipSeq).toBe(1);
    store.rename('Mine');
    await settle(w.hub, store);
    expect(sync.state.registration).toBe('taken');
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.hub.sockets[0].closedWith).toBeNull();
    expect(w.hub.appends).toEqual([]);
    expect(store.pendingCount).toBe(1);
    expect(sync.state.save).toEqual({ kind: 'device', why: 'taken' });
  });

  it.each([
    [{ status: 403, body: { error: 'x', code: 'quota' } }, 'quota', 'quota'],
    [{ status: 400, body: { error: 'x', code: 'invalid_id' } }, 'failed', 'register-failed']
  ] as const)('Y7 P9 P11 %j: %s, nothing sent, nothing retried', async (answer, reg, why) => {
    const w = world();
    w.fetch.handler = () => answer;
    const { error } = mockConsole('error');
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.clock.advance(300_000);
    await settle(w.hub, store);
    expect(sync.state.registration).toBe(reg);
    expect(sync.state.save).toEqual({ kind: 'device', why });
    expect(w.fetch.calls).toHaveLength(1);
    expect(w.hub.sockets).toEqual([]);
    if (reg === 'failed') {
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('[sim-sync] registration refused', 400, 'invalid_id');
    } else expect(error).not.toHaveBeenCalled();
  });

  it('Y8 P6 a look that becomes an edit registers, and reconnects the socket that could not write', async () => {
    const w = world();
    const sim = newId();
    w.hub.register(sim);
    w.hub.write = false;
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    // A reconnect of the same SimSocket keeps the last hello's build and never shows `off`; a
    // second SimSocket would start with no build.
    const seen: SocketView[] = [];
    sync.subscribe(() => seen.push(sync.state.socket));
    store.rename('A');
    w.hub.write = true; // the registration's session writes this sim
    await settle(w.hub, store);
    expect(sims(w)).toEqual([sim]);
    expect(seen.map((v) => v.phase)).toContain('connecting');
    expect(seen.filter((v) => v.phase === 'off' || v.serverBuild === null)).toEqual([]);
    // One SimSocket, reconnected once: the reader's connection closed, a writer's opened.
    expect(w.hub.sockets).toHaveLength(2);
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(w.hub.sockets[1].closedWith).toBeNull();
    // The reader opened nothing, so the writer's open stored the start commit.
    expect(namesOf(w.hub.commits(sim))).toEqual([DEFAULT_SIM_NAME, 'A']);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('P6 an ok answer leaves a socket that already writes alone', async () => {
    const w = world();
    const sim = newId();
    const first = draftOf(0, [nameChange('S')]);
    w.hub.register(sim);
    w.hub.foreign(sim, first);
    await w.db.createSim(
      { simId: sim, createdAt: 1, registered: false },
      { batch: { owner: 'x', confirmed: [stamped(first, 1)], put: [], remove: [] } }
    );
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    expect(sync.state.socket.write).toBe(true);
    store.rename('A');
    await settle(w.hub, store);
    expect(sims(w)).toEqual([sim]);
    expect(w.hub.sockets).toHaveLength(1);
    expect(namesOf(w.hub.commits(sim))).toEqual(['S', 'A']);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('Y9 P12 an answer that comes after the store moved to another sim opens nothing', async () => {
    const w = world();
    let answer!: (a: FetchAnswer) => void;
    w.fetch.handler = () => new Promise((resolve) => (answer = resolve));
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.registration).toBe('registering');
    const first = store.simId!;
    await sync.open(null);
    answer({ status: 201, body: { simId: first, created: true } });
    await settle(w.hub, store);
    expect(w.hub.sockets).toEqual([]);
    expect((await w.db.read(first)).sim?.registered).toBe(false);
    expect(sync.state.registration).toBe('idle');
    expect(w.fetch.calls).toHaveLength(1);
  });

  it("Y10 P13 switching sims stops the old socket and opens the new sim's own", async () => {
    const w = world();
    const other = newId();
    w.hub.register(other);
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    const a = store.simId!;
    w.hub.foreign(a, draftOf(w.hub.commits(a).length, [nameChange('F')])); // queued to the old socket
    await sync.open(other);
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(2);
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(w.hub.sockets[1].url).toContain(other);
    expect(store.simId).toBe(other);
    // Only the other sim's own commit (the start commit its writer's open stored) is applied.
    expect(w.hub.commits(other)).toHaveLength(1);
    expect(store.tipSeq).toBe(1);
    expect(sync.state.registration).toBe('none');
  });

  it('F14 open of the sim already open and ready does nothing', async () => {
    const w = world();
    const sim = newId();
    w.hub.register(sim);
    w.hub.write = false; // a reader: the edit stays pending
    const { store, sync } = await tab(w, 'a', { db: null });
    await sync.open(sim);
    await settle(w.hub, store);
    store.rename('A'); // no storage: only the store holds it
    await sync.open(sim);
    await settle(w.hub, store);
    expect(store.pendingCount).toBe(1);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.hub.sockets[0].closedWith).toBeNull();
  });

  it('two opens in a row: no socket for the sim the store passes through', async () => {
    const w = world();
    const x = newId();
    const y = newId();
    w.hub.register(x);
    w.hub.register(y);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const base = memorySimDb();
    const db: SimDb = {
      ...base,
      read: async (id) => {
        if (id === x) await held;
        return base.read(id);
      }
    };
    const { store, sync } = await tab(w, 'a', { db });
    const first = sync.open(x);
    const second = sync.open(y);
    release();
    await Promise.all([first, second]);
    await settle(w.hub, store);
    expect(store.simId).toBe(y);
    expect(w.hub.sockets.map((s) => s.url)).toEqual([expect.stringContaining(y)]);
  });

  it('S3 the store opened another sim without SimSync: the old socket stops, the new sim gets one', async () => {
    const w = world();
    const x = newId();
    const y = newId();
    w.hub.register(x);
    w.hub.register(y);
    const { store, sync } = await tab(w, 'a');
    await sync.open(x);
    await settle(w.hub, store);
    await store.open(y);
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(2);
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(w.hub.sockets[1].url).toContain(y);
    expect(sync.state.socket.phase).toBe('live');
  });

  it('a failed open leaves no socket on the sim the store was on, and none after', async () => {
    const w = world();
    const x = newId();
    const y = newId();
    w.hub.register(x);
    const base = memorySimDb();
    const db: SimDb = {
      ...base,
      read: (id) => (id === y ? Promise.reject(new Error('closed')) : base.read(id))
    };
    const { store, sync } = await tab(w, 'a', { db });
    await sync.open(x);
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    await expect(sync.open(y)).rejects.toThrow('closed');
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(sync.state.socket).toEqual(OFF_VIEW);
  });

  it('open of the sim the store is on, behind an open of another still queued, ends on it', async () => {
    const w = world();
    const x = newId();
    const y = newId();
    w.hub.register(x);
    w.hub.register(y);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const base = memorySimDb();
    const db: SimDb = {
      ...base,
      claimPending: async (...args) => {
        await held;
        return base.claimPending(...args);
      }
    };
    const { store, sync } = await tab(w, 'a', { db });
    await sync.open(x);
    await settle(w.hub, store);
    const claim = store.claim(['gone-tab']); // the store's next open waits behind it
    const toY = sync.open(y);
    const toX = sync.open(x); // the store is still ready on x: not a reason to do nothing
    release();
    await Promise.all([claim, toY, toX]);
    await settle(w.hub, store);
    expect(store.simId).toBe(x);
    expect(store.ready).toBe(true);
    expect(w.hub.sockets.filter((s) => s.url.includes(y))).toEqual([]);
    expect(w.hub.sockets.at(-1)?.url).toContain(x);
    expect(w.hub.sockets.at(-1)?.closedWith).toBeNull();
    expect(w.fetch.calls).toEqual([]);
  });

  /** A sim this device stored, confirmed on the server, with one of this tab's edits unsent. */
  async function storedWithEdit(w: World) {
    const sim = newId();
    const first = draftOf(0, [nameChange('S')]);
    const mine = draftOf(1, [nameChange('Mine')]);
    w.hub.register(sim);
    w.hub.foreign(sim, first);
    await w.db.createSim(
      { simId: sim, createdAt: 1, registered: false },
      {
        batch: {
          owner: 'a',
          confirmed: [stamped(first, 1)],
          put: [{ id: mine.id, pending: { draft: mine, targetId: null } }],
          remove: []
        }
      }
    );
    return sim;
  }

  it('a subscriber that stops SimSync when it first sees a socket hears nothing after the end', async () => {
    const w = world();
    const sim = await storedWithEdit(w);
    const { store, sync } = await tab(w, 'a');
    let heard = 0;
    let atEnd = -1;
    sync.subscribe(() => {
      heard++;
      if (atEnd < 0 && sync.state.socket.phase !== 'off') {
        atEnd = 0;
        sync.stop();
        atEnd = heard; // the final state, published inside stop(), is counted
      }
    });
    await sync.open(sim);
    await settle(w.hub, store);
    w.clock.advance(300_000);
    await settle(w.hub, store);
    expect(atEnd).toBeGreaterThan(0);
    expect(heard).toBe(atEnd);
    expect(sync.state.socket).toEqual(OFF_VIEW);
    expect(w.fetch.calls).toEqual([]);
    expect(w.clock.nextDelay()).toBeNull();
  });

  it('a subscriber that opens another sim when it first sees a socket posts nothing for the one left', async () => {
    const w = world();
    const sim = await storedWithEdit(w);
    const other = newId();
    // The other sim's read is held, so the store stays on `sim` while the request could go.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const db: SimDb = {
      ...w.db,
      read: async (id) => {
        if (id === other) await held;
        return w.db.read(id);
      }
    };
    const { store, sync } = await tab(w, 'a', { db });
    let opened: Promise<void> | null = null;
    sync.subscribe(() => {
      if (opened === null && sync.state.socket.phase !== 'off') opened = sync.open(other);
    });
    await sync.open(sim);
    expect(opened).not.toBeNull();
    await settle(w.hub, store);
    expect(w.fetch.calls).toEqual([]);
    release();
    await opened;
    await settle(w.hub, store);
    expect(store.simId).toBe(other);
    expect(w.fetch.calls).toEqual([]);
    expect(sync.state.registration).toBe('none'); // the other sim is a look
  });

  it('a throw while an answer is handled is logged once by name and is not unhandled', async () => {
    const w = world();
    w.fetch.handler = () => ({ status: 401, body: { error: 'x', code: 'sign_in' } });
    const { error } = mockConsole('error');
    const { store, sync } = await tab(w, 'a');
    let thrown = 0;
    sync.subscribe(() => {
      if (sync.state.registration === 'sign-in' && thrown === 0) {
        thrown++;
        throw new TypeError('subscriber failed');
      }
    });
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(thrown).toBe(1);
    // The subscriber's throw stays in the publish loop.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] subscriber failed', 'TypeError');
    expect(sync.state.registration).toBe('sign-in');
  });

  it("a throw of the store's while an answer is handled is logged once by name", async () => {
    const w = world();
    let boom = false;
    w.fetch.handler = () => {
      boom = true; // armed for the answer's handling
      return { status: 409, body: { error: 'x', code: 'taken' } };
    };
    const { error } = mockConsole('error');
    const real = new LogStore({ db: w.db, tabId: 'a', stamp });
    // The store as SimSync sees it: its tipSeq throws once when armed (the taken answer reads it).
    const store = new Proxy(real, {
      get(target, key) {
        if (key === 'tipSeq' && boom) {
          boom = false;
          throw new RangeError('tip');
        }
        const v: unknown = Reflect.get(target, key, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      }
    });
    const sync = new SimSync({
      store,
      db: w.db,
      tabId: 'a',
      live: true,
      build: 'b',
      origin: ORIGIN,
      fetch: w.fetch.fetch,
      WebSocket: w.hub.WebSocket,
      clock: w.clock,
      random: () => 0.5,
      locks: w.locks,
      channel: null,
      net: w.net
    });
    await sync.start();
    await sync.open(null);
    real.rename('A');
    await settle(w.hub, real);
    expect(w.fetch.calls).toHaveLength(1);
    expect(boom).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] registration handling failed', 'RangeError');
  });

  it('a subscriber that throws on a live foreign commit leaves the socket live and the next subscriber called', async () => {
    const w = world();
    const sim = newId();
    w.hub.register(sim);
    w.hub.write = false;
    w.hub.foreign(sim, draftOf(0, [nameChange('Theirs')]));
    w.fetch.handler = () => ({ status: 409, body: { error: 'x', code: 'taken' } });
    const { error } = mockConsole('error');
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    store.rename('Mine');
    await settle(w.hub, store);
    expect(sync.state.socket.phase).toBe('live');
    expect(sync.state.save).toEqual({ kind: 'device', why: 'taken' });
    let thrown = 0;
    const heard: string[] = [];
    sync.subscribe(() => {
      thrown++;
      throw new TypeError('first');
    });
    sync.subscribe(() => {
      thrown++;
      throw new RangeError('second');
    });
    sync.subscribe(() => heard.push(sync.state.save.kind));
    // The store writes the foreign commit (saving), then the write ends (device again).
    w.hub.foreign(sim, draftOf(1, [nameChange('Theirs again')]));
    await settle(w.hub, store);
    expect(thrown).toBeGreaterThanOrEqual(2);
    expect(heard).toContain('saving');
    expect(store.tipSeq).toBe(2);
    expect(sync.state.socket).toMatchObject({ phase: 'live', halt: null });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] subscriber failed', 'TypeError');
  });

  it('a subscriber that throws on an ok registration answer: no unhandled rejection, state done', async () => {
    const w = world();
    const { error } = mockConsole('error');
    const { store, sync } = await tab(w, 'a');
    let thrown = 0;
    sync.subscribe(() => {
      if (sync.state.registration === 'done' && thrown === 0) {
        thrown++;
        throw new TypeError('subscriber failed');
      }
    });
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(thrown).toBe(1);
    expect(sync.state.registration).toBe('done');
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] subscriber failed', 'TypeError');
  });

  it('a halted socket is kept and reported; nothing revives it; another sim gets its own', async () => {
    const w = world();
    const other = newId();
    w.hub.register(other);
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.hub.closeAll(4410); // the sim was taken down
    await settle(w.hub, store);
    expect(sync.state.socket).toMatchObject({ phase: 'halted', halt: 'gone' });
    store.rename('B');
    await settle(w.hub, store);
    expect(sync.state.save).toEqual({ kind: 'device', why: 'gone' });
    w.net.set('offline');
    w.net.set('online');
    sync.retryRegistration();
    w.clock.advance(300_000);
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.fetch.calls).toHaveLength(1);
    expect(sync.state.socket.halt).toBe('gone');
    await sync.open(other);
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(2);
    expect(w.hub.sockets[1].url).toContain(other);
    expect(sync.state.socket).toMatchObject({ phase: 'live', halt: null });
  });

  it('open rejects before start', async () => {
    const w = world();
    const store = new LogStore({ db: w.db, tabId: 'a', stamp });
    const sync = new SimSync({
      store,
      db: w.db,
      tabId: 'a',
      live: true,
      build: 'b',
      origin: ORIGIN,
      fetch: w.fetch.fetch,
      WebSocket: w.hub.WebSocket,
      clock: w.clock,
      random: () => 0.5,
      locks: w.locks,
      channel: null,
      net: w.net
    });
    await expect(sync.open(null)).rejects.toThrow();
    expect(store.ready).toBe(false);
  });

  it('Y13 write revoked mid-session keeps edits on the device and sends them when it returns', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.hub.setAccess(false);
    store.rename('B');
    await settle(w.hub, store);
    expect(sync.state.save).toEqual({ kind: 'device', why: 'no-write' });
    expect(store.pendingCount).toBe(1);
    w.hub.setAccess(true);
    await settle(w.hub, store);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
    expect(w.hub.sockets).toHaveLength(1);
  });

  it('Y14 a server on another build is reported and the tab keeps saving', async () => {
    const w = world();
    w.hub.build = 'a-newer-release';
    const { store, sync } = await tab(w, 'a');
    expect(sync.state.buildMismatch).toBe(false);
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.socket.serverBuild).toBe('a-newer-release');
    expect(sync.state.buildMismatch).toBe(true);
    expect(sync.state.save.kind).toBe('saved');
  });

  it('Y14 a server on the same build is not a mismatch', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.socket.serverBuild).toBe('b');
    expect(sync.state.buildMismatch).toBe(false);
  });

  it('Y15 open rejects when the store cannot read, and is not retried', async () => {
    const w = world();
    const bad: SimDb = { ...memorySimDb(), read: () => Promise.reject(new Error('closed')) };
    const { store, sync } = await tab(w, 'a', { db: bad });
    await expect(sync.open(newId())).rejects.toThrow('closed');
    expect(store.ready).toBe(false);
    w.clock.advance(300_000);
    await settle(w.hub, store);
    expect(w.hub.sockets).toEqual([]);
    expect(w.fetch.calls).toEqual([]);
  });

  it('Y16 two tabs register one at a time: the second request waits for the first answer', async () => {
    const w = world();
    const answers: ((a: FetchAnswer) => void)[] = [];
    w.fetch.handler = () => new Promise((resolve) => answers.push(resolve));
    const A = await tab(w, 'a');
    const B = await tab(w, 'b');
    await A.sync.open(null);
    await B.sync.open(null);
    A.store.rename('A');
    B.store.rename('B');
    await settle(w.hub, A.store, B.store);
    expect(w.fetch.calls).toHaveLength(1);
    const sim = sims(w)[0];
    w.hub.register(sim);
    answers[0]({ status: 201, body: { simId: sim, created: true } });
    await settle(w.hub, A.store, B.store);
    expect(w.fetch.calls).toHaveLength(2);
    expect(w.fetch.maxInFlight).toBe(1);
  });

  it('Y20 P16 a registration waiting for its turn is not posted once its tab left the sim', async () => {
    const w = world();
    const answers: ((a: FetchAnswer) => void)[] = [];
    w.fetch.handler = () => new Promise((resolve) => answers.push(resolve));
    const A = await tab(w, 'a');
    const B = await tab(w, 'b');
    await A.sync.open(null);
    A.store.rename('A');
    await settle(w.hub, A.store); // A's request is out and holds the lock
    await B.sync.open(null);
    B.store.rename('B'); // B adopts A's sim and queues its own registration
    await settle(w.hub, B.store);
    expect(B.store.simId).toBe(A.store.simId);
    expect(B.sync.state.registration).toBe('registering');
    await B.sync.open(null); // B leaves the sim before its turn
    const sim = sims(w)[0];
    w.hub.register(sim);
    answers[0]({ status: 201, body: { simId: sim, created: true } });
    await settle(w.hub, A.store, B.store);
    expect(w.fetch.calls).toHaveLength(1);
    // No registration lock is left held; each tab holds only its own tab lock (Task 14).
    expect(w.locks.held().sort()).toEqual([`${TAB_LOCK_PREFIX}a`, `${TAB_LOCK_PREFIX}b`]);
  });

  it('Y17 P5 a sim needing registration with nothing to send and nothing on the server: nothing', async () => {
    const w = world();
    const sim = newId();
    await w.db.createSim({ simId: sim, createdAt: 1, registered: false });
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    expect(store.registration).toBe('needed');
    expect(sync.state.registration).toBe('idle');
    expect(w.fetch.calls).toEqual([]);
    expect(w.hub.sockets).toEqual([]);
    expect(sync.state.save.kind).toBe('saved');
  });

  it('Y23 P15 a sim needing registration that is on the server is read, with nothing posted', async () => {
    const w = world();
    const sim = newId();
    const first = draftOf(0, [nameChange('S')]);
    w.hub.register(sim);
    w.hub.foreign(sim, first);
    await w.db.createSim(
      { simId: sim, createdAt: 1, registered: false },
      { batch: { owner: 'x', confirmed: [stamped(first, 1)], put: [], remove: [] } }
    );
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    expect(store.registration).toBe('needed');
    expect(sync.state.registration).toBe('idle');
    expect(w.fetch.calls).toEqual([]);
    expect(w.hub.sockets).toHaveLength(1);
    w.hub.foreign(sim, draftOf(1, [nameChange('T')]));
    await settle(w.hub, store);
    expect(store.tipSeq).toBe(2);
  });

  it('Y18 with no storage the save state never says this device', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a', { db: null });
    w.net.set('offline');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.save).toEqual({ kind: 'unsaved', why: 'offline' });
    w.net.set('online');
    await settle(w.hub, store);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('a gate that rejects counts as retry; nothing throws', async () => {
    const w = world();
    // The lock API fails after the job ran (the gate rethrows a failure once the job started).
    const locks: LocksLike = {
      async request(_name, _options, callback) {
        await callback(null);
        throw new DOMException('lost', 'AbortError');
      },
      query: () => w.locks.query()
    };
    const { store, sync } = await tab(w, 'a', { locks });
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(w.fetch.calls).toHaveLength(1);
    expect(sync.state.registration).toBe('retrying');
    expect(w.hub.sockets).toEqual([]);
  });

  it('S3 a stop from inside a store notification during a receive leaves no timer and no socket', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    const a = store.simId!;
    let stops = 0;
    store.subscribe(() => {
      if (store.tipSeq === 3 && stops === 0) {
        stops++;
        sync.stop(); // inside the store's receive, inside the socket's frame
      }
    });
    w.hub.foreign(a, draftOf(w.hub.commits(a).length, [nameChange('F')]));
    await settle(w.hub, store);
    expect(stops).toBe(1);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(w.clock.nextDelay()).toBeNull();
    expect(sync.state.socket.phase).toBe('off');
  });

  it('Y22 P17 after stop, a late answer opens nothing and records nothing', async () => {
    const w = world();
    let answer!: (a: FetchAnswer) => void;
    w.fetch.handler = () => new Promise((resolve) => (answer = resolve));
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    sync.stop();
    w.hub.register(store.simId!);
    answer({ status: 201, body: { simId: store.simId, created: true } });
    w.net.set('offline');
    w.net.set('online');
    await settle(w.hub, store);
    expect(w.hub.sockets).toEqual([]);
    expect((await w.db.read(store.simId!)).sim?.registered).toBe(false);
    expect(store.registration).toBe('needed');
  });

  it('Y22 P17 after stop, a retry timer and online post nothing', async () => {
    const w = world();
    w.fetch.handler = () => 'network';
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    expect(sync.state.registration).toBe('retrying');
    sync.stop();
    expect(w.clock.nextDelay()).toBeNull();
    w.clock.advance(300_000);
    w.net.set('offline');
    w.net.set('online');
    sync.retryRegistration();
    store.rename('B');
    await settle(w.hub, store);
    await microtasks();
    expect(w.fetch.calls).toHaveLength(1);
    expect(w.hub.sockets).toEqual([]);
  });

  it('P17 after stop, open rejects and a store edit opens nothing', async () => {
    const w = world();
    const sim = newId();
    w.hub.register(sim);
    const { store, sync } = await tab(w, 'a');
    await sync.open(sim);
    await settle(w.hub, store);
    sync.stop();
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    await expect(sync.open(null)).rejects.toThrow();
    store.rename('A');
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.fetch.calls).toEqual([]);
  });
});

describe('SimSync: tabs, claims and visibility', () => {
  /** A sim on the server and stored here, registered: tabs that open it write at once. */
  async function onServer(w: World) {
    const sim = newId();
    const first = draftOf(0, [nameChange('S')]);
    w.hub.register(sim);
    w.hub.foreign(sim, first);
    await w.db.createSim(
      { simId: sim, createdAt: 1, registered: true },
      { batch: { owner: 'x', confirmed: [stamped(first, 1)], put: [], remove: [] } }
    );
    return sim;
  }
  /** A tab that is gone (it never held a lock) with one unsent rename on `sim`. */
  async function goneTab(w: World, sim: string, name: string, db: SimDb = w.db) {
    const g = new LogStore({ db, tabId: 'g', stamp });
    await g.open(sim);
    g.rename(name);
    await g.written();
  }

  it('Y11 T8 T9 open claims gone tabs, never a live one; a tab that goes later is claimed then', async () => {
    const w = world();
    const A = await tab(w, 'a');
    await A.sync.open(null);
    A.store.rename('A');
    await settle(w.hub, A.store);
    const sim = A.store.simId!;
    const B = await tab(w, 'b', { live: false }); // alive, never sends
    await B.sync.open(sim);
    B.store.rename('B');
    await B.store.written();
    await goneTab(w, sim, 'G');
    const C = await tab(w, 'c');
    await C.sync.open(sim);
    await settle(w.hub, A.store, C.store);
    expect(namesOf(w.hub.commits(sim))).toEqual([DEFAULT_SIM_NAME, 'A', 'G']);
    expect(B.store.pendingCount).toBe(1);
    B.sync.stop();
    await settle(w.hub, A.store, C.store);
    expect(namesOf(w.hub.commits(sim))).toEqual([DEFAULT_SIM_NAME, 'A', 'G', 'B']);
    expect(A.store.pendingCount + C.store.pendingCount).toBe(0);
  });

  it('Y12 two tabs editing in turn end with one order on both and on the server', async () => {
    const w = world();
    const A = await tab(w, 'a');
    await A.sync.open(null);
    A.store.rename('A0');
    await settle(w.hub, A.store);
    const B = await tab(w, 'b');
    await B.sync.open(A.store.simId);
    for (let i = 1; i <= 5; i++) {
      A.store.rename(`A${i}`);
      B.store.rename(`B${i}`);
      await settle(w.hub, A.store, B.store);
    }
    // The object's start commit, A0, then ten more.
    expect(w.hub.commits(A.store.simId!)).toHaveLength(12);
    expect(A.store.tipSeq).toBe(12);
    expect(B.store.tipSeq).toBe(12);
    expect(A.store.name).toBe(B.store.name);
    expect(w.fetch.calls).toHaveLength(1);
    expect([A.sync.state.save.kind, B.sync.state.save.kind]).toEqual(['saved', 'saved']);
  });

  it('Y19 becoming visible without write reconnects, to pick up a sign-in made elsewhere', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.hub.setAccess(false);
    store.rename('B');
    await settle(w.hub, store);
    expect(sync.state.save).toEqual({ kind: 'device', why: 'no-write' });
    w.hub.write = true;
    w.net.set('hidden');
    w.net.set('visible');
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(2);
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(namesOf(w.hub.commits(store.simId!))).toEqual([DEFAULT_SIM_NAME, 'A', 'B']);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('visible with nothing pending or held reconnects nothing, even without write', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.hub.setAccess(false);
    await settle(w.hub, store);
    expect(sync.state.socket.write).toBe(false);
    w.net.set('hidden');
    w.net.set('visible');
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.hub.sockets[0].closedWith).toBeNull();
  });

  it('visible on a socket that writes reconnects nothing, with an append unanswered', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.hub.hold = true;
    store.rename('B');
    await settle(w.hub, store);
    expect(store.pendingCount).toBe(1);
    expect(sync.state.socket.write).toBe(true);
    w.net.set('hidden');
    w.net.set('visible');
    w.hub.hold = false;
    w.hub.release();
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    expect(w.hub.sockets[0].closedWith).toBeNull();
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('visible on a socket held not-writer while it writes, with something pending, reconnects', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.hub.refuseNext('not-writer');
    store.rename('B');
    await settle(w.hub, store);
    // Only the hold says it cannot write: the access it was given is still write.
    expect(sync.state.socket).toMatchObject({ hold: 'not-writer', write: true });
    expect(store.pendingCount).toBe(1);
    w.net.set('hidden');
    w.net.set('visible');
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(2);
    expect(w.hub.sockets[0].closedWith).toBe(1000);
    expect(namesOf(w.hub.commits(store.simId!))).toEqual([DEFAULT_SIM_NAME, 'A', 'B']);
    expect(sync.state.save).toEqual({ kind: 'saved', why: null });
  });

  it('visible on a halted socket that cannot write, with something pending, opens nothing', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a');
    await sync.open(null);
    store.rename('A');
    await settle(w.hub, store);
    w.hub.refuseNext('not-writer');
    store.rename('B');
    await settle(w.hub, store);
    w.hub.closeAll(4410); // the sim was taken down
    await settle(w.hub, store);
    expect(sync.state.socket).toMatchObject({ phase: 'halted', halt: 'gone', hold: 'not-writer' });
    expect(store.pendingCount).toBe(1);
    w.net.set('hidden');
    w.net.set('visible');
    await settle(w.hub, store);
    expect(w.hub.sockets).toHaveLength(1);
    expect(sync.state.socket).toMatchObject({ phase: 'halted', halt: 'gone' });
  });

  it('Y25 opening the sim that is already open does nothing: unsent edits stay (no storage)', async () => {
    const w = world();
    const { store, sync } = await tab(w, 'a', { db: null, live: false });
    await sync.open(null);
    store.rename('A');
    await sync.open(store.simId);
    expect(store.pendingCount).toBe(1);
    expect(store.name).toBe('A');
  });

  it('Y26 stop releases the tab lock, so other tabs find this one gone', async () => {
    const w = world();
    const A = await tab(w, 'a');
    await tab(w, 'b');
    expect(w.locks.held().sort()).toEqual([`${TAB_LOCK_PREFIX}a`, `${TAB_LOCK_PREFIX}b`]);
    A.sync.stop();
    await microtasks();
    expect(w.locks.held()).toEqual([`${TAB_LOCK_PREFIX}b`]);
  });

  it('opens run in call order: a slow open of y then open of x ends on x', async () => {
    const w = world();
    const x = newId();
    const y = newId();
    w.hub.register(x);
    w.hub.register(y);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const db: SimDb = {
      ...w.db,
      pendingOwners: async (id) => {
        if (id === y) await held;
        return w.db.pendingOwners(id);
      }
    };
    const { store, sync } = await tab(w, 'a', { db });
    const toY = sync.open(y);
    const toX = sync.open(x);
    await microtasks();
    release();
    await Promise.all([toY, toX]);
    await settle(w.hub, store);
    expect(store.simId).toBe(x);
    expect(store.ready).toBe(true);
    expect(w.hub.sockets.filter((s) => s.url.includes(y))).toEqual([]);
    expect(w.hub.sockets.map((s) => s.url)).toEqual([expect.stringContaining(x)]);
    expect(w.fetch.calls).toEqual([]);
  });

  it('a stop during an open, before the store opens, opens nothing, claims nothing, watches nothing', async () => {
    const w = world();
    const sim = await onServer(w);
    const B = await tab(w, 'b', { live: false });
    await B.sync.open(sim);
    B.store.rename('B');
    await B.store.written();
    await goneTab(w, sim, 'G'); // after b's open, so b has not claimed it
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const claimPending = vi.fn(w.db.claimPending);
    const db: SimDb = {
      ...w.db,
      claimPending,
      pendingOwners: async (id) => {
        await held;
        return w.db.pendingOwners(id);
      }
    };
    const { store, sync } = await tab(w, 'c', { db });
    const opened = sync.open(sim);
    sync.stop();
    release();
    await expect(opened).rejects.toThrow('stopped');
    await microtasks();
    expect(store.ready).toBe(false);
    expect(store.simId).toBeNull();
    expect(claimPending).not.toHaveBeenCalled();
    // c holds nothing and waits on nothing: its lock is free and no watch of it is pending.
    expect(w.locks.held()).toEqual([`${TAB_LOCK_PREFIX}b`]);
    expect((await w.locks.query()).pending ?? []).toEqual([]);
    expect(await w.db.pendingOwners(sim)).toEqual(['b', 'g']);
    expect(w.hub.sockets).toEqual([]);
  });

  it('a stop while start waits for the tab lock leaves no lock and no subscription', async () => {
    const w = world();
    const { store, sync } = unstarted(w, 'a');
    const subscribe = vi.spyOn(store, 'subscribe');
    const watch = vi.spyOn(w.net, 'watch');
    const started = sync.start();
    sync.stop();
    await started;
    await microtasks();
    expect(w.locks.held()).toEqual([]);
    expect(subscribe).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    await expect(sync.open(null)).rejects.toThrow();
  });

  it('open before start has resolved rejects', async () => {
    const w = world();
    const { store, sync } = unstarted(w, 'a');
    const started = sync.start();
    await expect(sync.open(null)).rejects.toThrow('before start');
    await started;
    await sync.open(null);
    expect(store.ready).toBe(true);
  });

  it('a second start while the first waits for the lock returns the first call promise', async () => {
    const w = world();
    const { store, sync } = unstarted(w, 'a');
    const first = sync.start();
    const second = sync.start();
    expect(second).toBe(first);
    await second;
    await sync.open(null); // start has really resolved: open does not reject
    expect(store.ready).toBe(true);
    expect(w.locks.held()).toEqual([`${TAB_LOCK_PREFIX}a`]);
  });

  /**
   * Locks over the world's, whose query() (goneOwners' read of the lock table) is counted and,
   * while `held` is set, waits for it.
   */
  function slowQueryLocks(w: World) {
    const q = { calls: 0, held: null as Promise<void> | null };
    const locks: LocksLike = {
      request: (name, options, callback) => w.locks.request(name, options, callback),
      query: async () => {
        q.calls++;
        if (q.held !== null) await q.held;
        return w.locks.query();
      }
    };
    return { q, locks };
  }

  /** A sim with b's unsent record (b alive) and g's (gone), and c about to open it. */
  async function twoOwners(w: World) {
    const sim = await onServer(w);
    const B = await tab(w, 'b', { live: false });
    await B.sync.open(sim);
    B.store.rename('B');
    await B.store.written();
    await goneTab(w, sim, 'G');
    return sim;
  }

  it('a stop while the open waits on pendingOwners: no lock read, no store open, no claim, no watch', async () => {
    const w = world();
    const sim = await twoOwners(w);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    const claimPending = vi.fn(w.db.claimPending);
    const db: SimDb = {
      ...w.db,
      claimPending,
      pendingOwners: async (id) => {
        asked++;
        await held;
        return w.db.pendingOwners(id);
      }
    };
    const { q, locks } = slowQueryLocks(w);
    const { store, sync } = await tab(w, 'c', { db, locks });
    const opened = sync.open(sim);
    await microtasks();
    expect(asked).toBe(1); // parked inside pendingOwners
    sync.stop();
    release();
    await expect(opened).rejects.toThrow('stopped');
    await microtasks();
    expect(q.calls).toBe(0); // the lock table was never read after the stop
    expect(store.ready).toBe(false);
    expect(store.simId).toBeNull();
    expect(claimPending).not.toHaveBeenCalled();
    expect(w.locks.held()).toEqual([`${TAB_LOCK_PREFIX}b`]);
    expect((await w.locks.query()).pending ?? []).toEqual([]);
    expect(await w.db.pendingOwners(sim)).toEqual(['b', 'g']);
    expect(w.hub.sockets).toEqual([]);
  });

  it('a stop while the open waits on goneOwners: no store open, no claim, no watch', async () => {
    const w = world();
    const sim = await twoOwners(w);
    const claimPending = vi.fn(w.db.claimPending);
    const db: SimDb = { ...w.db, claimPending };
    const { q, locks } = slowQueryLocks(w);
    const { store, sync } = await tab(w, 'c', { db, locks });
    let release!: () => void;
    q.held = new Promise<void>((resolve) => (release = resolve));
    const opened = sync.open(sim);
    await microtasks();
    expect(q.calls).toBe(1); // parked inside goneOwners
    sync.stop();
    release();
    await expect(opened).rejects.toThrow('stopped');
    await microtasks();
    expect(store.ready).toBe(false);
    expect(store.simId).toBeNull();
    expect(claimPending).not.toHaveBeenCalled();
    expect(w.locks.held()).toEqual([`${TAB_LOCK_PREFIX}b`]);
    expect((await w.locks.query()).pending ?? []).toEqual([]);
    expect(await w.db.pendingOwners(sim)).toEqual(['b', 'g']);
    expect(w.hub.sockets).toEqual([]);
  });

  it('a second onGone for the same owner claims again and changes nothing', async () => {
    const w = world();
    const sim = await onServer(w);
    const B = await tab(w, 'b', { live: false });
    await B.sync.open(sim);
    B.store.rename('B');
    await B.store.written();
    const C = await tab(w, 'c');
    await C.sync.open(sim);
    await settle(w.hub, C.store);
    const claim = vi.spyOn(C.store, 'claim');
    B.sync.stop();
    await settle(w.hub, C.store);
    expect(namesOf(w.hub.commits(sim))).toEqual(['S', 'B']);
    const appends = w.hub.appends.length;
    // b announces itself late (another build, a stale message): c watches it again, finds its
    // lock free and is told it has gone a second time.
    w.bus.channel().postMessage({ type: 'here', tabId: 'b', reply: false });
    await settle(w.hub, C.store);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim.mock.calls).toEqual([[['b']], [['b']]]);
    expect(namesOf(w.hub.commits(sim))).toEqual(['S', 'B']);
    expect(w.hub.appends).toHaveLength(appends);
    expect(C.store.pendingCount).toBe(0);
  });

  it('a claim that fails is logged once by name', async () => {
    const w = world();
    const sim = await onServer(w);
    const B = await tab(w, 'b', { live: false });
    await B.sync.open(sim);
    B.store.rename('B');
    await B.store.written();
    let fail = false;
    const db: SimDb = {
      ...w.db,
      claimPending: (...args) =>
        fail ? Promise.reject(new TypeError('closed')) : w.db.claimPending(...args)
    };
    const C = await tab(w, 'c', { db });
    await C.sync.open(sim);
    await settle(w.hub, C.store);
    const { error } = mockConsole('error');
    fail = true;
    B.sync.stop();
    await settle(w.hub, C.store);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] claim failed', 'TypeError');
    expect(namesOf(w.hub.commits(sim))).toEqual(['S']);
  });

  it('a pendingOwners that rejects counts as no owners: nothing is claimed', async () => {
    const w = world();
    const sim = await onServer(w);
    await goneTab(w, sim, 'G');
    const db: SimDb = { ...w.db, pendingOwners: () => Promise.reject(new Error('closed')) };
    const { error } = mockConsole('error');
    const { store, sync } = await tab(w, 'c', { db });
    await sync.open(sim);
    await settle(w.hub, store);
    expect(store.ready).toBe(true);
    expect(namesOf(w.hub.commits(sim))).toEqual(['S']);
    expect(store.pendingCount).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['a lock request that rejects', 'rejects'],
    ['no Web Locks', 'none']
  ] as const)(
    'with %s, gone tabs are claimed at open only; nothing is watched',
    async (_label, kind) => {
      const w = world();
      const { error } = mockConsole('error');
      const sim = await onServer(w);
      await goneTab(w, sim, 'G');
      const locks: LocksLike | null =
        kind === 'none'
          ? null
          : {
              request: () => Promise.reject(new DOMException('denied', 'SecurityError')),
              query: () => w.locks.query()
            };
      const C = await tab(w, 'c', { locks });
      await C.sync.open(sim);
      await settle(w.hub, C.store);
      expect(namesOf(w.hub.commits(sim))).toEqual(['S', 'G']);
      // A tab that opens later and goes is not claimed: c heard nothing and watches nothing.
      const B = await tab(w, 'b', { live: false });
      await B.sync.open(sim);
      B.store.rename('B');
      await B.store.written();
      B.sync.stop();
      await settle(w.hub, C.store);
      expect(namesOf(w.hub.commits(sim))).toEqual(['S', 'G']);
      expect(C.store.pendingCount).toBe(0);
      expect(await w.db.pendingOwners(sim)).toEqual(['b']);
      if (kind === 'rejects') {
        expect(error).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith('[sim-sync] tab lock failed: SecurityError');
      } else expect(error).not.toHaveBeenCalled();
    }
  );

  it('S8 with a lock request that rejects, opening claims nothing of a live tab', async () => {
    const w = world();
    const { error } = mockConsole('error');
    const sim = await onServer(w);
    const B = await tab(w, 'b', { live: false }); // alive: holds its lock, never sends
    await B.sync.open(sim);
    B.store.rename('B');
    await B.store.written();
    const locks: LocksLike = {
      request: () => Promise.reject(new DOMException('denied', 'SecurityError')),
      query: () => w.locks.query()
    };
    const C = await tab(w, 'c', { locks });
    await C.sync.open(sim);
    await settle(w.hub, C.store);
    expect(namesOf(w.hub.commits(sim))).toEqual(['S']);
    expect(C.store.pendingCount).toBe(0);
    expect(B.store.pendingCount).toBe(1);
    expect(await w.db.pendingOwners(sim)).toEqual(['b']);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
