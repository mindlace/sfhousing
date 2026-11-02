// The /lesscars output files the pipeline writes and the page reads: the paired-run summary (the
// headline answer and its split by source), the representative future's timeline, the freed
// sites and the scheduled plan. Pure; relative imports only, like the rest of src/lib/data.
//
// Builder's calls:
// - Every file is JSON tagged `format: 'sfh-lesscars/1'`. The timeline is columnar (one array per
//   field, parcel ids as T11 rows) and bound to parcels.bin by `count` and `idsHash`, as policy.bin
//   binds itself; decoding against another parcels.bin throws. A pipeline project can name a
//   parcel parcels.bin lacks (projects.json keeps it); that id stays a string in the column.
// - parseSummary checks the attribution rule on the integers behind the means: each mean × seeds
//   must be an integer (within 1e-4), the four source sums must add to the extra sum, and the plan
//   sum minus the baseline sum must equal it too.
// - Schedule fields absent on a run (`regime`, `inFlight`) stay absent after a round trip.
import { idsHash } from '../column-file';
import type { ParcelId, ParcelRecord } from '../parcel';
import type { Day } from '../../timelapse/time';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  type ExitReason,
  type Pathway,
  type Provenance,
  type Stage
} from '../../timelapse/types';
import type { Schedule } from '../../sim/scenario/types';
import { parseLessCarsPlan, parseProvenance, type LessCarsPlan } from './plan';
import type { ProjectTimes } from './schedule';

export const LESSCARS_FORMAT = 'sfh-lesscars/1';
/** Where the extra homes come from (spec "Goals" 2), in display order. */
export const SOURCES = ['freed', 'parking', 'transitUnlocked', 'other'] as const;
export type Source = (typeof SOURCES)[number];
export const FREED = 0;
export const PARKING = 1;
export const TRANSIT_UNLOCKED = 2;
export const OTHER = 3;

/** One scheduled initiative build (spec "The initiative builds"). */
export interface InitiativeBuild {
  /** A freed site's id, or the converted parcel's id. */
  siteId: string;
  projectId: string;
  /**
   * The T11 row of a parking site, null for freed land. A build with a row happens only in the
   * seeds where its reservation was kept.
   */
  parcelRow: number | null;
  units: number;
  stories: number;
  existing: number;
  startDay: Day;
  completeDay: Day;
}

export interface LessCarsSummary {
  format: typeof LESSCARS_FORMAT;
  datasetVersion: string;
  planId: string;
  seeds: number;
  representativeSeed: number;
  switchDay: Day;
  regimeDays: Day[];
  /** 31 Dec of each year, 2028 … 2068 on a live build (41). */
  yearEnds: Day[];
  /** Plan − baseline cumulative net homes since asOf, per year end. */
  extra: { mean: number[]; p10: number[]; p50: number[]; p90: number[] };
  /** Mean per year end; each is an integer sum ÷ seeds, and the sums add to extra's exactly. */
  bySource: Record<Source, number[]>;
  /** Mean cumulative net homes since asOf, per year end. */
  plan: number[];
  baseline: number[];
  provenance: Provenance;
}

export interface LessCarsTimeline {
  format: typeof LESSCARS_FORMAT;
  datasetVersion: string;
  /** parcels.bin's row count and idsHash, which the parcel rows index. */
  count: number;
  idsHash: number;
  seed: number;
  schedules: Schedule[];
  builds: InitiativeBuild[];
}

export interface LessCarsSite {
  siteId: string;
  projectId: string;
  rec: ParcelRecord;
  outline: [number, number][][];
}
export interface LessCarsSitesFile {
  format: typeof LESSCARS_FORMAT;
  datasetVersion: string;
  sites: LessCarsSite[];
}

export interface LessCarsPlanFile {
  format: typeof LESSCARS_FORMAT;
  datasetVersion: string;
  plan: LessCarsPlan;
  times: ProjectTimes[];
  /** cnn → lng/lat lines. */
  segments: Record<string, [number, number][][]>;
}

// ---- validation helpers ----

class LessCarsFormatError extends Error {
  constructor(path: string, message: string) {
    super(`lesscars: ${path === '' ? '' : `${path}: `}${message}`);
    this.name = 'LessCarsFormatError';
  }
}
function fail(path: string, message: string): never {
  throw new LessCarsFormatError(path, message);
}
const at = (path: string, key: string | number) => (path === '' ? String(key) : `${path}.${key}`);

function obj(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of keys) if (!(k in r)) fail(at(path, k), 'missing');
  return r;
}
function arr(v: unknown, path: string, length?: number): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  if (length !== undefined && v.length !== length)
    fail(path, `expected ${length} entries, got ${v.length}`);
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'expected a string');
  return v;
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}
function int(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, 'expected an integer');
  return v;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected a boolean');
  return v;
}
function intOrNull(v: unknown, path: string): number | null {
  return v === null ? null : int(v, path);
}
function nums(v: unknown, path: string, length?: number): number[] {
  return arr(v, path, length).map((x, i) => num(x, at(path, i)));
}
function ints(v: unknown, path: string, length?: number): number[] {
  return arr(v, path, length).map((x, i) => int(x, at(path, i)));
}
function index<T>(v: unknown, path: string, of: readonly T[]): T {
  const i = int(v, path);
  if (i < 0 || i >= of.length) fail(path, `index ${i} out of range`);
  return of[i];
}
function format(v: unknown, path: string): typeof LESSCARS_FORMAT {
  if (v !== LESSCARS_FORMAT) fail(path, `expected ${LESSCARS_FORMAT}`);
  return LESSCARS_FORMAT;
}
function pairs(v: unknown, path: string): [number, number][] {
  return arr(v, path).map((p, i) => {
    const a = nums(p, at(path, i), 2);
    return [a[0], a[1]] as [number, number];
  });
}
function rings(v: unknown, path: string): [number, number][][] {
  return arr(v, path).map((r, i) => pairs(r, at(path, i)));
}

// ---- summary ----

const INT_TOL = 1e-4;
/** `mean × seeds` as the integer sum it came from; throws when it is not one. */
function sumOf(mean: number, seeds: number, path: string): number {
  const x = mean * seeds;
  const r = Math.round(x);
  if (Math.abs(x - r) > INT_TOL) fail(path, `${mean} × ${seeds} seeds is not an integer sum`);
  return r;
}

export function parseSummary(json: unknown): LessCarsSummary {
  const keys = [
    'format',
    'datasetVersion',
    'planId',
    'seeds',
    'representativeSeed',
    'switchDay',
    'regimeDays',
    'yearEnds',
    'extra',
    'bySource',
    'plan',
    'baseline',
    'provenance'
  ];
  const r = obj(json, '', keys);
  const seeds = int(r.seeds, 'seeds');
  if (seeds < 1) fail('seeds', 'expected at least one seed');
  const yearEnds = ints(r.yearEnds, 'yearEnds');
  const Y = yearEnds.length;
  if (Y === 0) fail('yearEnds', 'expected at least one year end');
  for (let y = 1; y < Y; y++)
    if (!(yearEnds[y] > yearEnds[y - 1])) fail(at('yearEnds', y), 'not ascending');
  const e = obj(r.extra, 'extra', ['mean', 'p10', 'p50', 'p90']);
  const extra = {
    mean: nums(e.mean, 'extra.mean', Y),
    p10: ints(e.p10, 'extra.p10', Y),
    p50: ints(e.p50, 'extra.p50', Y),
    p90: ints(e.p90, 'extra.p90', Y)
  };
  const b = obj(r.bySource, 'bySource', SOURCES);
  const bySource = Object.fromEntries(
    SOURCES.map((k) => [k, nums(b[k], at('bySource', k), Y)])
  ) as Record<Source, number[]>;
  const plan = nums(r.plan, 'plan', Y);
  const baseline = nums(r.baseline, 'baseline', Y);
  for (let y = 0; y < Y; y++) {
    const whole = sumOf(extra.mean[y], seeds, at('extra.mean', y));
    let parts = 0;
    for (const k of SOURCES) parts += sumOf(bySource[k][y], seeds, at(at('bySource', k), y));
    if (parts !== whole)
      fail(at('bySource', y), `sources sum to ${parts}, extra to ${whole} (× ${seeds} seeds)`);
    const diff =
      sumOf(plan[y], seeds, at('plan', y)) - sumOf(baseline[y], seeds, at('baseline', y));
    if (diff !== whole) fail(at('extra.mean', y), `plan − baseline is ${diff}, extra is ${whole}`);
  }
  return {
    format: format(r.format, 'format'),
    datasetVersion: str(r.datasetVersion, 'datasetVersion'),
    planId: str(r.planId, 'planId'),
    seeds,
    representativeSeed: int(r.representativeSeed, 'representativeSeed'),
    switchDay: int(r.switchDay, 'switchDay'),
    regimeDays: ints(r.regimeDays, 'regimeDays'),
    yearEnds,
    extra,
    bySource,
    plan,
    baseline,
    provenance: parseProvenance(r.provenance, 'provenance')
  };
}

// ---- timeline ----

const END_KINDS = ['complete', 'exit', 'open'] as const;
const PHASE_STARTS = ['scheduled', 'estimated'] as const;
const ORIGINS = ['pipeline', 'simulated'] as const;

interface ScheduleColumns {
  projectId: string[];
  origin: number[];
  /** T11 rows; a pipeline parcel parcels.bin lacks stays its id string. */
  parcels: (number | string)[][];
  pathway: number[];
  /** Per stage (STAGE_ORDER), the day entered or null. */
  entered: (number | null)[][];
  endKind: number[];
  endDay: (number | null)[];
  endStage: (number | null)[];
  endReason: (number | null)[];
  revDay: number[][];
  revUnits: number[][];
  revStories: (number | null)[][];
  existingUnits: number[];
  multiPhase: number[];
  phase: ([string, number, number, number] | null)[];
  regime: (number | null)[];
  inFlight: number[];
}
interface BuildColumns {
  siteId: string[];
  projectId: string[];
  parcelRow: (number | null)[];
  units: number[];
  stories: number[];
  existing: number[];
  startDay: number[];
  completeDay: number[];
}

/**
 * The timeline as columnar JSON bytes, parcel ids as rows of `parcelIds` (parcels.bin's order).
 * Throws when `t.count`/`t.idsHash` do not describe `parcelIds`.
 */
export function encodeTimelinePayload(
  t: LessCarsTimeline,
  parcelIds: readonly ParcelId[]
): Uint8Array {
  if (t.count !== parcelIds.length)
    throw new Error(`lesscars: timeline count ${t.count} differs from ${parcelIds.length} parcels`);
  if (t.idsHash !== idsHash(parcelIds))
    throw new Error('lesscars: timeline idsHash differs from the parcel ids given');
  const row = new Map<ParcelId, number>();
  parcelIds.forEach((id, i) => row.set(id, i));
  const rowOf = (id: ParcelId): number | string => row.get(id) ?? id;
  const s: ScheduleColumns = {
    projectId: [],
    origin: [],
    parcels: [],
    pathway: [],
    entered: STAGE_ORDER.map(() => []),
    endKind: [],
    endDay: [],
    endStage: [],
    endReason: [],
    revDay: [],
    revUnits: [],
    revStories: [],
    existingUnits: [],
    multiPhase: [],
    phase: [],
    regime: [],
    inFlight: []
  };
  for (const sc of t.schedules) {
    s.projectId.push(sc.projectId);
    s.origin.push(ORIGINS.indexOf(sc.origin));
    s.parcels.push(sc.parcelIds.map(rowOf));
    s.pathway.push(PATHWAYS.indexOf(sc.pathway));
    STAGE_ORDER.forEach((st, k) => s.entered[k].push(sc.entered[st] ?? null));
    s.endKind.push(END_KINDS.indexOf(sc.end.kind));
    s.endDay.push(sc.end.kind === 'open' ? null : sc.end.day);
    s.endStage.push(sc.end.kind === 'exit' ? STAGE_ORDER.indexOf(sc.end.stage) : null);
    s.endReason.push(sc.end.kind === 'exit' ? EXIT_ORDER.indexOf(sc.end.reason) : null);
    s.revDay.push(sc.revisions.map((r) => r.day));
    s.revUnits.push(sc.revisions.map((r) => r.units));
    s.revStories.push(sc.revisions.map((r) => r.stories));
    s.existingUnits.push(sc.existingUnits);
    s.multiPhase.push(sc.multiPhase ? 1 : 0);
    const p = sc.phase;
    s.phase.push(p ? [p.masterId, p.index, p.of, PHASE_STARTS.indexOf(p.start)] : null);
    s.regime.push(sc.regime ?? null);
    s.inFlight.push(sc.inFlight ? 1 : 0);
  }
  const b: BuildColumns = {
    siteId: [],
    projectId: [],
    parcelRow: [],
    units: [],
    stories: [],
    existing: [],
    startDay: [],
    completeDay: []
  };
  for (const x of t.builds) {
    if (x.parcelRow !== null && !(x.parcelRow >= 0 && x.parcelRow < t.count))
      throw new Error(`lesscars: build ${x.siteId} row ${x.parcelRow} out of range`);
    b.siteId.push(x.siteId);
    b.projectId.push(x.projectId);
    b.parcelRow.push(x.parcelRow);
    b.units.push(x.units);
    b.stories.push(x.stories);
    b.existing.push(x.existing);
    b.startDay.push(x.startDay);
    b.completeDay.push(x.completeDay);
  }
  const doc = {
    format: t.format,
    datasetVersion: t.datasetVersion,
    count: t.count,
    idsHash: t.idsHash,
    seed: t.seed,
    schedules: s,
    builds: b
  };
  return new TextEncoder().encode(JSON.stringify(doc));
}

/** A column of `n` entries at `path` in `r`. */
function col(r: Record<string, unknown>, key: string, path: string, n: number): unknown[] {
  return arr(r[key], at(path, key), n);
}

/**
 * Decodes encodeTimelinePayload's bytes against parcels.bin's ids. Throws on a bad format, or a
 * `count`/`idsHash` that is not this parcels.bin's.
 */
export function decodeTimelinePayload(
  bytes: Uint8Array,
  parcels: { count: number; id: readonly ParcelId[] }
): LessCarsTimeline {
  const r = obj(JSON.parse(new TextDecoder().decode(bytes)), '', [
    'format',
    'datasetVersion',
    'count',
    'idsHash',
    'seed',
    'schedules',
    'builds'
  ]);
  const fmt = format(r.format, 'format');
  const count = int(r.count, 'count');
  if (count !== parcels.count)
    fail('count', `timeline count ${count} differs from parcels.bin's ${parcels.count}`);
  const hash = int(r.idsHash, 'idsHash');
  if (hash !== idsHash(parcels.id))
    fail('idsHash', 'idsHash differs: built for another parcels.bin');
  const idOf = (v: unknown, path: string): ParcelId => {
    if (typeof v === 'string') return v;
    const i = int(v, path);
    if (i < 0 || i >= count) fail(path, `row ${i} out of range`);
    return parcels.id[i];
  };

  const sk = Object.keys({
    projectId: 0,
    origin: 0,
    parcels: 0,
    pathway: 0,
    entered: 0,
    endKind: 0,
    endDay: 0,
    endStage: 0,
    endReason: 0,
    revDay: 0,
    revUnits: 0,
    revStories: 0,
    existingUnits: 0,
    multiPhase: 0,
    phase: 0,
    regime: 0,
    inFlight: 0
  } satisfies Record<keyof ScheduleColumns, 0>);
  const s = obj(r.schedules, 'schedules', sk);
  const n = arr(s.projectId, 'schedules.projectId').length;
  const c = (k: keyof ScheduleColumns) => col(s, k, 'schedules', n);
  const entered = arr(s.entered, 'schedules.entered', STAGE_ORDER.length).map((e, k) =>
    arr(e, at('schedules.entered', k), n)
  );
  const [projectId, origin, parcelRows, pathway] = [
    c('projectId'),
    c('origin'),
    c('parcels'),
    c('pathway')
  ];
  const [endKind, endDay, endStage, endReason] = [
    c('endKind'),
    c('endDay'),
    c('endStage'),
    c('endReason')
  ];
  const [revDay, revUnits, revStories] = [c('revDay'), c('revUnits'), c('revStories')];
  const [existingUnits, multiPhase, phase, regime, inFlight] = [
    c('existingUnits'),
    c('multiPhase'),
    c('phase'),
    c('regime'),
    c('inFlight')
  ];
  const schedules: Schedule[] = [];
  for (let i = 0; i < n; i++) {
    const p = `schedules[${i}]`;
    const ent: Partial<Record<Stage, Day>> = {};
    STAGE_ORDER.forEach((st, k) => {
      const d = intOrNull(entered[k][i], at(p, `entered.${st}`));
      if (d !== null) ent[st] = d;
    });
    const kind = index(endKind[i], at(p, 'endKind'), END_KINDS);
    let end: Schedule['end'];
    if (kind === 'open') end = { kind };
    else if (kind === 'complete') end = { kind, day: int(endDay[i], at(p, 'endDay')) };
    else
      end = {
        kind,
        stage: index(endStage[i], at(p, 'endStage'), STAGE_ORDER) as Stage,
        reason: index(endReason[i], at(p, 'endReason'), EXIT_ORDER) as ExitReason,
        day: int(endDay[i], at(p, 'endDay'))
      };
    const days = ints(revDay[i], at(p, 'revDay'));
    const units = ints(revUnits[i], at(p, 'revUnits'), days.length);
    const stories = arr(revStories[i], at(p, 'revStories'), days.length).map((x, k) =>
      intOrNull(x, at(at(p, 'revStories'), k))
    );
    let ph: Schedule['phase'] = null;
    if (phase[i] !== null) {
      const a = arr(phase[i], at(p, 'phase'), 4);
      ph = {
        masterId: str(a[0], at(p, 'phase.masterId')),
        index: int(a[1], at(p, 'phase.index')),
        of: int(a[2], at(p, 'phase.of')),
        start: index(a[3], at(p, 'phase.start'), PHASE_STARTS)
      };
    }
    const sc: Schedule = {
      projectId: str(projectId[i], at(p, 'projectId')),
      origin: index(origin[i], at(p, 'origin'), ORIGINS),
      parcelIds: arr(parcelRows[i], at(p, 'parcels')).map((x, k) =>
        idOf(x, at(at(p, 'parcels'), k))
      ),
      pathway: index(pathway[i], at(p, 'pathway'), PATHWAYS) as Pathway,
      entered: ent,
      end,
      revisions: days.map((day, k) => ({ day, units: units[k], stories: stories[k] })),
      existingUnits: int(existingUnits[i], at(p, 'existingUnits')),
      multiPhase: int(multiPhase[i], at(p, 'multiPhase')) === 1,
      phase: ph
    };
    const reg = intOrNull(regime[i], at(p, 'regime'));
    if (reg !== null) sc.regime = reg;
    if (int(inFlight[i], at(p, 'inFlight')) === 1) sc.inFlight = true;
    schedules.push(sc);
  }

  const bk = Object.keys({
    siteId: 0,
    projectId: 0,
    parcelRow: 0,
    units: 0,
    stories: 0,
    existing: 0,
    startDay: 0,
    completeDay: 0
  } satisfies Record<keyof BuildColumns, 0>);
  const b = obj(r.builds, 'builds', bk);
  const m = arr(b.siteId, 'builds.siteId').length;
  const bc = (k: keyof BuildColumns) => col(b, k, 'builds', m);
  const [siteId, bProject, parcelRow, bUnits, bStories, existing, startDay, completeDay] = [
    bc('siteId'),
    bc('projectId'),
    bc('parcelRow'),
    bc('units'),
    bc('stories'),
    bc('existing'),
    bc('startDay'),
    bc('completeDay')
  ];
  const builds: InitiativeBuild[] = [];
  for (let i = 0; i < m; i++) {
    const p = `builds[${i}]`;
    const row = intOrNull(parcelRow[i], at(p, 'parcelRow'));
    if (row !== null && !(row >= 0 && row < count)) fail(at(p, 'parcelRow'), 'out of range');
    builds.push({
      siteId: str(siteId[i], at(p, 'siteId')),
      projectId: str(bProject[i], at(p, 'projectId')),
      parcelRow: row,
      units: int(bUnits[i], at(p, 'units')),
      stories: int(bStories[i], at(p, 'stories')),
      existing: int(existing[i], at(p, 'existing')),
      startDay: int(startDay[i], at(p, 'startDay')),
      completeDay: int(completeDay[i], at(p, 'completeDay'))
    });
  }
  return {
    format: fmt,
    datasetVersion: str(r.datasetVersion, 'datasetVersion'),
    count,
    idsHash: hash,
    seed: int(r.seed, 'seed'),
    schedules,
    builds
  };
}

// ---- sites and plan files ----

function parseRecord(v: unknown, path: string): ParcelRecord {
  const r = obj(v, path, [
    'id',
    'polygon',
    'labelPoint',
    'areaM2',
    'existingUnits',
    'existingFloorAreaM2',
    'existingHeightM',
    'landUse',
    'eligible',
    'neighborhood'
  ]);
  const lp = nums(r.labelPoint, at(path, 'labelPoint'), 2);
  const rec: ParcelRecord = {
    id: str(r.id, at(path, 'id')),
    polygon: rings(r.polygon, at(path, 'polygon')),
    labelPoint: [lp[0], lp[1]],
    areaM2: num(r.areaM2, at(path, 'areaM2')),
    existingUnits: num(r.existingUnits, at(path, 'existingUnits')),
    existingFloorAreaM2: num(r.existingFloorAreaM2, at(path, 'existingFloorAreaM2')),
    existingHeightM: num(r.existingHeightM, at(path, 'existingHeightM')),
    landUse: str(r.landUse, at(path, 'landUse')),
    eligible: bool(r.eligible, at(path, 'eligible')),
    neighborhood: str(r.neighborhood, at(path, 'neighborhood'))
  };
  if ('underwater' in r) {
    if (r.underwater !== true) fail(at(path, 'underwater'), 'expected true when present');
    rec.underwater = true;
  }
  return rec;
}

export function parseSitesFile(json: unknown): LessCarsSitesFile {
  const r = obj(json, '', ['format', 'datasetVersion', 'sites']);
  return {
    format: format(r.format, 'format'),
    datasetVersion: str(r.datasetVersion, 'datasetVersion'),
    sites: arr(r.sites, 'sites').map((v, i) => {
      const p = at('sites', i);
      const s = obj(v, p, ['siteId', 'projectId', 'rec', 'outline']);
      return {
        siteId: str(s.siteId, at(p, 'siteId')),
        projectId: str(s.projectId, at(p, 'projectId')),
        rec: parseRecord(s.rec, at(p, 'rec')),
        outline: rings(s.outline, at(p, 'outline'))
      };
    })
  };
}

function parseTimes(v: unknown, path: string): ProjectTimes {
  const r = obj(v, path, ['id', 'startDay', 'openDay', 'closeDay', 'availableDay', 'build']);
  let build: ProjectTimes['build'] = null;
  if (r.build !== null) {
    const b = obj(r.build, at(path, 'build'), ['startDay', 'completeDay']);
    build = {
      startDay: int(b.startDay, at(path, 'build.startDay')),
      completeDay: int(b.completeDay, at(path, 'build.completeDay'))
    };
  }
  return {
    id: str(r.id, at(path, 'id')),
    startDay: int(r.startDay, at(path, 'startDay')),
    openDay: int(r.openDay, at(path, 'openDay')),
    closeDay: intOrNull(r.closeDay, at(path, 'closeDay')),
    availableDay: intOrNull(r.availableDay, at(path, 'availableDay')),
    build
  };
}

export function parsePlanFile(json: unknown): LessCarsPlanFile {
  const r = obj(json, '', ['format', 'datasetVersion', 'plan', 'times', 'segments']);
  const plan = parseLessCarsPlan(r.plan);
  const times = arr(r.times, 'times').map((t, i) => parseTimes(t, at('times', i)));
  const ids = new Set(plan.projects.map((p) => p.id));
  for (const [i, t] of times.entries())
    if (!ids.has(t.id)) fail(at(at('times', i), 'id'), `no project ${t.id} in the plan`);
  const seg = obj(r.segments, 'segments', []);
  const segments: Record<string, [number, number][][]> = {};
  for (const [cnn, lines] of Object.entries(seg)) segments[cnn] = rings(lines, at('segments', cnn));
  return {
    format: format(r.format, 'format'),
    datasetVersion: str(r.datasetVersion, 'datasetVersion'),
    plan,
    times,
    segments
  };
}
