/**
 * Writes `golden-finance-seed1.json`, already formatted by Prettier, from Node:
 *   env -C <worktree> node_modules/.bin/tsx src/lib/sim/scenario/fixtures/build-finance-golden.ts
 * Run deliberately, never from CI: a changed golden is an engine change to review.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  FINANCE_GOLDEN_SEEDS,
  financeGoldenRun,
  type FinanceGolden
} from '../simulate.finance.golden.cases';
import { fundedRunStats } from '../funded';

const out = fileURLToPath(new URL('./golden-finance-seed1.json', import.meta.url));
const options = (await resolveConfig(out)) ?? {};
const runs: FinanceGolden['runs'] = [];
const lines: string[] = [];
for (const seed of FINANCE_GOLDEN_SEEDS) {
  const run = financeGoldenRun(seed);
  runs.push(run);
  const funded = run.schedules.filter((s) => s.funding);
  const kinds: Record<string, number> = {};
  for (const e of run.ledger) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  lines.push(
    `seed ${seed}: ${run.schedules.length} schedules, ${funded.length} funded ` +
      `(${funded.filter((s) => s.kind === 'affordable').length} affordable, ` +
      `${funded.filter((s) => s.funding!.certain).length} certain), ledger ${JSON.stringify(kinds)}, ` +
      `respells ${fundedRunStats().respells}`
  );
}
writeFileSync(out, await format(JSON.stringify({ runs }), { ...options, filepath: out }));
console.log(`wrote ${out}\n${lines.join('\n')}`);
