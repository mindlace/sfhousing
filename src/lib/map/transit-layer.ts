// Transit network -> map data (transit spec §6.1). Pure apart from the fetch.
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { decodeTransit } from '$lib/data/transit-codec';
import {
  accessBin,
  gridLngLat,
  sb79Tier,
  stopCapacity,
  stopClass,
  stopService,
  type AccessGrid,
  type ModeId,
  type StopClass,
  type StopService,
  type TransitNetwork
} from '$lib/transit';

export interface TransitView {
  net: TransitNetwork;
  service: StopService;
  cap: Float64Array;
}

export interface StopProps {
  i: number;
  cls: StopClass;
  cap: number;
  /** log10(cap), floored at 0; drives the marker radius. */
  lc: number;
  name: string;
}

export function transitView(net: TransitNetwork): TransitView {
  const service = stopService(net);
  return { net, service, cap: stopCapacity(net, service) };
}

export async function loadTransitNetwork(
  url: string,
  fetchFn: (u: string) => Promise<Response> = (u) => fetch(u)
): Promise<TransitNetwork> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`transit ${url}: HTTP ${res.status}`);
  return decodeTransit(await res.text());
}

export function stopsCollection(t: TransitView): FeatureCollection<Point, StopProps> {
  return {
    type: 'FeatureCollection',
    features: t.net.stops.map((s, i) => ({
      type: 'Feature',
      properties: {
        i,
        cls: stopClass(t.service[i]),
        cap: t.cap[i],
        lc: Math.log10(Math.max(1, t.cap[i])),
        name: s.name
      },
      geometry: { type: 'Point', coordinates: [s.lngLat[0], s.lngLat[1]] }
    }))
  };
}

/** One rectangle per run of equal non-zero bins along a grid row. */
export function accessCollection(grid: AccessGrid): FeatureCollection<Polygon, { b: number }> {
  const features: Feature<Polygon, { b: number }>[] = [];
  const size = grid.sizeM;
  for (let r = 0; r < grid.rows; r++) {
    const y0 = r * size;
    const y1 = y0 + size;
    let c = 0;
    while (c < grid.cols) {
      const b = accessBin(grid.values[r * grid.cols + c]);
      let e = c + 1;
      while (e < grid.cols && accessBin(grid.values[r * grid.cols + e]) === b) e++;
      if (b > 0) {
        const x0 = c * size;
        const x1 = e * size;
        const ring = [
          gridLngLat(grid, x0, y0),
          gridLngLat(grid, x1, y0),
          gridLngLat(grid, x1, y1),
          gridLngLat(grid, x0, y1),
          gridLngLat(grid, x0, y0)
        ];
        features.push({
          type: 'Feature',
          properties: { b },
          geometry: { type: 'Polygon', coordinates: [ring] }
        });
      }
      c = e;
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Tooltip mode groups, most significant first (San Francisco's operators per mode). */
const MODE_LABEL: Record<ModeId, string> = {
  'heavy-rail': 'BART',
  'commuter-rail': 'Caltrain',
  'light-rail': 'Muni Metro',
  streetcar: 'Streetcar',
  'cable-car': 'Cable car',
  bus: 'Bus'
};
const MODE_ORDER = Object.keys(MODE_LABEL) as ModeId[];

const nf = new Intl.NumberFormat('en-US');
const natural = new Intl.Collator('en', { numeric: true }).compare;

/** Name; routes grouped by mode, peak capacity and the estimated SB 79 tier (spec §6.1). */
export function stopTooltipLines(t: TransitView, i: number): [string, string] {
  const byMode = new Map<ModeId, Set<string>>();
  for (const e of t.service[i]) {
    if (!byMode.has(e.mode)) byMode.set(e.mode, new Set());
    byMode.get(e.mode)!.add(e.routeName);
  }
  const parts = MODE_ORDER.filter((m) => byMode.has(m)).map(
    (m) => `${MODE_LABEL[m]} ${[...byMode.get(m)!].sort(natural).join(', ')}`
  );
  parts.push(`~${nf.format(Math.round(t.cap[i] / 10) * 10)} riders/hr at peak`);
  const tier = sb79Tier(t.net, i, t.service);
  if (tier !== null) parts.push(`SB 79 tier ${tier} (est.)`);
  return [t.net.stops[i].name, parts.join(' · ')];
}
