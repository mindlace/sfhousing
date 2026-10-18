/**
 * Writes `src/lib/timelapse/fixtures/model-golden.json` (AC-11) from Node:
 * `npx tsx scripts/model-golden.ts`, then `npx prettier --write` on that file. The server and
 * browser-engine goldens then recompute the same cases and compare bit patterns.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { modelGoldenCases } from '../src/lib/timelapse/model.golden.cases';

const out = fileURLToPath(
  new URL('../src/lib/timelapse/fixtures/model-golden.json', import.meta.url)
);
writeFileSync(out, JSON.stringify({ cases: modelGoldenCases() }, null, 1) + '\n');
console.log(`wrote ${out}`);
