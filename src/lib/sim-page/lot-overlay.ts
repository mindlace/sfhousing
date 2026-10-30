/**
 * The /sim lot dots: which lots the user layer and the brushed protections touch. Three
 * ScatterplotLayers: a halo under every dot, the user-layer lots filled by mode with an outline,
 * and the protected lots as an outlined ring (shape, not colour, marks them: WCAG 1.4.1; the
 * "Your zoning" legend names the colours). The outline and the halo are a dark and a light tone,
 * so on any map colour one of them is at least 3:1 (WCAG 1.4.11; lot-overlay.spec.ts checks it).
 * Layer ids `sim-lots-halo`, `sim-lots` and `sim-lots-protected` (never generated-, rising- or
 * timeline-).
 */
import type { Layer } from '@deck.gl/core';
import type { ParcelId } from '$lib/data/parcel';
import type { OverlayCtors } from '$lib/brush/overlay';
import type { LotRole } from './policy';

type RGB = [number, number, number];
type Mode = Exclude<LotRole, 'protected'>;

/** Tier 4 (our choice): mode fills (raise as the toolbar's paint blue), lighter in dark mode. */
export const LOT_COLORS: { light: Record<Mode, RGB>; dark: Record<Mode, RGB> } = {
  light: { raise: [29, 78, 216], lower: [194, 65, 12], set: [109, 40, 217] },
  dark: { raise: [96, 165, 250], lower: [251, 146, 60], set: [196, 181, 253] }
};

/** The outline (dots and the protected ring) and the halo around it, per theme. */
export const LOT_EDGE: { light: { outline: RGB; halo: RGB }; dark: { outline: RGB; halo: RGB } } = {
  light: { outline: [17, 17, 17], halo: [255, 255, 255] },
  dark: { outline: [245, 245, 245], halo: [0, 0, 0] }
};

interface Dot {
  position: [number, number];
  role: LotRole;
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
  const colors = LOT_COLORS[theme];
  const edge = LOT_EDGE[theme];
  const all: Dot[] = [];
  const user: Dot[] = [];
  const prot: Dot[] = [];
  for (const [id, role] of roles) {
    const position = points(id);
    if (!position) continue;
    const d = { position, role };
    all.push(d);
    (role === 'protected' ? prot : user).push(d);
  }
  const common = {
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
      data: all,
      ...common,
      filled: false,
      stroked: true,
      getLineWidth: 5,
      getLineColor: [...edge.halo, 255]
    }),
    new L.ScatterplotLayer({
      id: 'sim-lots',
      data: user,
      ...common,
      filled: true,
      stroked: true,
      getLineWidth: 1.5,
      getLineColor: [...edge.outline, 255],
      getFillColor: (d: Dot) => [...colors[d.role as Mode], 255]
    }),
    new L.ScatterplotLayer({
      id: 'sim-lots-protected',
      data: prot,
      ...common,
      filled: false,
      stroked: true,
      getLineWidth: 2.5,
      getLineColor: [...edge.outline, 255]
    })
  ];
}
