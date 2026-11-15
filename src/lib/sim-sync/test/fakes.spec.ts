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

  it('never fires a timer that an earlier callback of the same advance cleared', () => {
    const c = new FakeClock();
    const ran: string[] = [];
    const cancelLater = c.after(8, () => ran.push('later'));
    c.after(3, () => {
      ran.push('first');
      cancelLater();
    });
    c.advance(10);
    expect(ran).toEqual(['first']);
    expect(c.nextDelay()).toBeNull();
  });

  it('fires after(0) on the next advance, advance(0) included, never at once', () => {
    const c = new FakeClock();
    const ran: number[] = [];
    c.after(0, () => ran.push(c.now()));
    expect(ran).toEqual([]);
    expect(c.nextDelay()).toBe(0);
    c.advance(0);
    expect(ran).toEqual([0]);
  });

  it('fires a timer set by a callback inside the same advance, at its due time', () => {
    const c = new FakeClock();
    const ran: number[] = [];
    c.after(4, () => {
      expect(c.now()).toBe(4);
      c.after(3, () => ran.push(c.now()));
      c.after(30, () => ran.push(-1));
    });
    c.advance(10);
    expect(ran).toEqual([7]);
    expect(c.now()).toBe(10);
    expect(c.nextDelay()).toBe(24);
  });

  it('lets a throwing callback reach the test, leaving time at its due time and the rest pending', () => {
    const c = new FakeClock();
    const ran: string[] = [];
    c.after(2, () => {
      throw new Error('boom');
    });
    c.after(5, () => ran.push('later'));
    expect(() => c.advance(10)).toThrow('boom');
    expect(c.now()).toBe(2);
    expect(ran).toEqual([]);
    c.advance(10);
    expect(ran).toEqual(['later']);
    expect(c.now()).toBe(12);
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

  it('starts online and visible unless told otherwise, and tells again for the same state', () => {
    expect([new FakeNet().online(), new FakeNet().visible()]).toEqual([true, true]);
    const net = new FakeNet({ online: false, visible: false });
    expect([net.online(), net.visible()]).toEqual([false, false]);
    const seen: string[] = [];
    net.watch((e) => seen.push(e));
    net.set('offline');
    net.set('offline');
    expect(seen).toEqual(['offline', 'offline']);
  });

  it('does not call a watcher that an earlier watcher removed during the same event', () => {
    const net = new FakeNet();
    const seen: string[] = [];
    let offSecond = () => {};
    net.watch(() => {
      seen.push('first');
      offSecond();
    });
    offSecond = net.watch(() => seen.push('second'));
    net.set('hidden');
    expect(seen).toEqual(['first']);
  });
});

describe('FakeLocks', () => {
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

  it('never runs a callback inside request(), in any path', async () => {
    const locks = new FakeLocks();
    const ran: string[] = [];
    let assigned = false;
    let release!: () => void;
    const free = locks.request('n', {}, () => {
      ran.push(`free:${assigned}`);
      return new Promise<void>((r) => (release = r));
    });
    assigned = true;
    expect(ran).toEqual([]);
    expect(locks.held()).toEqual([]);
    const queued = locks.request('n', {}, () => ran.push('queued'));
    const busy = locks.request('n', { ifAvailable: true }, (l) => ran.push(`busy:${l}`));
    const other = locks.request('m', { ifAvailable: true }, (l) => ran.push(`m:${l?.name}`));
    expect(ran).toEqual([]);
    await Promise.race([busy, other]);
    await microtasks();
    expect(ran).toContain('free:true');
    expect(ran).toContain('busy:null');
    expect(ran).toContain('m:m');
    expect(ran).not.toContain('queued');
    release();
    await Promise.all([free, queued, busy, other]);
    expect(ran.indexOf('free:true')).toBeLessThan(ran.indexOf('queued'));
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

  it('releases when the callback rejects, and the next waiter runs', async () => {
    const locks = new FakeLocks();
    const a = locks.request('n', {}, () => Promise.reject(new Error('nope')));
    const b = locks.request('n', {}, () => 'ran');
    await expect(a).rejects.toThrow('nope');
    expect(await b).toBe('ran');
    expect(locks.held()).toEqual([]);
  });

  it('releases when the callback throws', async () => {
    const locks = new FakeLocks();
    const a = locks.request('n', {}, () => {
      throw new Error('sync');
    });
    await expect(a).rejects.toThrow('sync');
    expect(locks.held()).toEqual([]);
  });

  it('makes a holder that asks for its own name again wait, without re-entry', async () => {
    const locks = new FakeLocks();
    const order: string[] = [];
    let inner!: Promise<unknown>;
    let finish!: () => void;
    const outer = locks.request('n', {}, () => {
      order.push('outer');
      inner = locks.request('n', {}, () => order.push('inner'));
      return new Promise<void>((r) => (finish = r));
    });
    await microtasks();
    expect(order).toEqual(['outer']);
    expect((await locks.query()).pending).toEqual([{ name: 'n', mode: 'exclusive' }]);
    finish();
    await Promise.all([outer, inner]);
    expect(order).toEqual(['outer', 'inner']);
  });

  it('reports held and pending in query, and held() from the grant', async () => {
    const locks = new FakeLocks();
    let release!: () => void;
    const a = locks.request('n', {}, () => new Promise<void>((r) => (release = r)));
    void locks.request('n', {}, () => undefined);
    void locks.request('m', {}, () => new Promise<void>(() => {}));
    await microtasks();
    const snap = await locks.query();
    expect(snap.held).toEqual([
      { name: 'n', mode: 'exclusive' },
      { name: 'm', mode: 'exclusive' }
    ]);
    expect(snap.pending).toEqual([{ name: 'n', mode: 'exclusive' }]);
    release();
    await a;
    await microtasks();
    expect((await locks.query()).pending).toEqual([]);
  });

  it('ifAvailable grants a free name and answers null for a held one without waiting', async () => {
    const locks = new FakeLocks();
    expect(await locks.request('n', { ifAvailable: true }, (l) => l?.name)).toBe('n');
    expect(locks.held()).toEqual([]);
    let release!: () => void;
    const a = locks.request('n', {}, () => new Promise<void>((r) => (release = r)));
    await microtasks();
    expect(await locks.request('n', { ifAvailable: true }, (l) => l)).toBeNull();
    expect((await locks.query()).pending).toEqual([]);
    release();
    await a;
  });

  it('removes an aborted waiter, so it never runs and the next waiter is granted', async () => {
    const locks = new FakeLocks();
    let release!: () => void;
    const ran: string[] = [];
    const a = locks.request('n', {}, () => new Promise<void>((r) => (release = r)));
    await microtasks();
    const ac = new AbortController();
    const gone = locks.request('n', { signal: ac.signal }, () => ran.push('gone'));
    const next = locks.request('n', {}, () => ran.push('next'));
    ac.abort();
    await expect(gone).rejects.toMatchObject({ name: 'AbortError' });
    expect((await locks.query()).pending).toEqual([{ name: 'n', mode: 'exclusive' }]);
    release();
    await Promise.all([a, next]);
    expect(ran).toEqual(['next']);
  });

  it('rejects at once for a signal that is already aborted', async () => {
    const locks = new FakeLocks();
    const ac = new AbortController();
    ac.abort();
    await expect(locks.request('n', { signal: ac.signal }, () => 'x')).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(locks.held()).toEqual([]);
  });
});

describe('FakeBus', () => {
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

  it('delivers later, never inside postMessage, and a copy that later mutation leaves alone', async () => {
    const bus = new FakeBus();
    const a = bus.channel();
    const b = bus.channel();
    const heard: unknown[] = [];
    b.addEventListener('message', (e) => heard.push(e.data));
    const msg = { x: 1 };
    a.postMessage(msg);
    expect(heard).toEqual([]);
    msg.x = 2;
    await microtasks();
    expect(heard).toEqual([{ x: 1 }]);
  });

  it('a closed sender posts nothing, and a closed receiver hears nothing', async () => {
    const bus = new FakeBus();
    const a = bus.channel();
    const b = bus.channel();
    const c = bus.channel();
    const heardB: unknown[] = [];
    const heardC: unknown[] = [];
    b.addEventListener('message', (e) => heardB.push(e.data));
    c.addEventListener('message', (e) => heardC.push(e.data));
    a.close();
    a.postMessage('from closed');
    b.postMessage('in flight');
    c.close();
    await microtasks();
    expect(heardB).toEqual([]);
    expect(heardC).toEqual([]);
  });

  it('a removed listener hears nothing, and one added twice hears once', async () => {
    const bus = new FakeBus();
    const a = bus.channel();
    const b = bus.channel();
    const heard: unknown[] = [];
    const twice = (e: MessageEvent) => heard.push(e.data);
    const removed = (e: MessageEvent) => heard.push(`removed:${e.data}`);
    b.addEventListener('message', twice);
    b.addEventListener('message', twice);
    b.addEventListener('message', removed);
    b.removeEventListener('message', removed);
    a.postMessage(1);
    await microtasks();
    expect(heard).toEqual([1]);
  });
});

describe('FakeFetch and errorName', () => {
  it('a fake fetch records the call and answers, fails as the network does, and aborts', async () => {
    const f = new FakeFetch(() => ({ status: 201, body: { ok: 1 } }));
    const res = await f.fetch('/api/sims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ simId: 's' })
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(f.calls).toEqual([
      {
        url: '/api/sims',
        method: 'POST',
        contentType: 'application/json',
        headers: { 'content-type': 'application/json' },
        body: { simId: 's' }
      }
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

  it('records every header lower-cased and the method', async () => {
    const f = new FakeFetch();
    await f.fetch('/x', {
      method: 'PUT',
      headers: { 'X-Thing': 'a', 'Content-Type': 'text/plain' }
    });
    expect(f.calls[0]).toMatchObject({
      url: '/x',
      method: 'PUT',
      contentType: 'text/plain',
      headers: { 'x-thing': 'a', 'content-type': 'text/plain' },
      body: null
    });
  });

  it('rejects at once for a signal already aborted, without counting it in flight', async () => {
    const f = new FakeFetch();
    const ac = new AbortController();
    ac.abort();
    await expect(f.fetch('/x', { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(f.inFlight).toBe(0);
    expect(f.maxInFlight).toBe(0);
  });

  it('holds a call in flight until the test releases it, and tracks the peak', async () => {
    let release!: (a: { status: number }) => void;
    const f = new FakeFetch(() => new Promise((r) => (release = r)));
    const p = f.fetch('/x', { method: 'POST', body: '{}' });
    expect(f.inFlight).toBe(1);
    await microtasks();
    expect(f.inFlight).toBe(1);
    release({ status: 200 });
    expect((await p).status).toBe(200);
    expect(f.inFlight).toBe(0);
    expect(f.maxInFlight).toBe(1);
  });

  it('rejects the call when the handler answer cannot be a Response', async () => {
    const f = new FakeFetch(() => ({ status: 204, body: { no: 'body allowed' } }));
    await expect(f.fetch('/x', { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(f.inFlight).toBe(0);
  });

  it('throws a clear error for a Request or URL input', () => {
    const f = new FakeFetch();
    expect(() => f.fetch(new Request('http://localhost/x'))).toThrow(/string URL/);
    expect(() => f.fetch(new URL('http://localhost/x'))).toThrow(/string URL/);
  });
});
