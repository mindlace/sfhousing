// frameLatest (scoreboard spec §4.3): the pages' score holder commits at most once per frame. These
// tests lived in Scoreboard.svelte.spec.ts until the floating Scoreboard was deleted.
import { describe, expect, it, vi } from 'vitest';
import { frameLatest } from './latest.svelte';

describe('frameLatest (§4.3: ≤ 1 render per frame)', () => {
  it('coalesces many pushes per frame into one commit of the latest value', () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => frames.push(cb));
    const l = frameLatest(0, raf, vi.fn());
    l.push(1);
    l.push(2);
    l.push(3);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(l.current).toBe(0);
    frames.shift()!(0);
    expect(l.current).toBe(3);
    l.push(4);
    expect(raf).toHaveBeenCalledTimes(2);
    frames.shift()!(16);
    expect(l.current).toBe(4);
  });

  it('dispose cancels a pending frame', () => {
    const caf = vi.fn();
    const l = frameLatest(0, () => 7, caf);
    l.push(1);
    l.dispose();
    expect(caf).toHaveBeenCalledWith(7);
    expect(l.current).toBe(0);
  });
});
