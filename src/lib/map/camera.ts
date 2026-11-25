import type { BBox } from '$lib/plan';
import { SF_GRID_BBOX } from '$lib/transit/grid';
import type { CameraFrame } from './types';

export const CENTER: [number, number] = [-122.4194, 37.7749];
export const CONSTRAINTS = {
  minZoom: 11,
  maxZoom: 18,
  maxPitch: 70,
  maxBounds: [
    [-122.56, 37.69],
    [-122.33, 37.84]
  ] as [[number, number], [number, number]]
};
export const NARROW_PX = 640;

export function defaultFrame(widthPx: number): CameraFrame {
  return widthPx >= NARROW_PX
    ? { center: CENTER, zoom: 13, pitch: 55, bearing: -20 }
    : { center: CENTER, zoom: 12.2, pitch: 45, bearing: -20 };
}

/** The run view fits this: mainland San Francisco, the transit grid's extent. */
export const RUN_BOUNDS: BBox = SF_GRID_BBOX;
/** CSS px kept clear between the city and each side of the box less the bottom inset. */
export const RUN_PAD_PX = 24;
/** The lowest zoom the run view jumps to. */
export const RUN_MIN_ZOOM = 8;

const mercX = (lng: number): number => (lng + 180) / 360;
const mercY = (lat: number): number =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const unX = (x: number): number => x * 360 - 180;
const unY = (y: number): number => {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
};

/** The run view's frame for a map box of this size and bottom inset, in CSS px. */
export function runFrame(widthPx: number, heightPx: number, bottomInset: number): CameraFrame {
  const [west, south, east, north] = RUN_BOUNDS;
  const x0 = mercX(west);
  const x1 = mercX(east);
  const y0 = mercY(north);
  const y1 = mercY(south);
  const freeW = widthPx - 2 * RUN_PAD_PX;
  const freeH = heightPx - bottomInset - 2 * RUN_PAD_PX;
  let zoom = RUN_MIN_ZOOM;
  if (freeW > 0 && freeH > 0) {
    const w0 = (x1 - x0) * 512;
    const h0 = (y1 - y0) * 512;
    zoom = Math.max(RUN_MIN_ZOOM, Math.log2(Math.min(freeW / w0, freeH / h0)));
  }
  return {
    center: [unX((x0 + x1) / 2), unY((y0 + y1) / 2)],
    zoom,
    pitch: 0,
    bearing: 0
  };
}

export type InitialCamera =
  | { kind: 'jump'; frame: CameraFrame }
  | {
      kind: 'fit';
      bounds: [[number, number], [number, number]];
      options: { padding: number; pitch: number; bearing: number; maxZoom: 16; animate: false };
    };

export function initialCamera(
  widthPx: number,
  initialFrame: CameraFrame | 'plan-bbox' | undefined,
  planBBox: BBox | undefined,
  bottomInset: number
): InitialCamera {
  const def = defaultFrame(widthPx);
  if (initialFrame === 'plan-bbox') {
    if (!planBBox) return { kind: 'jump', frame: def };
    return {
      kind: 'fit',
      bounds: [
        [planBBox[0], planBBox[1]],
        [planBBox[2], planBBox[3]]
      ],
      options: {
        padding: 48 + bottomInset,
        pitch: def.pitch,
        bearing: def.bearing,
        maxZoom: 16,
        animate: false
      }
    };
  }
  if (initialFrame) return { kind: 'jump', frame: initialFrame };
  return { kind: 'jump', frame: def };
}

export function pixelRatio(dpr: number): number {
  return Math.min(dpr, 2);
}
