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
import { BBOX, type InvariantProfile } from '../config';
import { pointStrictlyInside } from '../lib/rings';
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
}

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
/** V17: at least this share of eligible parcels is hostable (spec §4.10, tier 4 check bound). */
const HOSTABLE_MIN = 0.5;
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

/** Max without spreading (spread overflows the call stack at ~150k elements). */
export function maxOf(xs: readonly number[]): number {
  return xs.reduce((a, b) => (b > a ? b : a), -Infinity);
}

/**
 * Spec §4.9 invariants V1–V13 and transit spec §4.3 V14 over a built dataset directory.
 * Never throws.
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
  const eligible = recs.filter((r) => r.eligible);
  const eligibleById = new Map(recs.map((r) => [r.id, r.eligible]));
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
      ? eligible.filter((r) => {
          const i = p.index.get(r.id);
          return i !== undefined && p.districts[p.district[i]] !== '';
        }).length
      : 0;
    const share = ratio(withDistrict, eligible.length);
    addProblems(
      'V16',
      [
        fileProblem,
        parseFail === 0 ? '' : `scenario.height.parse_fail ${parseFail} ≠ 0`,
        p && !(share >= profile.heightJoinMin)
          ? `eligible with a district ${pct(share)} < ${thr(profile.heightJoinMin)}`
          : ''
      ],
      `0 parse failures; eligible with a district ${withDistrict}/${eligible.length} ≥ ${thr(profile.heightJoinMin)}`
    );
  }

  // V17 fill levels, no clamped u16, hostable masks, non-LP base = FZP, hostable share; warn on
  // the FZP net capacity cross-check.
  {
    const clamped = c['scenario.yield.clamped'];
    const nonlp = c['scenario.yield.nonlp_base_mismatch'];
    const problems = [
      fileProblem,
      clamped === 0 ? '' : `scenario.yield.clamped ${clamped} ≠ 0`,
      nonlp === 0 ? '' : `scenario.yield.nonlp_base_mismatch ${nonlp} ≠ 0`
    ];
    let hostable = 0;
    if (p) {
      const fl = p.fillLevels;
      if (fl.length !== FILL_LEVELS.length || FILL_LEVELS.some((v, k) => fl[k] !== v))
        problems.push(`fillLevels [${fl.join(', ')}] ≠ FILL_LEVELS`);
      const F = fl.length;
      let badH = 0;
      let badB = 0;
      for (let i = 0; i < p.count; i++) {
        const elig = eligibleById.get(p.id[i]) ?? false;
        const h = elig && p.envelopeStories[i] >= 1 && p.yield[i * F + F - 1] > 0;
        const hb = elig && p.baseStories[i] >= 1 && p.baseYield[i * F + F - 1] > 0;
        if (p.hostable[i] !== (h ? 1 : 0)) badH++;
        if (p.hostableBase[i] !== (hb ? 1 : 0)) badB++;
        hostable += p.hostable[i];
      }
      if (badH) problems.push(`${badH} hostable flag(s) disagree with eligibility and yield`);
      if (badB) problems.push(`${badB} hostableBase flag(s) disagree with eligibility and yield`);
      const share = ratio(hostable, eligible.length);
      if (!(share >= HOSTABLE_MIN))
        problems.push(`hostable ${pct(share)} of eligible < ${thr(HOSTABLE_MIN)}`);
    }
    const net = c['scenario.yield.fzp_net_total'];
    const [lo, hi] = FZP_NET_BAND.map((x) => x * FZP_NET_CAPACITY);
    const warn =
      net >= lo && net <= hi
        ? ''
        : `; warn: FZP net capacity ${net} outside [${lo}, ${hi}] (Planning ~${FZP_NET_CAPACITY}, tier 1)`;
    addProblems('V17', problems, `hostable ${hostable}/${eligible.length} eligible${warn}`);
  }

  // V18 panel covers every roll year; latest-year roll join; Σ units; panel = T11 features.
  {
    const panelYears = c['scenario.panel.years'];
    const rollYears = c['scenario.roll.years'];
    const matched = c['scenario.roll.latest_eligible_matched'];
    const unitsTotal = c['scenario.units.total'];
    const mismatch = c['scenario.panel.feature_mismatch'];
    const share = ratio(matched, eligible.length);
    const [ulo, uhi] = profile.scenarioUnitsRange;
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
        mismatch === 0 ? '' : `scenario.panel.feature_mismatch ${mismatch} ≠ 0`
      ],
      `${panelYears} roll years; eligible with a latest-year roll row ${matched}/${eligible.length}; Σ units ${unitsTotal} in [${ulo}, ${uhi}]`
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
  return out;
}
