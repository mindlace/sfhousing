/**
 * The body of the funded world cross-engine golden, run by `funded.golden.test.ts` (Node) and
 * `funded.golden.svelte.spec.ts` (the client project's browser engine). Regenerate the golden
 * with `fixtures/build-funded-golden.ts`.
 */
import { describe, expect, it } from 'vitest';
import golden from './fixtures/funded-events-mini-seed1.json';
import { FUNDED_GOLDEN_THROUGH, goldenFundedRun, type GoldenFunded } from './funded.golden.cases';

const want = golden as unknown as GoldenFunded;

export function describeFundedGolden(where: string): void {
  describe(`funded world cross-engine golden, mini city, seed 1 (${where})`, () => {
    it('is not degenerate: awards, their stage events and their money are in it', () => {
      const ev = want.events;
      expect(ev.filter((e) => e.kind === 'award').length).toBeGreaterThan(10);
      expect(ev.filter((e) => e.kind === 'start' && e.month > 0).length).toBeGreaterThan(10);
      expect(ev.filter((e) => e.kind === 'end' && e.how === 'complete').length).toBeGreaterThan(0);
      const kinds = new Set(want.ledger.map((e) => e.kind));
      for (const k of ['in', 'commit', 'spend'] as const) expect(kinds.has(k)).toBe(true);
      expect(ev.at(-1)!.month).toBeLessThanOrEqual(FUNDED_GOLDEN_THROUGH);
    });

    it('reproduces every event and the ledger exactly, byte for byte', () => {
      const now = goldenFundedRun();
      expect(now.events.length).toBe(want.events.length);
      expect(now.ledger.length).toBe(want.ledger.length);
      expect(now).toEqual(want);
      expect(JSON.stringify(now)).toBe(JSON.stringify(want));
    });
  });
}
