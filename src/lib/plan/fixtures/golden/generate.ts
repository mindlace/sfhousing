// Regenerate: npx tsx src/lib/plan/fixtures/golden/generate.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plan } from '../../types';
import { GRID_RECORDS } from '../grid-20x20';
import { bruteForceResolve } from '../reference';

export const GOLDEN_PLANS = ['empty', 'single-stamp', 'paint-then-erase', 'overlap-lower-wins'];

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of GOLDEN_PLANS) {
    const plan = JSON.parse(readFileSync(join(here, '../plans', `${name}.json`), 'utf8')) as Plan;
    const rows = bruteForceResolve(plan, GRID_RECORDS);
    writeFileSync(join(here, `${name}.json`), JSON.stringify(rows) + '\n');
  }
}
