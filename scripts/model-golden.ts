/**
 * Writes `src/lib/timelapse/fixtures/model-golden.json` (AC-11) from Node, already formatted by
 * Prettier: `npx tsx scripts/model-golden.ts`. The server and browser-engine goldens then
 * recompute the same cases and compare bit patterns.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { modelGoldenCases } from '../src/lib/timelapse/model.golden.cases';

const out = fileURLToPath(
  new URL('../src/lib/timelapse/fixtures/model-golden.json', import.meta.url)
);
const options = (await resolveConfig(out)) ?? {};
const text = await format(JSON.stringify({ cases: modelGoldenCases() }), {
  ...options,
  filepath: out
});
writeFileSync(out, text);
console.log(`wrote ${out}`);
