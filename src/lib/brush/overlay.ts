import type { Layer } from '@deck.gl/core';
import { project } from '$lib/plan';

type RGB = [number, number, number];

/**
 * Ring colours (spec §4.3). Each is ≥ 3:1 against the map's land, existing-building and
 * replaced-building fills in its theme (WCAG 1.4.11); overlay.spec.ts checks it.
 */
export const BRUSH_COLORS: { light: { paint: RGB; erase: RGB }; dark: { paint: RGB; erase: RGB } } =
  {
    light: { paint: [29, 78, 216], erase: [190, 24, 93] },
    dark: { paint: [96, 165, 250], erase: [244, 114, 182] }
  };

const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Web Mercator ground resolution with deck.gl's 512 px tiles. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
}

// Metres per degree in the plan-model plane, so the dashed ring matches stroke coverage.
const M_PER_DEG_LNG = project(1, 0)[0] - project(0, 0)[0];
const M_PER_DEG_LAT = project(0, 1)[1] - project(0, 0)[1];

/** An n-gon of radius `radiusM` around `center`, split into n/2 two-point dashes. */
export function dashedCircle(
  center: [number, number],
  radiusM: number,
  n = 64
): [number, number][][] {
  const vertex = (i: number): [number, number] => {
    const a = (2 * Math.PI * i) / n;
    return [
      center[0] + (radiusM * Math.cos(a)) / M_PER_DEG_LNG,
      center[1] + (radiusM * Math.sin(a)) / M_PER_DEG_LAT
    ];
  };
  const dashes: [number, number][][] = [];
  for (let i = 0; i + 1 < n; i += 2) dashes.push([vertex(i), vertex(i + 1)]);
  return dashes;
}

export interface OverlayCtors {
  ScatterplotLayer: new (props: Record<string, unknown>) => Layer;
  PathLayer: new (props: Record<string, unknown>) => Layer;
}

export interface OverlayInput {
  tool: 'paint' | 'erase';
  ring: [number, number] | null;
  radiusM: number;
  metersPerPixel: number;
  dark: boolean;
}

// Brush feedback sits above 3D buildings; it must not occlude later map labels.
const OVERLAY_PARAMETERS = { depthCompare: 'always', depthWriteEnabled: false } as const;

const RING_MIN_PX = 4;

/**
 * [] when there is no ring. Layer id: 'brush-ring' (never generated-/rising-). No stroke swath is
 * drawn (partner ruling 2026-10-12).
 */
export function buildOverlayLayers(L: OverlayCtors, s: OverlayInput): Layer[] {
  const color = [...BRUSH_COLORS[s.dark ? 'dark' : 'light'][s.tool], 255];
  const layers: Layer[] = [];

  if (s.ring) {
    if (s.tool === 'paint') {
      layers.push(
        new L.ScatterplotLayer({
          id: 'brush-ring',
          parameters: OVERLAY_PARAMETERS,
          data: [s.ring],
          getPosition: (d: unknown) => d,
          getRadius: s.radiusM,
          radiusUnits: 'meters',
          radiusMinPixels: RING_MIN_PX,
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          getLineColor: color
        })
      );
    } else {
      // Erase is dashed, so colour is never its only signal (spec §4.8).
      const r = Math.max(s.radiusM, RING_MIN_PX * s.metersPerPixel);
      layers.push(
        new L.PathLayer({
          id: 'brush-ring',
          parameters: OVERLAY_PARAMETERS,
          data: dashedCircle(s.ring, r),
          getPath: (d: unknown) => d,
          widthUnits: 'pixels',
          getWidth: 2,
          getColor: color
        })
      );
    }
  }

  return layers;
}
