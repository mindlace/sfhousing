// `npx tsx scripts/map-stream-measure.ts (<datasetDir> | --bench) [--seed 1] [--months 480]
// [--budget 20] [--every 1]` (with SFH_WORLD_LIVE set, the directory may be left out): one
// unfunded world stepped to `--months`, every cell ready, `flush(world, statics, budget)` timed
// after every `--every`th month and drained at the end. Prints one JSON object: how often cells
// are packed again, what the flushes cost, and a stand-in for the cost of one `snapshot` (a fresh
// stream fed one 'start' per row, drained once). Run it on a quiet machine. Not part of the bundle.
import { readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseManifest } from '../src/lib/data/manifest';
import { createMapStream } from '../src/lib/sim/world/map-stream';
import { createWorld, planDue, step } from '../src/lib/sim/world/index';
import type { SimInput } from '../src/lib/sim/scenario/types';
import { staticsOf, type Statics } from '../src/lib/sim/world/statics';
import { benchInput, liveInput } from '../src/lib/sim/world/test/cities.node.js';
import { benchRecords, dirRecords } from '../src/lib/sim/world/test/map-stream-cities.node.js';
import { streamDeps } from '../src/lib/sim/world/test/map-stream-deps';
import { StreamSink } from '../src/lib/sim/world/test/map-stream-run';
import { frameOf, oneFrame } from '../src/lib/sim/world/test/timeline';
import {
  ORIGIN_MASTER,
  ORIGIN_PHASE,
  ORIGIN_PIPELINE,
  ORIGIN_SIM,
  type World
} from '../src/lib/sim/world/types';

const now = () => performance.now();
const flag = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(name);
  return i < 0 ? dflt : Number(process.argv[i + 1]);
};
const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r2 = (x: number) => Math.round(x * 100) / 100;

async function main(): Promise<void> {
  const seed = flag('--seed', 1);
  const months = flag('--months', 480);
  const budgetMs = flag('--budget', 20);
  const every = flag('--every', 1);
  const arg = process.argv
    .slice(2)
    .find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  const bench = process.argv.includes('--bench');
  const dir = bench ? null : (arg ?? process.env.SFH_WORLD_LIVE ?? null);
  if (!bench && !dir) {
    console.error(
      'usage: map-stream-measure.ts (<datasetDir> | --bench) [--seed 1] [--months 480] [--budget 20] [--every 1]'
    );
    process.exit(2);
  }
  const input = dir ? await liveInput(dir) : benchInput();
  const records = dir ? dirRecords(dir) : benchRecords();
  const dataset = dir
    ? parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).datasetVersion
    : 'bench city';
  console.error(
    `${dataset}: ${input.parcels.count} parcels; ${cpus()[0]?.model} (${cpus().length} cores); ` +
      `load ${loadavg()
        .map((x) => x.toFixed(2))
        .join(' ')}`
  );

  const statics = staticsOf(input);
  const timeline = oneFrame(frameOf(input));
  const deps = streamDeps(input, records, { now });
  const stream = createMapStream(deps, months);
  const sink = new StreamSink(stream, statics);
  const world = createWorld(statics, timeline, seed, sink);
  sink.attach(world);
  const due = planDue(world, statics, timeline, seed, months);

  const packs = new Map<string, number>();
  const flushMs: number[] = [];
  const cellsPerUpdate: number[] = [];
  let worst = { ms: 0, month: 0 };
  let packMsTotal = 0;
  let stepMsTotal = 0;
  let flushes = 0;
  let nonNull = 0;
  const run = (month: number) => {
    const t = now();
    const u = stream.flush(world, statics, budgetMs);
    const ms = now() - t;
    flushes++;
    flushMs.push(ms);
    packMsTotal += ms;
    if (ms > worst.ms) worst = { ms, month };
    if (u) {
      nonNull++;
      cellsPerUpdate.push(u.cells.length);
      for (const c of u.cells) packs.set(c.cellId, (packs.get(c.cellId) ?? 0) + 1);
    }
    return u;
  };
  while (world.month < months) {
    const t = now();
    step(world, due, statics, timeline, seed, sink);
    stepMsTotal += now() - t;
    if (world.month % every === 0 || world.month === months) run(world.month);
  }
  let drainFlushes = 0;
  while (run(world.month) !== null) drainFlushes++;

  const buckets = { '1': 0, '2': 0, '3-5': 0, '6-10': 0, '11-50': 0, '>50': 0 };
  let maxPacks = { cell: '', n: 0 };
  let moreThanOnce = 0;
  for (const [cell, n] of packs) {
    if (n > 1) moreThanOnce++;
    if (n > maxPacks.n) maxPacks = { cell, n };
    if (n === 1) buckets['1']++;
    else if (n === 2) buckets['2']++;
    else if (n <= 5) buckets['3-5']++;
    else if (n <= 10) buckets['6-10']++;
    else if (n <= 50) buckets['11-50']++;
    else buckets['>50']++;
  }

  const projects = rowsWithCell(world, statics, input);

  // stand-in for snapshot: a fresh stream, one 'start' per row, one drain
  const resync = (d: ReturnType<typeof streamDeps>): number => {
    const s = createMapStream(d, months);
    for (let row = 0; row < world.projects.n; row++) {
      s.onEvent({ kind: 'start', row, day: 0 }, world, statics);
    }
    const t = now();
    s.flush(world, statics, Infinity);
    return now() - t;
  };
  const resyncMsColdMemo = resync(streamDeps(input, records, { now }));
  const resyncMsWarmMemo = resync(deps);

  console.log(
    JSON.stringify(
      {
        dataset,
        seed,
        months,
        budgetMs,
        every,
        projects,
        cells: packs.size,
        packsPerCell: buckets,
        maxPacks,
        cellsPackedMoreThanOnce: moreThanOnce,
        flushes,
        nonNullUpdates: nonNull,
        cellsPerUpdate: {
          p50: pct(cellsPerUpdate, 0.5),
          p95: pct(cellsPerUpdate, 0.95),
          max: Math.max(0, ...cellsPerUpdate)
        },
        packMsTotal: r2(packMsTotal),
        flushMsWorst: { ms: r2(worst.ms), month: worst.month },
        flushMsP95: r2(pct(flushMs, 0.95)),
        drainFlushes,
        stepMsTotal: r2(stepMsTotal),
        resyncMsColdMemo: r2(resyncMsColdMemo),
        resyncMsWarmMemo: r2(resyncMsWarmMemo),
        resyncNote:
          'stand-in for snapshot; the real one is timed in Task 7 on the bench city and the live city'
      },
      null,
      2
    )
  );
  console.error(
    `load after ${loadavg()
      .map((x) => x.toFixed(2))
      .join(' ')}`
  );
}

/** Rows whose T11 parcels give them a cell (as `MapStream.onEvent` places them). */
function rowsWithCell(world: World, statics: Statics, input: SimInput): number {
  const P = input.parcels;
  const p = world.projects;
  let n = 0;
  for (let row = 0; row < p.n; row++) {
    const origin = p.origin[row];
    let ids: string[];
    if (origin === ORIGIN_SIM) ids = [statics.parcelId[p.src[row]]];
    else if (origin === ORIGIN_PIPELINE) ids = statics.projects[p.src[row]].parcelIds;
    else if (origin === ORIGIN_PHASE) {
      ids = (statics.projects[p.src[row]].phases ?? [])[p.sub[row] - 1].parcelIds;
    } else if (origin === ORIGIN_MASTER) ids = [];
    else ids = [];
    if (ids.some((id) => P.index.has(id as never))) n++;
  }
  return n;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
