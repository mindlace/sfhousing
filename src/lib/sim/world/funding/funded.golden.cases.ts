/**
 * The run of the funded cross-engine golden (spec global constraint: the same inputs give the
 * same world in Node and in the browser). The builder (`fixtures/build-funded-golden.ts`, Node)
 * writes `fixtures/funded-events-mini-seed1.json` from `goldenFundedRun`; `funded.golden.shared.ts`
 * (the server test and the client project's browser spec) reruns it and compares. Browser-safe:
 * the mini city only. Test support only: nothing in the app imports it.
 */
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { staticsOf } from '../statics';
import { fundedMini, oneMoneyTimeline, runFunded, type MonthEvent } from './test/fixtures';

export const FUNDED_GOLDEN_SEED = 1;
export const FUNDED_GOLDEN_THROUGH = 120;

export interface GoldenFunded {
  events: MonthEvent[];
  ledger: LedgerEvent[];
}

/**
 * The mini city with `miniFinance`, seed 1, stepped through month 120: every event with the month
 * of the call that sent it, and the ledger, as the golden file holds them (a JSON round trip).
 */
export function goldenFundedRun(): GoldenFunded {
  const input = fundedMini();
  const got = runFunded(
    staticsOf(input),
    oneMoneyTimeline(input, miniFinance(input.asOf)),
    FUNDED_GOLDEN_SEED,
    FUNDED_GOLDEN_THROUGH
  );
  return JSON.parse(JSON.stringify({ events: got.events, ledger: got.ledger })) as GoldenFunded;
}
