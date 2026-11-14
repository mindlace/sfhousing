/**
 * The body of the world cross-engine golden, run by `world.golden.test.ts` (Node) and
 * `world.golden.svelte.spec.ts` (the client project's browser engine; `SFH_BROWSER` picks it).
 * Regenerate the golden with `fixtures/build-world-golden.ts`.
 */
import { describe, expect, it } from 'vitest';
import golden from './fixtures/world-events-mini-seed1.json';
import {
  WORLD_GOLDEN_CHANGE,
  WORLD_GOLDEN_THROUGH,
  goldenWorldEvents,
  type GoldenWorldEvent
} from './world.golden.cases';

const want = golden as unknown as GoldenWorldEvent[];

export function describeWorldGolden(where: string): void {
  describe(`world cross-engine golden, mini city, seed 1 (${where})`, () => {
    it('is not degenerate: an engine difference has something to show', () => {
      const count = (p: (e: GoldenWorldEvent) => boolean) => want.filter(p).length;
      expect(count((e) => e.kind === 'start' && e.month === 0)).toBeGreaterThan(5);
      expect(count((e) => e.kind === 'start' && e.month > 0)).toBeGreaterThan(5);
      expect(count((e) => e.kind === 'end' && e.how === 'exit')).toBeGreaterThan(0);
      expect(count((e) => e.kind === 'end' && e.how === 'complete')).toBeGreaterThan(0);
      expect(count((e) => e.kind === 'revise')).toBeGreaterThan(0);
      expect(count((e) => e.kind === 'phaseFiled')).toBeGreaterThan(0);
      expect(count((e) => e.month > WORLD_GOLDEN_CHANGE)).toBeGreaterThan(10);
      expect(want.at(-1)!.month).toBeLessThanOrEqual(WORLD_GOLDEN_THROUGH);
    });

    it('reproduces every event exactly, byte for byte', () => {
      const now = goldenWorldEvents();
      expect(now.length).toBe(want.length);
      expect(now).toEqual(want);
      expect(JSON.stringify(now)).toBe(JSON.stringify(want));
    });
  });
}
