/**
 * The input and run of the finance cross-engine golden (finance-engine spec section 6, test 5).
 * The builder (`fixtures/build-finance-golden.ts`, Node) writes `fixtures/golden-finance-seed1.json`
 * from `financeGoldenRun`; `simulate.finance.golden.shared.ts` (the server test and the client
 * project's browser spec) reruns it and compares deep-equal. Browser-safe. Test support only.
 */
import type { Day } from '$lib/timelapse/time';
import { runEngine } from './engine';
import { miniCalibrationWithRoutes, miniFinance } from './fixtures/mini-finance';
import type { LedgerEvent } from './money';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import type { Schedule, SimInput } from './types';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `goldenInput()` on the calibration with `affordableRoutes`, with the mini finance stack. */
export function financeGoldenInput(): SimInput {
  const base = goldenInput();
  return {
    ...base,
    calibration: miniCalibrationWithRoutes(),
    finance: miniFinance(base.asOf)
  };
}

export type FinanceGoldenRun = {
  seed: number;
  horizon: Day;
  schedules: Schedule[];
  ledger: LedgerEvent[];
};

/** The golden file: seed 1 (the spec's case) and seed 4 (market-funded starts and releases). */
export type FinanceGolden = { runs: FinanceGoldenRun[] };
export const FINANCE_GOLDEN_SEEDS = [1, 4] as const;

export function financeGolden(): FinanceGolden {
  return { runs: FINANCE_GOLDEN_SEEDS.map((seed) => financeGoldenRun(seed)) };
}

/** One run of `financeGoldenInput()`, as the golden file holds it (a JSON round trip). */
export function financeGoldenRun(seed: number = 1): FinanceGoldenRun {
  const pipeline: Schedule[] = [];
  const simulated: Schedule[] = [];
  const ledger: LedgerEvent[] = [];
  runEngine(financeGoldenInput(), seed, GOLDEN_HORIZON, {
    schedule(s) {
      (s.origin === 'pipeline' ? pipeline : simulated).push(s);
    },
    master() {},
    ledger(e) {
      ledger.push(e);
    }
  });
  pipeline.sort((a, b) => cmp(a.projectId, b.projectId));
  simulated.sort((a, b) => cmp(a.projectId, b.projectId));
  return JSON.parse(
    JSON.stringify({
      seed,
      horizon: GOLDEN_HORIZON,
      schedules: [...pipeline, ...simulated],
      ledger
    })
  ) as FinanceGoldenRun;
}
