/**
 * Writes `funded-events-mini-seed1.json`, already formatted by Prettier, from Node:
 *   env -C <worktree> node_modules/.bin/tsx src/lib/sim/world/funding/fixtures/build-funded-golden.ts
 * (or `npx tsx …` from the worktree root). tsx reads the `$lib` path alias from the tsconfig in
 * the current directory, so `npm --prefix <worktree> exec` from elsewhere cannot resolve it.
 * Run deliberately, never from signoff: a changed golden is an engine change to review.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { goldenFundedRun } from '../funded.golden.cases';

const out = fileURLToPath(new URL('./funded-events-mini-seed1.json', import.meta.url));
const options = (await resolveConfig(out)) ?? {};
const run = goldenFundedRun();
writeFileSync(out, await format(JSON.stringify(run), { ...options, filepath: out }));
console.log(`wrote ${out}: ${run.events.length} events, ${run.ledger.length} ledger events`);
