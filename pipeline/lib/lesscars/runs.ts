// /lesscars paired runs (spec "How it gets made": many paired futures): the plan and the baseline
// on the same seeds, each future's extra homes split by source (spec "Goals" 2), the summary and
// the representative future's timeline.
//
// Rules: a Schedule adds its net (addNet's rule: −existing at a construction start after asOf,
// +final units at completion) to the source of its first parcel's row (smallest id); a parcel
// parcels.bin lacks counts as `other`. An initiative build adds `units − existing` on its
// `completeDay` to `freed` (no row) or `parking` (a row), and a build with a row counts in a seed
// only when that row's reservation was kept there. Each per-source series is cumulative at each
// year end; a day after the last year end counts nowhere.
//
// Builder's calls:
// - Seeds: `LIVE_PROFILE.lesscarsSeeds` = 101 (odd, as BAND_RUNS, so the representative is one
//   run); the fixture profile runs 5. "Homes by 2068" is cumulative net completions since asOf,
//   the engine's own measure (completedNet).
// - A reservation day is the conversion project's clearance start (`startDay`), not its build
//   start: a parking site is an ordinary lot only until its conversion starts (spec "The
//   initiative builds"). An `edge-garage` on `{ parcel }` reserves from the garage's start; a
//   garage on `{ project }` sits on freed land and reserves nothing. A plan parcel absent from
//   parcels.bin, or two reservations on one row, throws.
// - A build whose units do not exceed its existing homes is dropped (a public developer does not
//   build to lose or keep homes; a freed sliver whose envelope holds none is the usual case). Its
//   parking reservation still stands: the plan named the lot, and the cost shows as `parking`.
// - A build's existing homes are the parcel's parcels.bin existingUnits, even in a future where an
//   exited project demolished them before the reservation day (rare; the engine reports no
//   demolition to the sink).
// - The summary's provenance is tier 3 (a model result on the plan's tiered inputs), n = seeds.
import { idsHash } from '../../../src/lib/data/column-file';
import {
  FREED,
  LESSCARS_FORMAT,
  OTHER,
  PARKING,
  SOURCES,
  TRANSIT_UNLOCKED,
  type InitiativeBuild,
  type LessCarsSummary,
  type LessCarsTimeline,
  type Source
} from '../../../src/lib/data/lesscars/codec';
import type { LessCarsPlan } from '../../../src/lib/data/lesscars/plan';
import { yearStart, type PlanSchedule } from '../../../src/lib/data/lesscars/schedule';
import type { ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import { REPO_URL } from '../../../src/lib/config';
import { bandSeed, nearestRank, representativeIndex } from '../../../src/lib/sim/scenario/band';
import { runEngine } from '../../../src/lib/sim/scenario/engine';
import { addNet, type NetAcc } from '../../../src/lib/sim/scenario/score';
import type { Schedule, SimInput } from '../../../src/lib/sim/scenario/types';
import type { Day } from '../../../src/lib/timelapse/time';
import type { FreedSite } from './sites';
import type { RegimeSet } from './regimes';

const K = SOURCES.length;

/** 31 December of each year `from` … `to` (2028 … 2068: 41 year ends). */
export function lesscarsYearEnds(from = 2028, to = 2068): Day[] {
  const out: Day[] = [];
  for (let y = from; y <= to; y++) out.push(yearStart(y + 1) - 1);
  return out;
}

/**
 * Per T11 row, the day the parcel is reserved from: a parking conversion's start, or the start of
 * an edge garage on a parcel; 0 elsewhere. Throws on a parcel parcels.bin lacks or a row reserved
 * twice.
 */
export function reservationsOf(
  plan: LessCarsPlan,
  s: PlanSchedule,
  parcels: Pick<ScenarioParcels, 'count' | 'index'>
): Int32Array {
  const out = new Int32Array(parcels.count);
  for (const p of plan.projects) {
    let id: string | null = null;
    if (p.kind === 'parking-conversion') id = p.parcel;
    else if (p.kind === 'edge-garage' && 'parcel' in p.site) id = p.site.parcel;
    if (id === null) continue;
    const row = parcels.index.get(id);
    if (row === undefined)
      throw new Error(`lesscars: ${p.id} names parcel ${id}, not in parcels.bin`);
    const t = s.times.get(p.id);
    if (!t) throw new Error(`lesscars: project ${p.id} is not scheduled`);
    if (out[row] !== 0) throw new Error(`lesscars: parcel ${id} is reserved twice (${p.id})`);
    out[row] = t.startDay;
  }
  return out;
}

/**
 * Each row's source (an index into SOURCES): a reserved row is `parking` in both arms, kept or
 * not; then `transitUnlocked`; else `other`. No row is `freed`.
 */
export function sourceOfRows(
  count: number,
  reservedFrom: Int32Array,
  unlocked: Uint8Array
): Uint8Array {
  if (reservedFrom.length !== count || unlocked.length !== count)
    throw new RangeError('lesscars: sourceOfRows columns differ in length');
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++)
    out[i] = reservedFrom[i] !== 0 ? PARKING : unlocked[i] === 1 ? TRANSIT_UNLOCKED : OTHER;
  return out;
}

/**
 * The plan's housing builds: each freed site of a removal or truncation with a build, then each
 * parking conversion, in plan order (sites by siteId). `units` is the top fill yield of the row
 * in force at the build's start, `stories` that row's stories. Builds adding no homes are dropped.
 */
export function initiativeBuilds(
  plan: LessCarsPlan,
  s: PlanSchedule,
  sites: readonly Pick<FreedSite, 'siteId' | 'projectId'>[],
  parcels: Pick<ScenarioParcels, 'index' | 'existingUnits'>,
  rows: Pick<RegimeSet, 'siteRowAt' | 'parcelRowAt'>
): InitiativeBuild[] {
  const out: InitiativeBuild[] = [];
  const push = (b: InitiativeBuild) => {
    if (b.units > b.existing) out.push(b);
  };
  for (const p of plan.projects) {
    const t = s.times.get(p.id);
    if (!t) throw new Error(`lesscars: project ${p.id} is not scheduled`);
    const build = t.build;
    if (build === null) continue;
    if (p.kind === 'highway-truncation' || p.kind === 'street-removal') {
      const mine = sites
        .filter((x) => x.projectId === p.id)
        .sort((a, b) => (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0));
      for (const site of mine) {
        const r = rows.siteRowAt(site.siteId, build.startDay);
        push({
          siteId: site.siteId,
          projectId: p.id,
          parcelRow: null,
          units: r.yield[r.yield.length - 1],
          stories: r.stories,
          existing: 0,
          startDay: build.startDay,
          completeDay: build.completeDay
        });
      }
    } else if (p.kind === 'parking-conversion') {
      const row = parcels.index.get(p.parcel);
      if (row === undefined)
        throw new Error(`lesscars: ${p.id} names parcel ${p.parcel}, not in parcels.bin`);
      const r = rows.parcelRowAt(row, build.startDay);
      push({
        siteId: p.parcel,
        projectId: p.id,
        parcelRow: row,
        units: r.yield[r.yield.length - 1],
        stories: r.stories,
        existing: parcels.existingUnits[row],
        startDay: build.startDay,
        completeDay: build.completeDay
      });
    }
  }
  return out;
}

type Regimes = Pick<RegimeSet, 'baseline' | 'plan'>;

/** Year-end bucket of a day: the first year end on or after it, Y past the last. */
function indexerOf(yearEnds: readonly Day[]): (d: Day) => number {
  const Y = yearEnds.length;
  return (d) => {
    let lo = 0;
    let hi = Y;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (yearEnds[mid] >= d) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
}

/** One arm's per-source deltas ([source][bucket], Y + 1 buckets), and the reservations seen. */
class ArmSink {
  readonly deltas: Int32Array[];
  readonly kept = new Map<number, boolean>();
  private readonly accs: NetAcc[];
  constructor(
    private readonly parcels: ScenarioParcels,
    private readonly source: Uint8Array,
    private readonly asOf: Day,
    readonly idx: (d: Day) => number,
    Y: number
  ) {
    this.deltas = Array.from({ length: K }, () => new Int32Array(Y + 1));
    const entitled = new Int32Array(Y + 1);
    this.accs = this.deltas.map((d) => ({ idx, pipeline: d, fresh: d, entitled }));
  }
  sourceOf(s: Schedule): number {
    const ids = s.parcelIds;
    if (ids.length === 0) return OTHER;
    let first = ids[0];
    for (let j = 1; j < ids.length; j++) if (ids[j] < first) first = ids[j];
    const row = this.parcels.index.get(first);
    return row === undefined ? OTHER : this.source[row];
  }
  schedule(s: Schedule): void {
    addNet(this.accs[this.sourceOf(s)], s, this.asOf);
  }
  master(): void {}
  reservation(row: number, kept: boolean): void {
    this.kept.set(row, kept);
  }
  /** The builds this run keeps: freed ones always, a parcel's only when its row was kept. */
  keptBuilds(builds: readonly InitiativeBuild[]): InitiativeBuild[] {
    return builds.filter((b) => {
      if (b.parcelRow === null) return true;
      const k = this.kept.get(b.parcelRow);
      if (k === undefined)
        throw new Error(`lesscars: build ${b.siteId} row ${b.parcelRow} has no reservation`);
      return k;
    });
  }
  addBuilds(builds: readonly InitiativeBuild[]): void {
    for (const b of builds)
      this.deltas[b.parcelRow === null ? FREED : PARKING][this.idx(b.completeDay)] +=
        b.units - b.existing;
  }
  /** Cumulative per-source series at each year end. */
  cumulative(Y: number): Int32Array[] {
    return this.deltas.map((d) => {
      const out = new Int32Array(Y);
      let acc = 0;
      for (let y = 0; y < Y; y++) out[y] = acc += d[y];
      return out;
    });
  }
}

function check(base: SimInput, reservedFrom: Int32Array, builds: readonly InitiativeBuild[]): void {
  const n = base.parcels.count;
  if (reservedFrom.length !== n) throw new RangeError('lesscars: reservedFrom length differs');
  for (const b of builds)
    if (b.parcelRow !== null && !(reservedFrom[b.parcelRow] > 0))
      throw new Error(
        `lesscars: build ${b.siteId} is on row ${b.parcelRow}, which is not reserved`
      );
}

function checkYearEnds(yearEnds: readonly Day[], horizon: Day): void {
  if (yearEnds.length === 0) throw new RangeError('lesscars: no year ends');
  for (let y = 1; y < yearEnds.length; y++)
    if (!(yearEnds[y] > yearEnds[y - 1])) throw new RangeError('lesscars: year ends not ascending');
  if (yearEnds[yearEnds.length - 1] > horizon)
    throw new RangeError('lesscars: the last year end is after the horizon');
}

const planInput = (base: SimInput, regimes: Regimes, reservedFrom: Int32Array): SimInput => ({
  ...base,
  regimes: regimes.plan,
  reservedFrom
});
const baselineInput = (base: SimInput, regimes: Regimes): SimInput => ({
  ...base,
  regimes: regimes.baseline
});

/**
 * The plan arm (`regimes.plan` with `reservedFrom`, plus the builds kept in each seed) and the
 * baseline arm (`regimes.baseline`) on seeds `bandSeed(i)`, `i < seeds`: per seed, cumulative
 * net homes per source ([source][year end]).
 */
export function runPairs(a: {
  base: SimInput;
  regimes: Regimes;
  reservedFrom: Int32Array;
  builds: InitiativeBuild[];
  source: Uint8Array;
  seeds: number;
  yearEnds: Day[];
  horizon: Day;
}): { perSeed: { seed: number; plan: Int32Array[]; baseline: Int32Array[] }[] } {
  const { base, yearEnds, horizon } = a;
  check(base, a.reservedFrom, a.builds);
  checkYearEnds(yearEnds, horizon);
  if (a.source.length !== base.parcels.count)
    throw new RangeError('lesscars: source length differs');
  if (!(Number.isInteger(a.seeds) && a.seeds >= 1)) throw new RangeError('lesscars: seeds');
  const Y = yearEnds.length;
  const idx = indexerOf(yearEnds);
  const pIn = planInput(base, a.regimes, a.reservedFrom);
  const bIn = baselineInput(base, a.regimes);
  const perSeed: { seed: number; plan: Int32Array[]; baseline: Int32Array[] }[] = [];
  for (let i = 0; i < a.seeds; i++) {
    const seed = bandSeed(i);
    const p = new ArmSink(base.parcels, a.source, base.asOf, idx, Y);
    runEngine(pIn, seed, horizon, p);
    p.addBuilds(p.keptBuilds(a.builds));
    const b = new ArmSink(base.parcels, a.source, base.asOf, idx, Y);
    runEngine(bIn, seed, horizon, b);
    perSeed.push({ seed, plan: p.cumulative(Y), baseline: b.cumulative(Y) });
  }
  return { perSeed };
}

const SUMMARY_PROVENANCE = (seeds: number): LessCarsSummary['provenance'] => ({
  tier: 3,
  label: 'Simulated: paired plan and baseline futures',
  sources: [
    {
      label: '/lesscars design spec',
      url: `${REPO_URL}/blob/main/docs/superpowers/specs/2026-11-01-lesscars-design.md`
    }
  ],
  method:
    `The FZP engine run ${seeds} times with the plan and ${seeds} times without it, on the same ` +
    'seeds; per year end, the mean and nearest-rank p10/p50/p90 of plan minus baseline ' +
    'cumulative net homes since the engine’s asOf, split by where the homes stand.',
  n: seeds
});

/**
 * The summary of paired runs: means by source as integer sums ÷ seeds (so the parts add to
 * extra.mean up to float rounding), nearest-rank bands over per-seed differences, and the
 * representative seed, the pair whose final difference is the median.
 */
export function summarise(
  r: ReturnType<typeof runPairs>,
  meta: Pick<LessCarsSummary, 'datasetVersion' | 'planId' | 'switchDay' | 'regimeDays' | 'yearEnds'>
): LessCarsSummary {
  const seeds = r.perSeed.length;
  if (seeds === 0) throw new RangeError('lesscars: no seeds to summarise');
  const Y = meta.yearEnds.length;
  const sums = Array.from({ length: K }, () => new Array<number>(Y).fill(0));
  const planSum = new Array<number>(Y).fill(0);
  const baseSum = new Array<number>(Y).fill(0);
  const diffs = Array.from({ length: Y }, () => new Int32Array(seeds));
  for (const [i, s] of r.perSeed.entries()) {
    if (s.plan.length !== K || s.baseline.length !== K)
      throw new RangeError(`lesscars: seed ${s.seed} has ${s.plan.length} sources, not ${K}`);
    for (let y = 0; y < Y; y++) {
      let d = 0;
      for (let k = 0; k < K; k++) {
        const dk = s.plan[k][y] - s.baseline[k][y];
        sums[k][y] += dk;
        d += dk;
        planSum[y] += s.plan[k][y];
        baseSum[y] += s.baseline[k][y];
      }
      diffs[y][i] = d;
    }
  }
  const total = new Array<number>(Y).fill(0);
  for (let y = 0; y < Y; y++) for (let k = 0; k < K; k++) total[y] += sums[k][y];
  const finals = Array.from(diffs[Y - 1]);
  const band = (q: number) => diffs.map((d) => nearestRank(d.slice().sort(), q));
  return {
    format: LESSCARS_FORMAT,
    datasetVersion: meta.datasetVersion,
    planId: meta.planId,
    seeds,
    representativeSeed: r.perSeed[representativeIndex(finals)].seed,
    switchDay: meta.switchDay,
    regimeDays: [...meta.regimeDays],
    yearEnds: [...meta.yearEnds],
    extra: {
      mean: total.map((v) => v / seeds),
      p10: band(0.1),
      p50: band(0.5),
      p90: band(0.9)
    },
    bySource: Object.fromEntries(
      SOURCES.map((k, j) => [k, sums[j].map((v) => v / seeds)])
    ) as Record<Source, number[]>,
    plan: planSum.map((v) => v / seeds),
    baseline: baseSum.map((v) => v / seeds),
    provenance: SUMMARY_PROVENANCE(seeds)
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The plan arm of `seed` (the representative seed): every Schedule in simulateDetailed's order
 * (pipeline then simulated, each by projectId), the builds kept in that seed, and every reserved
 * row's verdict there (kept, or voided by the market), ascending by row.
 */
export function representativeTimeline(a: {
  base: SimInput;
  regimes: Regimes;
  reservedFrom: Int32Array;
  builds: InitiativeBuild[];
  seed: number;
  horizon: Day;
  datasetVersion: string;
}): LessCarsTimeline {
  const { base } = a;
  check(base, a.reservedFrom, a.builds);
  const pipeline: Schedule[] = [];
  const simulated: Schedule[] = [];
  const kept = new Map<number, boolean>();
  runEngine(planInput(base, a.regimes, a.reservedFrom), a.seed, a.horizon, {
    schedule(s) {
      (s.origin === 'pipeline' ? pipeline : simulated).push(s);
    },
    master() {},
    reservation(row, k) {
      kept.set(row, k);
    }
  });
  pipeline.sort((x, y) => cmp(x.projectId, y.projectId));
  simulated.sort((x, y) => cmp(x.projectId, y.projectId));
  const builds = a.builds.filter((b) => b.parcelRow === null || kept.get(b.parcelRow) === true);
  const reservations = [...kept]
    .map(([row, k]) => ({ row, kept: k }))
    .sort((x, y) => x.row - y.row);
  return {
    format: LESSCARS_FORMAT,
    datasetVersion: a.datasetVersion,
    count: base.parcels.count,
    idsHash: idsHash(base.parcels.id),
    seed: a.seed,
    schedules: [...pipeline, ...simulated],
    builds,
    reservations
  };
}
