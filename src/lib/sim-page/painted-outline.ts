/**
 * Dashed outlines of custom-painted lots, drawn while the eraser is chosen (map overlays spec,
 * "Outlines while erasing"). One outline per lot, since the lot is what the eraser acts on, as
 * metric dashes along each ring (no `PathStyleExtension`, which would be a new dependency).
 * Dashed so colour is never the only signal.
 */
import type { Layer } from '@deck.gl/core';
import type { OverlayCtors } from '$lib/brush/overlay';
import type { LotOutlinesResult } from '$lib/sim/scenario/types';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { TOKENS, hexToRgba } from '$lib/map/palette';
import type { Theme } from '$lib/map/types';

export const OUTLINE_LAYER_ID = 'sim-painted-outline';
export const OUTLINE_DASH_M = 4; // tier 4
export const OUTLINE_GAP_M = 3; // tier 4

type Pt = [number, number];

const lengthM = (a: Pt, b: Pt): number =>
  Math.hypot((b[0] - a[0]) * M_PER_DEG_LNG, (b[1] - a[1]) * M_PER_DEG_LAT);

/** A closed lng/lat ring as dash paths, measured in metres along the ring. */
export function dashRing(ring: Pt[], dashM: number, gapM: number): Pt[][] {
  if (ring.length < 2 || dashM <= 0) return [];
  const pts: Pt[] = [...ring];
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push(first);
  // cum[i]: metres from the start to vertex i
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + lengthM(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];

  const at = (d: number): Pt => {
    let seg = 0;
    while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span === 0 ? 0 : (d - cum[seg]) / span;
    return [
      pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t,
      pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t
    ];
  };

  const dashes: Pt[][] = [];
  const period = dashM + Math.max(gapM, 0);
  for (let s = 0; s < total; s += period) {
    const e = Math.min(s + dashM, total);
    const path: Pt[] = [at(s)];
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s && cum[i] < e) path.push(pts[i]);
    path.push(at(e));
    dashes.push(path);
  }
  return dashes;
}

/** One PathLayer, id 'sim-painted-outline', 2 px, the 'painted-outline' token. */
export function paintedOutlineLayers(
  L: OverlayCtors,
  o: Extract<LotOutlinesResult, { ok: true }>,
  theme: Theme
): Layer[] {
  const paths: Pt[][] = [];
  for (let k = 0; k + 1 < o.starts.length; k++) {
    const ring: Pt[] = [];
    for (let v = o.starts[k]; v < o.starts[k + 1]; v++)
      ring.push([o.positions[2 * v], o.positions[2 * v + 1]]);
    for (const d of dashRing(ring, OUTLINE_DASH_M, OUTLINE_GAP_M)) paths.push(d);
  }
  if (paths.length === 0) return [];
  return [
    new L.PathLayer({
      id: OUTLINE_LAYER_ID,
      data: paths,
      getPath: (d: unknown) => d,
      widthUnits: 'pixels',
      getWidth: 2,
      getColor: hexToRgba(TOKENS[theme]['painted-outline'])
    })
  ];
}
