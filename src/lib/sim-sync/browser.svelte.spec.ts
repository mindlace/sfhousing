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

  it("browserPorts gives this window's ports", () => {
    const p = browserPorts();
    expect(p.origin).toBe(location.origin);
    expect(p.locks).toBe(navigator.locks);
    expect(p.net.online()).toBe(navigator.onLine);
    expect(p.net.visible()).toBe(document.visibilityState === 'visible');
    p.channel?.close();
  });
});
