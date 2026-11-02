/**
 * Dashed outlines of custom-painted lots, drawn while the eraser is chosen (map overlays spec,
 * "Outlines while erasing"). One outline per lot, since the lot is what the eraser acts on, as
 * metric dashes along each ring (`dashPath`). Dashed so colour is never the only signal.
 */
import type { Layer } from '@deck.gl/core';
import type { OverlayCtors } from '$lib/brush/overlay';
import type { LotOutlinesResult } from '$lib/sim/scenario/types';
import { OUTLINE_DASH_M, OUTLINE_GAP_M, dashPath } from '$lib/map/dash';
import { TOKENS, hexToRgba } from '$lib/map/palette';
import type { Theme } from '$lib/map/types';

export const OUTLINE_LAYER_ID = 'sim-painted-outline';
export { OUTLINE_DASH_M, OUTLINE_GAP_M };

type Pt = [number, number];

/** One PathLayer, id 'sim-painted-outline', 2 px, the 'painted-outline' token. */
export function paintedOutlineLayers(
  L: OverlayCtors,
  o: Extract<LotOutlinesResult, { ok: true }>,
  theme: Theme
): Layer[] {
  const paths: number[][][] = [];
  for (let k = 0; k + 1 < o.starts.length; k++) {
    const ring: Pt[] = [];
    for (let v = o.starts[k]; v < o.starts[k + 1]; v++)
      ring.push([o.positions[2 * v], o.positions[2 * v + 1]]);
    for (const d of dashPath(ring, OUTLINE_DASH_M, OUTLINE_GAP_M, true)) paths.push(d);
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
