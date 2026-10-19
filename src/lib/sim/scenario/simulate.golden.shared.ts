/**
 * The body of the `simulate` cross-engine golden (AC 1), run by `simulate.golden.test.ts` (Node)
 * and `simulate.golden.svelte.spec.ts` (the client project's browser engine; `SFH_BROWSER` picks
 * it). Regenerate the golden with `fixtures/build-golden.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import golden from './fixtures/golden-seed1.json';
import { GOLDEN_HORIZON, GOLDEN_SEED, goldenRun, type GoldenRun } from './simulate.golden.cases';

const want = golden as unknown as GoldenRun;

export function describeSimulateGolden(where: string): void {
  describe(`simulate cross-engine golden, seed 1 (${where})`, () => {
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warn.mockRestore();
    });

    it('is the golden run, and not degenerate: an engine difference has something to show', () => {
      expect(want.seed).toBe(GOLDEN_SEED);
      expect(want.horizon).toBe(GOLDEN_HORIZON);
      const ss = want.schedules;
      const of = (o: string) => ss.filter((s) => s.origin === o).length;
      expect(of('pipeline')).toBeGreaterThan(10);
      expect(of('simulated')).toBeGreaterThan(5);
      expect(ss.some((s) => s.phase !== null)).toBe(true);
      for (const k of ['complete', 'exit', 'open']) {
        expect(ss.some((s) => s.end.kind === k)).toBe(true);
      }
      expect(ss.some((s) => s.revisions.length > 1)).toBe(true);
      expect(new Set(ss.map((s) => (s.end.kind === 'open' ? -1 : s.end.day))).size).toBeGreaterThan(
        10
      );
    });

    it('reproduces every schedule exactly', () => {
      const now = goldenRun();
      expect(now.schedules.map((s) => s.projectId)).toEqual(want.schedules.map((s) => s.projectId));
      for (let i = 0; i < want.schedules.length; i++) {
        expect(now.schedules[i], want.schedules[i].projectId).toEqual(want.schedules[i]);
      }
      expect(now).toEqual(want);
    });
  });
}
