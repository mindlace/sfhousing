import type { Layer } from '@deck.gl/core';
import { project } from '$lib/plan';
import { TOKENS, hexToRgba } from '$lib/map/palette';

type RGB = [number, number, number];

const ring = (theme: 'light' | 'dark', token: 'brush-paint' | 'brush-erase'): RGB =>
  hexToRgba(TOKENS[theme][token]).slice(0, 3) as RGB;

/**
 * Ring colours, derived from the `brush-paint` / `brush-erase` map tokens (spec 2026-10-31 §8).
 * Each is >= 3:1 against the map's land, existing-building and replaced-building fills in its
 * theme (WCAG 1.4.11); palette.spec.ts checks it.
 */
export const BRUSH_COLORS: { light: { paint: RGB; erase: RGB }; dark: { paint: RGB; erase: RGB } } =
  {
    light: { paint: ring('light', 'brush-paint'), erase: ring('light', 'brush-erase') },
    dark: { paint: ring('dark', 'brush-paint'), erase: ring('dark', 'brush-erase') }
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
