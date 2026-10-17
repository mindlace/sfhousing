import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { decodeTransit } from '../../src/lib/data/transit-codec';
import type { Day } from '../../src/lib/timelapse/time';
import { BBOX, type InvariantProfile } from '../config';
import { pointStrictlyInside } from '../lib/rings';
import { checkV20 } from '../project-records/invariants';
import { PROJECTS_JSON } from './projects';
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
}

/** The project-records invariants measured in the build, not from the files. */
export const PROJECT_CHECK_IDS = ['V21', 'V22', 'V23', 'V24'] as const;

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
 * Spec §4.9 invariants V1–V13, transit spec §4.3 V14 and project-records spec §4.9 V20 over a
 * built dataset directory, then V21–V24 from `extras.projectChecks`. Never throws.
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
  return out;
}
