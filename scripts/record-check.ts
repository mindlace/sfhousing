// `npx tsx scripts/record-check.ts <datasetDir> [--json] [--targets <file>]` (building-choice
// spec, Acceptance): runs current law (the empty policy document) in the world engine for its first
// 120 model months and holds the simulated starts and completions to the record targets the
// calibration step wrote (`pipeline/.cache/derived/<datasetVersion>/record-targets.json`, Task 5).
// One line per check, `pass`, `miss` or `report`, with the n of both sides. Exits 0 with no
// miss, 1 with any, 2 when the check could not run (one stderr line, `record-check: {reason}`).
//
// It also holds the world runner `scripts/cap-measure.ts` uses: a dataset directory loaded with the
// timeline host's own loader (`loadDataset`), a document compiled as the host compiles it, its
// lots resolved as the host's brush service resolves them, and one world stepped on the host's
// seed with the dataset's world core (funding and cars), optionally fed to a score series.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HEIGHT_BANDS, bandIndex } from '../pipeline/lib/fzp-cal/height-time';
import {
  LARGE_LOT_LIMIT,
  LARGE_LOT_M2,
  LIMIT_BUCKETS,
  NEAR_LIMIT,
  PROJECT_MIN_HOMES,
  RECORD_TARGETS_JSON,
  TYPE_MAX_STORIES,
  quantile,
  recordTargets,
  type RecordTargets,
  type Target
} from '../pipeline/lib/building-records';
import { parseManifest, type Manifest } from '../src/lib/data/manifest';
import type { ParcelId } from '../src/lib/data/parcel';
import type { ScenarioParcels } from '../src/lib/data/scenario-codec';
import { decodeTransit } from '../src/lib/data/transit-codec';
import { generate, generateForUnits, type GeneratedBuilding } from '../src/lib/generator';
import { BUILDING_TYPES, type BuildingType } from '../src/lib/sim/choice/types';
import {
  BrushDataMissing,
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData,
  type LotIndex
} from '../src/lib/sim/levers/brushes';
import { createLru } from '../src/lib/sim/lru';
import { datasetUrl, simInputUrls } from '../src/lib/sim/world/input/load';
import { monthFirstDay, monthLastDay } from '../src/lib/sim/world/months';
import { compileTimeline } from '../src/lib/sim/world/policy/compile';
import {
  createChunkSet,
  loadDataset,
  type Dataset,
  type DatasetDeps
} from '../src/lib/sim/world/runner/dataset';
import { SEED } from '../src/lib/sim/world/runner/ensemble';
import { createWorldSeries, scoreStaticsOf, type MonthRow } from '../src/lib/sim/world/score';
import { WINDOW_MONTHS } from '../src/lib/sim/timeline-client';
import {
  NO_BTYPE,
  NO_DAY,
  ORIGIN_SIM,
  type StepSink,
  type World,
  type WorldEvent
} from '../src/lib/sim/world/types';
import { MONTH_DAYS, type Day } from '../src/lib/timelapse/time';
import {
  STAGE_ORDER,
  type Calibration,
  type ProjectHistoriesFile,
  type ProjectHistory
} from '../src/lib/timelapse/types';
import { DEFAULT_POLICY4, queriesOf4, type SimPolicy4 } from '../src/lib/timeline/policy4';
import { reconcilePolicy4 } from '../src/lib/timeline/reconcile4';

/** The model months the record check runs: the first ten simulated years (spec, Acceptance). */
export const RECORD_MONTHS = 120;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- the world runner ---

export interface WorldRun {
  world: World;
  /** The score series' month rows (as the view's `rows`); empty unless `series` was asked. */
  rows: MonthRow[];
  /** The first day of each row's calendar month (the view's `months`); empty as `rows`. */
  months: Day[];
}

export interface Worlds {
  datasetVersion: string;
  asOf: Day;
  cal: Calibration;
  ds: Dataset;
  /** One world on `doc` (reconciled here) stepped through `months` (default the host's window). */
  run(doc: SimPolicy4, opts?: { months?: number; series?: boolean }): WorldRun;
}

/** `<dir>/<path>` for `/data/<datasetVersion>/<path>`; null for another prefix. */
function pathIn(dir: string, m: Manifest, url: string): string | null {
  const prefix = `/data/${m.datasetVersion}/`;
  return url.startsWith(prefix) ? join(dir, url.slice(prefix.length)) : null;
}

/** File-backed fetches of a dataset directory; a missing file answers 404. */
function dirSources(dir: string, m: Manifest): Pick<DatasetDeps, 'fetch' | 'fetchBytes'> {
  const read = (url: string): Buffer | null => {
    const path = pathIn(dir, m, url);
    if (path === null) return null;
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  };
  return {
    fetch: async (url) => {
      const b = read(url);
      return b === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => JSON.parse(b.toString('utf8')) };
    },
    fetchBytes: async (url) => {
      const b = read(url);
      return b === null
        ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        : {
            ok: true,
            status: 200,
            arrayBuffer: async () =>
              b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
          };
    }
  };
}

/**
 * The brush lots of a document, resolved as the host's brush service resolves them: a query whose
 * optional file (transit, neighborhoods) the dataset lacks resolves to no lot.
 */
function lotResolver(
  dir: string,
  m: Manifest,
  parcels: ScenarioParcels,
  policy: BrushData['policy'],
  warn: (msg: string) => void
): (doc: SimPolicy4) => Record<string, ParcelId[]> {
  let index: LotIndex | null = null;
  let data: BrushData | null = null;
  const file = (u: unknown): unknown => {
    const url = datasetUrl(m, u);
    const path = url === null ? null : pathIn(dir, m, url);
    if (path === null) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  };
  const dataOf = (): BrushData => {
    if (data !== null) return data;
    const transit = file(m.transit);
    const shapes = file(m.neighborhoods);
    data = {
      parcels,
      policy,
      transit: transit === null ? null : decodeTransit(transit),
      neighborhoods: shapes === null ? null : parseNeighborhoods(shapes)
    };
    return data;
  };
  return (doc) => {
    const lots: Record<string, ParcelId[]> = {};
    for (const { key, query } of queriesOf4(doc)) {
      const d = dataOf();
      index ??= createLotIndex(d.parcels);
      try {
        lots[key] = resolveBrushRows(d, index, query).map((r) => d.parcels.id[r]);
      } catch (e) {
        if (!(e instanceof BrushDataMissing)) throw e;
        warn(`brush ${key}: ${e.message}`);
        lots[key] = [];
      }
    }
    return lots;
  };
}

/**
 * Loads a dataset directory with the timeline host's loader. Rejects with `no dataset at <dir>` or
 * `load failed: <code>: <message>`.
 */
export async function openWorlds(
  dir: string,
  opts: { warn?: (msg: string) => void } = {}
): Promise<Worlds> {
  const warn = opts.warn ?? (() => {});
  let manifest: Manifest;
  try {
    manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  } catch {
    throw new Error(`no dataset at ${dir}`);
  }
  const urls = simInputUrls(manifest);
  if (urls === null) throw new Error(`dataset ${manifest.datasetVersion} has no fzp scenario`);
  const deps: DatasetDeps = {
    ...dirSources(dir, manifest),
    later: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => performance.now(),
    warn,
    retryDelaysMs: [],
    maxConcurrent: 4,
    stopped: () => false,
    onChunk: () => {},
    onChunksReport: () => {}
  };
  const ds = await loadDataset(
    manifest,
    urls,
    createChunkSet(manifest, deps),
    deps,
    createLru<string, GeneratedBuilding | null>(1),
    { gen: generate, genForUnits: generateForUnits, logOnce: () => {} }
  );
  if ('code' in ds) throw new Error(`load failed: ${ds.code}: ${ds.message}`);
  const input = ds.loaded.fzp;
  const { asOf, calibration: cal } = input;
  const lotsOf = lotResolver(dir, manifest, input.parcels, ds.loaded.policy, warn);
  return {
    datasetVersion: manifest.datasetVersion,
    asOf,
    cal,
    ds,
    run(doc, o = {}) {
      const months = o.months ?? WINDOW_MONTHS;
      const policy = reconcilePolicy4(doc, cal, asOf).doc;
      const compile = compileTimeline(policy, lotsOf(policy), ds.ctx(months), 'plan');
      compile.step(Infinity);
      const timeline = compile.result();
      const statics = ds.statics;
      const score = o.series
        ? scoreStaticsOf(input, timeline, 'plan', months, ds.loaded.projects.rhnaCompletedNet)
        : null;
      const series = score === null ? null : createWorldSeries(score);
      // The ensemble's plain loop: events of `createWorld` fed once it returns, the rest live.
      const early: WorldEvent[] = [];
      let world: World | null = null;
      const sink: StepSink = {
        event: (e) => {
          if (series === null) return;
          if (world === null) early.push(e);
          else series.add(e, world, statics);
        }
      };
      const w = ds.core.createWorld(statics, timeline, SEED, sink);
      world = w;
      for (const e of early) series?.add(e, w, statics);
      const due = ds.core.planDue(w, statics, timeline, SEED, months);
      for (let m = 1; m <= months; m++) {
        ds.core.step(w, due, statics, timeline, SEED, sink);
        series?.stepped(m);
      }
      if (series === null || score === null) return { world: w, rows: [], months: [] };
      const through = series.finalThrough();
      return {
        world: w,
        rows: series.rows(0, through),
        months: score.months.slice(0, through + 1)
      };
    }
  };
}

// --- simulated starts ---

/** One simulated project, as the record check reads it. Days are `null` when not entered. */
export interface SimProject {
  /** Its first stage's day. */
  start: Day;
  /** Its stories and homes now (after any revision). */
  stories: number;
  units: number;
  /** The envelope stories its options were allowed up to at the start. */
  limit: number;
  type: BuildingType | null;
  lotAreaM2: number;
  affordable: boolean;
  issued: Day | null;
  construction: Day | null;
  complete: Day | null;
}

const S = STAGE_ORDER.length;
const STAGE = (s: (typeof STAGE_ORDER)[number]) => STAGE_ORDER.indexOf(s);

/** Every simulated row of `world` (pipeline rows, masters and phases left out). */
export function simProjectsOf(world: World, parcels: ScenarioParcels): SimProject[] {
  const p = world.projects;
  const out: SimProject[] = [];
  const day = (row: number, s: number): Day | null => {
    const d = p.entered[row * S + s];
    return d === NO_DAY ? null : d;
  };
  for (let row = 0; row < p.n; row++) {
    if (p.origin[row] !== ORIGIN_SIM) continue;
    let start = Infinity;
    for (let s = 0; s < S; s++) {
      const d = day(row, s);
      if (d !== null && d < start) start = d;
    }
    const stories = p.stories[row];
    if (!Number.isFinite(start) || !Number.isFinite(stories)) continue;
    out.push({
      start,
      stories,
      units: p.units[row],
      limit: p.env[row],
      type: p.btype[row] === NO_BTYPE ? null : BUILDING_TYPES[p.btype[row]],
      lotAreaM2: parcels.lotAreaM2[p.src[row]],
      affordable: p.kind[row] === 1,
      issued: day(row, STAGE('permitIssued')),
      construction: day(row, STAGE('construction')),
      complete: day(row, STAGE('complete'))
    });
  }
  return out;
}

// --- simulated statistics ---

export interface SimMedian {
  upTo: number;
  n: number;
  median: number;
}

/** The simulated side of every record check, over one window of days. */
export interface SimStats {
  /** Starts in the window: stories ÷ limit, by limit bucket (`LIMIT_BUCKETS`), uncapped. */
  heightRatio: { upTo: number; n: number; mean: number; nearLimit: number }[];
  /** Permits issued in the window, by height band (`HEIGHT_BANDS`) and type. */
  typeByBand: { upTo: number; n: number; V: number; III: number; I: number }[];
  /** Starts in the window above the code limits (`TYPE_MAX_STORIES`). */
  over: { V: number; III: number };
  /** Permits issued in the window at 8 to 12 stories, and how many are Type I. */
  typeI8to12: { n: number; k: number };
  /**
   * Median months of spells entered in the window and completed by its end, by height band:
   * `permitIssued` (issued to construction), `construction` (construction to completion), and
   * `issuedToComplete`, the two summed per project (ruling F8).
   */
  stageMonths: {
    permitIssued: SimMedian[];
    construction: SimMedian[];
    issuedToComplete: SimMedian[];
  };
  /** Median homes of permits issued in the window for `PROJECT_MIN_HOMES` or more, by band. */
  homesPerProject: SimMedian[];
  /** Permits issued in the window on lots of `LARGE_LOT_M2` or more with a limit of 13 or more. */
  largeLotTypeI: { n: number; k: number };
  /** Starts in the window: stories ÷ limit by cohort. */
  cohort: { affordable: { n: number; mean: number }; private: { n: number; mean: number } };
}

const medians = (): SimMedian[] => HEIGHT_BANDS.map((upTo) => ({ upTo, n: 0, median: 0 }));

/** Statistics of no project. */
export function emptySimStats(): SimStats {
  return {
    heightRatio: LIMIT_BUCKETS.map((upTo) => ({ upTo, n: 0, mean: 0, nearLimit: 0 })),
    typeByBand: HEIGHT_BANDS.map((upTo) => ({ upTo, n: 0, V: 0, III: 0, I: 0 })),
    over: { V: 0, III: 0 },
    typeI8to12: { n: 0, k: 0 },
    stageMonths: { permitIssued: medians(), construction: medians(), issuedToComplete: medians() },
    homesPerProject: medians(),
    largeLotTypeI: { n: 0, k: 0 },
    cohort: { affordable: { n: 0, mean: 0 }, private: { n: 0, mean: 0 } }
  };
}

const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, x) => a + x, 0) / xs.length;

/** Fills `out` (by band) with the median and n of each band's values. */
function fillMedians(out: SimMedian[], byBand: number[][]): void {
  byBand.forEach((xs, i) => {
    out[i].n = xs.length;
    out[i].median =
      xs.length === 0
        ? 0
        : quantile(
            [...xs].sort((a, b) => a - b),
            0.5
          );
  });
}

/**
 * The simulated statistics over `[from, to]`, computed as the record targets are
 * (`recordTargets`, pipeline/lib/building-records.ts): built height ÷ limit uncapped (Task 5),
 * each stage on its own interval, permits counted by the day they were issued.
 */
export function simStats(projects: readonly SimProject[], [from, to]: [Day, Day]): SimStats {
  const s = emptySimStats();
  const inWindow = (d: Day | null): d is Day => d !== null && d >= from && d <= to;
  const ratios = LIMIT_BUCKETS.map((): number[] => []);
  const cohorts = { affordable: [] as number[], private: [] as number[] };
  const months = {
    permitIssued: HEIGHT_BANDS.map((): number[] => []),
    construction: HEIGHT_BANDS.map((): number[] => []),
    issuedToComplete: HEIGHT_BANDS.map((): number[] => [])
  };
  const homes = HEIGHT_BANDS.map((): number[] => []);
  for (const p of projects) {
    const band = bandIndex(HEIGHT_BANDS, p.stories);
    if (inWindow(p.start)) {
      if (p.type === 'V' && p.stories > TYPE_MAX_STORIES.V) s.over.V++;
      if (p.type === 'III' && p.stories > TYPE_MAX_STORIES.III) s.over.III++;
      if (p.limit >= 1) {
        const r = p.stories / p.limit;
        ratios[bandIndex(LIMIT_BUCKETS, p.limit)].push(r);
        cohorts[p.affordable ? 'affordable' : 'private'].push(r);
      }
    }
    if (inWindow(p.issued)) {
      if (p.type !== null) {
        const b = s.typeByBand[band];
        b.n++;
        b[p.type]++;
        if (p.stories >= 8 && p.stories <= 12) {
          s.typeI8to12.n++;
          if (p.type === 'I') s.typeI8to12.k++;
        }
        if (p.lotAreaM2 >= LARGE_LOT_M2 && p.limit >= LARGE_LOT_LIMIT) {
          s.largeLotTypeI.n++;
          if (p.type === 'I' && p.stories >= LARGE_LOT_LIMIT) s.largeLotTypeI.k++;
        }
      }
      if (p.units >= PROJECT_MIN_HOMES) homes[band].push(p.units);
      if (p.construction !== null && p.construction <= to) {
        months.permitIssued[band].push((p.construction - p.issued) / MONTH_DAYS);
      }
      if (p.complete !== null && p.complete <= to) {
        months.issuedToComplete[band].push((p.complete - p.issued) / MONTH_DAYS);
      }
    }
    if (inWindow(p.construction) && p.complete !== null && p.complete <= to) {
      months.construction[band].push((p.complete - p.construction) / MONTH_DAYS);
    }
  }
  ratios.forEach((rs, i) => {
    s.heightRatio[i].n = rs.length;
    s.heightRatio[i].mean = mean(rs);
    s.heightRatio[i].nearLimit =
      rs.length === 0 ? 0 : rs.filter((r) => r >= NEAR_LIMIT).length / rs.length;
  });
  fillMedians(s.stageMonths.permitIssued, months.permitIssued);
  fillMedians(s.stageMonths.construction, months.construction);
  fillMedians(s.stageMonths.issuedToComplete, months.issuedToComplete);
  fillMedians(s.homesPerProject, homes);
  s.cohort = {
    affordable: { n: cohorts.affordable.length, mean: mean(cohorts.affordable) },
    private: { n: cohorts.private.length, mean: mean(cohorts.private) }
  };
  return s;
}

// --- the checks ---

export interface CheckLine {
  check: string;
  status: 'pass' | 'miss' | 'report';
  /** The simulated statistic; null when the simulation has no project for it. */
  sim: number | null;
  simN: number;
  /** The record statistic and its tolerance; null where the records give none. */
  target: number | null;
  tol: number | null;
  /** The records' n; null where it is not known. */
  n: number | null;
}

/**
 * Median months from permit issued to completion by height band, DBI raw pull (spec, Acceptance:
 * "issued to completion: 28.4, 36.8, 36.5, 33.7, 40.1 months"), on `HEIGHT_BANDS`. Reported
 * beside the two model stages summed per project; not a check (ruling F8 checks each stage).
 */
export const RAW_PULL_ISSUED_TO_COMPLETE = [28.4, 36.8, 36.5, 33.7, 40.1] as const;

const EPS = 1e-9;

/** A checked target: pass within its tolerance; miss without a simulated project. */
function judged(check: string, sim: number, simN: number, t: Target): CheckLine {
  const status = !t.checked
    ? 'report'
    : simN === 0
      ? 'miss'
      : Math.abs(sim - t.stat) <= t.tol + EPS
        ? 'pass'
        : 'miss';
  return { check, status, sim: simN === 0 ? null : sim, simN, target: t.stat, tol: t.tol, n: t.n };
}

const report = (
  check: string,
  sim: number | null,
  simN: number,
  target: number | null,
  n: number | null
): CheckLine => ({ check, status: 'report', sim, simN, target, tol: null, n });

const bandName = (upTo: number, prev: number | undefined): string =>
  upTo === 999 ? `above ${prev}` : `≤ ${upTo}`;

/**
 * Built height ÷ limit targets over the records built at or under their limit (owner ruling
 * 2026-11-27): no option exceeds the limit, and the density bonus that lets a project do so is a
 * later spec. The same `recordTargets` the calibration step runs, on those histories only.
 */
export function inLimitHeightRatio(
  histories: readonly ProjectHistory[],
  asOf: Day
): RecordTargets['heightRatio'] {
  const within = histories.filter(
    (h) =>
      h.storiesProposed === null ||
      h.baseStoriesAtFiling === null ||
      h.storiesProposed <= h.baseStoriesAtFiling
  );
  const none = { index: new Map(), lotAreaM2: new Uint32Array(0), baseStories: new Uint8Array(0) };
  return recordTargets(within, [], none, asOf).heightRatio;
}

/**
 * Every check of the spec's Acceptance table, simulated against the records. The height ÷ limit
 * checks take `inLimit` (the records at or under their limit, `inLimitHeightRatio`; by default
 * `targets.heightRatio`, every record), and each bucket reports the share of all its records
 * built over their limit.
 */
export function checkLines(
  targets: RecordTargets,
  sim: SimStats,
  inLimit: RecordTargets['heightRatio'] = targets.heightRatio
): CheckLine[] {
  const lines: CheckLine[] = [];
  inLimit.forEach((t, i) => {
    const s = sim.heightRatio.find((b) => b.upTo === t.upTo);
    const name = `height ÷ limit ${bandName(t.upTo, inLimit[i - 1]?.upTo)}`;
    lines.push(judged(`${name}: mean`, s?.mean ?? 0, s?.n ?? 0, t.mean));
    lines.push(judged(`${name}: share ≥ ${NEAR_LIMIT}`, s?.nearLimit ?? 0, s?.n ?? 0, t.nearLimit));
    const all = targets.heightRatio.find((b) => b.upTo === t.upTo);
    if (all !== undefined) {
      const n = all.mean.n;
      lines.push(
        report(`${name}: records over their limit`, null, 0, n ? all.overLimit / n : null, n)
      );
    }
  });

  const ct = targets.constructionType;
  const starts = sim.heightRatio.reduce((a, b) => a + b.n, 0);
  for (const type of ['V', 'III'] as const) {
    const over = sim.over[type];
    lines.push({
      check: `Type ${type} above ${ct.maxStories[type]} stories`,
      status: over === 0 ? 'pass' : 'miss',
      sim: over,
      simN: starts,
      target: 0,
      tol: 0,
      n: null
    });
  }
  const i8 = sim.typeI8to12;
  lines.push(
    judged('Type I share 8 to 12 stories', i8.n === 0 ? 0 : i8.k / i8.n, i8.n, ct.typeIShare8to12)
  );
  ct.byBand.forEach((t, i) => {
    const s = sim.typeByBand.find((b) => b.upTo === t.upTo);
    const name = `${bandName(t.upTo, ct.byBand[i - 1]?.upTo)} stories`;
    for (const type of ['V', 'III', 'I'] as const) {
      const simN = s?.n ?? 0;
      lines.push(
        report(
          `Type ${type} share ${name}`,
          simN === 0 ? null : s![type] / simN,
          simN,
          t.n === 0 ? null : t[type] / t.n,
          t.n
        )
      );
    }
  });

  const stages = [
    ['permitIssued', 'permit issued to construction'],
    ['construction', 'construction to completion']
  ] as const;
  for (const [key, label] of stages) {
    targets.stageMonths[key].forEach((t, i) => {
      const s = sim.stageMonths[key].find((b) => b.upTo === t.upTo);
      const name = `${label} ${bandName(t.upTo, targets.stageMonths[key][i - 1]?.upTo)} stories (months)`;
      lines.push(judged(name, s?.median ?? 0, s?.n ?? 0, t));
    });
  }
  sim.stageMonths.issuedToComplete.forEach((s, i) => {
    const name = `issued to completion ${bandName(s.upTo, HEIGHT_BANDS[i - 1])} stories (months)`;
    lines.push(
      report(name, s.n === 0 ? null : s.median, s.n, RAW_PULL_ISSUED_TO_COMPLETE[i], null)
    );
  });

  targets.homesPerProject.forEach((t, i) => {
    const s = sim.homesPerProject.find((b) => b.upTo === t.upTo);
    const name = `homes per project ${bandName(t.upTo, targets.homesPerProject[i - 1]?.upTo)} stories`;
    lines.push(judged(name, s?.median ?? 0, s?.n ?? 0, t));
  });

  const ll = sim.largeLotTypeI;
  lines.push(
    judged(
      'large lots, Type I at 13 or more stories',
      ll.n === 0 ? 0 : ll.k / ll.n,
      ll.n,
      targets.largeLotTypeI
    )
  );

  const c = targets.cohort;
  const sc = sim.cohort;
  lines.push(
    report(
      'height ÷ limit, affordable',
      sc.affordable.n === 0 ? null : sc.affordable.mean,
      sc.affordable.n,
      c.affordable.mean,
      c.affordable.n
    )
  );
  lines.push(
    report(
      'height ÷ limit, private',
      sc.private.n === 0 ? null : sc.private.mean,
      sc.private.n,
      c.private.mean,
      c.private.n
    )
  );
  const both = sc.affordable.n > 0 && sc.private.n > 0;
  lines.push(
    report(
      'height ÷ limit, affordable − private',
      both ? sc.affordable.mean - sc.private.mean : null,
      Math.min(sc.affordable.n, sc.private.n),
      c.diff,
      null
    )
  );
  return lines;
}

/** 1 when any check misses, else 0. */
export function recordExit(lines: readonly CheckLine[]): 0 | 1 {
  return lines.some((l) => l.status === 'miss') ? 1 : 0;
}

const num = (x: number): string =>
  Number.isInteger(x) ? x.toLocaleString('en-US') : x.toFixed(Math.abs(x) < 10 ? 3 : 1);

/** One printed line: status, check, the simulated figure and the records'. */
export function formatLine(l: CheckLine): string {
  const sim = l.sim === null ? 'none' : num(l.sim);
  const target = l.target === null ? '—' : num(l.target);
  const tol = l.tol === null ? '' : ` ± ${num(l.tol)}`;
  const n = l.n === null ? '' : ` (n ${num(l.n)})`;
  return `${l.status.padEnd(6)} ${l.check}: sim ${sim} (n ${num(l.simN)}), records ${target}${tol}${n}`;
}

// --- the command ---

const USAGE =
  'usage: npx tsx scripts/record-check.ts <datasetDir> [--json] [--targets <file>] ' +
  '[--histories <file>]';

export interface RecordIo {
  out(line: string): void;
  err(line: string): void;
}

const CONSOLE_IO: RecordIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line)
};

/** The command's arguments, or the reason they are refused. */
function parseArgs(
  argv: string[]
):
  | { dir: string; json: boolean; targets: string | null; histories: string | null }
  | { error: string } {
  let dir: string | null = null;
  let json = false;
  let targets: string | null = null;
  let histories: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--targets') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: '--targets needs a file' };
      targets = v;
    } else if (a === '--histories') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: '--histories needs a file' };
      histories = v;
    } else if (a.startsWith('--')) return { error: `unknown flag ${a}` };
    else if (dir === null) dir = a;
    else return { error: USAGE };
  }
  return dir === null ? { error: USAGE } : { dir, json, targets, histories };
}

/** `project-histories.json` as the projects step wrote it. */
function readHistories(path: string): ProjectHistoriesFile {
  let f: ProjectHistoriesFile;
  try {
    f = JSON.parse(readFileSync(path, 'utf8')) as ProjectHistoriesFile;
  } catch {
    throw new Error(`no project histories at ${path}`);
  }
  if (f.schema !== 1 || !Array.isArray(f.histories))
    throw new Error(`project histories at ${path} are not schema 1`);
  return f;
}

/** `record-targets.json` as the calibration step wrote it. */
function readTargets(path: string): RecordTargets {
  let t: RecordTargets;
  try {
    t = JSON.parse(readFileSync(path, 'utf8')) as RecordTargets;
  } catch {
    throw new Error(`no record targets at ${path}`);
  }
  if (t.schema !== 1)
    throw new Error(`record targets at ${path} have schema ${String(t.schema)}, not 1`);
  return t;
}

export async function main(argv: string[], io: RecordIo = CONSOLE_IO): Promise<0 | 1 | 2> {
  const args = parseArgs(argv);
  if ('error' in args) {
    io.err(`record-check: ${args.error}`);
    return 2;
  }
  try {
    let version: string;
    try {
      version = parseManifest(
        JSON.parse(readFileSync(join(args.dir, 'manifest.json'), 'utf8'))
      ).datasetVersion;
    } catch {
      throw new Error(`no dataset at ${args.dir}`);
    }
    const targetsPath =
      args.targets ?? join(ROOT, 'pipeline/.cache/derived', version, RECORD_TARGETS_JSON);
    const targets = readTargets(targetsPath);
    const historiesPath =
      args.histories ?? join(ROOT, 'pipeline/.cache/derived', version, 'project-histories.json');
    const hf = readHistories(historiesPath);
    const inLimit = inLimitHeightRatio(hf.histories, hf.asOf);
    const warnings: string[] = [];
    const worlds = await openWorlds(args.dir, { warn: (m) => warnings.push(m) });
    const { world } = worlds.run(DEFAULT_POLICY4, { months: RECORD_MONTHS });
    const window: [Day, Day] = [
      monthFirstDay(worlds.asOf, 1),
      monthLastDay(worlds.asOf, RECORD_MONTHS)
    ];
    const sim = simStats(simProjectsOf(world, worlds.ds.loaded.fzp.parcels), window);
    const lines = checkLines(targets, sim, inLimit);
    for (const w of warnings) io.err(w);
    if (args.json) {
      io.out(
        JSON.stringify(
          {
            datasetVersion: version,
            months: RECORD_MONTHS,
            window,
            targets: targetsPath,
            histories: historiesPath,
            sim,
            lines
          },
          null,
          2
        )
      );
    } else {
      const count = (s: CheckLine['status']) => lines.filter((l) => l.status === s).length;
      io.out(`Dataset ${version}; records ${targets.window[0]} to ${targets.window[1]}`);
      io.out(`Current law, model months 1 to ${RECORD_MONTHS}`);
      for (const l of lines) io.out(formatLine(l));
      io.out(`${count('pass')} pass, ${count('miss')} miss, ${count('report')} report`);
    }
    return recordExit(lines);
  } catch (e) {
    io.err(`record-check: ${messageOf(e)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`record-check: ${messageOf(e)}`);
      process.exitCode = 2;
    }
  );
}
