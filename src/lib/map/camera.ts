import type { BBox } from '$lib/plan';
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
