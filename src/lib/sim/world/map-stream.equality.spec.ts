// Signoff equality (map-stream spec S17): the cells and demolitions a stream has sent for a world
// stepped to the horizon equal today's packing, `createGeometry` over `simulateDetailed`'s
// schedules, under one frame and no public money.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import { createGeometry, type Geometry } from '$lib/sim/scenario/geometry';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { createMapStream } from './map-stream';
import { monthLastDay } from './months';
import { staticsOf } from './statics';
import { benchInput, fixtureInput, liveInput } from './test/cities.node';
import { benchRecords, dirRecords, fixtureRecords } from './test/map-stream-cities.node';
import { streamDeps } from './test/map-stream-deps';
import { fill, startStream } from './test/map-stream-run';
import { horizonMonth, readAll } from './test/run';
import { frameOf, oldInputOf, oneFrame } from './test/timeline';

const SEED = 1;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Sent {
  last: Map<string, TimedPackedCell>;
  demolished: Map<ParcelId, Day>;
  schedules: Schedule[];
  oldSchedules: Schedule[];
  g: Geometry;
}

/** Fills a stream to the horizon month and builds today's packing for the same input. */
function run(input: SimInput, records: ParcelRecord[], flushEvery: number): Sent {
  const statics = staticsOf(input);
  const H = horizonMonth(input.asOf);
  const Hday = monthLastDay(input.asOf, H);
  const timeline = oneFrame(frameOf(input));
  const deps = streamDeps(input, records);
  const stream = createMapStream(deps, H);
  const { world, sink } = startStream(statics, timeline, SEED, stream);
  const updates = fill({
    world,
    statics,
    timeline,
    seed: SEED,
    stream,
    sink,
    through: H,
    flushEvery
  });
  for (
    let u = stream.flush(world, statics, Infinity);
    u;
    u = stream.flush(world, statics, Infinity)
  )
    updates.push(u);

  const last = new Map<string, TimedPackedCell>();
  const demolished = new Map<ParcelId, Day>();
  for (const u of updates) {
    for (const id of u.removedCells) last.delete(id);
    for (const c of u.cells) last.set(c.cellId, c);
    for (const lot of u.restore ?? []) demolished.delete(lot);
    for (const d of u.demolish) {
      const had = demolished.get(d.parcelId);
      if (had === undefined || d.day < had) demolished.set(d.parcelId, d.day);
    }
  }

  const old = simulateDetailed(oldInputOf(input), SEED, Hday);
  const P = input.parcels;
  const byId = new Map<ParcelId, ParcelRecord>();
  const byCell = new Map<string, ParcelRecord[]>();
  for (const r of records) {
    byId.set(r.id, r);
    const i = P.index.get(r.id);
    if (i === undefined) continue;
    const cell = P.cells[P.cell[i]].cellId;
    const list = byCell.get(cell);
    if (list) list.push(r);
    else byCell.set(cell, [r]);
  }
  const { records: _records, ...massingCtx } = deps.massing;
  void _records;
  const g = createGeometry({
    input,
    schedules: old.schedules,
    records: byCell,
    recordOf: (id) => byId.get(id),
    massingCtx,
    warnOnce: () => {}
  });
  return {
    last,
    demolished,
    schedules: readAll(world, statics, Hday).schedules,
    oldSchedules: old.schedules,
    g
  };
}

function suite(name: string, load: () => Promise<{ input: SimInput; records: ParcelRecord[] }>) {
  describe(`${name}, one frame, no money, seed ${SEED}`, () => {
    let r: Sent;
    beforeAll(async () => {
      const { input, records } = await load();
      r = run(input, records, 12);
    });

    it("the world agrees with simulateDetailed at H' (precondition)", () => {
      expect(r.schedules.map((s) => s.projectId)).toEqual(r.oldSchedules.map((s) => s.projectId));
      for (let i = 0; i < r.oldSchedules.length; i++)
        expect(r.schedules[i], r.oldSchedules[i].projectId).toEqual(r.oldSchedules[i]);
    });

    it("the cells last sent equal packTimedCell over simulateDetailed's schedules", () => {
      expect(r.last.size).toBeGreaterThan(0);
      expect([...r.last.keys()].sort(cmp)).toEqual([...r.g.anchoredCells()].sort(cmp));
      for (const c of [...r.last.keys()].sort(cmp)) expect(r.last.get(c), c).toEqual(r.g.pack(c));
    });

    it("the demolitions sent equal today's revision 0 list", () => {
      const folded: TimelineUpdate['demolish'] = [...r.demolished.keys()]
        .sort(cmp)
        .map((parcelId) => ({ parcelId, day: r.demolished.get(parcelId)! }));
      expect(folded.length).toBeGreaterThan(0);
      expect(folded).toEqual(r.g.demolish());
    });
  });
}

suite('bench', async () => ({ input: benchInput(), records: benchRecords() }));
suite('fixture', async () => ({ input: await fixtureInput(), records: fixtureRecords() }));

const LIVE = process.env.SFH_WORLD_LIVE;
describe.skipIf(!LIVE)('live', () => {
  suite('live', async () => ({ input: await liveInput(LIVE!), records: dirRecords(LIVE!) }));
});
