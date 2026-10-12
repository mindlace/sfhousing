import type { PackedCell } from './types';
import type { Viewport } from '@deck.gl/core';
type Bounds = [number, number, number, number];
const cells = new WeakMap<object, { bounds: Bounds; top: number }>();
const views = new WeakMap<object, Map<number, Bounds | null>>();
/** The binary data object remains stable across animation frames and theme changes. */
export function registerCellBounds(data: object, pack: PackedCell): void {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity,
    top = 0;
  for (let i = 0; i < pack.positions.length; i += 2) {
    west = Math.min(west, pack.positions[i]);
    east = Math.max(east, pack.positions[i]);
    south = Math.min(south, pack.positions[i + 1]);
    north = Math.max(north, pack.positions[i + 1]);
  }
  for (const height of pack.partTopM) top = Math.max(top, height);
  cells.set(data, { bounds: [west, south, east, north], top });
}
interface FilterContext {
  layer: { id: string; props: { data?: unknown } };
  viewport: Viewport;
}
export function generatedCellFilter({ layer, viewport }: FilterContext): boolean {
  if (
    !/^(generated|rising)-/.test(layer.id) ||
    !layer.props.data ||
    typeof layer.props.data !== 'object'
  )
    return true;
  const cell = cells.get(layer.props.data);
  const view = viewport as Viewport & {
    getBounds?: (options?: { z: number }) => Bounds;
    pitch?: number;
  };
  if (!cell || !view.getBounds || (view.pitch ?? 0) > 60) return true;
  let byHeight = views.get(viewport);
  if (!byHeight) views.set(viewport, (byHeight = new Map()));
  let visible = byHeight.get(cell.top);
  if (visible === undefined) {
    // Above-eye roof planes cross the perspective horizon; keep everything in that case.
    const cameraHeight = view.cameraPosition[2] / view.distanceScales.unitsPerMeter[2];
    if (!Number.isFinite(cameraHeight) || cameraHeight <= cell.top) visible = null;
    else {
      const ground = view.getBounds(),
        roof = view.getBounds({ z: cell.top });
      visible = [
        Math.min(ground[0], roof[0]),
        Math.min(ground[1], roof[1]),
        Math.max(ground[2], roof[2]),
        Math.max(ground[3], roof[3])
      ];
      if (!visible.every(Number.isFinite) || visible[2] - visible[0] > 180) visible = null;
    }
    byHeight.set(cell.top, visible);
  }
  if (!visible) return true;
  const [w, s, e, n] = cell.bounds;
  return e >= visible[0] && w <= visible[2] && n >= visible[1] && s <= visible[3];
}
