import { describe, expect, it } from 'vitest';
import { newId } from '$lib/ids/base58';
import { browserPorts } from './ports';
import { TAB_CHANNEL, TabPresence } from './tabs';

describe('in a real browser', () => {
  it('hears a tab go when its lock frees, through Web Locks and BroadcastChannel', async () => {
    const [ida, idb] = [newId(), newId()];
    const a = new TabPresence({
      tabId: ida,
      locks: navigator.locks,
      channel: new BroadcastChannel(TAB_CHANNEL)
    });
    const b = new TabPresence({
      tabId: idb,
      locks: navigator.locks,
      channel: new BroadcastChannel(TAB_CHANNEL)
    });
    // a answers b's announcement only after it is watching b: its reply is the signal.
    const spy = new BroadcastChannel(TAB_CHANNEL);
    const replied = new Promise<void>((resolve) =>
      spy.addEventListener('message', (e) => {
        const d = e.data as { tabId?: unknown; reply?: unknown };
        if (d.tabId === ida && d.reply === true) resolve();
      })
    );
    const gone = new Promise<string>((resolve) => a.onGone(resolve));
    await a.start();
    await b.start();
    expect(await a.goneOwners([idb, 'never-was'])).toEqual(['never-was']);
    await replied;
    expect(a.watching()).toContain(idb);
    b.stop();
    expect(await gone).toBe(idb);
    a.stop();
    spy.close();
  });

  it('two watchers of one tab both hear it go', async () => {
    const [ida, idb, idc] = [newId(), newId(), newId()];
    const make = (tabId: string) =>
      new TabPresence({
        tabId,
        locks: navigator.locks,
        channel: new BroadcastChannel(TAB_CHANNEL)
      });
    const [a, b, c] = [make(ida), make(idb), make(idc)];
    const heard = (t: TabPresence) => new Promise<string>((resolve) => t.onGone(resolve));
    const [goneA, goneB] = [heard(a), heard(b)];
    // each watcher answers c's announcement only once it is watching c
    const spy = new BroadcastChannel(TAB_CHANNEL);
    const replied = new Set<string>();
    let announced = false;
    const both = new Promise<void>((resolve) =>
      spy.addEventListener('message', (e) => {
        const d = e.data as { tabId?: unknown; reply?: unknown };
        if (d.tabId === idc && d.reply === false) announced = true;
        if (announced && d.reply === true && (d.tabId === ida || d.tabId === idb)) {
          replied.add(d.tabId);
        }
        if (replied.size === 2) resolve();
      })
    );
    await a.start();
    await b.start();
    await c.start();
    await both;
    expect(a.watching()).toContain(idc);
    expect(b.watching()).toContain(idc);
    c.stop();
    expect(await goneA).toBe(idc);
    expect(await goneB).toBe(idc);
    a.stop();
    b.stop();
    spy.close();
  });

  it("browserPorts gives this window's ports", () => {
    const p = browserPorts();
    expect(p.origin).toBe(location.origin);
    expect(p.locks).toBe(navigator.locks);
    expect(p.net.online()).toBe(navigator.onLine);
    expect(p.net.visible()).toBe(document.visibilityState === 'visible');
    p.channel?.close();
  });
});
