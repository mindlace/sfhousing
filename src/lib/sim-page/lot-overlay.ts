/**
 * The /sim lot dots: every lot a rule or the custom painting changes. Two ScatterplotLayers: a
 * halo under every dot and the dots, filled with an outline (the "Your zoning" map key names the
 * colour). The outline and the halo are a dark and a light tone, so on any map colour one of
 * them is at least 3:1 (WCAG 1.4.11; lot-overlay.spec.ts checks it). Layer ids `sim-lots-halo`
 * and `sim-lots` (never generated-, rising- or timeline-).
 */
import type { Layer } from '@deck.gl/core';
import type { ParcelId } from '$lib/data/parcel';
import type { OverlayCtors } from '$lib/brush/overlay';
import type { LotRole } from './policy';

type RGB = [number, number, number];

/** Tier 4 (our choice): the toolbar's paint blue, lighter in dark mode. */
export const LOT_COLORS: { light: Record<LotRole, RGB>; dark: Record<LotRole, RGB> } = {
  light: { changed: [29, 78, 216] },
  dark: { changed: [96, 165, 250] }
};

/** The dots' outline and the halo around it, per theme. */
export const LOT_EDGE: { light: { outline: RGB; halo: RGB }; dark: { outline: RGB; halo: RGB } } = {
  light: { outline: [17, 17, 17], halo: [255, 255, 255] },
  dark: { outline: [245, 245, 245], halo: [0, 0, 0] }
};

interface Dot {
  position: [number, number];
}

const DOT_M = 5;
const DOT_MIN_PX = 2;
const DOT_MAX_PX = 8;

export function lotOverlayLayers(
  L: OverlayCtors,
  roles: Map<ParcelId, LotRole>,
  points: (id: ParcelId) => [number, number] | undefined,
  dark: boolean
): Layer[] {
  const theme = dark ? 'dark' : 'light';
  const edge = LOT_EDGE[theme];
  const dots: Dot[] = [];
  for (const id of roles.keys()) {
    const position = points(id);
    if (position) dots.push({ position });
  }
  const common = {
    data: dots,
    getPosition: (d: Dot) => d.position,
    getRadius: DOT_M,
    radiusUnits: 'meters',
    radiusMinPixels: DOT_MIN_PX,
    radiusMaxPixels: DOT_MAX_PX,
    lineWidthUnits: 'pixels',
    pickable: false
  };
  return [
    new L.ScatterplotLayer({
      id: 'sim-lots-halo',
      ...common,
      filled: false,
      stroked: true,
      getLineWidth: 5,
      getLineColor: [...edge.halo, 255]
    }),
    new L.ScatterplotLayer({
      id: 'sim-lots',
      ...common,
      filled: true,
      stroked: true,
      getLineWidth: 1.5,
      getLineColor: [...edge.outline, 255],
      getFillColor: [...LOT_COLORS[theme].changed, 255]
    })
  ];
}
