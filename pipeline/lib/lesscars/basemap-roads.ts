// Which protomaps `roads` features of the basemap lie on the /lesscars freeway removals, and can
// they be hidden by feature id at every zoom the page shows? (docs/dev/lesscars.md "Basemap ids".)
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PMTiles } from 'pmtiles';
import { NodeFileSource } from '../pmtiles-file';
import { tileBounds } from '../../sources/land';

/** The zooms SimMap shows the basemap at: 11 (camera minimum) to the archive's maxzoom 15. */
export const BASEMAP_ZOOMS = [11, 12, 13, 14, 15] as const;

export interface RoadPiece {
  id: number; // the feature id as the tile stores it (OSM-derived, up to ~3.6e13)
  z: number;
  kind: string; // protomaps `kind`: highway, major_road, …
  isLink: boolean;
  ref: string | null;
  name: string | null;
  /** Length of the feature with this id at this zoom over every tile of the archive, m. */
  lengthM: number;
  /** Of that, the length within bandM of the lines, m. */
  inBandM: number;
}

const SAMPLE_M = 5;
const M_PER_DEG = 111_320;

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

type Pt = [number, number];

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

interface Acc {
  kind: string;
  isLink: boolean;
  ref: string | null;
  name: string | null;
  lengthM: number;
  inBandM: number;
}

/** Features of the `roads` layer coming within bandM of `lines` ([lng, lat]), per zoom. */
export async function roadsNear(a: {
  pmtiles: string;
  lines: [number, number][][];
  bandM: number;
  zooms?: readonly number[]; // default BASEMAP_ZOOMS
}): Promise<RoadPiece[]> {
  const zooms = a.zooms ?? BASEMAP_ZOOMS;
  const pts = a.lines.flat();
  if (pts.length === 0) return [];
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const meanLat = lats.reduce((s, v) => s + v, 0) / lats.length;
  // equirectangular projection at the lines' mean latitude: lng/lat to metres
  const kx = M_PER_DEG * Math.cos((meanLat * Math.PI) / 180);
  const proj = (p: Pt): Pt => [p[0] * kx, p[1] * M_PER_DEG];
  const dLat = a.bandM / M_PER_DEG;
  const dLng = a.bandM / kx;
  const bbox = [
    Math.min(...lngs) - dLng,
    Math.min(...lats) - dLat,
    Math.max(...lngs) + dLng,
    Math.max(...lats) + dLat
  ];
  const mlines = a.lines.map((l) => l.map(proj));
  const nearLines = (p: Pt) => {
    for (const l of mlines)
      for (let i = 1; i < l.length; i++) if (distToSeg(p, l[i - 1], l[i]) <= a.bandM) return true;
    return false;
  };

  const pm = new PMTiles(new NodeFileSource(a.pmtiles));
  const h = await pm.getHeader();
  const out: RoadPiece[] = [];

  for (const z of zooms) {
    const accs = new Map<number, Acc>();
    const tileRange = (w: number, s: number, e: number, n: number) => ({
      x0: tileX(w, z),
      x1: tileX(e, z),
      y0: tileY(n, z),
      y1: tileY(s, z)
    });

    /** Visit every road line feature of a tile with the segments whose midpoint is in the tile. */
    const scan = async (
      x: number,
      y: number,
      visit: (id: number, props: Record<string, unknown>, segs: [Pt, Pt][]) => void
    ) => {
      const t = await pm.getZxy(z, x, y);
      if (!t) return;
      const layer = new VectorTile(new Pbf(new Uint8Array(t.data))).layers.roads;
      if (!layer) return;
      const [w, s, e, n] = tileBounds(z, x, y);
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 2 || f.id === undefined || !Number.isSafeInteger(f.id)) continue;
        const g = f.toGeoJSON(x, y, z).geometry as { type: string; coordinates: unknown };
        const parts = (g.type === 'LineString' ? [g.coordinates] : g.coordinates) as Pt[][];
        const segs: [Pt, Pt][] = [];
        for (const part of parts)
          for (let k = 1; k < part.length; k++) {
            const mx = (part[k - 1][0] + part[k][0]) / 2;
            const my = (part[k - 1][1] + part[k][1]) / 2;
            // a segment belongs to the tile its midpoint is in, so tile buffers count once
            if (mx >= w && mx < e && my >= s && my < n) segs.push([part[k - 1], part[k]]);
          }
        if (segs.length > 0) visit(f.id, f.properties, segs);
      }
    };

    // Pass 1: tiles meeting the lines' bbox plus the band give the candidate ids and in-band lengths.
    const r1 = tileRange(bbox[0], bbox[1], bbox[2], bbox[3]);
    for (let x = r1.x0; x <= r1.x1; x++)
      for (let y = r1.y0; y <= r1.y1; y++)
        await scan(x, y, (id, props, segs) => {
          let inBand = 0;
          for (const [p, q] of segs) {
            const pa = proj(p);
            const pb = proj(q);
            const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
            const n = Math.max(1, Math.ceil(len / SAMPLE_M));
            let hit = 0;
            for (let s = 0; s < n; s++) {
              const u = (s + 0.5) / n;
              if (nearLines([pa[0] + u * (pb[0] - pa[0]), pa[1] + u * (pb[1] - pa[1])])) hit++;
            }
            inBand += (len * hit) / n;
          }
          if (inBand <= 0) return;
          const acc = accs.get(id) ?? {
            kind: String(props.kind ?? ''),
            isLink: props.is_link === true || props.is_link === 'true' || props.is_link === 1,
            ref: props.ref == null ? null : String(props.ref),
            name: props.name == null ? null : String(props.name),
            lengthM: 0,
            inBandM: 0
          };
          acc.inBandM += inBand;
          accs.set(id, acc);
        });

    // Pass 2: every tile of the zoom in the header bounds sums the candidates' full lengths.
    if (accs.size > 0) {
      const r2 = tileRange(h.minLon, h.minLat, h.maxLon, h.maxLat);
      for (let x = r2.x0; x <= r2.x1; x++)
        for (let y = r2.y0; y <= r2.y1; y++)
          await scan(x, y, (id, _props, segs) => {
            const acc = accs.get(id);
            if (!acc) return;
            for (const [p, q] of segs) {
              const pa = proj(p);
              const pb = proj(q);
              acc.lengthM += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
            }
          });
    }

    for (const [id, acc] of accs) {
      // the two passes sum the same segments, so in-band never exceeds length; clamp float noise
      out.push({ id, z, ...acc, inBandM: Math.min(acc.inBandM, acc.lengthM) });
    }
  }
  return out;
}

export interface ZoomVerdict {
  z: number;
  ok: boolean;
  mixed: RoadPiece[];
}

/** One entry per zoom of `zooms` (default BASEMAP_ZOOMS), a zoom with no pieces included: ok when
 *  no `highway` piece has an in-band share in [lo, hi) (defaults 0.1, 0.9). */
export function idVerdict(
  pieces: readonly RoadPiece[],
  opts: { lo?: number; hi?: number; zooms?: readonly number[] } = {}
): ZoomVerdict[] {
  const lo = opts.lo ?? 0.1;
  const hi = opts.hi ?? 0.9;
  return (opts.zooms ?? BASEMAP_ZOOMS).map((z) => {
    const mixed = pieces.filter((p) => {
      if (p.z !== z || p.kind !== 'highway' || p.lengthM <= 0) return false;
      const share = p.inBandM / p.lengthM;
      return share >= lo && share < hi;
    });
    return { z, ok: mixed.length === 0, mixed };
  });
}
