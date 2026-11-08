// `npm run pipeline -- lesscars-basemap`: can the basemap's roads on the /lesscars freeway
// removals be hidden by feature id (verdict `ids`) or must the tiles step split them out
// (verdict `split`)? Report mode prints the per-zoom evidence; `candidates` proposes the id list
// (basemap-ids.candidates.json) from the freeway-land catalog's removed segments; `--split` runs
// the tiles split over the raw basemap and lists, per phase, what moves to `roads_lc`. It never
// writes the curated basemap-ids.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { VectorTile, type VectorTileLayer } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PMTiles } from 'pmtiles';
import { LC, LESSCARS_BASEMAP_IDS_JSON, LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import { openDuck } from '../lib/duck';
import {
  BASEMAP_IDS_CANDIDATES_JSON,
  readBasemapIds,
  type BasemapIdsFile
} from '../lib/lesscars/basemap-ids';
import { BASEMAP_ZOOMS, idVerdict, roadsNear } from '../lib/lesscars/basemap-roads';
import {
  alongDist,
  freewayRoad,
  keptOnlyRefs,
  LC_ROADS_LAYER,
  splitPhasesOf,
  splitRoadsTile,
  tileSegs,
  world,
  type Seg,
  type SplitPhase
} from '../lib/lesscars/basemap-split';
import { NodeFileSource } from '../lib/pmtiles-file';
import { readFreewayLand } from '../lib/lesscars/freeway-land';
import { loadLockedStreets } from '../lib/lesscars/streets';
import { readLock } from '../lib/lock';

type Pt = [number, number];
type Geo = { type: string; coordinates?: unknown; features?: Geo[]; geometry?: Geo };

function linesOf(g: Geo | null | undefined): [number, number][][] {
  if (!g) return [];
  if (g.type === 'FeatureCollection') return (g.features ?? []).flatMap((f) => linesOf(f));
  if (g.type === 'Feature') return linesOf(g.geometry);
  if (g.type === 'LineString') return [g.coordinates as [number, number][]];
  if (g.type === 'MultiLineString') return g.coordinates as [number, number][][];
  return [];
}

/** One feature id's pieces moved to `roads_lc` for a phase, metres per zoom. */
export interface SplitRow {
  project: string;
  id: number;
  kind: string;
  kindDetail: string | null;
  ref: string | null;
  movedM: Record<number, number>;
}

/** What the tiles split does to the basemap, per phase (lesscars-basemap --split). */
export interface SplitReport {
  rows: SplitRow[];
  /** Freeway-road metres left in `roads` along a removed line, nearer it than any kept line. */
  leftM: { project: string; z: number; id: number; ref: string | null; m: number }[];
  /**
   * Kept coverage lost: per kept segment and zoom, the metres of its CNN lines that a freeway road
   * in `roads` drew within COVER_M before the split and none does after (a kept road hidden). It
   * does not use the split rule's comparisons, so a kept road drawn nearer a removed line shows.
   */
  keptLostM: { segment: string; z: number; m: number }[];
}

const CHECK_M = 8;
/** A kept CNN line point is drawn when a freeway road lies within this, metres (any direction). */
export const COVER_M = 15;
/** The --split report fails when a kept segment loses more coverage than this at a zoom, metres. */
export const KEPT_LOSS_MAX_M = 30;
/** Sampling step along a kept CNN line for the coverage measure, metres. */
const COVER_STEP_M = 4;
const EARTH_M = 2 * Math.PI * 6_378_137;
const tileXOf = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileYOf = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/**
 * Runs the tiles split (splitRoadsTile, as `writeBasemap` does) over the raw basemap's tiles near
 * the phases' corridors at BASEMAP_ZOOMS and measures, per phase: the features moved to
 * `roads_lc`; freeway roads left in `roads` along a removed line; and, per kept segment, the
 * coverage of its CNN lines the split takes away (`keptLostM`). Lengths count each segment in the
 * tile holding its midpoint, so tile buffers count once.
 */
export async function splitReport(a: {
  pmtiles: string;
  phases: SplitPhase[];
  /** The kept catalog segments with their CNN lines. */
  kept: { id: string; lines: [number, number][][] }[];
  keepRefs?: string[];
  checkM?: number;
}): Promise<SplitReport> {
  const keepLines = a.kept.flatMap((k) => k.lines);
  const checkM = a.checkM ?? CHECK_M;
  const pm = new PMTiles(new NodeFileSource(a.pmtiles));
  const pts = a.phases.flatMap((p) => p.corridor.flat());
  const [w, s, e, n] = [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1]))
  ];
  const rows = new Map<string, SplitRow>();
  const left = new Map<string, SplitReport['leftM'][number]>();
  const keptLost = new Map<string, SplitReport['keptLostM'][number]>();
  const cosT = Math.cos((LC.basemapParallelDeg * Math.PI) / 180);
  const add = <T extends { m: number }>(m: Map<string, T>, k: string, v: Omit<T, 'm'>, d: number) =>
    m.set(k, { ...(v as T), m: (m.get(k)?.m ?? 0) + d });
  for (const z of BASEMAP_ZOOMS) {
    const clip = LC.basemapClipZooms.includes(z);
    for (let x = tileXOf(w, z); x <= tileXOf(e, z); x++)
      for (let y = tileYOf(n, z); y <= tileYOf(s, z); y++) {
        const t = await pm.getZxy(z, x, y);
        if (!t) continue;
        const raw = new Uint8Array(t.data);
        const out = splitRoadsTile(raw, z, x, y, a.phases, clip, {
          keep: keepLines,
          keepRefs: a.keepRefs ?? []
        });
        if (out === null) continue;
        const vt = new VectorTile(new Pbf(out));
        const extent = vt.layers.roads?.extent ?? 4096;
        const latC = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
        const mPerUnit = (EARTH_M * Math.cos(latC)) / (2 ** z * extent);
        const band = checkM / mPerUnit;
        const segsOf = (lines: [number, number][][]) =>
          tileSegs(
            lines.map((l) => l.map(world)),
            2 ** z,
            x,
            y,
            extent,
            band
          );
        const removed = a.phases.map((p) => ({ project: p.projectId, segs: segsOf(p.lines) }));
        const kept = segsOf(keepLines);
        // Kept coverage: sample each kept segment's lines; a point is drawn when a freeway road
        // of `roads` lies within COVER_M of it, in any direction (cos threshold 0).
        const coverBand = COVER_M / mPerUnit;
        const roadSegs = (layer: VectorTileLayer | undefined) => {
          const segs: Seg[] = [];
          for (let i = 0; i < (layer?.length ?? 0); i++) {
            const f = layer!.feature(i);
            if (f.type !== 2 || !freewayRoad(f.properties)) continue;
            for (const part of f.loadGeometry())
              for (let k = 1; k < part.length; k++) {
                const [p, q] = [part[k - 1], part[k]];
                const len = Math.hypot(q.x - p.x, q.y - p.y);
                if (len > 0)
                  segs.push({
                    a: [p.x, p.y],
                    b: [q.x, q.y],
                    ux: (q.x - p.x) / len,
                    uy: (q.y - p.y) / len
                  });
              }
          }
          return segs;
        };
        const before = roadSegs(new VectorTile(new Pbf(raw)).layers.roads);
        const after = roadSegs(vt.layers.roads);
        const stepU = COVER_STEP_M / mPerUnit;
        for (const k of a.kept)
          for (const sg of segsOf(k.lines)) {
            const len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
            const steps = Math.max(1, Math.ceil(len / stepU));
            for (let j = 0; j < steps; j++) {
              const t = (j + 0.5) / steps;
              const p: Pt = [sg.a[0] + t * (sg.b[0] - sg.a[0]), sg.a[1] + t * (sg.b[1] - sg.a[1])];
              if (p[0] < 0 || p[0] >= extent || p[1] < 0 || p[1] >= extent) continue;
              if (alongDist(p, 1, 0, before, coverBand, 0) === Infinity) continue;
              if (alongDist(p, 1, 0, after, coverBand, 0) !== Infinity) continue;
              const key = `${k.id} ${z}`;
              keptLost.set(key, {
                segment: k.id,
                z,
                m: (keptLost.get(key)?.m ?? 0) + (len / steps) * mPerUnit
              });
            }
          }
        /** The removed line along a piece nearest it (within checkM), and its distance. */
        const nearestRemoved = (mid: Pt, u: Pt) => {
          let best: { project: string | null; d: number } = { project: null, d: Infinity };
          for (const r of removed) {
            const d = alongDist(mid, u[0], u[1], r.segs, band, cosT);
            if (d < best.d) best = { project: r.project, d };
          }
          return best;
        };
        /** Visit each in-tile segment of a layer's line features with its length in metres. */
        const visit = (
          layer: string,
          f: (props: Record<string, unknown>, id: number, mid: Pt, u: Pt, m: number) => void
        ) => {
          const l = vt.layers[layer];
          for (let i = 0; i < (l?.length ?? 0); i++) {
            const feat = l!.feature(i);
            if (feat.type !== 2 || feat.id === undefined) continue;
            for (const part of feat.loadGeometry())
              for (let k = 1; k < part.length; k++) {
                const [p, q] = [part[k - 1], part[k]];
                const mid: Pt = [(p.x + q.x) / 2, (p.y + q.y) / 2];
                if (mid[0] < 0 || mid[0] >= extent || mid[1] < 0 || mid[1] >= extent) continue;
                const len = Math.hypot(q.x - p.x, q.y - p.y);
                if (len === 0) continue;
                const u: Pt = [(q.x - p.x) / len, (q.y - p.y) / len];
                f(feat.properties, feat.id, mid, u, len * mPerUnit);
              }
          }
        };
        const str = (v: unknown) => (v == null ? null : String(v));
        visit(LC_ROADS_LAYER, (props, id, mid, u, m) => {
          const project = String(props.lc_project);
          const key = `${project} ${id}`;
          const row = rows.get(key) ?? {
            project,
            id,
            kind: String(props.kind ?? ''),
            kindDetail: str(props.kind_detail),
            ref: str(props.ref),
            movedM: {}
          };
          row.movedM[z] = (row.movedM[z] ?? 0) + m;
          rows.set(key, row);
        });
        visit('roads', (props, id, mid, u, m) => {
          // a road with only kept-only refs (I-280) is a kept freeway, never left behind
          const refs = typeof props.ref === 'string' ? props.ref.split(';') : [];
          if (!freewayRoad(props)) return;
          if (refs.length > 0 && refs.every((t) => (a.keepRefs ?? []).includes(t.trim()))) return;
          const r = nearestRemoved(mid, u);
          if (r.project !== null && r.d < alongDist(mid, u[0], u[1], kept, band, cosT))
            add(
              left,
              `${r.project} ${z} ${id}`,
              { project: r.project, z, id, ref: str(props.ref) },
              m
            );
        });
      }
  }
  const byId = <T extends { project: string; id: number }>(x: T, y: T) =>
    x.project === y.project ? x.id - y.id : x.project < y.project ? -1 : 1;
  return {
    rows: [...rows.values()].sort(byId),
    leftM: [...left.values()].sort((x, y) => byId(x, y) || x.z - y.z),
    keptLostM: [...keptLost.values()].sort((x, y) =>
      x.segment === y.segment ? x.z - y.z : x.segment < y.segment ? -1 : 1
    )
  };
}

export async function lesscarsBasemap(a: {
  mode: 'report' | 'candidates' | 'split';
  pmtiles: string;
  linesPath?: string; // GeoJSON FeatureCollection of LineStrings, report mode
  bandM?: number; // default LC.basemapBandM
  // candidates mode
  lockPath?: string;
  rawDir?: string;
  byName?: boolean; // raw files by lock name (the mini fixture)
  catalogPath?: string; // default the live freeway-land.json
  outPath?: string; // default BASEMAP_IDS_CANDIDATES_JSON
  minShare?: number; // default LC.basemapMinShare
  idsPath?: string; // split mode: default the live basemap-ids.json
}): Promise<number> {
  if (a.mode === 'candidates') return candidates(a);
  if (a.mode === 'split') return split(a);
  if (!a.linesPath) {
    console.error(
      'usage: lesscars-basemap --report --lines <file> [--band <m>] [--pmtiles <file>]'
    );
    return 2;
  }
  const lines = linesOf(JSON.parse(readFileSync(a.linesPath, 'utf8')) as Geo);
  if (lines.length === 0) {
    console.error(`${a.linesPath}: no LineStrings`);
    return 2;
  }
  const bandM = a.bandM ?? LC.basemapBandM;
  const pieces = await roadsNear({ pmtiles: a.pmtiles, lines, bandM });
  const verdicts = idVerdict(pieces);
  for (const v of verdicts) {
    const hw = new Set(pieces.filter((p) => p.z === v.z && p.kind === 'highway').map((p) => p.id));
    console.log(`z${v.z}: ${hw.size} highway ids, ${v.mixed.length} mixed`);
    for (const p of v.mixed)
      console.log(
        `  ${p.id} ${p.ref ?? p.name ?? '-'} ${Math.round(p.inBandM)}/${Math.round(p.lengthM)} m`
      );
  }
  const bad = verdicts.filter((v) => !v.ok).map((v) => v.z);
  console.log(bad.length === 0 ? 'verdict: ids' : `verdict: split (zooms ${bad.join(',')})`);
  return 0;
}

/**
 * The split report: the phases of basemap-ids.json with their catalog segments' CNN lines and the
 * kept segments' lines, split over `pmtiles` (the raw basemap: a built basemap.pmtiles is already
 * split). Prints, per phase, every feature moved to `roads_lc` (id, kind, ref, metres per zoom),
 * then the freeway roads left along a removed line and the kept coverage each kept segment loses
 * per zoom. Exits 1 (FAIL lines) when a segment loses more than KEPT_LOSS_MAX_M at a zoom.
 */
async function split(a: Parameters<typeof lesscarsBasemap>[0]): Promise<number> {
  if (!a.lockPath || !a.rawDir) {
    console.error('lesscars-basemap --split: needs the lock and the raw directory');
    return 2;
  }
  const catalogPath = a.catalogPath ?? LESSCARS_FREEWAY_LAND_JSON.live;
  const catalog = readFreewayLand(catalogPath);
  const ids = readBasemapIds(a.idsPath ?? LESSCARS_BASEMAP_IDS_JSON.live);
  if (!catalog || !ids) {
    console.error('lesscars-basemap --split: needs freeway-land.json and basemap-ids.json');
    return 1;
  }
  let streets: Awaited<ReturnType<typeof loadLockedStreets>>;
  try {
    streets = await loadLockedStreets({
      lockPath: a.lockPath,
      rawDir: a.rawDir,
      byName: a.byName,
      crs: 'EPSG:4326'
    });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  const byCnn = new Map(streets.map((s) => [s.cnn, s.lines]));
  const linesOfSegs = (segs: typeof catalog.segments) =>
    segs.flatMap((s) => s.cnn.flatMap((c) => byCnn.get(c) ?? []));
  const db = await openDuck();
  let phases: SplitPhase[];
  try {
    phases = await splitPhasesOf(
      db,
      ids.phases.map((p) => ({
        ...p,
        lines: linesOfSegs(catalog.segments.filter((s) => s.removedBy === p.project))
      })),
      a.bandM ?? LC.basemapBandM
    );
  } finally {
    db.close();
  }
  const kept = catalog.segments
    .filter((s) => s.removedBy === null)
    .map((s) => ({ id: s.id, lines: linesOfSegs([s]) }));
  const keepRefs = keptOnlyRefs(catalog.segments);
  const r = await splitReport({ pmtiles: a.pmtiles, phases, kept, keepRefs });
  console.log(`kept-only refs (never moved unless listed): ${keepRefs.join(', ') || 'none'}`);
  const zs = BASEMAP_ZOOMS.map((z) => `z${z}`).join(' ');
  for (const p of phases) {
    console.log(`\n${p.projectId}: id kind kind_detail ref | moved m ${zs}`);
    for (const row of r.rows.filter((x) => x.project === p.projectId))
      console.log(
        `  ${row.id} ${row.kind} ${row.kindDetail ?? '-'} ${row.ref ?? '-'} | ` +
          BASEMAP_ZOOMS.map((z) => Math.round(row.movedM[z] ?? 0)).join(' ')
      );
  }
  console.log(`\nfreeway roads left in roads along a removed line (>= 1 m):`);
  for (const x of r.leftM.filter((y) => y.m >= 1))
    console.log(`  ${x.project} z${x.z} ${x.id} ${x.ref ?? '-'} ${Math.round(x.m)} m`);
  const keptRef = (ref: string | null) =>
    ref !== null && ref.split(';').some((t) => keepRefs.includes(t.trim()));
  console.log(`\nroads_lc features with a kept-only ref token:`);
  for (const row of r.rows.filter((x) => keptRef(x.ref)))
    console.log(`  ${row.project} ${row.id} ${row.ref}`);
  console.log(
    `\nkept coverage lost (kept CNN line metres drawn within ${COVER_M} m before the split, ` +
      `not after; limit ${KEPT_LOSS_MAX_M} m per segment and zoom):`
  );
  for (const k of kept) {
    const lost = BASEMAP_ZOOMS.map(
      (z) => r.keptLostM.find((x) => x.segment === k.id && x.z === z)?.m ?? 0
    );
    console.log(
      `  ${k.id} | ${lost.map((m, i) => `z${BASEMAP_ZOOMS[i]} ${Math.round(m)}`).join(' ')}`
    );
  }
  const over = r.keptLostM.filter((x) => x.m > KEPT_LOSS_MAX_M);
  for (const x of over)
    console.log(`FAIL: ${x.segment} loses ${Math.round(x.m)} m of kept coverage at z${x.z}`);
  console.log(over.length === 0 ? 'kept coverage: ok' : `kept coverage: FAIL (${over.length})`);
  return over.length === 0 ? 0 : 1;
}

/** Prettier's JSON layout (the enrichment JSON is prettier-checked). */
async function formatJson(v: unknown): Promise<string> {
  const prettier = await import('prettier');
  return prettier.format(JSON.stringify(v), { parser: 'json', printWidth: 100, tabWidth: 2 });
}

/**
 * For each catalog segment with `removedBy`: the roads pieces whose in-band share is at least
 * `minShare` at any zoom, grouped by (removedBy, ref) into phases.
 */
async function candidates(a: Parameters<typeof lesscarsBasemap>[0]): Promise<number> {
  if (!a.lockPath || !a.rawDir) {
    console.error('lesscars-basemap candidates: needs the lock and the raw directory');
    return 2;
  }
  const catalogPath = a.catalogPath ?? LESSCARS_FREEWAY_LAND_JSON.live;
  const catalog = readFreewayLand(catalogPath);
  if (!catalog) {
    console.error(`no ${catalogPath}: the catalog lists the removed segments to read ids for`);
    return 1;
  }
  if (!existsSync(a.lockPath)) {
    console.error(`no ${a.lockPath}: run \`npm run pipeline -- fetch\` first`);
    return 1;
  }
  const basemap = readLock(a.lockPath).sources.find((s) => s.id === 'protomaps-basemap')?.files[0];
  if (!basemap) {
    console.error('lock has no protomaps-basemap file');
    return 1;
  }
  let streets: Awaited<ReturnType<typeof loadLockedStreets>>;
  try {
    streets = await loadLockedStreets({
      lockPath: a.lockPath,
      rawDir: a.rawDir,
      byName: a.byName,
      crs: 'EPSG:4326'
    });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  const byCnn = new Map(streets.map((s) => [s.cnn, s.lines]));
  const bandM = a.bandM ?? LC.basemapBandM;
  const minShare = a.minShare ?? LC.basemapMinShare;
  const phases = new Map<string, { project: string; ref: string | null; ids: Set<number> }>();
  for (const seg of catalog.segments) {
    if (seg.removedBy === null) continue;
    const lost = seg.cnn.filter((c) => !byCnn.has(c));
    if (lost.length > 0) {
      console.error(`${seg.id}: src_streets lacks CNN ${lost.join(', ')}`);
      return 1;
    }
    const lines = seg.cnn.flatMap((c) => byCnn.get(c)!);
    const pieces = await roadsNear({ pmtiles: a.pmtiles, lines, bandM });
    const key = JSON.stringify([seg.removedBy, seg.ref]);
    const phase = phases.get(key) ?? { project: seg.removedBy, ref: seg.ref, ids: new Set() };
    const before = phase.ids.size;
    for (const p of pieces)
      if (p.lengthM > 0 && p.inBandM / p.lengthM >= minShare) phase.ids.add(p.id);
    phases.set(key, phase);
    console.log(`${seg.id}: ${seg.cnn.length} CNNs, ${phase.ids.size - before} new ids`);
  }
  const out: BasemapIdsFile = {
    schema: 1,
    source: { sha256: basemap.sha256 },
    phases: [...phases.values()].map((p) => ({
      project: p.project,
      ref: p.ref,
      ids: [...p.ids].sort((x, y) => x - y)
    }))
  };
  const outPath = a.outPath ?? BASEMAP_IDS_CANDIDATES_JSON;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, await formatJson(out));
  console.log(`wrote ${outPath}`);
  return 0;
}
