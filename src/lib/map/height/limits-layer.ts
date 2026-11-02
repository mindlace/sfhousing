/**
 * HeightLimitsLayer (height-lids spec, "The design"): zoning height limits on /sim.
 *
 * Zoomed in, glass lids from the worker's HeightLids: a faint glaze face per piece at its limit
 * height, walls where the limit steps, ink rims along the lid edges and one label per region.
 * Zoomed out, the city's contour chains flat on the ground with their labels. Lids fade in over
 * LIDS_FADE and contours fade out over it; a sublayer at opacity 0 is not rendered.
 *
 * The look per mode (plain, paint, rule) comes from limits-style. Filtered and dashed data is
 * memoized per (lids | city, mode, theme), and labels per integer zoom, so a pan or a zoom inside
 * one integer zoom outside the fade does no work here.
 */
import { CompositeLayer, type Layer, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import { PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { dashPath } from '$lib/map/dash';
import { TOKENS, hexToRgba, type RGBA } from '$lib/map/palette';
import type { Theme } from '$lib/map/types';
import { OUTLINE_DASH_M, OUTLINE_GAP_M } from '$lib/sim-page/painted-outline';
import {
  LIDS_FADE,
  chainLook,
  chainWidthPx,
  glazeAlpha,
  lidsOpacity,
  resolveMode,
  rimLook,
  wallAlpha,
  type LimitsMode,
  type LimitsView,
  type Look
} from './limits-style';
import { storiesToM } from './room';
import type { HeightCity, HeightLids, LabelSet } from './types';
import { LidWallLayer } from './wall-layer';

export const LIMITS_LAYER_ID = 'sim-height-limits';

/** Rims dash as the eraser's painted-lot outline; contours with longer dashes, read from afar. */
export const RIM_DASH_M = OUTLINE_DASH_M;
export const RIM_GAP_M = OUTLINE_GAP_M;
export const CONTOUR_DASH_M = 40;
export const CONTOUR_GAP_M = 30;
export const RIM_WIDTH_PX = 1.5;
export const LABEL_SIZE_PX = 12;
/** Every character a lid or contour label can hold ("4 stories · +1,200 floors", "40+"). */
export const LABEL_CHARS = '0123456789+,· storiesyfl';

export interface HeightLimitsProps {
  city: HeightCity | null;
  lids: HeightLids | null;
  mode: LimitsView;
  theme: Theme;
}

type Props = HeightLimitsProps & LayerProps;

interface Line {
  path: Float64Array | number[][];
  color: RGBA;
  width: number;
}

interface Label {
  text: string;
  position: [number, number, number];
}

interface LineSets {
  solid: Line[];
  dashed: Line[];
}

interface LidData extends LineSets {
  /** Glaze colour per piece. */
  glaze: RGBA[];
  wallAlpha: Float32Array;
}

interface Memo<T> {
  src: unknown;
  key: string;
  value: T;
}

function memo<T>(m: Memo<T> | undefined, src: unknown, key: string, make: () => T): Memo<T> {
  return m && m.src === src && m.key === key ? m : { src, key, value: make() };
}

const colorOf = (look: Look, ink: RGBA, paint: RGBA): RGBA => {
  const c = look.tone === 'paint' ? paint : ink;
  return [c[0], c[1], c[2], Math.round(c[3] * look.alpha)];
};

const modeKey = (m: LimitsMode, theme: Theme) =>
  `${m.kind}:${m.kind === 'rule' ? m.source : ''}:${theme}`;

/**
 * Rims, glaze colours and wall alphas for `lids` in `mode`. Paint-touching rims are dashed here on
 * the main thread: styling, accepted because it runs once per (lids, mode) via the memo, never
 * per frame (R10).
 */
function lidData(lids: HeightLids, mode: LimitsMode, theme: Theme): LidData {
  const t = TOKENS[theme];
  const ink = hexToRgba(t['limit-ink']);
  const paint = hexToRgba(t['painted-outline']);
  const glazeToken = hexToRgba(t['limit-glaze']);
  const { pieces, rims, walls } = lids;

  const solid: Line[] = [];
  const dashed: Line[] = [];
  for (let k = 0; k + 1 < rims.starts.length; k++) {
    const look = rimLook(rims.kind[k], pieces.source[rims.piece[k]], mode);
    if (!look.show) continue;
    const path = rims.positions.subarray(3 * rims.starts[k], 3 * rims.starts[k + 1]);
    const color = colorOf(look, ink, paint);
    const width = look.widthPx ?? RIM_WIDTH_PX;
    if (!look.dashed) {
      solid.push({ path, color, width });
      continue;
    }
    const pts: number[][] = [];
    for (let i = 0; i < path.length; i += 3) pts.push([path[i], path[i + 1], path[i + 2]]);
    for (const d of dashPath(pts, RIM_DASH_M, RIM_GAP_M, false))
      dashed.push({ path: d, color, width });
  }

  const glaze = Array.from(pieces.stories, (_, p): RGBA => [
    glazeToken[0],
    glazeToken[1],
    glazeToken[2],
    Math.round(glazeToken[3] * glazeAlpha(pieces.source[p], pieces.glaze[p], mode))
  ]);
  const wa = new Float32Array(walls.count);
  for (let i = 0; i < walls.count; i++) wa[i] = wallAlpha(pieces.source[walls.piece[i]], mode);
  return { solid, dashed, glaze, wallAlpha: wa };
}

/** Contour chains for `city` in `mode`; paint-touching chains dashed once per (city, mode) (R10). */
function contourData(city: HeightCity, mode: LimitsMode, theme: Theme): LineSets {
  const t = TOKENS[theme];
  const ink = hexToRgba(t['limit-ink']);
  const paint = hexToRgba(t['painted-outline']);
  const c = city.chains;
  const solid: Line[] = [];
  const dashed: Line[] = [];
  for (let k = 0; k + 1 < c.starts.length; k++) {
    const look = chainLook(c.kind[k], c.srcA[k], c.srcB[k], mode);
    if (!look.show) continue;
    const path = c.positions.subarray(2 * c.starts[k], 2 * c.starts[k + 1]);
    const color = colorOf(look, ink, paint);
    const width = look.widthPx ?? chainWidthPx(c.hi[k], c.lo[k]);
    if (!look.dashed) {
      solid.push({ path, color, width });
      continue;
    }
    const pts: number[][] = [];
    for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
    for (const d of dashPath(pts, CONTOUR_DASH_M, CONTOUR_GAP_M, false))
      dashed.push({ path: d, color, width });
  }
  return { solid, dashed };
}

/** The labels of `set` shown at integer zoom `z` (minZoom ≤ z). */
function labelsAt(set: LabelSet, z: number): Label[] {
  const out: Label[] = [];
  for (let i = 0; i < set.text.length; i++) {
    if (set.minZoom[i] > z) continue;
    const p = set.position;
    out.push({ text: set.text[i], position: [p[3 * i], p[3 * i + 1], p[3 * i + 2]] });
  }
  return out;
}

const inFade = (z: number) => z >= LIDS_FADE[0] && z <= LIDS_FADE[1];

/** Never written to depth, so the overlays drawn after are never cut by a lid. */
const NO_DEPTH_WRITE = { depthWriteEnabled: false } as const;

export class HeightLimitsLayer extends CompositeLayer<Props> {
  static layerName = 'HeightLimitsLayer';

  declare state: {
    /** The zoom the sublayers were last rendered at. */
    zoom?: number;
    lid?: Memo<LidData>;
    contours?: Memo<LineSets>;
    lidLabels?: Memo<Label[]>;
    contourLabels?: Memo<Label[]>;
  };

  shouldUpdateState({ changeFlags, context }: UpdateParameters<this>): boolean {
    if (changeFlags.propsOrDataChanged || changeFlags.updateTriggersChanged) return true;
    if (!changeFlags.viewportChanged) return false;
    const z = context.viewport.zoom;
    const was = this.state.zoom;
    if (was === undefined) return true;
    return Math.floor(z) !== Math.floor(was) || inFade(z) || inFade(was);
  }

  renderLayers(): Layer[] {
    const { city, lids, mode: view, theme } = this.props;
    const zoom = this.context.viewport.zoom;
    this.state.zoom = zoom;
    const zBucket = Math.floor(zoom);
    const lidsOp = lidsOpacity(zoom);
    const t = TOKENS[theme];
    const ink = hexToRgba(t['limit-ink']);
    const halo = hexToRgba(t['limit-halo']);
    const out: Layer[] = [];

    if (lids && lidsOp > 0) {
      // lids and city may come from different limit revisions: each maps the rule id itself (R5)
      const mode = resolveMode(view, lids.sourceIds);
      const key = modeKey(mode, theme);
      const lid = (this.state.lid = memo(this.state.lid, lids, key, () =>
        lidData(lids, mode, theme)
      )).value;
      const labelSet = mode.kind === 'paint' ? lids.paintLabels : lids.labels;
      const labels = (this.state.lidLabels = memo(
        this.state.lidLabels,
        labelSet,
        String(zBucket),
        () => labelsAt(labelSet, zBucket)
      )).value;
      out.push(
        new SolidPolygonLayer(
          this.getSubLayerProps({
            id: 'glaze',
            data: lids.faces,
            getPolygon: (f: HeightLids['faces'][number]) => {
              const z = storiesToM(lids.pieces.stories[f.piece]);
              return f.rings.map((r) => {
                const ring: number[][] = [];
                for (let i = 0; i < r.length; i += 2) ring.push([r[i], r[i + 1], z]);
                return ring;
              });
            },
            getFillColor: (f: HeightLids['faces'][number]) => lid.glaze[f.piece],
            updateTriggers: { getFillColor: key },
            extruded: false,
            opacity: lidsOp,
            parameters: NO_DEPTH_WRITE
          })
        ),
        new LidWallLayer(
          this.getSubLayerProps({
            id: 'walls',
            data: lids.walls,
            color: hexToRgba(t['limit-wall']),
            alpha: lid.wallAlpha,
            opacity: lidsOp
          })
        )
      );
      out.push(...this.lineLayers('rims', lid, lidsOp));
      if (labels.length) out.push(this.labelLayer('lid-labels', labels, lidsOp, ink, halo));
    }

    const contourOp = 1 - lidsOp;
    if (city && contourOp > 0) {
      const mode = resolveMode(view, city.sourceIds);
      const key = modeKey(mode, theme);
      const lines = (this.state.contours = memo(this.state.contours, city, key, () =>
        contourData(city, mode, theme)
      )).value;
      const labels = (this.state.contourLabels = memo(
        this.state.contourLabels,
        city.labels,
        String(zBucket),
        () => labelsAt(city.labels, zBucket)
      )).value;
      out.push(...this.lineLayers('contours', lines, contourOp));
      if (labels.length) out.push(this.labelLayer('contour-labels', labels, contourOp, ink, halo));
    }
    return out;
  }

  /** `-<id>` (solid) and `-<id>-dashed`, each only when it has lines. */
  private lineLayers(id: string, sets: LineSets, opacity: number): Layer[] {
    const out: Layer[] = [];
    for (const [suffix, data] of [
      ['', sets.solid],
      ['-dashed', sets.dashed]
    ] as const) {
      if (data.length === 0) continue;
      out.push(
        new PathLayer<Line>(
          this.getSubLayerProps({
            id: id + suffix,
            data,
            getPath: (d: Line) => d.path,
            positionFormat: id === 'rims' ? 'XYZ' : 'XY',
            getColor: (d: Line) => d.color,
            getWidth: (d: Line) => d.width,
            widthUnits: 'pixels',
            opacity,
            parameters: NO_DEPTH_WRITE
          })
        )
      );
    }
    return out;
  }

  private labelLayer(id: string, data: Label[], opacity: number, ink: RGBA, halo: RGBA): Layer {
    return new TextLayer<Label>(
      this.getSubLayerProps({
        id,
        data,
        getText: (d: Label) => d.text,
        getPosition: (d: Label) => d.position,
        getColor: ink,
        getSize: LABEL_SIZE_PX,
        sizeUnits: 'pixels',
        outlineWidth: 2,
        outlineColor: halo,
        fontSettings: { sdf: true },
        characterSet: LABEL_CHARS,
        opacity,
        parameters: { depthCompare: 'always', depthWriteEnabled: false }
      })
    ) as unknown as Layer;
  }
}

/** The limits layer for `p`, with id LIMITS_LAYER_ID. */
export function heightLimitsLayer(p: HeightLimitsProps): HeightLimitsLayer {
  return new HeightLimitsLayer({ id: LIMITS_LAYER_ID, ...p });
}
