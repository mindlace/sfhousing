// A gross-step worker (gross.ts `writeGross` with `workers > 0`): loads the same inputs as the main
// thread, then takes `batch` rows (default GROSS_BATCH) at a time from the shared cursor and posts
// `{ start, rows }` until the cursor passes `count`.
import { parentPort, workerData } from 'node:worker_threads';
import { grossRowAt, loadGrossInputs } from './gross';

const { outDir, cursor, count, batch, index, failWorker } = workerData as {
  outDir: string;
  cursor: Int32Array;
  count: number;
  batch: number;
  index: number;
  /** Test only (grossRowsOnWorkers' `failWorker`). */
  failWorker?: number;
};
if (failWorker !== undefined) {
  if (index === failWorker) throw new Error(`gross worker ${index}: test failure`);
  // Block (without taking rows) until the main thread terminates this worker.
  Atomics.wait(cursor, 0, Atomics.load(cursor, 0), 60_000);
}
const inp = loadGrossInputs(outDir);
if (inp.parcels.count !== count) {
  throw new Error(`gross worker: parcels.bin has ${inp.parcels.count} rows, expected ${count}`);
}
for (;;) {
  const start = Atomics.add(cursor, 0, batch);
  if (start >= count) break;
  const end = Math.min(count, start + batch);
  const rows = [];
  for (let i = start; i < end; i++) rows.push(grossRowAt(inp, i));
  parentPort!.postMessage({ start, rows });
}
