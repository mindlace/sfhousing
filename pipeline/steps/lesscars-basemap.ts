// `npm run pipeline -- lesscars-basemap`: can the basemap's roads on the /lesscars freeway
// removals be hidden by feature id (verdict `ids`) or must the tiles step split them out
// (verdict `split`)? Report mode prints the per-zoom evidence; `candidates` is Task 6.
import { readFileSync } from 'node:fs';
import { idVerdict, roadsNear } from '../lib/lesscars/basemap-roads';
import { LC } from '../lesscars-config';

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
  mode: 'report' | 'candidates'; // 'candidates' is Task 6
  pmtiles: string;
  linesPath?: string; // GeoJSON FeatureCollection of LineStrings, report mode
  bandM?: number; // default LC.basemapBandM
}): Promise<number> {
  if (a.mode !== 'report') {
    console.error('lesscars-basemap: only --report is implemented');
    return 2;
  }
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
