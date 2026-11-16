import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { TAB_LOCK_PREFIX, TabPresence } from './tabs';
import { FakeBus, FakeLocks, microtasks } from './test/fakes';

const tab = (tabId: string, locks: FakeLocks | null, bus: FakeBus | null) =>
  new TabPresence({ tabId, locks, channel: bus?.channel() ?? null });

describe('TabPresence', () => {
  afterEach(() => vi.restoreAllMocks());

  it('T1 T7 holds its own lock from start until stop', async () => {
    const locks = new FakeLocks();
    const a = tab('a', locks, null);
    await a.start();
    expect(locks.held()).toEqual([`${TAB_LOCK_PREFIX}a`]);
    a.stop();
    await microtasks();
    expect(locks.held()).toEqual([]);
  });

  it('T4 the gone owners are those whose lock is free, never this tab', async () => {
    const locks = new FakeLocks();
    const a = tab('a', locks, null);
    const b = tab('b', locks, null);
    await a.start();
    await b.start();
    expect(await a.goneOwners(['a', 'b', 'c'])).toEqual(['c']);
  });

  it('T5 without Web Locks every owner but this tab is gone, and watch does nothing', async () => {
    const a = tab('a', null, null);
    await a.start();
    expect(await a.goneOwners(['a', 'b'])).toEqual(['b']);
    a.watch('b');
    expect(a.watching()).toEqual([]);
  });

  it('T2 T3 tabs learn of each other on the channel and hear when the other goes, once', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const a = tab('a', locks, bus);
    const b = tab('b', locks, bus);
    const goneA: string[] = [];
    const goneB: string[] = [];
    a.onGone((o) => goneA.push(o));
    b.onGone((o) => goneB.push(o));
    await a.start();
    await b.start();
    await microtasks();
    expect(a.watching()).toEqual(['b']);
    expect(b.watching()).toEqual(['a']);
    a.watch('b'); // twice is once
    b.stop();
    await microtasks();
    expect(goneA).toEqual(['b']);
    expect(goneB).toEqual([]);
    expect(locks.held()).toEqual([`${TAB_LOCK_PREFIX}a`]);
    expect(a.watching()).toEqual([]);
  });

  it('T6 without a channel only watched owners are heard', async () => {
    const locks = new FakeLocks();
    const a = tab('a', locks, null);
    const b = tab('b', locks, null);
    const c = tab('c', locks, null);
    const gone: string[] = [];
    a.onGone((o) => gone.push(o));
    await a.start();
    await b.start();
    await c.start();
    a.watch('b');
    await microtasks();
    b.stop();
    c.stop();
    await microtasks();
    expect(gone).toEqual(['b']);
  });

  it('T7 stop abandons a watch silently', async () => {
    const locks = new FakeLocks();
    const a = tab('a', locks, null);
    const b = tab('b', locks, null);
    const gone: string[] = [];
    a.onGone((o) => gone.push(o));
    await a.start();
    await b.start();
    a.watch('b');
    await microtasks();
    expect(a.watching()).toEqual(['b']);
    a.stop();
    expect(a.watching()).toEqual([]);
    b.stop();
    await microtasks();
    expect(gone).toEqual([]);
  });

  it('a tab that cannot get its own lock announces nothing and watches no one', async () => {
    const { error } = mockConsole('error');
    const bus = new FakeBus();
    const heard = bus.channel();
    const messages: unknown[] = [];
    heard.addEventListener('message', (e) => messages.push(e.data));
    const locks = {
      request: () => Promise.reject(new DOMException('no', 'SecurityError')),
      query: () => Promise.reject(new Error('unreadable'))
    };
    const a = new TabPresence({ tabId: 'a', locks, channel: bus.channel() });
    expect(await a.start()).toBe(false);
    await microtasks();
    expect(messages).toEqual([]);
    // The lock table is still asked: one that cannot be read fails, and the caller claims no one.
    await expect(a.goneOwners(['a', 'b'])).rejects.toThrow('unreadable');
    a.watch('b');
    expect(a.watching()).toEqual([]);
    expect(error.mock.calls).toEqual([['[sim-sync] tab lock failed: SecurityError']]);
  });

  it('S8 a tab whose own lock failed still asks the lock table: a live owner is not gone', async () => {
    const { error } = mockConsole('error');
    const table = new FakeLocks();
    const b = tab('b', table, null);
    await b.start();
    const locks = {
      request: () => Promise.reject(new DOMException('no', 'SecurityError')),
      query: () => table.query()
    };
    const a = new TabPresence({ tabId: 'a', locks, channel: null });
    expect(await a.start()).toBe(false);
    expect(await a.goneOwners(['a', 'b', 'c'])).toEqual(['c']);
    a.watch('b');
    expect(a.watching()).toEqual([]);
    expect(error.mock.calls).toEqual([['[sim-sync] tab lock failed: SecurityError']]);
  });

  it('start resolves true once the lock is held and announced', async () => {
    const a = tab('a', new FakeLocks(), null);
    expect(await a.start()).toBe(true);
  });

  it('a second start while the first waits is the first call', async () => {
    const locks = new FakeLocks();
    const a = tab('a', locks, null);
    const first = a.start();
    const second = a.start();
    expect(second).toBe(first);
    expect(locks.requested).toEqual([`${TAB_LOCK_PREFIX}a`]);
    expect(await second).toBe(true);
    expect(locks.held()).toEqual([`${TAB_LOCK_PREFIX}a`]);
  });

  it('a fresh announcement from an owner already told gone makes it watchable again', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const a = tab('a', locks, bus);
    const gone: string[] = [];
    a.onGone((o) => gone.push(o));
    await a.start();
    const b = tab('b', locks, bus);
    await b.start();
    await microtasks();
    b.stop();
    await microtasks();
    expect(gone).toEqual(['b']);
    a.watch('b');
    expect(a.watching()).toEqual([]);
    const b2 = tab('b', locks, bus);
    await b2.start();
    await microtasks();
    expect(a.watching()).toEqual(['b']);
    b2.stop();
    await microtasks();
    expect(gone).toEqual(['b', 'b']);
  });

  it('a watch that fails other than by abort is logged once', async () => {
    const { error } = mockConsole('error');
    const locks = new FakeLocks();
    const a = tab('a', locks, null);
    await a.start();
    locks.request = () => Promise.reject(new TypeError('boom'));
    a.watch('b');
    await microtasks();
    expect(error.mock.calls).toEqual([['[sim-sync] tab watch failed: TypeError']]);
    expect(a.watching()).toEqual([]);
  });

  it('a post that throws is logged once and not thrown', async () => {
    const { error } = mockConsole('error');
    const channel = {
      postMessage: () => {
        throw new DOMException('x', 'DataCloneError');
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      close: () => {}
    };
    const a = new TabPresence({ tabId: 'a', locks: new FakeLocks(), channel });
    expect(await a.start()).toBe(true);
    expect(error.mock.calls).toEqual([['[sim-sync] tab post failed: DataCloneError']]);
  });

  it('ignores its own messages and malformed ones', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const a = tab('a', locks, bus);
    await a.start();
    const raw = bus.channel();
    raw.postMessage({ type: 'here', tabId: 'a', reply: false });
    raw.postMessage({ type: 'here', tabId: 7 });
    raw.postMessage({ type: 'here', tabId: 'x' });
    raw.postMessage({ type: 'bye', tabId: 'y', reply: false });
    raw.postMessage(null);
    raw.postMessage('here');
    await microtasks();
    expect(a.watching()).toEqual([]);
  });

  it('S8 a tab that is closing but still holds its lock is not gone', async () => {
    const locks = new FakeLocks();
    const a = tab('a', locks, null);
    const b = tab('b', locks, null);
    await a.start();
    await b.start();
    b.stop();
    expect(await a.goneOwners(['b'])).toEqual([]);
    await microtasks();
    expect(await a.goneOwners(['b'])).toEqual(['b']);
  });

  it('S8 two live tabs each watching the other never hear the other gone', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const a = tab('a', locks, bus);
    const b = tab('b', locks, bus);
    const gone: string[] = [];
    a.onGone((o) => gone.push(`a:${o}`));
    b.onGone((o) => gone.push(`b:${o}`));
    await a.start();
    await b.start();
    await microtasks();
    expect(a.watching()).toEqual(['b']);
    expect(b.watching()).toEqual(['a']);
    expect(gone).toEqual([]);
    expect(await a.goneOwners(['b'])).toEqual([]);
    expect(await b.goneOwners(['a'])).toEqual([]);
  });

  it('a stopped tab watches nothing, and an unsubscribed listener is not told', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const a = tab('a', locks, bus);
    const b = tab('b', locks, bus);
    const told: string[] = [];
    const off = a.onGone((o) => told.push(o));
    await a.start();
    await b.start();
    await microtasks();
    off();
    b.stop();
    await microtasks();
    expect(told).toEqual([]);
    a.stop();
    a.watch('b');
    expect(a.watching()).toEqual([]);
  });
});
