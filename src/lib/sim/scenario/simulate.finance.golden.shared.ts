/**
 * The body of the finance cross-engine golden, run by `simulate.finance.golden.test.ts` (Node)
 * and `simulate.finance.golden.svelte.spec.ts` (the client project's browser engine). The file
 * holds two runs of one input: seed 1 (the spec's case) and seed 4, which brings market-funded
 * starts and releases. Regenerate with `fixtures/build-finance-golden.ts`.
 */
import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden-finance-seed1.json';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import {
  FINANCE_GOLDEN_SEEDS,
  financeGoldenInput,
  financeGoldenRun,
  type FinanceGolden
} from './simulate.finance.golden.cases';

const want = golden as unknown as FinanceGolden;

export function describeFinanceGolden(where: string): void {
  describe(`finance cross-engine golden (${where})`, () => {
    it('keeps the FZP golden input free of market and finance', () => {
      const input = goldenInput();
      expect('market' in input).toBe(false);
      expect('finance' in input).toBe(false);
      expect('finance' in financeGoldenInput()).toBe(true);
    });

    it('holds seeds 1 and 4, and neither is degenerate', () => {
      expect(want.runs.map((r) => r.seed)).toEqual([...FINANCE_GOLDEN_SEEDS]);
      for (const r of want.runs) expect(r.horizon).toBe(GOLDEN_HORIZON);
      const [one, four] = want.runs;
      const funded1 = one.schedules.filter((s) => s.funding);
      expect(funded1.some((s) => s.kind === 'affordable' && s.funding!.certain)).toBe(true);
      for (const k of ['in', 'commit', 'spend']) {
        expect(
          one.ledger.some((e) => e.kind === k),
          k
        ).toBe(true);
      }
      expect(four.schedules.some((s) => s.funding && s.kind !== 'affordable')).toBe(true);
      expect(four.ledger.some((e) => e.kind === 'release')).toBe(true);
    });

    for (const [i, seed] of FINANCE_GOLDEN_SEEDS.entries()) {
      it(`reproduces every schedule and ledger event exactly, seed ${seed}`, () => {
        const w = want.runs[i];
        const now = financeGoldenRun(seed);
        expect(now.schedules.map((s) => s.projectId)).toEqual(w.schedules.map((s) => s.projectId));
        for (let k = 0; k < w.schedules.length; k++) {
          expect(now.schedules[k], w.schedules[k].projectId).toEqual(w.schedules[k]);
        }
        expect(now.ledger).toEqual(w.ledger);
        expect(now).toEqual(w);
      });
    }
  });
}
