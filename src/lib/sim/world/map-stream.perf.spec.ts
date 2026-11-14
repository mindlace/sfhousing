// Wall-clock bars for the map stream (`npm run test:perf`; never in signoff). The bar: a
// `flush(…, 20)` takes at most 30 ms on the bench city. Printed with no assertion: the snapshot
// cost, cold and warm, and on the live city the longest flush and the longest single project's
// `massingFor` (the unsplittable unit of a sliced flush).
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '$lib/data/parcel';
import { massingFor } from '$lib/sim/scenario/massing';
import type { SimInput } from '$lib/sim/scenario/types';
import { planDue } from './due';
import { createMapStream } from './map-stream';
import { monthLastDay } from './months';
import { scheduleAt } from './read';
import { staticsOf } from './statics';
import { benchInput, liveInput } from './test/cities.node';
import { benchRecords, dirRecords } from './test/map-stream-cities.node';
import { streamDeps } from './test/map-stream-deps';
import { startStream } from './test/map-stream-run';
import { frameOf, oneFrame } from './test/timeline';
import { step } from './world';

const SEED = 1;
const WINDOW = 480;
const BUDGET = 20;
const BAR = 30;
const LIVE = process.env.SFH_WORLD_LIVE;

const ms = (x: number) => x.toFixed(2);

/** A world and stream for `input` stepped to month 480; `budgetMs` null flushes nothing. */
function run(input: SimInput, records: ParcelRecord[], budgetMs: number | null) {
  const statics = staticsOf(input);
  const timeline = oneFrame(frameOf(input));
  const deps = streamDeps(input, records);
  const stream = createMapStream(deps, WINDOW);
  const { world, sink } = startStream(statics, timeline, SEED, stream);
  const due = planDue(world, statics, timeline, SEED, WINDOW);
  const flushes: { ms: number; month: number; cells: number }[] = [];
  const sent = new Set<string>();
  let sends = 0;
  const t0 = performance.now();
  while (world.month < WINDOW) {
    step(world, due, statics, timeline, SEED, sink);
    if (budgetMs === null) continue;
    const t = performance.now();
    const u = stream.flush(world, statics, budgetMs);
    const dt = performance.now() - t;
    sends += u?.cells.length ?? 0;
    for (const c of u?.cells ?? []) sent.add(c.cellId);
    flushes.push({ ms: dt, month: world.month, cells: u?.cells.length ?? 0 });
  }
  const stepped = performance.now() - t0;
  let drained = 0;
  if (budgetMs !== null) {
    for (
      let u = stream.flush(world, statics, Infinity);
      u;
      u = stream.flush(world, statics, Infinity)
    ) {
      drained += u.cells.length;
      sends += u.cells.length;
      for (const c of u.cells) sent.add(c.cellId);
    }
  }
  return { statics, deps, stream, world, flushes, sent, sends, drained, stepped };
}

function snapshots(name: string, input: SimInput, records: ParcelRecord[]) {
  // cold: events only, nothing flushed, empty memo
  const cold = run(input, records, null);
  let t = performance.now();
  const a = cold.stream.snapshot(cold.world, cold.statics);
  const coldMs = performance.now() - t;
  // warm: the deps and memo of a full fill
  const warm = run(input, records, BUDGET);
  t = performance.now();
  const b = warm.stream.snapshot(warm.world, warm.statics);
  const warmMs = performance.now() - t;
  console.log(
    `[perf] ${name} snapshot at month ${WINDOW}: cold ${ms(coldMs)} ms (${a.cells.length} cells), ` +
      `warm ${ms(warmMs)} ms (${b.cells.length} cells)`
  );
  expect(b.revision).toBe(0);
  expect(b.cells.length).toBe(a.cells.length);
  return warm;
}

describe('map stream timing, bench city', () => {
  it(`flush(…, ${BUDGET}) takes at most ${BAR} ms, month by month to ${WINDOW}`, () => {
    const r = run(benchInput(), benchRecords(), BUDGET);
    expect(r.sends, 'cells sent (every cell of every update)').toBeGreaterThanOrEqual(1000);
    const times = r.flushes.map((f) => f.ms).sort((x, y) => x - y);
    const total = times.reduce((s, x) => s + x, 0);
    const p95 = times[Math.ceil(0.95 * times.length) - 1];
    const worst = r.flushes.reduce((w, f) => (f.ms > w.ms ? f : w), r.flushes[0]);
    console.log(
      `[perf] bench city flush(…, ${BUDGET}): ${r.flushes.length} flushes, worst ${ms(worst.ms)} ms ` +
        `(month ${worst.month}, ${worst.cells} cells), p95 ${ms(p95)} ms, total ${ms(total)} ms; ` +
        `${r.sends} cell sends over ${r.sent.size} distinct cells, ${r.drained} in the final drain; stepping incl. flushes ${ms(r.stepped)} ms`
    );
    expect(
      worst.ms,
      `worst flush ${ms(worst.ms)} ms at month ${worst.month}, ${worst.cells} cells in the update`
    ).toBeLessThanOrEqual(BAR);
  }, 120_000);

  it('snapshot at month 480, cold and warm (no bar)', () => {
    snapshots('bench city', benchInput(), benchRecords());
  }, 120_000);
});

describe.skipIf(!LIVE)('map stream timing, live city', () => {
  it('snapshot at month 480, cold and warm; longest flush and longest massingFor (no bar)', async () => {
    const input = await liveInput(LIVE!);
    const records = dirRecords(LIVE!);
    const name = `live ${LIVE!.split('/').pop()}`;
    const r = snapshots(name, input, records);

    const times = r.flushes.map((f) => f.ms).sort((x, y) => x - y);
    const total = times.reduce((s, x) => s + x, 0);
    const worst = r.flushes.reduce((w, f) => (f.ms > w.ms ? f : w), r.flushes[0]);
    console.log(
      `[perf] ${name} flush(…, ${BUDGET}): ${r.flushes.length} flushes, longest ${ms(worst.ms)} ms ` +
        `(month ${worst.month}, ${worst.cells} cells), p95 ${ms(times[Math.ceil(0.95 * times.length) - 1])} ms, ` +
        `total ${ms(total)} ms; ${r.sends} cell sends over ${r.sent.size} distinct cells`
    );

    // the longest single project: massingFor over every revision, cold generator memo each time
    const day = monthLastDay(input.asOf, WINDOW);
    const deps = streamDeps(input, records);
    let longest = { ms: 0, projectId: '', revisions: 0 };
    let projects = 0;
    for (let row = 0; row < r.world.projects.n; row++) {
      const schedule = scheduleAt(r.world, r.statics, row, day);
      if (schedule === null) continue;
      deps.massing.memo.clear();
      const t = performance.now();
      try {
        for (let k = 0; k < schedule.revisions.length; k++) massingFor(schedule, k, deps.massing);
      } catch {
        continue; // no loaded parcel records: not a packed project
      }
      const dt = performance.now() - t;
      projects++;
      if (dt > longest.ms)
        longest = { ms: dt, projectId: schedule.projectId, revisions: schedule.revisions.length };
    }
    console.log(
      `[perf] ${name} longest single-project massingFor at month ${WINDOW}: ${ms(longest.ms)} ms ` +
        `(${longest.projectId}, ${longest.revisions} revisions), over ${projects} projects`
    );
    expect(projects).toBeGreaterThan(0);
  }, 300_000);
});
