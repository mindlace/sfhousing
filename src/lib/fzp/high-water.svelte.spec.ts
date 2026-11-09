// HighWater: the furthest day the user has reached; scrubbing back never lowers it.
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { HighWater } from './high-water.svelte';

describe('HighWater', () => {
  it('starts at the given day', () => {
    expect(new HighWater(2).value).toBe(2);
  });

  it('reach raises the value and never lowers it', () => {
    const h = new HighWater(0);
    h.reach(10);
    h.reach(5);
    expect(h.value).toBe(10);
  });

  it('reset sets the value unconditionally', () => {
    const h = new HighWater(0);
    h.reach(10);
    h.reset(3);
    expect(h.value).toBe(3);
  });

  it('is reactive', () => {
    const h = new HighWater(0);
    const seen: number[] = [];
    const cleanup = $effect.root(() => {
      $effect(() => {
        seen.push(h.value);
      });
    });
    flushSync();
    h.reach(4);
    flushSync();
    h.reach(2);
    flushSync();
    cleanup();
    expect(seen).toEqual([0, 4]);
  });
});
