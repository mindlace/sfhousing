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
import { OFF_VIEW } from './sim-socket';
import { SimSync, type SimSyncOptions } from './sim-sync.svelte';
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
  await sync.start();
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
    store.rename('A');
    w.hub.write = true; // the registration's session writes this sim
    await settle(w.hub, store);
    expect(sims(w)).toEqual([sim]);
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
    expect(w.locks.held()).toEqual([]);
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
