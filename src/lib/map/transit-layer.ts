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

/**
 * One map marker: a station (GTFS BART and Caltrain stops are platforms, one per direction) or a
 * stop with no station. Capacity and class are over all member stops.
 */
export interface StopMarker {
  /** Member stop indices, ascending. */
  stops: number[];
  lngLat: [number, number];
  name: string;
  cls: StopClass;
  cap: number;
}

export interface TransitView {
  net: TransitNetwork;
  service: StopService;
  cap: Float64Array;
  markers: StopMarker[];
}

export interface StopProps {
  /** Index into `TransitView.markers`. */
  i: number;
  cls: StopClass;
  cap: number;
  /** log10(cap), floored at 0; drives the marker radius. */
  lc: number;
  name: string;
}

export function transitView(net: TransitNetwork): TransitView {
  const service = stopService(net);
  const cap = stopCapacity(net, service);
  return { net, service, cap, markers: stopMarkers(net, service, cap) };
}

/** The leading words every name shares, else the first name. */
function stationName(names: string[]): string {
  const words = names.map((n) => n.split(/\s+/));
  const common: string[] = [];
  for (let k = 0; words.every((w) => k < w.length && w[k] === words[0][k]); k++) {
    common.push(words[0][k]);
  }
  return common.length ? common.join(' ') : names[0];
}

function stopMarkers(net: TransitNetwork, service: StopService, cap: Float64Array): StopMarker[] {
  const groups: number[][] = [];
  const byStation = new Map<string, number[]>();
  net.stops.forEach((s, i) => {
    const g = s.stationId === null ? undefined : byStation.get(s.stationId);
    if (g) {
      g.push(i);
    } else {
      groups.push([i]);
      if (s.stationId !== null) byStation.set(s.stationId, groups[groups.length - 1]);
    }
  });
  return groups.map((stops) => {
    let lng = 0;
    let lat = 0;
    let c = 0;
    for (const i of stops) {
      lng += net.stops[i].lngLat[0];
      lat += net.stops[i].lngLat[1];
      c += cap[i];
    }
    return {
      stops,
      lngLat: [lng / stops.length, lat / stops.length],
      name: stationName(stops.map((i) => net.stops[i].name)),
      cls: stopClass(stops.flatMap((i) => service[i])),
      cap: c
    };
  });
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
    features: t.markers.map((m, i) => ({
      type: 'Feature',
      properties: { i, cls: m.cls, cap: m.cap, lc: Math.log10(Math.max(1, m.cap)), name: m.name },
      geometry: { type: 'Point', coordinates: [m.lngLat[0], m.lngLat[1]] }
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

/**
 * Marker `i` (`StopProps.i`): name; routes grouped by mode, peak capacity and the estimated SB 79
 * tier (spec §6.1), over every platform of a station.
 */
export function stopTooltipLines(t: TransitView, i: number): [string, string] {
  const m = t.markers[i];
  const byMode = new Map<ModeId, Set<string>>();
  for (const e of m.stops.flatMap((s) => t.service[s])) {
    if (!byMode.has(e.mode)) byMode.set(e.mode, new Set());
    byMode.get(e.mode)!.add(e.routeName);
  }
  const parts = MODE_ORDER.filter((m) => byMode.has(m)).map(
    (m) => `${MODE_LABEL[m]} ${[...byMode.get(m)!].sort(natural).join(', ')}`
  );
  parts.push(`~${nf.format(Math.round(m.cap / 10) * 10)} riders/hr at peak`);
  // sb79Tier already counts over the whole station.
  const tier = sb79Tier(t.net, m.stops[0], t.service);
  if (tier !== null) parts.push(`SB 79 tier ${tier} (est.)`);
  return [m.name, parts.join(' · ')];
}
