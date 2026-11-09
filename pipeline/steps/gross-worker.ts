// A gross-step worker (gross.ts `writeGross` with `workers > 0`): loads the same inputs as the main
// thread, then takes GROSS_BATCH rows at a time from the shared cursor and posts
// `{ start, rows }` until the cursor passes `count`.
import { parentPort, workerData } from 'node:worker_threads';
import { GROSS_BATCH, grossRowAt, loadGrossInputs } from './gross';

const { outDir, cursor, count } = workerData as {
  outDir: string;
  cursor: Int32Array;
  count: number;
};
const inp = loadGrossInputs(outDir);
if (inp.parcels.count !== count) {
  throw new Error(`gross worker: parcels.bin has ${inp.parcels.count} rows, expected ${count}`);
}
for (;;) {
  const start = Atomics.add(cursor, 0, GROSS_BATCH);
  if (start >= count) break;
  const end = Math.min(count, start + GROSS_BATCH);
  const rows = [];
  for (let i = start; i < end; i++) rows.push(grossRowAt(inp, i));
  parentPort!.postMessage({ start, rows });
}
