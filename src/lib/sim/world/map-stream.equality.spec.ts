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
import type { PolicyTimeline } from './policy/frame';
import { staticsOf, type Statics } from './statics';
import { benchInput, fixtureInput, liveInput } from './test/cities.node';
import { benchRecords, dirRecords, fixtureRecords } from './test/map-stream-cities.node';
import { sharedGenMemo, streamDeps, warmGenMemo } from './test/map-stream-deps';
import { useFastTypedArrayEquality } from './test/map-stream-equal';
import { fill, startStream } from './test/map-stream-run';
import { horizonMonth, readAll } from './test/run';
import { frameOf, oldInputOf, oneFrame } from './test/timeline';

const SEED = 1;
/**
 * Months between flushes. The assertions read only the cells last sent, and a flush packs every
 * dirty cell whole, so the cadence sets the cost (H' is 483 months on the bench city: yearly
 * flushes pack about 10,000 cells, ten-yearly about 1,200) but not what is compared. Cells sent
 * before the final update and never again are still compared (`early`).
 */
const FLUSH_EVERY = 120;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

useFastTypedArrayEquality();

interface City {
  input: SimInput;
  records: ParcelRecord[];
  statics: Statics;
  timeline: PolicyTimeline;
  /** H': the horizon month, and its last day. */
  H: number;
  Hday: Day;
}

function cityOf(input: SimInput, records: ParcelRecord[]): City {
  const H = horizonMonth(input.asOf);
  return {
    input,
    records,
    statics: staticsOf(input),
    timeline: oneFrame(frameOf(input)),
    H,
    Hday: monthLastDay(input.asOf, H)
  };
}

interface Streamed {
  deps: ReturnType<typeof streamDeps>;
  last: Map<string, TimedPackedCell>;
  /** Cells whose last send came before the final update: never re-sent, so they must still hold. */
  early: number;
  demolished: Map<ParcelId, Day>;
  schedules: Schedule[];
}

/**
 * Fills a stream to H', flushing every `flushEvery` months, drains it, and folds what it sent:
 * the cells last sent and the earliest demolition day per lot.
 */
function stream(c: City, flushEvery: number): Streamed {
  const deps = streamDeps(c.input, c.records, { genMemo: sharedGenMemo(c.input) });
  const stream = createMapStream(deps, c.H);
  const { world, sink } = startStream(c.statics, c.timeline, SEED, stream);
  const { statics, timeline } = c;
  const updates = fill({
    world,
    statics,
    timeline,
    seed: SEED,
    stream,
    sink,
    through: c.H,
    flushEvery
  });
  for (
    let u = stream.flush(world, statics, Infinity);
    u;
    u = stream.flush(world, statics, Infinity)
  )
    updates.push(u);

  const last = new Map<string, TimedPackedCell>();
  /** The update each cell was last sent in. */
  const sentIn = new Map<string, number>();
  const demolished = new Map<ParcelId, Day>();
  updates.forEach((u, i) => {
    for (const id of u.removedCells) last.delete(id);
    for (const cell of u.cells) {
      last.set(cell.cellId, cell);
      sentIn.set(cell.cellId, i);
    }
    for (const lot of u.restore ?? []) demolished.delete(lot);
    for (const d of u.demolish) {
      const had = demolished.get(d.parcelId);
      if (had === undefined || d.day < had) demolished.set(d.parcelId, d.day);
    }
  });
  let early = 0;
  for (const [cell, i] of sentIn) if (last.has(cell) && i < updates.length - 1) early++;
  return { deps, last, early, demolished, schedules: readAll(world, statics, c.Hday).schedules };
}

/** Today's packing for the same input: `createGeometry` over `simulateDetailed`'s schedules at H'. */
function today(c: City, deps: Streamed['deps']): { oldSchedules: Schedule[]; g: Geometry } {
  const old = simulateDetailed(oldInputOf(c.input), SEED, c.Hday);
  const P = c.input.parcels;
  const byId = new Map<ParcelId, ParcelRecord>();
  const byCell = new Map<string, ParcelRecord[]>();
  for (const r of c.records) {
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
    input: c.input,
    schedules: old.schedules,
    records: byCell,
    recordOf: (id) => byId.get(id),
    massingCtx,
    warnOnce: () => {}
  });
  return { oldSchedules: old.schedules, g };
}

// The setup is split over hooks, each well inside the default hook timeout under load: the city
// (input, then records), the generator's cold cost (`warmGenMemo` through H', the same run the
// stream fills), the stream fill, and today's packing. The generator memo is a pure content cache
// shared by both sides, as the host shares one (massing.ts:25); every cell is still packed by both.
function suite(
  name: string,
  loadInput: () => SimInput | Promise<SimInput>,
  loadRecords: () => ParcelRecord[]
) {
  describe(`${name}, one frame, no money, seed ${SEED}`, () => {
    let input: SimInput;
    let c: City;
    let s: Streamed;
    let t: { oldSchedules: Schedule[]; g: Geometry };
    beforeAll(async () => {
      input = await loadInput();
    });
    beforeAll(() => {
      c = cityOf(input, loadRecords());
    });
    beforeAll(() => {
      warmGenMemo(c.input, c.records, c.statics, c.timeline, SEED, c.H);
    });
    beforeAll(() => {
      s = stream(c, FLUSH_EVERY);
    });
    beforeAll(() => {
      t = today(c, s.deps);
    });

    it("the world agrees with simulateDetailed at H' (precondition)", () => {
      expect(s.schedules.map((x) => x.projectId)).toEqual(t.oldSchedules.map((x) => x.projectId));
      for (let i = 0; i < t.oldSchedules.length; i++)
        expect(s.schedules[i], t.oldSchedules[i].projectId).toEqual(t.oldSchedules[i]);
    });

    it("the cells last sent equal packTimedCell over simulateDetailed's schedules", () => {
      expect(s.last.size).toBeGreaterThan(0);
      expect(s.early).toBeGreaterThan(0);
      expect([...s.last.keys()].sort(cmp)).toEqual([...t.g.anchoredCells()].sort(cmp));
      for (const cell of [...s.last.keys()].sort(cmp))
        expect(s.last.get(cell), cell).toEqual(t.g.pack(cell));
    });

    it("the demolitions sent equal today's revision 0 list", () => {
      const folded: TimelineUpdate['demolish'] = [...s.demolished.keys()]
        .sort(cmp)
        .map((parcelId) => ({ parcelId, day: s.demolished.get(parcelId)! }));
      expect(folded.length).toBeGreaterThan(0);
      expect(folded).toEqual(t.g.demolish());
    });
  });
}

suite('bench', benchInput, benchRecords);
suite('fixture', fixtureInput, fixtureRecords);

const LIVE = process.env.SFH_WORLD_LIVE;
describe.skipIf(!LIVE)('live', () => {
  suite(
    'live',
    () => liveInput(LIVE!),
    () => dirRecords(LIVE!)
  );
});
