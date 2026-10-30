/**
 * The /sim lot dots: which lots the user layer and the brushed protections touch. One
 * ScatterplotLayer of user-layer lots, filled by mode, and one of protected lots, drawn as an
 * outlined ring so colour is never the only signal (WCAG 1.4.1). Layer ids `sim-lots` and
 * `sim-lots-protected` (never generated-, rising- or timeline-).
 */
import type { Layer } from '@deck.gl/core';
import type { ParcelId } from '$lib/data/parcel';
import type { OverlayCtors } from '$lib/brush/overlay';
import type { LotRole } from './policy';

type RGB = [number, number, number];

/** Tier 4 (our choice): mode hues as on the toolbar (paint blue), with a lighter dark set. */
export const LOT_COLORS: { light: Record<LotRole, RGB>; dark: Record<LotRole, RGB> } = {
  light: {
    raise: [29, 78, 216],
    lower: [194, 65, 12],
    set: [109, 40, 217],
    protected: [21, 128, 61]
  },
  dark: {
    raise: [96, 165, 250],
    lower: [251, 146, 60],
    set: [196, 181, 253],
    protected: [74, 222, 128]
  }
};

interface Dot {
  position: [number, number];
  role: LotRole;
}

const DOT_M = 5;
const DOT_MIN_PX = 2;
const DOT_MAX_PX = 6;

export function lotOverlayLayers(
  L: OverlayCtors,
  roles: Map<ParcelId, LotRole>,
  points: (id: ParcelId) => [number, number] | undefined,
  dark: boolean
): Layer[] {
  const colors = LOT_COLORS[dark ? 'dark' : 'light'];
  const user: Dot[] = [];
  const prot: Dot[] = [];
  for (const [id, role] of roles) {
    const position = points(id);
    if (!position) continue;
    (role === 'protected' ? prot : user).push({ position, role });
  }
  const common = {
    getPosition: (d: Dot) => d.position,
    getRadius: DOT_M,
    radiusUnits: 'meters',
    radiusMinPixels: DOT_MIN_PX,
    radiusMaxPixels: DOT_MAX_PX,
    pickable: false
  };
  return [
    new L.ScatterplotLayer({
      id: 'sim-lots',
      data: user,
      ...common,
      filled: true,
      stroked: false,
      getFillColor: (d: Dot) => [...colors[d.role], 230]
    }),
    new L.ScatterplotLayer({
      id: 'sim-lots-protected',
      data: prot,
      ...common,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: [...colors.protected, 255]
    })
  ];
}
