import { describe, expect, it } from 'vitest';
import { errorName } from '../ports';
import { FakeBus, FakeClock, FakeFetch, FakeLocks, FakeNet, microtasks } from './fakes';

describe('FakeClock', () => {
  it('runs timers in due order, timers set meanwhile included, and cancels', () => {
    const c = new FakeClock();
    const ran: string[] = [];
    c.after(20, () => ran.push('b'));
    const cancel = c.after(15, () => ran.push('x'));
    c.after(10, () => {
      ran.push('a');
      c.after(5, () => ran.push('a2'));
    });
    cancel();
    expect(c.nextDelay()).toBe(10);
    c.advance(20);
    expect(ran).toEqual(['a', 'a2', 'b']);
    expect(c.now()).toBe(20);
    expect(c.nextDelay()).toBeNull();
  });

  it('runs ties in the order set, with now at each due time, and cancels twice safely', () => {
    const c = new FakeClock();
    const ran: string[] = [];
    c.after(5, () => ran.push(`a${c.now()}`));
    c.after(5, () => ran.push(`b${c.now()}`));
    const cancel = c.after(7, () => ran.push('x'));
    cancel();
    cancel();
    c.advance(4);
    expect(ran).toEqual([]);
    c.advance(10);
    expect(ran).toEqual(['a5', 'b5']);
    expect(c.now()).toBe(14);
  });
});

describe('FakeNet', () => {
  it('tells its watchers every change, at once', () => {
    const net = new FakeNet();
    const seen: string[] = [];
    const off = net.watch((e) => seen.push(e));
    net.set('offline');
    net.set('hidden');
    expect([net.online(), net.visible()]).toEqual([false, false]);
    off();
    net.set('online');
    expect(seen).toEqual(['offline', 'hidden']);
  });
});

describe('FakeLocks, FakeBus, FakeFetch, errorName', () => {
  it('grants a name to one holder at a time, answers ifAvailable, and aborts a waiter', async () => {
    const locks = new FakeLocks();
    let release!: () => void;
    const first = locks.request('n', {}, () => new Promise<void>((r) => (release = r)));
    await microtasks();
    expect(locks.held()).toEqual(['n']);
    expect(await locks.request('n', { ifAvailable: true }, (l) => l)).toBeNull();
    const ac = new AbortController();
    const waiting = locks.request('n', { signal: ac.signal }, () => 'never');
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await first;
    expect(locks.held()).toEqual([]);
    expect((await locks.query()).held).toEqual([]);
  });

  it('hands a released name to the next waiter in request order', async () => {
    const locks = new FakeLocks();
    const order: string[] = [];
    let release!: () => void;
    const a = locks.request('n', {}, () => {
      order.push('a');
      return new Promise<void>((r) => (release = r));
    });
    const b = locks.request('n', {}, () => order.push('b'));
    await microtasks();
    expect(order).toEqual(['a']);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
    expect(locks.requested).toEqual(['n', 'n']);
  });

  it('a bus channel hears the others, never itself', async () => {
    const bus = new FakeBus();
    const a = bus.channel();
    const b = bus.channel();
    const heardA: unknown[] = [];
    const heardB: unknown[] = [];
    a.addEventListener('message', (e) => heardA.push(e.data));
    b.addEventListener('message', (e) => heardB.push(e.data));
    a.postMessage({ x: 1 });
    await microtasks();
    expect(heardA).toEqual([]);
    expect(heardB).toEqual([{ x: 1 }]);
  });

  it('a fake fetch records the call and answers, fails as the network does, and aborts', async () => {
    const f = new FakeFetch(() => ({ status: 201, body: { ok: 1 } }));
    const res = await f.fetch('/api/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ simId: 's' })
    });
    expect(res.status).toBe(201);
    expect(f.calls).toEqual([
      { url: '/api/sims', method: 'POST', contentType: 'application/json', body: { simId: 's' } }
    ]);
    f.handler = () => 'network';
    await expect(f.fetch('/api/sims', { method: 'POST', body: '{}' })).rejects.toThrow(TypeError);
    f.handler = () => new Promise(() => {});
    const ac = new AbortController();
    const hung = f.fetch('/api/sims', { method: 'POST', body: '{}', signal: ac.signal });
    ac.abort();
    await expect(hung).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.inFlight).toBe(0);
    expect(errorName(new TypeError('x'))).toBe('TypeError');
    expect(errorName('x')).toBe('unknown');
  });
});
