// An options worker (options.ts `candidateRows` with `workers > 0`): decodes the chunk records,
// then takes `batch` jobs (default OPTIONS_BATCH) at a time from the shared cursor and posts
// `{ start, rows, district }` until the cursor passes the last job.
import { parentPort, workerData } from 'node:worker_threads';
import { candidatesForJob, loadChunkRecords, type CandidateJob } from './options';

const { outDir, jobs, cursor, batch, index, failWorker } = workerData as {
  outDir: string;
  jobs: CandidateJob[];
  cursor: Int32Array;
  batch: number;
  index: number;
  /** Test only (OptionsWorkerOpts' `failWorker`). */
  failWorker?: number;
};
if (failWorker !== undefined) {
  if (index === failWorker) throw new Error(`options worker ${index}: test failure`);
  // Block (without taking jobs) until the main thread terminates this worker.
  Atomics.wait(cursor, 0, Atomics.load(cursor, 0), 60_000);
}
const records = loadChunkRecords(outDir);
for (;;) {
  const start = Atomics.add(cursor, 0, batch);
  if (start >= jobs.length) break;
  const end = Math.min(jobs.length, start + batch);
  const rows: Uint32Array[] = [];
  const district = new Uint8Array(end - start);
  for (let i = start; i < end; i++) {
    const r = candidatesForJob(records, jobs[i]);
    rows.push(r.packed);
    district[i - start] = r.district ? 1 : 0;
  }
  parentPort!.postMessage({ start, rows, district });
}
