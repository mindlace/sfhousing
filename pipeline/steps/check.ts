import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, inflateRawSync } from 'node:zlib';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import {
  FILL_LEVELS,
  SCENARIO_FORMAT,
  decodeScenarioPayload,
  encodeScenarioPayload,
  type ScenarioParcels
} from '../../src/lib/data/scenario-codec';
import { decodeTransit } from '../../src/lib/data/transit-codec';
import type { Day } from '../../src/lib/timelapse/time';
import type { Calibration, Pathway, Stage } from '../../src/lib/timelapse/types';
import { BBOX, type InvariantProfile } from '../config';
import { checkQuality } from '../lib/quality';
import { pointStrictlyInside } from '../lib/rings';
import { parseProjectsFile } from '../../src/lib/timelapse/projects';
import { FIXTURE_CAL, LIVE_CAL } from '../lib/fzp-cal/config';
import { checkV25, checkV26, checkV27, parseCalibrationText } from '../lib/fzp-cal/invariants';
import { scenarioEligible } from '../lib/scenario-eligibility';
import { checkV20 } from '../project-records/invariants';
import { CALIBRATION_JSON } from './calibration';
import { PROJECTS_JSON } from './projects';
import { PARCELS_BIN } from '../lib/scenario-files';
import { z12TileBytes } from './tiles';

export interface InvariantResult {
  id: `V${number}`;
  ok: boolean;
  detail: string;
}

export interface CheckExtras {
  /** report_counts + chunks.* (report.json `counts`). */
  counts: Record<string, number>;
  /** V12 in-run half: the second encode of the chunks was byte-identical. */
  reencodeIdentical?: boolean;
  /** V11 tile budgets are skipped; default: skipped iff buildings.pmtiles is absent. */
  skipTiles?: boolean;
  /** Leave machine-dependent numbers (tile and gzip bytes) out of `detail` (fixture report). */
  stableDetail?: boolean;
  /** V20: the build's snapshot day; V20 fails when it is not given. */
  asOf?: Day;
  /**
   * V21-V24 from the project-records step (they need the in-memory derivation). A standalone
   * `check` carries them from report.json; when absent they fail as not measured.
   */
  projectChecks?: InvariantResult[];
  /**
   * V28 and V29 from the calibration step (they need the in-memory computation). A standalone
   * `check` carries them from report.json; when absent they fail as not measured.
   */
  calibrationChecks?: InvariantResult[];
}

/** The project-records invariants measured in the build, not from the files. */
export const PROJECT_CHECK_IDS = ['V21', 'V22', 'V23', 'V24'] as const;

/** The stage-calibration invariants measured in the build, not from the files. */
export const CALIBRATION_CHECK_IDS = ['V28', 'V29'] as const;

interface Chunk {
  cellId: string;
  parcelCount: number;
  rawBytes: number;
  gzipBytes: number;
  recs: ParcelRecord[] | null;
  error?: string;
}

/** Transit spec §4.3 size target for transit.json; over it V14 warns but still passes. */
const TRANSIT_TARGET_BYTES = 400e3;
/**
 * Planning's ~780,000 units of net added FZP capacity (tier 1, scenario-data literature §1 [A]):
 * V17's cross-check of `scenario.yield.fzp_net_total`.
 */
const FZP_NET_CAPACITY = 780e3;
/** V17 warns (still passes) outside [0.25×, 4×] FZP_NET_CAPACITY (spec §4.10, tier 4 band). */
const FZP_NET_BAND = [0.25, 4] as const;
/**
 * V17: at least this share of (scenario-)eligible parcels is hostable (spec §4.10, tier 4 check
 * bound).
 */
const HOSTABLE_MIN = 0.5;
/**
 * V18: `hostable_base` changes by at most this share between consecutive roll years, with no
 * exemptions (partner ruling, option c: a density-cap change such as the 2022-11-27 fourplex
 * ordinance must not flip the at-risk set; tier 4 check bound, made up).
 */
const HOSTABLE_BASE_STEP_MAX = 0.05;
/** V19 warns (still passes) when parcels.bin is larger (spec §4.10, tier 4). */
const SCENARIO_WARN_BYTES = 3.0e6;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const thr = (x: number) => `${Number((x * 100).toFixed(4))}%`;
const ratio = (num: number | undefined, den: number | undefined) =>
  num === undefined || den === undefined || den === 0 ? NaN : num / den;

function readManifest(outDir: string): { m: Manifest | null; error?: string } {
  try {
    return { m: parseManifest(JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'))) };
  } catch (e) {
    return { m: null, error: (e as Error).message };
  }
}

function readChunks(outDir: string, m: Manifest): Chunk[] {
  const prefix = `/data/${m.datasetVersion}/`;
  return m.chunks.map((c) => {
    const base = { cellId: c.cellId, parcelCount: c.parcelCount, rawBytes: 0, gzipBytes: 0 };
    try {
      const buf = readFileSync(join(outDir, c.url.slice(prefix.length)));
      const recs = decodeParcelChunk(buf.toString('utf8'));
      return {
        ...base,
        rawBytes: buf.length,
        gzipBytes: gzipSync(buf, { level: 9 }).length,
        recs
      };
    } catch (e) {
      return { ...base, recs: null, error: `${c.cellId}: ${(e as Error).message}` };
    }
  });
}

interface Scenario {
  p: ScenarioParcels | null;
  /** The inflated payload, when it inflated. */
  payload?: Uint8Array;
  /** parcels.bin bytes on disk; NaN when unreadable. */
  fileBytes: number;
  error?: string;
}

/** Inflate and decode `scenarios/fzp/parcels.bin` (manifest-independent path). Never throws. */
function readScenario(outDir: string): Scenario {
  let body: Buffer;
  try {
    body = readFileSync(join(outDir, PARCELS_BIN));
  } catch (e) {
    return { p: null, fileBytes: NaN, error: `${PARCELS_BIN} unreadable: ${(e as Error).message}` };
  }
  try {
    const payload = new Uint8Array(inflateRawSync(body));
    return { p: decodeScenarioPayload(payload), payload, fileBytes: body.length };
  } catch (e) {
    const error = `${PARCELS_BIN} does not decode: ${(e as Error).message}`;
    return { p: null, fileBytes: body.length, error };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function neighborhoodNames(outDir: string, profile: InvariantProfile): string[] {
  if (profile.neighborhoodNames !== 'from-source') return profile.neighborhoodNames;
  const fc = JSON.parse(readFileSync(join(outDir, 'neighborhoods.geojson'), 'utf8')) as {
    features: { properties: { name: string } }[];
  };
  return fc.features.map((f) => f.properties.name);
}

/**
 * V30 (scenario-data spec §4.10, T14): every registered rule reports, no `quality.*` key names an
 * unregistered rule, and with `profile.qualityShares` no share exceeds its rule's failShare (a
 * share above warnShare warns). `check` is the registry's checker; tests pass a crafted one.
 */
export function checkV30(
  counts: Record<string, number>,
  profile: Pick<InvariantProfile, 'qualityShares'>,
  check: typeof checkQuality = checkQuality
): InvariantResult {
  const shares = profile.qualityShares;
  const q = check(counts, { shares });
  const warn = q.warnings.length ? `warn: ${q.warnings.join('; ')}` : '';
  const parts = q.ok
    ? [
        'every registered rule reports',
        shares ? 'no share above failShare' : 'shares not checked on this profile'
      ]
    : q.failures;
  return { id: 'V30', ok: q.ok, detail: [...parts, warn].filter(Boolean).join('; ') };
}

/** Invariant `id`'s result: its problems joined by '; ', or the `ok` text when there are none. */
function verdict(id: InvariantResult['id'], problems: string[], ok: string): InvariantResult {
  return {
    id,
    ok: problems.length === 0,
    detail: problems.length === 0 ? ok : problems.join('; ')
  };
}

/** Whether `outDir` holds a fixture dataset (`fixture-<n>`), by its manifest's datasetVersion. */
function isFixtureDataset(outDir: string): boolean {
  const { m } = readManifest(outDir);
  return m !== null && /^fixture-\d+$/.test(m.datasetVersion);
}

/**
 * V25–V27 over `scenarios/fzp/calibration.json` and `projects.json` (stage-calibration spec
 * §4.10). A missing or unreadable file fails the invariants that need it. The V27 sample size and
 * tolerance come from the calibration profile that matches the invariant profile.
 */
function checkCalibrationFiles(outDir: string): InvariantResult[] {
  const calFile = join(outDir, CALIBRATION_JSON);
  const projFile = join(outDir, PROJECTS_JSON);
  if (!existsSync(calFile)) {
    const d = `${CALIBRATION_JSON} missing`;
    return (['V25', 'V26', 'V27'] as const).map((id) => ({ id, ok: false, detail: d }));
  }
  const text = readFileSync(calFile, 'utf8');
  const bytes = statSync(calFile).size;

  // T3's asOf and in-flight projects. A projects.json that is missing or invalid is V20's to
  // report: here it only means the asOf or in-flight comparison is not made. (T4d's asOf is
  // checked by the calibration step itself, which throws on a mismatch.)
  let projectsAsOf: Day | undefined;
  let inFlight: { pathway: Pathway; stage: Stage }[] | undefined;
  if (existsSync(projFile)) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(projFile, 'utf8'));
    } catch {
      json = undefined;
    }
    const asOf = (json as { asOf?: unknown } | undefined)?.asOf;
    if (Number.isInteger(asOf)) projectsAsOf = asOf as Day;
    try {
      inFlight = parseProjectsFile(json).projects;
    } catch {
      inFlight = undefined;
    }
  }

  const v25 = checkV25(text, bytes, FILL_LEVELS, projectsAsOf);
  const out: InvariantResult[] = [
    verdict(
      'V25',
      v25,
      `parses, fill levels equal FILL_LEVELS, asOf matches projects.json (T4d asOf checked by the calibration step), ${bytes} B`
    )
  ];

  // V26 reads the cells even when parseCalibration rejects the file (a deleted cell is itself a
  // parse failure); V27 samples only a file that parses.
  const parsed = parseCalibrationText(text);
  let raw: Calibration | undefined;
  if ('cal' in parsed) raw = parsed.cal;
  else {
    try {
      raw = JSON.parse(text) as Calibration;
    } catch {
      raw = undefined;
    }
  }
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    const d = `${CALIBRATION_JSON} is not a JSON object (V25)`;
    out.push({ id: 'V26', ok: false, detail: d }, { id: 'V27', ok: false, detail: d });
    return out;
  }
  const v26 = checkV26(raw, inFlight ?? []);
  out.push(
    verdict(
      'V26',
      v26,
      inFlight
        ? `every occupiable pathway x stage cell present (${inFlight.length} in flight)`
        : 'every occupiable pathway x stage cell present (in-flight cells not checked)'
    )
  );
  if ('error' in parsed) {
    out.push({ id: 'V27', ok: false, detail: `${CALIBRATION_JSON} does not parse (V25)` });
    return out;
  }
  // The method constants follow the dataset version (as build.ts's fixtureMode does), not the
  // T14 share flag; a dataset with no readable manifest is judged by the live constants.
  const cal = isFixtureDataset(outDir) ? FIXTURE_CAL : LIVE_CAL;
  out.push(
    verdict(
      'V27',
      checkV27(parsed.cal, cal.v27N, cal.v27Tol),
      `sampling reproduces every table within ${cal.v27Tol} (${cal.v27N} draws per cell)`
    )
  );
  return out;
}

/** The `scenario.panel.hostable_base.<roll year>` counts the scenario step writes (V18). */
const HOSTABLE_BASE_KEY = /^scenario\.panel\.hostable_base\.(\d{4})$/;

/**
 * V18's hostable_base stability input: the panel roll years with a
 * `scenario.panel.hostable_base.<year>` count, ascending, and for each later year y, paired with
 * the previous panel year, the change over the parcels with a row in both,
 * |both − both_prev| / both_prev (`.<y>.both`, `.<y>.both_prev`; 0 when both are 0, Infinity when
 * only the earlier one is). `problem` is 'missing' when a pair count is absent and 'no-overlap'
 * when no parcel has a row in both years (`.<y>.both_rows` = 0), so no pair passes unmeasured.
 */
export function hostableBaseSteps(counts: Record<string, number>): {
  years: number[];
  steps: { from: number; to: number; change: number; problem?: 'missing' | 'no-overlap' }[];
} {
  const years: number[] = [];
  for (const k of Object.keys(counts)) {
    const m = HOSTABLE_BASE_KEY.exec(k);
    if (m) years.push(Number(m[1]));
  }
  years.sort((a, b) => a - b);
  const steps = years.slice(1).map((to, k) => {
    const from = years[k];
    const rows = counts[`scenario.panel.hostable_base.${to}.both_rows`];
    const a = counts[`scenario.panel.hostable_base.${to}.both_prev`];
    const b = counts[`scenario.panel.hostable_base.${to}.both`];
    if (rows === undefined || a === undefined || b === undefined)
      return { from, to, change: NaN, problem: 'missing' as const };
    if (rows === 0) return { from, to, change: NaN, problem: 'no-overlap' as const };
    const change = a === 0 ? (b === 0 ? 0 : Infinity) : Math.abs(b - a) / a;
    return { from, to, change };
  });
  return { years, steps };
}

/** Max without spreading (spread overflows the call stack at ~150k elements). */
export function maxOf(xs: readonly number[]): number {
  return xs.reduce((a, b) => (b > a ? b : a), -Infinity);
}

/**
 * Spec §4.9 invariants V1–V13, transit spec §4.3 V14, scenario-data spec §4.10 V15–V19 and
 * project-records spec §4.9 V20 over a built dataset directory, then V21–V24 from
 * `extras.projectChecks` and V30 (T14) from the counts. Never throws.
 */
export async function checkDataset(
  outDir: string,
  profile: InvariantProfile,
  extras: CheckExtras
): Promise<InvariantResult[]> {
  const c = extras.counts;
  const out: InvariantResult[] = [];
  const add = (id: InvariantResult['id'], ok: boolean, detail: string) =>
    out.push({ id, ok, detail });

  const { m, error: manifestError } = readManifest(outDir);
  const chunks = m ? readChunks(outDir, m) : [];
  const decodeErrors = chunks.filter((k) => k.error).map((k) => k.error!);
  const recs = chunks.flatMap((k) => k.recs ?? []);
  const decodeNote = decodeErrors.length
    ? `; ${decodeErrors.length} chunk(s) failed to decode`
    : '';

  // V1 units.
  const units = recs.reduce((s, r) => s + r.existingUnits, 0);
  const dev = (units - profile.unitsTarget) / profile.unitsTarget;
  add(
    'V1',
    decodeErrors.length === 0 &&
      Math.abs(units - profile.unitsTarget) <= profile.unitsTol * profile.unitsTarget,
    `Σ units ${units} vs ${profile.unitsTarget} (${(dev * 100).toFixed(2)}%, tolerance ±${thr(profile.unitsTol)})${decodeNote}`
  );

  // V2 parcels emitted = distinct active non-null ids, within range.
  const emitted = c['parcels.emitted'];
  const distinct = c['parcels.distinct_active_ids'];
  const [lo, hi] = profile.parcelRange;
  add(
    'V2',
    emitted !== undefined && emitted === distinct && emitted >= lo && emitted <= hi,
    `parcels emitted ${emitted} vs distinct active ids ${distinct}, range [${lo}, ${hi}]`
  );

  // V3 land-use match.
  const lu = ratio(c['landuse.matched_parcels'], emitted);
  add(
    'V3',
    lu >= profile.landUseMatchMin,
    `land-use match ${pct(lu)} ${lu >= profile.landUseMatchMin ? '≥' : '<'} ${thr(profile.landUseMatchMin)}`
  );

  // V4 landuse values ⊆ known.
  const unknown = c['landuse.unknown_values'];
  add('V4', unknown === 0, `unknown landuse values: ${unknown}`);

  // V5 height coverage (hs ≠ 3).
  const kept = c['buildings.kept'];
  const cov = ratio(kept - c['buildings.hs3'], kept);
  add(
    'V5',
    cov >= profile.heightCoverageMin,
    cov >= profile.heightCoverageMin
      ? `height coverage ${pct(cov)} ≥ ${thr(profile.heightCoverageMin)}`
      : `height coverage ${(cov * 100).toFixed(1)}% < ${thr(profile.heightCoverageMin)}: set config.renderSource='datasf'`
  );

  // V6 building piece area carrying a parcelId.
  const pa = ratio(c['pieces.area_with_parcel_m2'], c['pieces.area_total_m2']);
  add(
    'V6',
    pa >= profile.pieceAreaParcelMin,
    `piece area with parcelId ${pct(pa)} ${pa >= profile.pieceAreaParcelMin ? '≥' : '<'} ${thr(profile.pieceAreaParcelMin)}`
  );

  // V7 neighborhood names and label point strictly inside its polygon.
  {
    let names: string[] = [];
    let nbError = '';
    try {
      names = neighborhoodNames(outDir, profile);
    } catch (e) {
      nbError = `neighborhoods unreadable: ${(e as Error).message}`;
    }
    const nameSet = new Set(names);
    const badNb = recs.filter((r) => !nameSet.has(r.neighborhood)).length;
    const empty = recs.filter((r) => r.polygon.length === 0).length;
    const inside = recs.filter((r) => pointStrictlyInside([0, 0], r.polygon)).length;
    const rate = recs.length ? inside / recs.length : 0;
    const countOk =
      profile.neighborhoodCount === null || names.length === profile.neighborhoodCount;
    const problems = [
      nbError,
      countOk ? '' : `${names.length} neighborhoods, want ${profile.neighborhoodCount}`,
      badNb ? `${badNb} parcel(s) with an unknown neighborhood` : '',
      empty ? `${empty} empty polygon(s)` : '',
      rate < profile.labelInsideMin
        ? `label inside ${pct(rate)} < ${thr(profile.labelInsideMin)}`
        : ''
    ].filter(Boolean);
    add(
      'V7',
      problems.length === 0 && recs.length > 0 && decodeErrors.length === 0,
      problems.length
        ? problems.join('; ')
        : `${names.length} neighborhoods; label inside ${inside}/${recs.length}${decodeNote}`
    );
  }

  // V8 each parcel in exactly one chunk; Σ parcelCount = V2; unique cellIds; chunks decode.
  {
    const seen = new Map<string, number>();
    for (const r of recs) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    const dupes = [...seen.values()].filter((n) => n > 1).length;
    const sumCount = chunks.reduce((s, k) => s + k.parcelCount, 0);
    const cellIds = new Set(chunks.map((k) => k.cellId));
    const countMismatch = chunks.filter((k) => k.recs && k.recs.length !== k.parcelCount);
    const problems = [
      manifestError ? `manifest: ${manifestError}` : '',
      ...decodeErrors,
      dupes ? `${dupes} parcel id(s) in more than one chunk` : '',
      seen.size !== distinct ? `${seen.size} distinct ids ≠ V2 ${distinct}` : '',
      sumCount !== distinct ? `Σ parcelCount ${sumCount} ≠ V2 ${distinct}` : '',
      cellIds.size !== chunks.length ? 'duplicate cellId' : '',
      ...countMismatch.map((k) => `${k.cellId}: parcelCount ${k.parcelCount} ≠ ${k.recs!.length}`)
    ].filter(Boolean);
    add(
      'V8',
      problems.length === 0,
      problems.length
        ? problems.join('; ')
        : `${seen.size} parcels in ${chunks.length} chunk(s), each exactly once`
    );
  }

  // V9 per-chunk size limits.
  {
    const maxP = Math.max(0, ...chunks.map((k) => k.recs?.length ?? k.parcelCount));
    const maxRaw = Math.max(0, ...chunks.map((k) => k.rawBytes));
    const maxGz = Math.max(0, ...chunks.map((k) => k.gzipBytes));
    const ok =
      maxP <= profile.maxChunkParcels &&
      maxRaw <= profile.maxChunkRaw &&
      maxGz <= profile.maxChunkGzip;
    const gz = extras.stableDetail ? '' : `, ${maxGz}/${profile.maxChunkGzip} B gzip-9`;
    add(
      'V9',
      ok,
      `largest chunk: ${maxP}/${profile.maxChunkParcels} parcels, ${maxRaw}/${profile.maxChunkRaw} B raw${gz}`
    );
  }

  // V10 max existingHeightM over the parcels.
  {
    const maxH = recs.length ? maxOf(recs.map((r) => r.existingHeightM)) : NaN;
    const [hlo, hhi] = profile.maxHeightRange;
    add('V10', maxH >= hlo && maxH <= hhi, `max existingHeightM ${maxH} m, range [${hlo}, ${hhi}]`);
  }

  // V11 first-paint budgets.
  {
    const size = (f: string) =>
      existsSync(join(outDir, f)) ? statSync(join(outDir, f)).size : NaN;
    const mb = size('manifest.json');
    const nb = size('neighborhoods.geojson');
    const parts = [
      `manifest ${mb}/${profile.manifestMax} B`,
      `neighborhoods ${nb}/${profile.neighborhoodsMax} B`
    ];
    let ok = mb <= profile.manifestMax && nb <= profile.neighborhoodsMax;
    const skip = extras.skipTiles ?? !existsSync(join(outDir, 'buildings.pmtiles'));
    let tiles = 'tiles skipped';
    if (!skip) {
      try {
        const b = await z12TileBytes(join(outDir, 'buildings.pmtiles'), BBOX);
        const bm = await z12TileBytes(join(outDir, 'basemap.pmtiles'), BBOX);
        const tilesOk = b <= profile.z12BuildingsMax && bm <= profile.z12BasemapMax;
        ok &&= tilesOk;
        tiles = extras.stableDetail
          ? tilesOk
            ? ''
            : 'z12 tiles over budget'
          : `z12 buildings ${b}/${profile.z12BuildingsMax} B, basemap ${bm}/${profile.z12BasemapMax} B`;
      } catch (e) {
        ok = false;
        tiles = `z12 tile bytes unavailable: ${(e as Error).message}`;
      }
    } else if (extras.stableDetail) tiles = '';
    if (tiles) parts.push(tiles);
    add('V11', ok, parts.join('; '));
  }

  // V12 in-run determinism (the cross-run half is the golden test + CI).
  add(
    'V12',
    extras.reencodeIdentical === true,
    extras.reencodeIdentical === undefined
      ? 'in-run re-encode not measured'
      : extras.reencodeIdentical
        ? 'chunks re-encode byte-identical'
        : 'chunks re-encode differs'
  );

  // V13 published versions are immutable: enforced by `upload`.
  add('V13', true, 'enforced at upload');

  // V14 transit network (transit spec §4.3).
  {
    const problems: string[] = [];
    let detail = '';
    if (!m?.transit) problems.push('manifest has no transit');
    else {
      try {
        const rel = m.transit.slice(`/data/${m.datasetVersion}/`.length);
        const buf = readFileSync(join(outDir, rel));
        const net = decodeTransit(buf.toString('utf8'));
        if (net.stops.length < profile.transitMinStops)
          problems.push(`${net.stops.length} stops < ${profile.transitMinStops}`);
        const heavy = new Set<number>();
        for (const p of net.patterns)
          if (p.mode === 'heavy-rail') for (const s of p.stops) if (s.tph > 0) heavy.add(s.stop);
        const missing = profile.transitHeavyRailStations.filter(
          (name) =>
            ![...heavy].some((i) => net.stops[i].name.toLowerCase().includes(name.toLowerCase()))
        );
        if (missing.length) problems.push(`no heavy-rail service at ${missing.join(', ')}`);
        detail = `${net.stops.length} stops, ${net.patterns.length} patterns, ${heavy.size} heavy-rail stops`;
        if (buf.length > TRANSIT_TARGET_BYTES)
          detail += `; warn: transit.json ${buf.length} B > ${TRANSIT_TARGET_BYTES} B target`;
      } catch (e) {
        problems.push(`transit.json: ${(e as Error).message}`);
      }
    }
    add('V14', problems.length === 0, problems.length ? problems.join('; ') : detail);
  }

  // V15–V19 scenario file (scenario-data spec §4.10).
  const sc = readScenario(outDir);
  const p = sc.p;
  // V16-V18 count eligibility as the scenario does: parcels.bin's flags bit 5 (the chunk record's
  // `eligible`, or no land-use row with latest-roll units, sd.landuse.none-with-units), the value
  // its yields and hostable flags used. V17 checks the flag against the chunk records.
  const eligibleRows: number[] = [];
  if (p) for (let i = 0; i < p.count; i++) if (p.eligible[i]) eligibleRows.push(i);
  const eligibleN = eligibleRows.length;
  const recById = new Map(recs.map((r) => [r.id, r]));
  const fileProblem = sc.error ?? '';
  const addProblems = (id: InvariantResult['id'], problems: string[], okDetail: string) => {
    const ps = problems.filter(Boolean);
    add(id, ps.length === 0, ps.length ? ps.join('; ') : okDetail);
  };

  // V15 decodes; header matches; count = V2; ids in exactly one chunk, in that chunk's cell;
  // re-encoding the decoded payload is byte-identical.
  {
    const problems = [fileProblem];
    if (p) {
      if (p.format !== SCENARIO_FORMAT) problems.push(`format ${p.format} ≠ ${SCENARIO_FORMAT}`);
      if (!m) problems.push('no manifest to compare datasetVersion');
      else if (p.datasetVersion !== m.datasetVersion)
        problems.push(`datasetVersion ${p.datasetVersion} ≠ ${m.datasetVersion}`);
      if (p.scenario !== 'fzp') problems.push(`scenario ${p.scenario} ≠ fzp`);
      if (p.count !== emitted) problems.push(`count ${p.count} ≠ parcels.emitted ${emitted}`);
      if (recs.length !== p.count) problems.push(`${recs.length} chunk records ≠ count ${p.count}`);
      const cellsOf = new Map<string, string[]>();
      for (const k of chunks)
        for (const r of k.recs ?? []) cellsOf.set(r.id, [...(cellsOf.get(r.id) ?? []), k.cellId]);
      let missing = 0;
      let multi = 0;
      let wrongCell = 0;
      p.id.forEach((id, i) => {
        const cs = cellsOf.get(id);
        if (!cs) missing++;
        else if (cs.length > 1) multi++;
        else if (p.cells[p.cell[i]]?.cellId !== cs[0]) wrongCell++;
      });
      if (missing) problems.push(`${missing} id(s) in no chunk`);
      if (multi) problems.push(`${multi} id(s) in more than one chunk`);
      if (wrongCell) problems.push(`${wrongCell} id(s) whose cell ≠ their chunk's cellId`);
      if (decodeErrors.length) problems.push(`${decodeErrors.length} chunk(s) failed to decode`);
      try {
        if (!sameBytes(encodeScenarioPayload(p), sc.payload!))
          problems.push('re-encoding the decoded payload differs');
      } catch (e) {
        problems.push(`re-encoding the decoded payload fails: ${(e as Error).message}`);
      }
    }
    addProblems(
      'V15',
      problems,
      `${p?.count} parcels decode, each in its chunk's cell; re-encode byte-identical`
    );
  }

  // V16 height strings parse; eligible parcels have a district.
  {
    const parseFail = c['scenario.height.parse_fail'];
    const withDistrict = p
      ? eligibleRows.filter((i) => p.districts[p.district[i]] !== '').length
      : 0;
    const share = ratio(withDistrict, eligibleN);
    addProblems(
      'V16',
      [
        fileProblem,
        parseFail === 0 ? '' : `scenario.height.parse_fail ${parseFail} ≠ 0`,
        p && !(share >= profile.heightJoinMin)
          ? `eligible with a district ${pct(share)} < ${thr(profile.heightJoinMin)}`
          : ''
      ],
      `0 parse failures; eligible with a district ${withDistrict}/${eligibleN} ≥ ${thr(profile.heightJoinMin)}`
    );
  }

  // V17 fill levels, no clamped u16, hostable masks, non-LP base = FZP, hostable share; warn on
  // the FZP net capacity cross-check. The hostable flags read the uncapped full-fill yields
  // (partner ruling, option c), which the payload does not carry: V17 checks the conditions the
  // payload can show (hostable ⇒ eligible ∧ stories ≥ 1; eligible ∧ stories ≥ 1 ∧ capped
  // yield[F−1] > 0 ⇒ hostable, since capped > 0 implies uncapped > 0) and the step's counts of
  // flags that disagree with its own uncapped yields. Eligibility is flags bit 5, which must equal
  // the chunk record's `eligible` or sd.landuse.none-with-units on the row's latest-roll units.
  {
    const clamped = c['scenario.yield.clamped'];
    const nonlp = c['scenario.yield.nonlp_base_mismatch'];
    const zero = (k: string) => (c[k] === 0 ? '' : `${k} ${c[k]} ≠ 0`);
    const problems = [
      fileProblem,
      clamped === 0 ? '' : `scenario.yield.clamped ${clamped} ≠ 0`,
      nonlp === 0 ? '' : `scenario.yield.nonlp_base_mismatch ${nonlp} ≠ 0`,
      zero('scenario.hostable_mismatch'),
      zero('scenario.hostable_base_mismatch')
    ];
    let hostable = 0;
    if (p) {
      const fl = p.fillLevels;
      if (fl.length !== FILL_LEVELS.length || FILL_LEVELS.some((v, k) => fl[k] !== v))
        problems.push(`fillLevels [${fl.join(', ')}] ≠ FILL_LEVELS`);
      const F = fl.length;
      let badH = 0;
      let badB = 0;
      let badE = 0;
      for (let i = 0; i < p.count; i++) {
        const rec = recById.get(p.id[i]);
        if (
          (p.eligible[i] === 1) !==
          (rec !== undefined && scenarioEligible(rec, p.existingUnits[i]))
        )
          badE++;
        const elig = p.eligible[i] === 1;
        const canH = elig && p.envelopeStories[i] >= 1;
        const canB = elig && p.baseStories[i] >= 1;
        const mustH = canH && p.yield[i * F + F - 1] > 0;
        const mustB = canB && p.baseYield[i * F + F - 1] > 0;
        if (p.hostable[i] ? !canH : mustH) badH++;
        if (p.hostableBase[i] ? !canB : mustB) badB++;
        hostable += p.hostable[i];
      }
      if (badH) problems.push(`${badH} hostable flag(s) disagree with eligibility and yield`);
      if (badB) problems.push(`${badB} hostableBase flag(s) disagree with eligibility and yield`);
      if (badE)
        problems.push(
          `${badE} eligible flag(s) disagree with the chunk record and sd.landuse.none-with-units`
        );
      const share = ratio(hostable, eligibleN);
      if (!(share >= HOSTABLE_MIN))
        problems.push(`hostable ${pct(share)} of eligible < ${thr(HOSTABLE_MIN)}`);
    }
    const net = c['scenario.yield.fzp_net_total'];
    const [lo, hi] = FZP_NET_BAND.map((x) => x * FZP_NET_CAPACITY);
    const warn =
      net >= lo && net <= hi
        ? ''
        : `; warn: FZP net capacity ${net} outside [${lo}, ${hi}] (Planning ~${FZP_NET_CAPACITY}, tier 1)`;
    addProblems('V17', problems, `hostable ${hostable}/${eligibleN} eligible${warn}`);
  }

  // V18 panel covers every roll year; latest-year roll join; Σ units; panel = T11 features;
  // hostable_base stable year on year.
  {
    const panelYears = c['scenario.panel.years'];
    const rollYears = c['scenario.roll.years'];
    const matched = c['scenario.roll.latest_eligible_matched'];
    const unitsTotal = c['scenario.units.total'];
    const mismatch = c['scenario.panel.feature_mismatch'];
    // Coordinator ruling 2026-10-18: parcels whose panel and T11 base caps differ by period (each
    // correct for its own date) are not compared on base-cap features; reported here by code.
    const capDiffers = c['scenario.v18.cap_period_differs'];
    const capPrefix = 'scenario.v18.cap_period_differs.';
    const capByCode = Object.entries(c)
      .filter(([k]) => k.startsWith(capPrefix))
      .map(([k, n]): [string, number] => [k.slice(capPrefix.length), n])
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    const capSum = capByCode.reduce((s, [, n]) => s + n, 0);
    // Ord. 292-24 changed only the RM and RC maxima, so a cap-period difference on any other code
    // (a split code counts when one of its components is RM or RC) means the exclusion hides a
    // real mismatch.
    const inFamily = (code: string) =>
      code.split('|').some((z) => /^(?:RM-[1-4]|RC-[34])$/.test(z.trim()));
    const outside = capByCode.filter(([k, n]) => n > 0 && !inFamily(k)).map(([k]) => k);
    const baseCapMismatch = c['scenario.v18.basecap_mismatch'];
    const capDetail =
      capDiffers > 0
        ? `; base cap differs by period on ${capDiffers} parcels (base-cap features not ` +
          `compared; ${capByCode.map(([k, n]) => `${k} ${n}`).join(', ')})`
        : '; base cap differs by period on 0 parcels';
    const share = ratio(matched, eligibleN);
    const [ulo, uhi] = profile.scenarioUnitsRange;
    const { years: hbYears, steps } = hostableBaseSteps(c);
    const maxStep = steps.length ? maxOf(steps.map((s) => s.change)) : 0;
    const stepProblem = (s: (typeof steps)[number]) =>
      s.problem === 'missing'
        ? `hostable_base ${s.from} → ${s.to} has no both-years counts`
        : s.problem === 'no-overlap'
          ? `hostable_base ${s.from} → ${s.to}: no parcel has a row in both years`
          : `hostable_base ${s.from} → ${s.to} changes by ${pct(s.change)} > ${thr(HOSTABLE_BASE_STEP_MAX)}`;
    addProblems(
      'V18',
      [
        fileProblem,
        rollYears > 0 && panelYears === rollYears
          ? ''
          : `panel years ${panelYears} ≠ roll years ${rollYears}`,
        share >= profile.rollJoinMin
          ? ''
          : `eligible with a latest-year roll row ${pct(share)} < ${thr(profile.rollJoinMin)}`,
        unitsTotal >= ulo && unitsTotal <= uhi
          ? ''
          : `scenario.units.total ${unitsTotal} outside [${ulo}, ${uhi}]`,
        mismatch === 0 ? '' : `scenario.panel.feature_mismatch ${mismatch} ≠ 0`,
        Number.isInteger(capDiffers) && capDiffers === capSum
          ? ''
          : `scenario.v18.cap_period_differs ${capDiffers} ≠ Σ by code ${capSum}`,
        outside.length === 0
          ? ''
          : `cap-period difference outside the RM and RC families (Ord. 292-24): ${outside.join(', ')}`,
        baseCapMismatch === 0
          ? ''
          : `scenario.v18.basecap_mismatch ${baseCapMismatch} ≠ 0 (T11 baseCap differs from ` +
            'sc_parcel.cap_prefzp)',
        hbYears.length === panelYears
          ? ''
          : `hostable_base counted for ${hbYears.length} roll years ≠ ${panelYears}`,
        ...steps.filter((s) => !(s.change <= HOSTABLE_BASE_STEP_MAX)).map(stepProblem)
      ],
      `${panelYears} roll years; eligible with a latest-year roll row ${matched}/${eligibleN}; Σ units ${unitsTotal} in [${ulo}, ${uhi}]; hostable_base year-on-year change (parcels in both years) ≤ ${thr(maxStep)} ≤ ${thr(HOSTABLE_BASE_STEP_MAX)}${capDetail}`
    );
  }

  // V19 file size budget; warn over SCENARIO_WARN_BYTES.
  {
    const b = sc.fileBytes;
    const max = profile.scenarioMaxBytes;
    const ok = b <= max;
    const warn = b > SCENARIO_WARN_BYTES ? `; warn: over ${SCENARIO_WARN_BYTES / 1e6} MB` : '';
    const detail = Number.isNaN(b)
      ? fileProblem
      : extras.stableDetail
        ? `parcels.bin ${ok ? 'within' : 'over'} budget${warn}`
        : `parcels.bin ${b}/${max} B${warn}`;
    add('V19', ok, detail);
  }

  // V20 projects.json (project-records spec §4.9): the T3 validator against the chunk parcels.
  {
    const file = join(outDir, PROJECTS_JSON);
    if (extras.asOf === undefined) add('V20', false, 'snapshot day (asOf) not given');
    else if (!existsSync(file)) add('V20', false, `${PROJECTS_JSON} is missing`);
    else {
      out.push(
        checkV20(readFileSync(file), {
          asOf: extras.asOf,
          parcelIds: new Set(recs.map((r) => r.id)),
          maxBytes: profile.projectsMaxBytes,
          warnBytes: profile.projectsWarnBytes
        })
      );
    }
  }

  // V21–V24: measured by the project-records step.
  for (const id of PROJECT_CHECK_IDS) {
    const r = extras.projectChecks?.find((x) => x.id === id);
    out.push(r ? { id, ok: r.ok, detail: r.detail } : { id, ok: false, detail: 'not measured' });
  }

  // V25–V27 calibration.json (stage-calibration spec §4.10), from the files; then V28, V29 from
  // the calibration step.
  out.push(...checkCalibrationFiles(outDir));
  for (const id of CALIBRATION_CHECK_IDS) {
    const r = extras.calibrationChecks?.find((x) => x.id === id);
    out.push(r ? { id, ok: r.ok, detail: r.detail } : { id, ok: false, detail: 'not measured' });
  }

  // V30 data-quality registry (T14): every rule reports; live shares within failShare.
  out.push(checkV30(c, profile));
  return out;
}
