// `npm run pipeline -- lesscars-basemap`: can the basemap's roads on the /lesscars freeway
// removals be hidden by feature id (verdict `ids`) or must the tiles step split them out
// (verdict `split`)? Report mode prints the per-zoom evidence; `candidates` proposes the id list
// (basemap-ids.candidates.json) from the freeway-land catalog's removed segments. It never writes
// the curated basemap-ids.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LC, LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import { BASEMAP_IDS_CANDIDATES_JSON, type BasemapIdsFile } from '../lib/lesscars/basemap-ids';
import { idVerdict, roadsNear } from '../lib/lesscars/basemap-roads';
import { readFreewayLand } from '../lib/lesscars/freeway-land';
import { loadLockedStreets } from '../lib/lesscars/streets';
import { readLock } from '../lib/lock';

type Geo = { type: string; coordinates?: unknown; features?: Geo[]; geometry?: Geo };

function linesOf(g: Geo | null | undefined): [number, number][][] {
  if (!g) return [];
  if (g.type === 'FeatureCollection') return (g.features ?? []).flatMap((f) => linesOf(f));
  if (g.type === 'Feature') return linesOf(g.geometry);
  if (g.type === 'LineString') return [g.coordinates as [number, number][]];
  if (g.type === 'MultiLineString') return g.coordinates as [number, number][][];
  return [];
}

export async function lesscarsBasemap(a: {
  mode: 'report' | 'candidates';
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
}): Promise<number> {
  if (a.mode === 'candidates') return candidates(a);
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
