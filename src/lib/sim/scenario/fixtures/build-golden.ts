/**
 * Writes `golden-seed1.json` (AC 1), already formatted by Prettier, from Node:
 *   env -C <worktree> node_modules/.bin/tsx src/lib/sim/scenario/fixtures/build-golden.ts
 * (or `npx tsx …` from the worktree root). tsx reads the `$lib` path alias from the tsconfig in
 * the current directory, so `npm --prefix <worktree> exec` from elsewhere cannot resolve it.
 * Run deliberately, never from CI: a changed golden is an engine change to review.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { goldenRun } from '../simulate.golden.cases';

const out = fileURLToPath(new URL('./golden-seed1.json', import.meta.url));
const options = (await resolveConfig(out)) ?? {};
const warn = console.warn;
console.warn = () => {}; // the once-per-input skipped-rows notice
const run = goldenRun();
console.warn = warn;
writeFileSync(out, await format(JSON.stringify(run), { ...options, filepath: out }));
console.log(`wrote ${out}: ${run.schedules.length} schedules`);
