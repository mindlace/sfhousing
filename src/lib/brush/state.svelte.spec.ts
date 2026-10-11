import { describe, expect, it } from 'vitest';
import { MSG } from './messages';
import { SETTINGS_KEY } from './settings';
import { BrushState } from './state.svelte';

function memStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v)
  };
}

function fakeTimers() {
  let seq = 0;
  const pending = new Map<number, () => void>();
  const setTimeout = ((fn: () => void) => {
    const id = ++seq;
    pending.set(id, fn);
    return id;
  }) as unknown as typeof globalThis.setTimeout;
  const clearTimeout = ((id: number) => void pending.delete(id)) as typeof globalThis.clearTimeout;
  const flush = () => {
    const fns = [...pending.values()];
    pending.clear();
    fns.forEach((f) => f());
  };
  return { setTimeout, clearTimeout, flush, pending };
}

describe('BrushState', () => {
  it('defaults to Paint on a fine pointer and Move otherwise', () => {
    expect(new BrushState({ fine: true, storage: null }).tool).toBe('paint');
    expect(new BrushState({ fine: false, storage: null }).tool).toBe('move');
  });

  it('reads persisted settings and falls back to 6 stories, 30 m', () => {
    const s = new BrushState({
      storage: memStorage({ [SETTINGS_KEY]: '{"stories":12,"radiusM":80}' })
    });
    expect([s.stories, s.radiusM]).toEqual([12, 80]);
    const d = new BrushState({ storage: null });
    expect([d.stories, d.radiusM]).toEqual([6, 30]);
  });

  it('clamps and persists stories and radius', () => {
    const storage = memStorage();
    const s = new BrushState({ storage });
    s.setStories(90.4);
    s.setRadius(2);
    expect([s.stories, s.radiusM]).toEqual([80, 5]);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).toEqual({ stories: 80, radiusM: 5 });
  });

  it('orders the status line: city phase > announcement > loading parcels > zoom hint', () => {
    const t = fakeTimers();
    const s = new BrushState({ storage: null, ...t });
    s.loadingParcels = true;
    s.zoomHint = true;
    s.announce('Painted', 4000);
    expect(s.phase).toBe('loading');
    expect(s.statusText).toBe(MSG.loadingCity);
    s.phase = 'failed';
    expect(s.statusText).toBe(MSG.cityFailed);
    s.phase = 'ready';
    expect(s.statusText).toBe('Painted');
    t.flush();
    expect(s.announcement).toBe('');
    expect(s.statusText).toBe(MSG.loadingParcels);
    s.loadingParcels = false;
    expect(s.statusText).toBe(MSG.zoomIn);
    s.zoomHint = false;
    expect(s.statusText).toBe('');
  });

  it('replaces a current announcement and cancels its timer', () => {
    const t = fakeTimers();
    const s = new BrushState({ storage: null, ...t });
    s.announce('one', 4000);
    s.announce('two', 6000);
    expect(t.pending.size).toBe(1);
    expect(s.announcement).toBe('two');
    t.flush();
    expect(s.announcement).toBe('');
  });
});
