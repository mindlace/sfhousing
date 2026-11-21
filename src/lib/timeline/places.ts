/**
 * Neighbourhood names for Activity's list: the published `neighborhoods.geojson` (in every
 * manifest), parsed by the levers' own reader, and a point-in-shape lookup. Pure TS.
 */
import { parseNeighborhoods, type NeighborhoodShapes } from '$lib/sim/levers/brushes';

type Shape = NeighborhoodShapes[number];
type Box = [minX: number, minY: number, maxX: number, maxY: number];

/** Each shape's bounding box, once per shape object. */
const boxes = new WeakMap<Shape, Box>();

function boxOf(s: Shape): Box {
  let b = boxes.get(s);
  if (b) return b;
  b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of s.rings)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      }
  boxes.set(s, b);
  return b;
}

/** Even-odd over every ring of the multipolygon (holes and separate parts alike). */
function inShape(s: Shape, x: number, y: number): boolean {
  const b = boxOf(s);
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let inside = false;
  for (const poly of s.rings)
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
  return inside;
}

/** The name of the first shape whose rings hold the point (even-odd), else null. */
export function placeOf(
  shapes: NeighborhoodShapes,
  lngLat: readonly [number, number]
): string | null {
  for (const s of shapes) if (inShape(s, lngLat[0], lngLat[1])) return s.name;
  return null;
}

/** Fetch and parse; null on any failure (the list then shows no place). */
export async function loadPlaces(
  url: string,
  fetchFn: typeof fetch = (u) => fetch(u)
): Promise<NeighborhoodShapes | null> {
  try {
    const r = await fetchFn(url);
    if (!r.ok) return null;
    return parseNeighborhoods(await r.json());
  } catch {
    return null;
  }
}
