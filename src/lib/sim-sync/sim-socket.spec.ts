// SimSocket against the fake sim object (FakeHub), a real store over the in-memory database,
// the fake clock and the fake network signals. No timers: time moves only by clock.advance.
import { describe, expect, it } from 'vitest';
import { newId } from '$lib/ids/base58';
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

/** A store on a new sim with `edits` renames pending and stored, and a socket not started. */
async function rig(
  o: { hub?: HubOptions; online?: boolean; visible?: boolean; edits?: number } = {}
): Promise<Rig> {
  const hub = new FakeHub(o.hub);
  const clock = new FakeClock();
  const net = new FakeNet({ online: o.online ?? true, visible: o.visible ?? true });
  const store = new LogStore({ db: memorySimDb(), tabId: 'a', stamp });
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

  it('C11 a connection that fails before it opens counts as an attempt', async () => {
    const r = await rig();
    let made = 0;
    const Throwing = function (url: string) {
      made++;
      if (made === 1) throw new DOMException('no', 'SyntaxError');
      return new r.hub.WebSocket(url);
    } as unknown as SocketCtor;
    const sock = new SimSocket({ ...r.opts, WebSocket: Throwing });
    sock.start();
    expect(sock.view.phase).toBe('waiting');
    expect(r.clock.nextDelay()).toBe(1000);
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(sock.view.phase).toBe('live');
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

  it('C12 a connection that reaches live with something to send keeps the backoff', async () => {
    // No start commit: the pending edit stays on the tip, so head() is not null when caught up.
    const r = await rig({ edits: 1, hub: { start: false } });
    r.hub.reject = true;
    r.sock.start();
    await settle(r.hub, r.store);
    r.hub.reject = false;
    r.clock.advance(1000);
    await settle(r.hub, r.store);
    expect(r.sock.view.phase).toBe('live');
    expect(r.store.head()).not.toBeNull();
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
