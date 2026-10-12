import type { Layer } from '@deck.gl/core';
import { project } from '$lib/plan';
import { spacingM } from './sampler';

type RGB = [number, number, number];

/**
 * Ring and swath colours (spec §4.3). Each is ≥ 3:1 against the map's land, existing-building and
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
  swath: [number, number][] | null;
  metersPerPixel: number;
  dark: boolean;
}

// Brush feedback sits above 3D buildings; it must not occlude later map labels.
const OVERLAY_PARAMETERS = { depthCompare: 'always', depthWriteEnabled: false } as const;

const RING_MIN_PX = 4;

/** cos 60°: a vertex that turns the path by more than 60° is sharp. */
const SHARP_TURN_COS = 0.5;

type XY = [number, number];

/** The vertex b's two segment lengths (plan-plane metres), and whether it turns by more than 60°. */
function corner(a: XY, b: XY, c: XY): { la: number; lc: number; sharp: boolean } {
  const [ax, ay] = project(a[0], a[1]);
  const [bx, by] = project(b[0], b[1]);
  const [cx, cy] = project(c[0], c[1]);
  const la = Math.hypot(bx - ax, by - ay);
  const lc = Math.hypot(cx - bx, cy - by);
  const cos = ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) / (la * lc);
  return { la, lc, sharp: la > 0 && lc > 0 && cos < SHARP_TURN_COS };
}

/**
 * The swath path as deck should draw it (drawing only: the op and the sampler are untouched).
 *
 * deck's PathLayer clamps a sharp joint's inner miter by the longer of its two segments and
 * discards the shorter segment's fragments past its end. So at a near-reversal beside a short
 * segment it drops the inner half of the longer segment and draws dark, double-blended wedges and
 * slivers along it: the brush's "line that shoots out, then disappears". The short segment is
 * usually the live tail backing up a few centimetres (pointer jitter, or the start of a reversal),
 * which is why it flickers.
 *
 * - A live tail (a last segment shorter than the kept spacing) that turns sharply is not drawn. It
 *   lies within that spacing (≤ r/2) of the last kept point, so the drawn swath still reaches the
 *   ring, and it is drawn again once it turns gently or is kept.
 * - At every other sharp vertex the longer segment is split so both sides are equally long, which
 *   keeps deck's clamped miter on the shorter segment. It only adds collinear points.
 */
export function swathDrawPath(path: readonly XY[], radiusM: number): XY[] {
  let pts = path;
  const n = pts.length;
  if (n >= 3) {
    const { lc, sharp } = corner(pts[n - 3], pts[n - 2], pts[n - 1]);
    if (sharp && lc < spacingM(radiusM)) pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return pts.slice();
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const { la, lc, sharp } = corner(a, b, c);
    if (sharp && la > lc) {
      const t = lc / la;
      out.push([b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t], b);
    } else if (sharp && lc > la) {
      const t = la / lc;
      out.push(b, [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t]);
    } else {
      out.push(b);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** [] when nothing to draw. Layer ids: 'brush-ring', 'brush-swath' (never generated-/rising-). */
export function buildOverlayLayers(L: OverlayCtors, s: OverlayInput): Layer[] {
  const color = [...BRUSH_COLORS[s.dark ? 'dark' : 'light'][s.tool], 255];
  const layers: Layer[] = [];

  if (s.swath && s.swath.length > 0) {
    // A stamp is a one-point path; doubling it lets the rounded caps draw a disc.
    const path =
      s.swath.length === 1 ? [s.swath[0], s.swath[0]] : swathDrawPath(s.swath, s.radiusM);
    layers.push(
      new L.PathLayer({
        id: 'brush-swath',
        parameters: OVERLAY_PARAMETERS,
        data: [path],
        getPath: (d: unknown) => d,
        widthUnits: 'meters',
        getWidth: 2 * s.radiusM,
        capRounded: true,
        jointRounded: true,
        opacity: 0.25,
        getColor: color
      })
    );
  }

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
