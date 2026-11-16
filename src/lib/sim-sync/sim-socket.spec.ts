// SimSocket against the fake sim object (FakeHub), a real store over the in-memory database,
// the fake clock and the fake network signals. No timers: time moves only by clock.advance.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { newId } from '$lib/ids/base58';
import { SHAPES_REVISION } from '$lib/sim-log';
import { LogStore } from '$lib/sim-store/log-store.svelte';
import { memorySimDb } from '$lib/sim-store/sim-db';
import { DS, draftOf, nameChange, stamped } from '$lib/sim-store/test/commits';
import type { SocketCtor } from './ports';
import {
  HELLO_TIMEOUT_MS,
  OFF_VIEW,
  PING_MS,
  SimSocket,
  type SimSocketOptions,
  type SocketView
} from './sim-socket';
import { FakeClock, FakeNet } from './test/fakes';
import { FakeHub, settle, type HubOptions } from './test/hub';

const ORIGIN = 'http://localhost:4173';

afterEach(() => {
  vi.restoreAllMocks();
});
const stamp = () => ({ datasetVersion: DS, build: 'test' });

interface Rig {
  hub: FakeHub;
  clock: FakeClock;
  net: FakeNet;
  store: LogStore;
  sim: string;
  opts: SimSocketOptions;
  sock: SimSocket;
  views: SocketView[];
}

/**
 * A store on a new sim with `edits` renames pending and stored, and a socket not started.
 * `db: null`: a store with no database, whose head is sendable as soon as it is made.
 */
async function rig(
  o: { hub?: HubOptions; online?: boolean; visible?: boolean; edits?: number; db?: null } = {}
): Promise<Rig> {
  const hub = new FakeHub(o.hub);
  const clock = new FakeClock();
  const net = new FakeNet({ online: o.online ?? true, visible: o.visible ?? true });
  const db = o.db === null ? null : memorySimDb();
  const store = new LogStore({ db, tabId: 'a', stamp });
  const sim = newId();
  await store.open(sim);
  for (let i = 0; i < (o.edits ?? 0); i++) store.rename(`N${i}`);
  await store.written();
  const views: SocketView[] = [];
  const opts: SimSocketOptions = {
    store,
    simId: sim,
    origin: ORIGIN,
    WebSocket: hub.WebSocket,
    clock,
    random: () => 0.5,
    net,
    onChange: (v) => views.push(v)
  };
  return { hub, clock, net, store, sim, opts, sock: new SimSocket(opts), views };
}

async function live(r: Rig) {
  r.sock.start();
  await settle(r.hub, r.store);
}

const foreign = (r: Rig, name: string, o?: Parameters<FakeHub['foreign']>[2]) =>
  r.hub.foreign(r.sim, draftOf(r.hub.commits(r.sim).length, [nameChange(name)]), o);

const pings = (r: Rig, i = 0) => r.hub.sockets[i].sent.filter((t) => t === 'ping').length;

describe('SimSocket: connection', () => {
  it("C1 connects to its sim's stream, ws for http and wss for https", async () => {
    const r = await rig();
    r.sock.start();
    expect(r.hub.sockets.map((s) => s.url)).toEqual([
      `ws://localhost:4173/api/sims/${r.sim}/stream`
    ]);
    expect(r.sock.view.phase).toBe('connecting');
    new SimSocket({ ...r.opts, origin: 'https://sim.example' }).start();
    expect(r.hub.sockets[1].url).toBe(`wss://sim.example/api/sims/${r.sim}/stream`);
  });

  it('C2 C14b starts offline when the browser is, and connects on online', async () => {
    const r = await rig({ online: false });
    r.sock.start();
    expect(r.sock.view.phase).toBe('offline');
    expect(r.hub.sockets).toHaveLength(0);
    r.net.set('online');
    expect(r.hub.sockets).toHaveLength(1);
  });

  it('C3 on hello sets the server dataset, resumes from the tip and goes live', async () => {
    const r = await rig();
    foreign(r, 'F1');
    await live(r);
    expect(r.store.serverDataset).toBe(DS);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.store.tipSeq).toBe(1);
    expect(r.sock.view).toMatchObject({ phase: 'live', write: true, serverBuild: 'b' });
  });

  it('C3 the hello sets the dataset and sends the resume at once', async () => {
    const r = await rig();
    r.sock.start();
    expect(r.store.serverDataset).toBeNull();
    r.hub.step(); // open, hello, access
    expect(r.store.serverDataset).toBe(DS);
    expect(r.hub.sockets[0].sent).toEqual([JSON.stringify({ type: 'resume', after: 0 })]);
    expect(r.sock.view).toMatchObject({ phase: 'catching-up', write: true, serverBuild: 'b' });
  });

  it('C3 a hello while the store is on another sim sends no resume and is not live', async () => {
    const r = await rig();
    await r.store.open(newId());
    await live(r);
    expect(r.hub.resumes).toEqual([]);
    const s = r.hub.sockets[0];
    s.emit('message', JSON.stringify({ type: 'commits', commits: [], more: false }));
    expect(r.sock.view.phase).toBe('catching-up');
    expect(r.store.tipSeq).toBe(0);
  });

  it('C4 a hello without a dataset leaves it unknown, so nothing is sent', async () => {
    const r = await rig({ hub: { dataset: null }, edits: 1 });
    await live(r);
    expect(r.store.serverDataset).toBeNull();
    expect(r.hub.appends).toEqual([]);
    expect(r.store.pendingCount).toBe(1);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C5 a hello of another protocol halts: closed, never reconnected', async () => {
    const r = await rig({ hub: { protocol: 2 }, edits: 1 });
    await live(r);
    expect(r.sock.view).toMatchObject({ phase: 'halted', halt: 'protocol' });
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    expect(r.hub.resumes).toEqual([]);
    r.clock.advance(120_000);
    r.net.set('offline');
    r.net.set('online');
    r.net.set('hidden');
    r.net.set('visible');
    r.sock.reconnect();
    expect(r.hub.sockets).toHaveLength(1);
    expect(r.sock.view.phase).toBe('halted');
    expect(r.store.pendingCount).toBe(1);
  });

  it('C6 no hello within 10 s closes the socket and reconnects after the backoff', async () => {
    const r = await rig();
    r.hub.silent = true;
    await live(r);
    r.clock.advance(9_999);
    expect(r.sock.view.phase).toBe('connecting');
    r.clock.advance(1);
    expect(r.sock.view.phase).toBe('waiting');
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    r.hub.silent = false;
    r.clock.advance(999);
    expect(r.hub.sockets).toHaveLength(1);
    r.clock.advance(1);
    expect(r.hub.sockets).toHaveLength(2);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C11 reconnects with backoff 1, 2, 4 … 30 s while no connection gets through', async () => {
    const r = await rig();
    r.hub.reject = true;
    r.sock.start();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      await settle(r.hub, r.store);
      const d = r.clock.nextDelay()!;
      delays.push(d);
      r.clock.advance(d);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(r.hub.sockets).toHaveLength(8);
  });

  it('C11 a close while live drops the timers and waits; write is unknown on the next', async () => {
    const r = await rig();
    await live(r);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'waiting', write: null, inFlight: null });
    expect(r.clock.nextDelay()).toBe(1000);
    r.clock.advance(1000);
    expect(r.hub.sockets).toHaveLength(2);
    expect(r.sock.view).toMatchObject({ phase: 'connecting', write: null, serverBuild: 'b' });
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'live', write: true });
    expect(r.hub.resumes).toEqual([0, 1]);
  });

  it('C11 a close clears the ping timer: no ping goes out while it waits', async () => {
    const r = await rig();
    await live(r);
    r.hub.reject = true;
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    r.clock.advance(PING_MS + HELLO_TIMEOUT_MS);
    await settle(r.hub, r.store);
    expect(r.hub.sockets.length).toBeGreaterThan(1);
    expect(r.hub.sockets.flatMap((s) => s.sent).filter((t) => t === 'ping')).toEqual([]);
    expect(r.sock.view.phase).toBe('waiting');
  });

  it('C11 a socket that cannot be made is backed off and logged once', async () => {
    const r = await rig();
    const { error } = mockConsole('error');
    let made = 0;
    const Throwing = function (url: string) {
      made++;
      if (made <= 2) throw new DOMException('no', 'SyntaxError');
      return new r.hub.WebSocket(url);
    } as unknown as SocketCtor;
    const sock = new SimSocket({ ...r.opts, WebSocket: Throwing });
    sock.start();
    expect(sock.view.phase).toBe('waiting');
    expect(r.clock.nextDelay()).toBe(1000);
    r.clock.advance(1000);
    expect(sock.view.phase).toBe('waiting');
    expect(r.clock.nextDelay()).toBe(2000);
    r.clock.advance(2000);
    await settle(r.hub, r.store);
    expect(sock.view.phase).toBe('live');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] socket failed', 'SyntaxError');
  });

  it('C12 a connection that reaches live with nothing to send resets the backoff', async () => {
    const r = await rig();
    r.hub.reject = true;
    r.sock.start();
    await settle(r.hub, r.store);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    r.hub.reject = false;
    r.clock.advance(2000);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('live');
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('waiting');
    expect(r.clock.nextDelay()).toBe(1000);
  });

  it('C12 connections that reach live with an edit still pending back off 1 s, then 2 s', async () => {
    // The edit is sent once live: held at the object, so it stays pending.
    const r = await rig({ hub: { hold: true }, edits: 1 });
    await live(r);
    expect(r.sock.view.phase).toBe('live');
    expect(r.store.pendingCount).toBe(1);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(1000);
    // Another writer's commit, so the next resume re-applies the pending edit again.
    foreign(r, 'F1');
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('live');
    expect(r.store.pendingCount).toBe(1);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(2000);
  });

  it('C13 a close 4410 halts as gone: never reconnected', async () => {
    const r = await rig();
    await live(r);
    r.hub.closeAll(4410);
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'halted', halt: 'gone' });
    r.clock.advance(120_000);
    r.net.set('visible');
    r.net.set('online');
    expect(r.hub.sockets).toHaveLength(1);
    expect(r.clock.nextDelay()).toBeNull();
  });

  it('C13 a close 4410 while connecting halts as gone too', async () => {
    const r = await rig();
    r.hub.silent = true;
    await live(r);
    r.hub.closeAll(4410);
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'halted', halt: 'gone' });
    expect(r.clock.nextDelay()).toBeNull();
  });

  it('C14 offline closes the socket and waits for online, which connects at once', async () => {
    const r = await rig();
    await live(r);
    r.net.set('offline');
    expect(r.sock.view.phase).toBe('offline');
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    r.clock.advance(120_000);
    expect(r.hub.sockets).toHaveLength(1);
    r.net.set('online');
    expect(r.hub.sockets).toHaveLength(2);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C14 offline while connecting or waiting closes, cancels the timer and waits', async () => {
    const r = await rig();
    r.hub.silent = true;
    await live(r);
    r.net.set('offline');
    expect(r.sock.view.phase).toBe('offline');
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    expect(r.clock.nextDelay()).toBeNull();
    r.hub.silent = false;
    r.net.set('online');
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('waiting');
    r.net.set('offline');
    expect(r.sock.view.phase).toBe('offline');
    expect(r.clock.nextDelay()).toBeNull();
    r.clock.advance(120_000);
    expect(r.hub.sockets).toHaveLength(2);
  });

  it('C14b online while waiting connects at once, the attempt count kept', async () => {
    const r = await rig();
    r.hub.reject = true;
    r.sock.start();
    await settle(r.hub, r.store);
    r.net.set('online');
    expect(r.hub.sockets).toHaveLength(2);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(2000);
  });

  it('C15 becoming visible while waiting connects at once', async () => {
    const r = await rig();
    await live(r);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('waiting');
    r.net.set('hidden');
    expect(r.hub.sockets).toHaveLength(1);
    r.net.set('visible');
    expect(r.hub.sockets).toHaveLength(2);
    expect(r.sock.view.phase).toBe('connecting');
    r.clock.advance(1000);
    expect(r.hub.sockets).toHaveLength(2);
  });

  it('C16 C25 pings every 30 s while visible, never while hidden, and at once on visible', async () => {
    const r = await rig();
    await live(r);
    r.clock.advance(30_000);
    expect(pings(r)).toBe(1);
    await settle(r.hub, r.store); // the pong
    r.net.set('hidden');
    r.clock.advance(90_000);
    expect(pings(r)).toBe(1);
    r.net.set('visible');
    expect(pings(r)).toBe(2);
    await settle(r.hub, r.store);
    r.clock.advance(30_000);
    expect(pings(r)).toBe(3);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C16 a socket that connects while hidden pings only once visible', async () => {
    const r = await rig({ visible: false });
    await live(r);
    expect(r.sock.view.phase).toBe('live');
    r.clock.advance(120_000);
    expect(pings(r)).toBe(0);
    r.net.set('visible');
    expect(pings(r)).toBe(1);
  });

  it('C16 visible while connecting sends no ping', async () => {
    const r = await rig();
    r.hub.silent = true;
    await live(r);
    r.net.set('visible');
    expect(r.hub.sockets[0].sent).toEqual([]);
  });

  it('C24 a ping with no frame back within 10 s closes the connection and reconnects', async () => {
    const r = await rig();
    await live(r);
    r.hub.mute = true; // the connection died without a close
    r.clock.advance(30_000);
    expect(pings(r)).toBe(1);
    r.clock.advance(9_999);
    expect(r.sock.view.phase).toBe('live');
    r.clock.advance(1);
    expect(r.sock.view.phase).toBe('waiting');
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    r.hub.mute = false;
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.hub.sockets).toHaveLength(2);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C24 any frame within 10 s of a ping keeps the connection', async () => {
    const r = await rig();
    await live(r);
    r.clock.advance(30_000);
    await settle(r.hub, r.store); // the pong
    r.clock.advance(29_999);
    expect(r.sock.view.phase).toBe('live');
    expect(r.hub.sockets).toHaveLength(1);
  });

  it('C24 a commit frame clears the deadline as a pong does', async () => {
    const r = await rig();
    await live(r);
    r.hub.mute = true;
    r.clock.advance(30_000);
    r.hub.mute = false;
    const s = r.hub.sockets[0];
    s.emit(
      'message',
      JSON.stringify({ type: 'commits', commits: [stamped(draftOf(1, [nameChange('L')]), 2)] })
    );
    expect(r.store.tipSeq).toBe(2);
    r.clock.advance(HELLO_TIMEOUT_MS);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C24 C25 a ping on visible does not push back a deadline already running', async () => {
    const r = await rig();
    await live(r);
    r.hub.mute = true;
    r.clock.advance(PING_MS);
    r.clock.advance(5_000);
    r.net.set('hidden');
    r.net.set('visible');
    expect(pings(r)).toBe(2);
    r.clock.advance(4_999);
    expect(r.sock.view.phase).toBe('live');
    r.clock.advance(1);
    expect(r.sock.view.phase).toBe('waiting');
  });

  it('C24 hidden stops the pings but not a deadline already running', async () => {
    const r = await rig();
    await live(r);
    r.hub.mute = true;
    r.clock.advance(PING_MS);
    r.net.set('hidden');
    r.clock.advance(HELLO_TIMEOUT_MS);
    expect(r.sock.view.phase).toBe('waiting');
    expect(pings(r)).toBe(1);
  });

  it('C17 stop closes with 1000; later events of that socket change nothing', async () => {
    const r = await rig();
    await live(r);
    const s = r.hub.sockets[0];
    r.sock.stop();
    expect(s.closedWith).toBe(1000);
    expect(r.sock.view.phase).toBe('off');
    // Departure: the hub stores a start commit, so the tip is 1 and a late commit is seq 2.
    expect(r.store.tipSeq).toBe(1);
    const late = stamped(draftOf(1, [nameChange('X')]), 2);
    s.emit('message', JSON.stringify({ type: 'commits', commits: [late], more: false }));
    s.emit('close', 1011);
    await settle(r.hub, r.store);
    r.clock.advance(120_000);
    expect(r.store.tipSeq).toBe(1);
    expect(r.hub.sockets).toHaveLength(1);
  });

  it('C17 stop is final: net events, store changes, start and reconnect do nothing', async () => {
    const r = await rig();
    await live(r);
    r.sock.stop();
    const n = r.views.length;
    r.net.set('offline');
    r.net.set('online');
    r.net.set('visible');
    r.store.rename('After');
    await r.store.written();
    r.sock.start();
    r.sock.reconnect();
    r.clock.advance(120_000);
    expect(r.hub.sockets).toHaveLength(1);
    expect(r.sock.view).toEqual(OFF_VIEW);
    expect(r.views).toHaveLength(n);
    expect(r.clock.nextDelay()).toBeNull();
  });

  it('C17 S3 a socket replaced by reconnect is ignored: its close starts nothing', async () => {
    const r = await rig();
    await live(r);
    const old = r.hub.sockets[0];
    r.sock.reconnect();
    expect(old.closedWith).toBe(1000);
    expect(r.hub.sockets).toHaveLength(2);
    await settle(r.hub, r.store); // the old socket's own close event arrives here
    old.emit('close', 1011);
    old.emit('message', JSON.stringify({ type: 'hello', build: 'x', protocol: 9 }));
    expect(r.sock.view.phase).toBe('live');
    expect(r.clock.nextDelay()).toBe(PING_MS);
    expect(r.hub.sockets).toHaveLength(2);
  });

  it('C17 a socket closed by its timeout is ignored when its close arrives', async () => {
    const r = await rig();
    r.hub.silent = true;
    await live(r);
    r.clock.advance(HELLO_TIMEOUT_MS);
    await settle(r.hub, r.store); // the closed socket's own close event
    expect(r.sock.view.phase).toBe('waiting');
    expect(r.clock.nextDelay()).toBe(1000);
  });

  it('C17 stop while connecting: the late open, hello and close of that socket do nothing', async () => {
    const r = await rig();
    r.sock.start();
    const s = r.hub.sockets[0];
    r.sock.stop();
    expect(s.closedWith).toBe(1000);
    await settle(r.hub, r.store);
    s.emit('open');
    s.emit('message', JSON.stringify({ type: 'hello', build: 'b', protocol: 1, dataset: DS }));
    s.emit('close', 1011);
    r.clock.advance(120_000);
    expect(r.sock.view).toEqual(OFF_VIEW);
    expect(r.hub.sockets).toHaveLength(1);
    expect(r.hub.resumes).toEqual([]);
    expect(r.store.serverDataset).toBeNull();
    expect(r.clock.nextDelay()).toBeNull();
  });

  it('C17 a store subscriber that stops the socket during hello leaves it stopped', async () => {
    const r = await rig();
    r.store.subscribe(() => r.sock.stop());
    await live(r);
    expect(r.store.serverDataset).toBe(DS);
    expect(r.sock.view).toEqual(OFF_VIEW);
    expect(r.hub.resumes).toEqual([]);
    expect(r.clock.nextDelay()).toBeNull();
    r.clock.advance(120_000);
    expect(r.hub.sockets[0].sent).toEqual([]);
  });

  it('C17 an onChange that stops the socket during hello leaves it stopped', async () => {
    const r = await rig();
    const sock: SimSocket = new SimSocket({
      ...r.opts,
      onChange: (v) => {
        if (v.phase === 'catching-up') sock.stop();
      }
    });
    sock.start();
    await settle(r.hub, r.store);
    expect(sock.view).toEqual(OFF_VIEW);
    expect(r.hub.resumes).toEqual([]);
    expect(r.clock.nextDelay()).toBeNull();
  });

  it('C17 a store subscriber that reconnects during hello: only the new socket goes on', async () => {
    const r = await rig();
    let once = false;
    r.store.subscribe(() => {
      if (once) return;
      once = true;
      r.sock.reconnect();
    });
    await live(r);
    expect(r.hub.sockets).toHaveLength(2);
    expect(r.hub.sockets[0].sent).toEqual([]);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.sock.view.phase).toBe('live');
    r.clock.advance(PING_MS);
    expect(pings(r, 0)).toBe(0);
    expect(pings(r, 1)).toBe(1);
  });

  it('C19 C23 a text that is not a known frame, and an error event, are ignored', async () => {
    const r = await rig();
    await live(r);
    const s = r.hub.sockets[0];
    const n = r.views.length;
    s.emit('message', 'not json');
    s.emit('message', '{"type":"other"}');
    s.emit('message', '[1]');
    s.emit('message', 'null');
    s.emit('message', '{"type":"commits","commits":"no"}');
    s.emit('message', '{"type":"access","write":"yes"}');
    s.emit('error');
    expect(r.sock.view.phase).toBe('live');
    expect(r.views).toHaveLength(n);
  });

  it('C26 a second hello on a connection is ignored', async () => {
    const r = await rig();
    await live(r);
    r.hub.sockets[0].emit(
      'message',
      JSON.stringify({ type: 'hello', build: 'other', protocol: 1, dataset: 'fixture-9' })
    );
    r.hub.sockets[0].emit('message', JSON.stringify({ type: 'hello', build: 'o', protocol: 2 }));
    await settle(r.hub, r.store);
    expect(r.store.serverDataset).toBe(DS);
    expect(r.sock.view.serverBuild).toBe('b');
    expect(r.sock.view.phase).toBe('live');
    expect(r.hub.resumes).toEqual([0]);
  });

  it('C27 a commits frame before hello is ignored', async () => {
    const r = await rig();
    r.hub.silent = true;
    await live(r);
    const early = stamped(draftOf(0, [nameChange('X')]), 1);
    r.hub.sockets[0].emit('message', JSON.stringify({ type: 'commits', commits: [early] }));
    r.hub.sockets[0].emit('message', JSON.stringify({ type: 'access', write: false }));
    expect(r.store.tipSeq).toBe(0);
    expect(r.sock.view).toMatchObject({ phase: 'connecting', write: null });
  });

  it('C28 online while already connecting or live opens nothing more', async () => {
    const r = await rig();
    r.hub.silent = true;
    await live(r);
    r.net.set('online');
    expect(r.hub.sockets).toHaveLength(1);
    r.hub.silent = false;
    r.sock.reconnect();
    await settle(r.hub, r.store);
    r.net.set('online');
    expect(r.hub.sockets).toHaveLength(2);
    expect(r.sock.view.phase).toBe('live');
  });

  it('reconnect while offline or not started does nothing', async () => {
    const r = await rig({ online: false });
    r.sock.reconnect();
    expect(r.sock.view.phase).toBe('off');
    r.sock.start();
    r.sock.reconnect();
    expect(r.sock.view.phase).toBe('offline');
    expect(r.hub.sockets).toHaveLength(0);
  });

  it('an access frame sets write; onChange gets every new view', async () => {
    const r = await rig();
    await live(r);
    expect(r.views.map((v) => v.phase)).toEqual([
      'connecting',
      'catching-up',
      'catching-up',
      'live'
    ]);
    expect(r.views[r.views.length - 1]).toEqual(r.sock.view);
    r.hub.setAccess(false);
    await settle(r.hub, r.store);
    expect(r.sock.view.write).toBe(false);
  });
});

// The hub stores a start commit when a writer opens an empty sim: a rig with no commits of its
// own has seq 1 stored before the first resume, so tips and `after`s below are one above the
// brief's wherever the sim starts empty.
describe('SimSocket: resume', () => {
  const phases = (r: Rig, from: number) => r.views.slice(from).map((v) => v.phase);
  /** Steps the hub until `done`, at most 50 steps (no unbounded loop if the client stalls). */
  const stepUntil = (r: Rig, done: () => boolean) => {
    for (let i = 0; i < 50 && !done(); i++) r.hub.step();
    expect(done()).toBe(true);
  };

  it('C7 a paged resume asks again after each more: true and goes live on more: false', async () => {
    const r = await rig({ hub: { pageSize: 2, frameSize: 1 } });
    for (let s = 0; s < 5; s++) foreign(r, `F${s}`);
    await live(r);
    expect(r.hub.resumes).toEqual([0, 2, 4]);
    expect(r.store.tipSeq).toBe(5);
    expect(r.sock.view.phase).toBe('live');
    expect(phases(r, 0)).toEqual(['connecting', 'catching-up', 'catching-up', 'live']);
  });

  it('C8 a gap while live resumes from the gap', async () => {
    const r = await rig();
    await live(r);
    const n = r.views.length;
    foreign(r, 'A', { except: r.hub.sockets[0] });
    foreign(r, 'B');
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 1]);
    expect(r.store.tipSeq).toBe(3);
    expect(r.sock.view.phase).toBe('live');
    expect(phases(r, n)).toEqual(['catching-up', 'live']);
  });

  it('C9 live frames during a catch-up never start a second resume', async () => {
    const r = await rig({ hub: { pageSize: 1, frameSize: 1 } });
    await live(r);
    foreign(r, 'A', { except: r.hub.sockets[0] });
    foreign(r, 'B', { except: r.hub.sockets[0] });
    foreign(r, 'C'); // seq 4: a gap after 1
    foreign(r, 'D'); // seq 5: arrives while the resume is under way
    await settle(r.hub, r.store);
    expect(r.store.tipSeq).toBe(5);
    expect(r.hub.resumes).toEqual([0, 1, 2, 3, 4]);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C9 C10 a frame answered not-ready inside an answer: its end resumes again, not live', async () => {
    // An edit, so the sim is stored on the device and a reopen keeps its confirmed commits.
    // Held at the object once sent, so the edit never moves the tip.
    const r = await rig({ hub: { frameSize: 1, hold: true }, edits: 1 });
    foreign(r, 'F0');
    foreign(r, 'F1');
    // Both frames of the answer come in one step: the store is reopened from inside the first.
    let opening: Promise<void> | null = null;
    r.store.subscribe(() => {
      if (opening === null && r.store.tipSeq === 1) opening = r.store.open(r.sim);
    });
    r.sock.start();
    r.hub.flush(); // its last frame, more: false, answered not-ready
    expect(opening).not.toBeNull();
    expect(r.store.tipSeq).toBe(1);
    expect(r.sock.view.phase).toBe('catching-up');
    expect(r.hub.resumes).toEqual([0]);
    await opening;
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 1]);
    expect(r.store.tipSeq).toBe(2);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C10 frames that came while the store was opening are fetched again, once, when it is ready', async () => {
    // An edit, so the sim is stored on the device and a reopen keeps its confirmed commits;
    // held at the object once sent, so it never moves the tip.
    const r = await rig({ hub: { hold: true }, edits: 1 });
    await live(r);
    const opening = r.store.open(r.sim);
    foreign(r, 'A');
    r.hub.flush(); // the store answers stale, not-ready: nothing applied
    expect(r.sock.view.phase).toBe('catching-up');
    await opening;
    expect(r.store.tipSeq).toBe(1);
    await settle(r.hub, r.store);
    expect(r.store.tipSeq).toBe(2);
    expect(r.hub.resumes).toEqual([0, 1]);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C10 C3 a hello while the store is on another sim owes the resume; sent when it is back', async () => {
    const r = await rig();
    await r.store.open(newId());
    await live(r);
    expect(r.hub.resumes).toEqual([]);
    expect(r.sock.view.phase).toBe('catching-up');
    await r.store.open(r.sim);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.store.tipSeq).toBe(1);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C18 a frame for a sim the store no longer has open applies nothing and asks nothing', async () => {
    const r = await rig();
    await live(r);
    await r.store.open(newId());
    foreign(r, 'A');
    await settle(r.hub, r.store);
    expect(r.store.tipSeq).toBe(0);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C20 a resume refused gone halts as diverged and keeps the commits', async () => {
    const r = await rig({ edits: 1 });
    r.hub.refuseResume('gone');
    await live(r);
    expect(r.sock.view).toMatchObject({ phase: 'halted', halt: 'diverged' });
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    r.clock.advance(120_000);
    expect(r.hub.sockets).toHaveLength(1);
    expect(r.store.pendingCount).toBe(1);
  });

  it('C21 a refusal limit with no id backs off and resumes; an answer resets the backoff', async () => {
    const r = await rig();
    r.hub.refuseResume('limit', 'limit');
    await live(r);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.sock.view.phase).toBe('catching-up');
    expect(r.clock.nextDelay()).toBe(1000);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(2000);
    r.clock.advance(2000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 0, 0]);
    expect(r.sock.view.phase).toBe('live');
    r.hub.refuseResume('limit');
    foreign(r, 'A', { except: r.hub.sockets[0] });
    foreign(r, 'B'); // a gap: resume, refused
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 0, 0, 1]);
    expect(r.sock.view.phase).toBe('catching-up');
    expect(r.clock.nextDelay()).toBe(1000);
  });

  it('C21 a store change during a limit backoff does not send the owed resume early', async () => {
    const r = await rig();
    r.hub.refuseResume('limit');
    await live(r);
    r.store.rename('X');
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0]);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 0]);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C21 C11 a close during a limit backoff cancels it', async () => {
    const r = await rig();
    r.hub.refuseResume('limit', 'limit');
    await live(r);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(2000);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(1000);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('live');
    expect(r.clock.nextDelay()).toBe(PING_MS);
    expect(r.hub.resumes).toEqual([0, 0, 0]);
  });

  it('C22 a connection lost between pages resumes from what was applied', async () => {
    const r = await rig({ hub: { pageSize: 2, frameSize: 1 } });
    for (let s = 0; s < 5; s++) foreign(r, `F${s}`);
    r.sock.start();
    // Departure: the hub takes a step to receive a resume, one to answer, one per frame; step
    // until the second resume has reached it, then lose its answer.
    stepUntil(r, () => r.hub.resumes.length === 2);
    expect(r.store.tipSeq).toBe(2);
    r.hub.closeAll(1012);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('waiting');
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 2, 2, 4]);
    expect(r.store.tipSeq).toBe(5);
    expect(r.sock.view.phase).toBe('live');
  });

  it("C29 a page the store cannot apply (a newer build's commit) is not asked for again", async () => {
    // Departure: hidden, so no ping goes unanswered while the clock runs on with no settle.
    const r = await rig({ hub: { pageSize: 1 }, visible: false });
    const newer = draftOf(0, [nameChange('L')], { shapes: SHAPES_REVISION + 1 });
    r.hub.storeRaw(r.sim, stamped(newer, 1));
    r.hub.storeRaw(r.sim, stamped(draftOf(1, [nameChange('M')]), 2));
    await live(r);
    r.clock.advance(120_000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.store.stopped).toBe('future');
    expect(r.sock.view).toMatchObject({ phase: 'catching-up', hold: 'newer' });
    // Stalled, not merely idle: a later gap asks for nothing.
    const s = r.hub.sockets[0];
    const later = stamped(draftOf(2, [nameChange('N')]), 3);
    s.emit('message', JSON.stringify({ type: 'commits', commits: [later] }));
    await settle(r.hub, r.store);
    expect(s.sent.filter((t) => t.includes('"resume"'))).toHaveLength(1);
    expect(r.hub.resumes).toEqual([0]);
  });

  it("C29 a single-page answer ending more: false with a newer build's commit stalls", async () => {
    const r = await rig({ visible: false });
    const newer = draftOf(0, [nameChange('L')], { shapes: SHAPES_REVISION + 1 });
    r.hub.storeRaw(r.sim, stamped(newer, 1));
    await live(r);
    expect(r.sock.view).toMatchObject({ phase: 'catching-up', hold: 'newer' });
    // The server counts the socket caught up and sends live commits: each is a gap.
    r.hub.storeRaw(r.sim, stamped(draftOf(1, [nameChange('M')]), 2));
    r.hub.storeRaw(r.sim, stamped(draftOf(2, [nameChange('N')]), 3));
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.store.tipSeq).toBe(0);
    expect(r.sock.view.phase).toBe('catching-up');
    expect(r.hub.sockets).toHaveLength(1);
  });

  it("C29 a page the store takes part of, stopping at a newer build's commit, stalls", async () => {
    const r = await rig({ hub: { pageSize: 2 }, visible: false });
    const newer = draftOf(1, [nameChange('L')], { shapes: SHAPES_REVISION + 1 });
    r.hub.storeRaw(r.sim, stamped(draftOf(0, [nameChange('K')]), 1));
    r.hub.storeRaw(r.sim, stamped(newer, 2));
    r.hub.storeRaw(r.sim, stamped(draftOf(2, [nameChange('M')]), 3));
    await live(r);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.store.tipSeq).toBe(1);
    expect(r.store.stopped).toBe('future');
    expect(r.sock.view).toMatchObject({ phase: 'catching-up', hold: 'newer' });
  });

  it('C29 a live commit from a newer build stops the connection being live; no resume follows', async () => {
    const r = await rig({ visible: false });
    await live(r);
    expect(r.sock.view.phase).toBe('live');
    const newer = draftOf(1, [nameChange('L')], { shapes: SHAPES_REVISION + 1 });
    r.hub.storeRaw(r.sim, stamped(newer, 2));
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'catching-up', hold: 'newer' });
    r.hub.storeRaw(r.sim, stamped(draftOf(2, [nameChange('M')]), 3)); // a gap for the store
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.store.tipSeq).toBe(1);
    expect(r.sock.view.phase).toBe('catching-up');
  });

  it('C29 C10 a reopen between the frames of a page owes the resume and never stalls', async () => {
    // An edit, so the sim is stored on the device and a reopen keeps its confirmed commits;
    // held at the object once sent, so it never moves the tip.
    const r = await rig({ hub: { hold: true }, edits: 1 });
    await live(r); // tip 1: the start commit
    const s = r.hub.sockets[0];
    const a = foreign(r, 'A', { except: s });
    const b = foreign(r, 'B', { except: s });
    const c = foreign(r, 'C', { except: s });
    // The hub delivers every frame of an answer in one step, so the page's frames are sent by
    // hand around the reopen. The resume the gap makes is lost (mute) so the hub does not
    // answer it as well; the owed one is the resume the hub answers.
    r.hub.mute = true;
    s.emit('message', JSON.stringify({ type: 'commits', commits: [c] })); // a gap: resume 1
    r.hub.flush();
    r.hub.mute = false;
    const opening = r.store.open(r.sim);
    s.emit('message', JSON.stringify({ type: 'commits', commits: [a] })); // not-ready: owed
    await opening;
    expect(r.store.tipSeq).toBe(1);
    // The page's last frame: a gap for the store, the tip not moved past `after`.
    s.emit('message', JSON.stringify({ type: 'commits', commits: [b], more: true }));
    const resumes = () => s.sent.filter((t) => t.includes('"resume"'));
    expect(resumes()).toEqual([0, 1, 1].map((after) => JSON.stringify({ type: 'resume', after })));
    await settle(r.hub, r.store);
    expect(r.store.tipSeq).toBe(4);
    expect(r.sock.view).toMatchObject({ phase: 'live', hold: null });
  });

  it('C21 a refusal with no id other than limit or gone is backed off and logged once', async () => {
    const { error } = mockConsole('error');
    const r = await rig();
    await live(r);
    const s = r.hub.sockets[0];
    const refused = JSON.stringify({ type: 'refused', id: null, why: 'invalid' });
    s.emit('message', refused);
    s.emit('message', refused);
    expect(r.sock.view.phase).toBe('catching-up');
    expect(r.clock.nextDelay()).toBe(2000);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] resume refused', 'invalid');
    r.clock.advance(2000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 1]);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C29 C10 more: true answered not-ready is owed, not stalled', async () => {
    const r = await rig({ hub: { pageSize: 1 } });
    foreign(r, 'F0');
    foreign(r, 'F1');
    r.sock.start();
    stepUntil(r, () => r.hub.resumes.length === 1); // the resume has reached the hub
    const opening = r.store.open(r.sim);
    r.hub.flush(); // the first page, more: true, answered not-ready
    expect(r.hub.resumes).toEqual([0]);
    await opening;
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 0, 1]);
    expect(r.store.tipSeq).toBe(2);
    expect(r.sock.view.phase).toBe('live');
  });

  it('C30 a commit the store cannot fold halts the socket as broken, logged by name only', async () => {
    const { error } = mockConsole('error');
    const r = await rig();
    r.hub.storeRaw(r.sim, stamped(draftOf(0, [{ op: 'delete', key: 'p:nope' }]), 1));
    await live(r);
    expect(r.sock.view).toMatchObject({ phase: 'halted', halt: 'broken' });
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[sim-sync] receive failed', 'LogError');
    r.clock.advance(120_000);
    expect(r.hub.sockets).toHaveLength(1);
  });

  it('C17 a store subscriber that stops the socket inside an answer: no resume follows', async () => {
    const r = await rig({ hub: { pageSize: 1 } });
    foreign(r, 'F0');
    foreign(r, 'F1');
    r.store.subscribe(() => {
      if (r.store.tipSeq === 1) r.sock.stop();
    });
    await live(r);
    expect(r.hub.resumes).toEqual([0]);
    expect(r.sock.view).toEqual(OFF_VIEW);
    expect(r.clock.nextDelay()).toBeNull();
  });
});

// The rows of the append table. The hub stores a start commit when a writer opens an empty
// sim, so the store's own first commit, made on parent 0, is re-applied on parent 1 by the
// resume before it is ever sent: parents, resumes and stored ids below are one later than the
// brief's wherever the sim starts empty.
describe('SimSocket: appends', () => {
  const sent = (r: Rig, id: string) => r.hub.appends.filter((d) => d.id === id);
  const ids = (r: Rig) => r.hub.commits(r.sim).map((c) => c.id);
  const kinds = (r: Rig, i = 0) =>
    r.hub.sockets[i].sent.filter((t) => t !== 'ping').map((t) => JSON.parse(t).type);

  it("A1 sends the stored head after the resume, one at a time, in the store's order", async () => {
    const r = await rig({ hub: { hold: true }, edits: 3 });
    const mine = r.store.pending.map((p) => p.draft.id);
    await live(r);
    expect(kinds(r)).toEqual(['resume', 'append']);
    expect(r.hub.appends.map((d) => d.id)).toEqual([mine[0]]);
    expect(r.sock.view.inFlight).toBe(mine[0]);
    r.hub.release();
    await settle(r.hub, r.store);
    expect(r.hub.appends.map((d) => d.id)).toEqual(mine.slice(0, 2));
    r.hub.release();
    await settle(r.hub, r.store);
    r.hub.release();
    await settle(r.hub, r.store);
    expect(ids(r).slice(1)).toEqual(mine);
    expect(r.hub.appends.map((d) => d.id)).toEqual(mine);
    expect(r.store.pendingCount).toBe(0);
    expect(r.sock.view.inFlight).toBeNull();
  });

  it('A2 sends nothing while access says write: false, and sends once it says true', async () => {
    const r = await rig({ hub: { write: false }, edits: 1 });
    await live(r);
    expect(r.hub.appends).toEqual([]);
    expect(r.sock.view).toMatchObject({ phase: 'live', write: false });
    r.hub.setAccess(true);
    await settle(r.hub, r.store);
    expect(r.hub.appends).toHaveLength(1);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A3 not-writer holds the commit pending until access says write: true', async () => {
    // Departures: hidden, so no unanswered ping reconnects (a new connection clears the hold,
    // A15); and the hub sends access only on a change, so write goes false and back to true.
    const r = await rig({ edits: 1, visible: false });
    r.hub.refuseNext('not-writer');
    await live(r);
    expect(r.sock.view).toMatchObject({ hold: 'not-writer', inFlight: null });
    r.clock.advance(120_000);
    await settle(r.hub, r.store);
    expect(r.hub.appends).toHaveLength(1);
    expect(r.store.pendingCount).toBe(1);
    r.hub.setAccess(false);
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ hold: 'not-writer', write: false });
    r.hub.setAccess(true);
    await settle(r.hub, r.store);
    expect(r.hub.appends).toHaveLength(2);
    expect(r.store.pendingCount).toBe(0);
    expect(r.sock.view.hold).toBeNull();
  });

  it('A4 behind: the foreign commit arrives first, then the re-applied head is sent', async () => {
    const r = await rig({ hub: { hold: true }, edits: 1 });
    const id = r.store.pending[0].draft.id;
    await live(r);
    const f = foreign(r, 'F');
    r.hub.release(); // parent 1 against tip 2: behind
    await settle(r.hub, r.store);
    r.hub.release();
    await settle(r.hub, r.store);
    expect(sent(r, id).map((d) => d.parent)).toEqual([1, 2]);
    expect(ids(r).slice(1)).toEqual([f.id, id]);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A4 behind with a resume already under way waits for it rather than asking again', async () => {
    const r = await rig({ hub: { hold: true }, edits: 1 });
    const id = r.store.pending[0].draft.id;
    await live(r);
    const s = r.hub.sockets[0];
    foreign(r, 'A', { except: s });
    foreign(r, 'B'); // a gap for the store: a resume from 1
    r.hub.release(); // ours, parent 1: behind
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 1]);
    expect(sent(r, id).map((d) => d.parent)).toEqual([1, 3]);
    r.hub.release();
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(0);
    expect(r.store.tipSeq).toBe(4);
  });

  it('A5 behind with the tip unmoved resumes before sending again', async () => {
    const r = await rig({ edits: 1 });
    r.hub.refuseNext('behind');
    await live(r);
    expect(r.hub.resumes).toEqual([0, 1]);
    expect(kinds(r)).toEqual(['resume', 'append', 'resume', 'append']);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A6 invalid drops the commit, which the store reports, and sends the next', async () => {
    const r = await rig({ edits: 2 });
    const [first, second] = r.store.pending.map((p) => p.draft.id);
    r.hub.refuseNext('invalid');
    await live(r);
    expect(r.store.drops.map((d) => d.id)).toEqual([first]);
    expect(ids(r).slice(1)).toEqual([second]);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A6 invalid naming a commit the store no longer has pending drops nothing else', async () => {
    const r = await rig({ hub: { hold: true }, edits: 2 });
    const [first, second] = r.store.pending.map((p) => p.draft.id);
    await live(r);
    expect(r.sock.view.inFlight).toBe(first);
    r.store.dropPending(first); // gone from the store while it is in flight
    await r.store.written();
    const refused = { type: 'refused', id: first, why: 'invalid' };
    r.hub.sockets[0].emit('message', JSON.stringify(refused));
    await settle(r.hub, r.store);
    expect(r.store.drops.map((d) => d.id)).toEqual([first]);
    expect(r.sock.view.inFlight).toBe(second);
    expect(r.store.pendingCount).toBe(1);
  });

  it('A7 limit holds, backs off 1 s, then sends again', async () => {
    const r = await rig({ edits: 1 });
    r.hub.refuseNext('limit');
    await live(r);
    expect(r.sock.view).toMatchObject({ hold: 'limit', inFlight: null });
    r.clock.advance(999);
    await settle(r.hub, r.store);
    expect(r.hub.appends).toHaveLength(1);
    r.clock.advance(1);
    expect(r.sock.view.hold).toBeNull();
    await settle(r.hub, r.store);
    expect(r.hub.appends).toHaveLength(2);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A7 limit in a row backs off longer; a confirmed append resets it', async () => {
    const r = await rig({ edits: 2 });
    r.hub.refuseNext('limit', 'limit');
    await live(r);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.sock.view.hold).toBe('limit');
    expect(r.clock.nextDelay()).toBe(2000);
    r.clock.advance(2000);
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(0);
    r.hub.refuseNext('limit');
    r.store.rename('More');
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(1);
    expect(r.sock.view.hold).toBe('limit');
    expect(r.clock.nextDelay()).toBe(1000);
  });

  it.each(['full', 'newer'] as const)('A8 %s holds for good and keeps the commit', async (why) => {
    const r = await rig({ edits: 1 });
    r.hub.refuseNext(why);
    await live(r);
    r.hub.setAccess(false);
    r.hub.setAccess(true);
    r.clock.advance(300_000);
    await settle(r.hub, r.store);
    expect(r.sock.view.hold).toBe(why);
    expect(r.hub.appends).toHaveLength(1);
    expect(r.store.pendingCount).toBe(1);
  });

  it('A9 gone on an append halts and closes', async () => {
    const r = await rig({ edits: 1 });
    r.hub.refuseNext('gone');
    await live(r);
    expect(r.sock.view).toMatchObject({ phase: 'halted', halt: 'gone', inFlight: null });
    expect(r.hub.sockets[0].closedWith).toBe(1000);
    expect(r.store.pendingCount).toBe(1);
    r.clock.advance(120_000);
    expect(r.hub.sockets).toHaveLength(1);
  });

  it('A10 an append answered by silence (a duplicate) is confirmed by its copy on the stream', async () => {
    const r = await rig({ hub: { hold: true }, edits: 2 });
    await live(r);
    // Departure: the version in flight is the one re-applied on the start commit.
    const h = r.store.pending[0].draft;
    expect(r.sock.view.inFlight).toBe(h.id);
    r.hub.foreign(r.sim, structuredClone(h)); // another tab sent this very commit first
    r.hub.release(); // ours is a duplicate: no frame
    await settle(r.hub, r.store);
    expect(r.hub.duplicates).toBe(1);
    expect(r.sock.view.inFlight).not.toBe(h.id);
    expect(r.sock.view.inFlight).not.toBeNull();
    r.hub.release();
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(0);
    expect(r.hub.commits(r.sim)).toHaveLength(3);
  });

  it('A11 a socket lost after its append was accepted resumes and never sends it again', async () => {
    const r = await rig({ hub: { hold: true }, edits: 1 });
    const id = r.store.pending[0].draft.id;
    await live(r);
    r.hub.release(); // accepted; its frame is queued
    r.hub.closeAll(1006); // and lost
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'waiting', inFlight: null });
    expect(r.store.pendingCount).toBe(1);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(sent(r, id)).toHaveLength(1);
    expect(r.store.pendingCount).toBe(0);
    expect(r.hub.duplicates).toBe(0);
  });

  it('A12 a socket lost before its append was processed sends it again after the resume', async () => {
    // Departure: the hub processes a held append even after its socket closed, as the object
    // does. Here the append is lost on the way (mute), so the object never sees it.
    const r = await rig({ edits: 1, hub: { write: false } });
    const id = r.store.pending[0].draft.id;
    await live(r);
    const s = r.hub.sockets[0];
    r.hub.mute = true;
    s.emit('message', JSON.stringify({ type: 'access', write: true })); // sends the append
    expect(r.sock.view.inFlight).toBe(id);
    r.hub.flush();
    r.hub.mute = false;
    r.hub.setAccess(true);
    r.hub.closeAll(1006);
    await settle(r.hub, r.store);
    expect(r.sock.view.inFlight).toBeNull();
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 0]);
    expect(kinds(r, 0)).toEqual(['resume', 'append']);
    expect(kinds(r, 1)).toEqual(['resume', 'append']);
    // The first writer to open the empty sim (the new socket) made the start commit.
    expect(ids(r).slice(1)).toEqual([id]);
    expect(r.hub.duplicates).toBe(0);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A12 an append that reached the object before its socket closed is stored once', async () => {
    // The object keeps an append that reached it whatever happens to its socket: the copy sent
    // again after the resume is a duplicate (silence), and the original's commit on the new
    // connection's stream is what lets the next one go.
    const r = await rig({ hub: { hold: true }, edits: 2 });
    const [first, second] = r.store.pending.map((p) => p.draft.id);
    await live(r);
    r.hub.closeAll(1006);
    await settle(r.hub, r.store);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 1]);
    r.hub.release(); // the old socket's copy is stored; the new one's is a duplicate
    await settle(r.hub, r.store);
    expect(sent(r, first)).toHaveLength(2);
    expect(r.hub.duplicates).toBe(1);
    expect(r.sock.view.inFlight).toBe(second);
    r.hub.release();
    await settle(r.hub, r.store);
    expect(ids(r).slice(1)).toEqual([first, second]);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A13 sends nothing once the store has another sim open', async () => {
    const r = await rig();
    await live(r);
    await r.store.open(newId());
    r.store.rename('Other');
    await r.store.written();
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(1);
    expect(r.hub.appends).toEqual([]);
  });

  it('A14 an internal error on every append backs off longer; a confirmed append resets it', async () => {
    const r = await rig({ edits: 1 });
    r.hub.closeOnAppend = 3;
    r.sock.start();
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      await settle(r.hub, r.store);
      const d = r.clock.nextDelay()!;
      delays.push(d);
      r.clock.advance(d);
    }
    await settle(r.hub, r.store);
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(r.store.pendingCount).toBe(0);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(1000);
  });

  it('A14 a confirmed append resets the backoff even with more left to send', async () => {
    const r = await rig({ edits: 2 });
    r.hub.closeOnAppend = 2;
    r.sock.start();
    await settle(r.hub, r.store);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.clock.nextDelay()).toBe(2000);
    // The next connection: the first append is stored, the second closes the socket.
    r.clock.advance(2000);
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(0);
    r.hub.closeOnAppend = 1;
    r.store.rename('Third');
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(1);
    expect(r.sock.view.phase).toBe('waiting');
    expect(r.clock.nextDelay()).toBe(1000);
  });

  it('A15 full outlives a reconnect', async () => {
    const r = await rig({ edits: 1 });
    r.hub.refuseNext('full');
    await live(r);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.hub.sockets).toHaveLength(2);
    expect(r.sock.view).toMatchObject({ phase: 'live', hold: 'full' });
    expect(r.hub.appends).toHaveLength(1);
  });

  it('A15 a new connection clears not-writer and limit', async () => {
    const r = await rig({ edits: 2 });
    r.hub.refuseNext('not-writer');
    await live(r);
    expect(r.sock.view.hold).toBe('not-writer');
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    expect(r.sock.view.hold).toBe('not-writer');
    r.hub.refuseNext('limit');
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.sock.view.hold).toBe('limit');
    expect(r.store.pendingCount).toBe(2);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    r.clock.advance(r.clock.nextDelay()!);
    expect(r.sock.view.hold).toBeNull();
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A16 a refusal naming an id that is not in flight is ignored', async () => {
    const r = await rig({ hub: { hold: true }, edits: 1 });
    const id = r.store.pending[0].draft.id;
    await live(r);
    for (const why of ['invalid', 'gone', 'not-writer', 'behind'] as const) {
      r.hub.sockets[0].emit('message', JSON.stringify({ type: 'refused', id: newId(), why }));
    }
    expect(r.store.drops).toEqual([]);
    expect(r.sock.view).toMatchObject({ phase: 'live', hold: null, inFlight: id });
    r.hub.release();
    await settle(r.hub, r.store);
    expect(sent(r, id)).toHaveLength(1);
    expect(r.store.pendingCount).toBe(0);
  });

  it("A17 a limit refusal with no id is the resume's, even with an append in flight", async () => {
    const r = await rig({ hub: { hold: true }, edits: 1 });
    const id = r.store.pending[0].draft.id;
    await live(r);
    expect(r.sock.view.inFlight).toBe(id);
    r.hub.sockets[0].emit('message', JSON.stringify({ type: 'refused', id: null, why: 'limit' }));
    expect(r.sock.view.hold).toBeNull();
    expect(r.sock.view.inFlight).toBe(id);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.hub.resumes).toEqual([0, 1]);
    r.hub.release();
    await settle(r.hub, r.store);
    expect(sent(r, id)).toHaveLength(1);
    expect(r.store.pendingCount).toBe(0);
  });

  it('A18 an owed resume blocks sending until its answer (S1)', async () => {
    const r = await rig({ hub: { write: false }, edits: 1 });
    await live(r);
    r.hub.setAccess(true); // queued, not delivered
    const opening = r.store.open(r.sim);
    r.hub.flush(); // access arrives while the store opens: nothing can be sent
    expect(kinds(r)).toEqual(['resume']);
    await opening; // the store is ready again: the owed resume goes first
    expect(kinds(r)).toEqual(['resume', 'resume']);
    await settle(r.hub, r.store);
    expect(kinds(r)).toEqual(['resume', 'resume', 'append']);
    expect(r.store.pendingCount).toBe(0);
  });

  it('a newer hold is never lifted by write access or by a limit wait', async () => {
    const r = await rig({ hub: { hold: true }, edits: 1, visible: false });
    await live(r);
    r.hub.refuseNext('limit');
    r.hub.release();
    await settle(r.hub, r.store);
    expect(r.sock.view.hold).toBe('limit');
    // A newer build's commit stalls the connection: newer replaces limit.
    const newer = draftOf(1, [nameChange('L')], { shapes: SHAPES_REVISION + 1 });
    r.hub.storeRaw(r.sim, stamped(newer, 2));
    await settle(r.hub, r.store);
    expect(r.sock.view.hold).toBe('newer');
    r.clock.advance(1000); // the limit wait ends
    const s = r.hub.sockets[0];
    s.emit('message', JSON.stringify({ type: 'access', write: false }));
    s.emit('message', JSON.stringify({ type: 'access', write: true }));
    await settle(r.hub, r.store);
    expect(r.sock.view.hold).toBe('newer');
    expect(kinds(r)).toEqual(['resume', 'append']);
  });

  it('a newer hold from an append outlives a reconnect and write access', async () => {
    const r = await rig({ edits: 1, visible: false });
    r.hub.refuseNext('newer');
    await live(r);
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    r.hub.sockets[1].emit('message', JSON.stringify({ type: 'access', write: true }));
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'live', hold: 'newer' });
    expect(r.hub.appends).toHaveLength(1);
  });

  it('a burst of edits goes one at a time, each after the last came back', async () => {
    const r = await rig({ hub: { hold: true }, edits: 1 });
    await live(r);
    for (let i = 0; i < 4; i++) r.store.rename(`B${i}`);
    await settle(r.hub, r.store);
    expect(r.hub.appends).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      r.hub.release();
      await settle(r.hub, r.store);
      expect(r.hub.appends).toHaveLength(Math.min(i + 2, 5));
    }
    expect(r.hub.appends.map((d) => d.parent)).toEqual([1, 2, 3, 4, 5]);
    expect(r.hub.duplicates).toBe(0);
    expect(r.store.pendingCount).toBe(0);
  });

  it('a store with no database: the head re-applied inside receive is sent once, as re-applied', async () => {
    const r = await rig({ hub: { hold: true }, db: null, edits: 1 });
    const id = r.store.pending[0].draft.id;
    await live(r);
    foreign(r, 'F');
    r.hub.release(); // behind
    await settle(r.hub, r.store);
    expect(sent(r, id).map((d) => d.parent)).toEqual([1, 2]);
    r.hub.release();
    await settle(r.hub, r.store);
    expect(r.store.pendingCount).toBe(0);
  });

  it('a store subscriber that stops the socket inside the receive confirming an append', async () => {
    const r = await rig({ hub: { hold: true }, edits: 2 });
    await live(r);
    r.store.subscribe(() => {
      if (r.store.pendingCount === 1) r.sock.stop();
    });
    r.hub.release();
    await settle(r.hub, r.store);
    expect(r.sock.view).toEqual(OFF_VIEW);
    expect(r.hub.appends).toHaveLength(1);
    expect(r.clock.nextDelay()).toBeNull();
  });

  it('a store subscriber that reconnects inside that receive: only the new socket sends', async () => {
    const r = await rig({ hub: { hold: true }, edits: 2 });
    const [, second] = r.store.pending.map((p) => p.draft.id);
    await live(r);
    let once = false;
    r.store.subscribe(() => {
      if (once || r.store.pendingCount !== 1) return;
      once = true;
      r.sock.reconnect();
    });
    r.hub.release();
    await settle(r.hub, r.store);
    expect(kinds(r, 0)).toEqual(['resume', 'append']);
    expect(kinds(r, 1)).toEqual(['resume', 'append']);
    expect(r.sock.view.inFlight).toBe(second);
  });

  it('a close with an append in flight clears it; nothing is sent while waiting', async () => {
    const r = await rig({ hub: { hold: true }, edits: 1 });
    await live(r);
    r.hub.reject = true;
    r.hub.closeAll(1011);
    await settle(r.hub, r.store);
    r.store.rename('While away');
    await settle(r.hub, r.store);
    expect(r.sock.view).toMatchObject({ phase: 'waiting', inFlight: null });
    expect(r.hub.appends).toHaveLength(1);
  });
});
