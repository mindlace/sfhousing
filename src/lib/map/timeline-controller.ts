// Owns the deck timeline layers in FZP mode: revision ordering, slicing, the two cell layers per
// timeline cell, the stage bars, the demolish pump and the overlay-layer slot (spec §4.1, §4.3,
// §4.4, §4.5, §4.7). deck is type-only here: the layer and extension classes arrive through deps,
// so deck and the timelapse GPU code (timelapse/deck.ts) stay lazy.
import type { Layer } from '@deck.gl/core';
import type { SolidPolygonLayer } from '@deck.gl/layers';
import type { ParcelId } from '$lib/data/parcel';
import type { TypologyId } from '$lib/generator';
import type { Day } from '$lib/timelapse/time';
import { MAX_CELLS_PER_SLICE } from './hide';
import { TOKENS, hexToRgba, type RGBA } from './palette';
import { registerCellBounds } from './cull';
import { appearanceColor } from './appearance';
import { TYPOLOGY_ORDER, type Theme, type TimedPackedCell, type TimelineUpdate } from './types';
import { buildBars } from './timelapse/bars';
import { declutter } from './timelapse/declutter';
import { DemolishPump, type PumpDeps } from './timelapse/demolish';
import { encodeParts, validateTimedCell, type EncodedParts } from './timelapse/encode';
import { packChanceTexture, type ChanceTexture } from './timelapse/lookups';
import type { TimelapseExtension, TimelapseExtensionProps } from './timelapse/extension';
import type { StageBarLayer } from './timelapse/stage-bar-layer';
import type { BarAttrs, TimelineClock, TimelineLookups, TimelineSnapshot } from './timelapse/types';

export interface TimelineDeps extends PumpDeps {
  setLayers(layers: Layer[]): void; // overlay.setProps({ layers })
  SolidPolygonLayer: typeof SolidPolygonLayer;
  TimelapseExtension: typeof TimelapseExtension;
  StageBarLayer: typeof StageBarLayer;
  repaint(): void; // map.triggerRepaint()
  onResyncNeeded(): void;
}

export interface TimelinePartLookup {
  projectId: string;
  parcelId: ParcelId;
  typology: TypologyId;
  stories: number;
  units: number;
  existingUnits: number;
}

/** Ids of the per-cell timeline layers (picking and culling). `timeline-bars` is not one. */
export const TIMELINE_PART_LAYER = /^timeline-(solid|ghost)-/;

type Accessor<T> = (o: unknown, info: { index: number }) => T;
type TimelineLayerProps = ConstructorParameters<
  typeof SolidPolygonLayer<unknown, TimelapseExtensionProps>
>[0];

interface PackCache {
  data: { length: number; startIndices: Uint32Array; attributes: object };
  getElevation: Accessor<number>;
  fill: Partial<Record<Theme, Accessor<RGBA>>>;
}

// Created once per pack (data, elevation) and per (pack, theme) (fill colour), as in
// generated-controller.ts. Both of a cell's layers share them, so they share one tessellation
// key and one registered cull bound.
const packCache = new WeakMap<TimedPackedCell, PackCache>();

function accessorsFor(pack: TimedPackedCell, theme: Theme) {
  let c = packCache.get(pack);
  if (!c) {
    const { partTopM } = pack;
    c = {
      data: {
        length: pack.partCount,
        startIndices: pack.startIndices,
        attributes: { getPolygon: { value: pack.positions, size: 2 } }
      },
      getElevation: (_, { index }) => partTopM[index],
      fill: {}
    };
    registerCellBounds(c.data, pack);
    packCache.set(pack, c);
  }
  let fill = c.fill[theme];
  if (!fill) {
    const { partTypology, partAppearance } = pack;
    fill = c.fill[theme] = (_, { index }) =>
      appearanceColor(theme, TYPOLOGY_ORDER[partTypology[index]], partAppearance[index]);
  }
  return { data: c.data, getElevation: c.getElevation, getFillColor: fill };
}

interface Cell {
  pack: TimedPackedCell;
  /** Re-encoded by `setLookups` (tlC depends on typical durations). */
  enc: EncodedParts;
  /** Per-cell attribute accessors; they read `enc` at call time. */
  tl: { getTlA: Accessor<number[]>; getTlB: Accessor<number[]>; getTlC: Accessor<number[]> };
  solid: Layer | null; // null when the cell has no parts
  ghost: Layer | null;
}

interface Slice {
  cells: TimedPackedCell[];
  removed: string[];
}

const RESERVED = /^(generated|rising|timeline)-/;

/** One vec4 per part from `enc[key]`. deck copies the value out at once, so a scratch is safe. */
function vec4Accessor(cell: Pick<Cell, 'enc'>, key: keyof EncodedParts): Accessor<number[]> {
  const out = [0, 0, 0, 0];
  return (_, { index }) => {
    const a = cell.enc[key];
    const o = 4 * index;
    out[0] = a[o];
    out[1] = a[o + 1];
    out[2] = a[o + 2];
    out[3] = a[o + 3];
    return out;
  };
}

const byKey = <T>(a: [string, T], b: [string, T]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

export class TimelineController {
  private lastRevision = -1;
  private cells = new Map<string, Cell>();
  private queue: Slice[] = [];
  private overlay: Layer[] = [];
  private rafHandle: number | null = null;
  private current: Layer[] = [];
  private destroyed = false;
  private readonly clock: TimelineClock;
  private readonly ext: TimelapseExtension;
  private readonly pump: DemolishPump;
  private lookups: TimelineLookups | null = null;
  private chance: ChanceTexture | null = null;
  /** Bumped by `setLookups`: the cell layers' `updateTriggers.getTlC`. */
  private tlcVersion = 0;
  private bars: BarAttrs[] = [];
  private barsLayer: Layer | null = null;
  /** Cells changed since the bars were last built. */
  private barsDirty = false;
  private warnedNoLookups = false;

  /**
   * `labelBeforeId`: the basemap's first label layer. Every layer this controller emits carries
   * it as deck's `beforeId` (§4.3). Settled layers are built with it, so they stay referentially
   * stable across emits.
   */
  constructor(
    private deps: TimelineDeps,
    private theme: Theme,
    private labelBeforeId?: string
  ) {
    this.clock = { day: 0, theme };
    this.ext = new deps.TimelapseExtension({ clock: this.clock });
    this.pump = new DemolishPump(deps);
  }

  /** The pump's applied set: parcels whose existing building is hidden now (O(1)). */
  get demolished(): { has(id: ParcelId): boolean } {
    return this.pump;
  }

  apply(u: TimelineUpdate): void {
    if (this.destroyed) return;
    if (u.revision !== 0 && u.revision !== this.lastRevision + 1) {
      this.deps.onResyncNeeded();
      return;
    }
    for (const c of u.cells) validateTimedCell(c);
    if (u.revision === 0) return this.snapshot(u);
    this.lastRevision = u.revision;
    if (u.demolish.length > 0)
      console.error(
        `[map] timeline revision ${u.revision}: demolish must be empty after revision 0; ` +
          `${u.demolish.length} entries ignored`
      );
    if (u.cells.length === 0 && u.removedCells.length === 0) return; // band-only
    const idle = this.queue.length === 0;
    this.queue.push(...planTimelineSlices(u));
    if (idle) this.runSlice(this.queue.shift()!);
    this.schedule();
  }

  /**
   * O(1) and allocation-free (§4.7): the clock the shaders read, the pump's target, one repaint.
   * Calls before the first `apply` are kept and used.
   */
  setTime(day: Day): void {
    if (!Number.isFinite(day)) throw new RangeError(`setTime: day must be finite, got ${day}`);
    if (this.destroyed) return;
    this.clock.day = day;
    this.pump.setTarget(day);
    this.deps.repaint();
  }

  /**
   * Stores the lookups and uploads a new chance texture; re-encodes every installed cell's tlC
   * (typical construction days) and rebuilds the bars once the slice queue has drained.
   * `packChanceTexture` throws a `RangeError` on a row longer than 2048; nothing changes then.
   */
  setLookups(l: TimelineLookups): void {
    if (this.destroyed) return;
    const chance = packChanceTexture(l.chance);
    this.lookups = l;
    this.chance = chance;
    this.tlcVersion++;
    if (this.lastRevision < 0) return;
    for (const cell of this.cells.values()) {
      cell.enc = encodeParts(cell.pack, l);
      this.buildCellLayers(cell);
    }
    this.barsDirty = true;
    if (this.queue.length === 0) this.rebuildBars();
    this.emit();
  }

  setTheme(t: Theme): void {
    if (t === this.theme) return;
    this.theme = t;
    this.clock.theme = t;
    if (this.destroyed) return;
    for (const cell of this.cells.values()) this.buildCellLayers(cell);
    if (this.lastRevision >= 0) this.emit();
  }

  setOverlayLayers(layers: Layer[]): void {
    for (const l of layers)
      if (RESERVED.test(l.id)) throw new Error(`setOverlayLayers: reserved layer id ${l.id}`);
    const beforeId = this.labelBeforeId;
    this.overlay = beforeId
      ? layers.map((l) => l.clone({ beforeId } as Partial<Layer['props']>))
      : [...layers];
    this.emit();
  }

  lookup(layerId: string, index: number): TimelinePartLookup | null {
    if (!TIMELINE_PART_LAYER.test(layerId)) return null;
    const p = this.cells.get(layerId.replace(TIMELINE_PART_LAYER, ''))?.pack;
    if (!p || index < 0 || index >= p.partCount) return null;
    const s = p.partSlot[index];
    const m = p.parcelMeta;
    return {
      projectId: p.slotProjectIds[s],
      parcelId: p.parcelIds[s],
      typology: TYPOLOGY_ORDER[m[4 * s + 3]],
      stories: m[4 * s + 2],
      units: m[4 * s],
      existingUnits: m[4 * s + 1]
    };
  }

  /** Re-applies the applied set after a buildings tile reload (`retryBuildings`). */
  reapplyDemolished(): void {
    if (this.destroyed) return;
    for (const id of this.pump.appliedIds()) this.deps.setReplaced(id);
  }

  debugSnapshot(): TimelineSnapshot {
    let parts = 0;
    for (const cell of this.cells.values()) parts += cell.pack.partCount;
    return {
      revision: this.lastRevision,
      cells: this.cells.size,
      parts,
      bars: this.barsLayer ? this.bars.length : 0,
      day: this.clock.day,
      demolish: { total: this.pump.total, applied: this.pump.applied },
      // Queued slices + a scheduled pump frame. 0 = layers and feature-state have converged.
      pending: this.queue.length + (this.pump.pending ? 1 : 0),
      layerIds: this.current.map((l) => l.id)
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelFrame();
    this.pump.destroy();
    this.queue = [];
    this.cells.clear();
    this.bars = [];
    this.barsLayer = null;
    this.current = [];
  }

  // -------------------------------------------------------------------------------------------

  /** Revision 0: drop queued slices, cells and bars, replace the demolish list, then install. */
  private snapshot(u: TimelineUpdate): void {
    this.cancelFrame();
    this.queue = [];
    this.cells.clear();
    this.bars = [];
    this.barsLayer = null;
    this.barsDirty = true;
    this.pump.replace(u.demolish);
    this.lastRevision = 0;
    const slices = planTimelineSlices(u);
    this.queue = slices.length > 0 ? slices : [{ cells: [], removed: [] }];
    this.runSlice(this.queue.shift()!);
    this.schedule();
  }

  private runSlice(slice: Slice): void {
    for (const id of slice.removed) if (this.cells.delete(id)) this.barsDirty = true;
    for (const pack of slice.cells) this.install(pack);
    // Bars are rebuilt once per update, when its last slice has installed.
    if (this.queue.length === 0 && this.barsDirty) this.rebuildBars();
    this.emit();
  }

  private install(pack: TimedPackedCell): void {
    const l = this.lookups;
    if (!l && !this.warnedNoLookups && import.meta.env.DEV) {
      this.warnedNoLookups = true;
      console.warn(
        '[map] timeline installed before setTimelineLookups: no bars, and construction shows ' +
          'no solid floors until completion'
      );
    }
    const cell = { pack, enc: encodeParts(pack, l) } as Cell;
    cell.tl = {
      getTlA: vec4Accessor(cell, 'tlA'),
      getTlB: vec4Accessor(cell, 'tlB'),
      getTlC: vec4Accessor(cell, 'tlC')
    };
    this.buildCellLayers(cell);
    this.cells.set(pack.cellId, cell);
    this.barsDirty = true;
  }

  private rebuildBars(): void {
    this.barsDirty = false;
    const l = this.lookups;
    if (!l || !this.chance) {
      this.bars = [];
      this.barsLayer = null;
      return;
    }
    const sorted = [...this.cells].sort(byKey).map(([, c]) => c.pack);
    const bars = buildBars(sorted, l);
    declutter(bars);
    this.bars = bars;
    this.barsLayer = new this.deps.StageBarLayer({
      data: bars,
      chance: this.chance,
      clock: this.clock,
      ...(this.labelBeforeId ? { beforeId: this.labelBeforeId } : {})
    } as ConstructorParameters<TimelineDeps['StageBarLayer']>[0]) as unknown as Layer;
  }

  private frame = (): void => {
    this.rafHandle = null;
    if (this.destroyed) return;
    if (this.queue.length > 0) this.runSlice(this.queue.shift()!);
    this.schedule();
  };

  private schedule(): void {
    if (this.rafHandle !== null || this.destroyed) return;
    if (this.queue.length > 0) this.rafHandle = this.deps.raf(this.frame);
  }

  private cancelFrame(): void {
    if (this.rafHandle !== null) this.deps.cancelRaf(this.rafHandle);
    this.rafHandle = null;
  }

  private buildCellLayers(cell: Cell): void {
    const has = cell.pack.partCount > 0;
    cell.solid = has ? this.makeLayer(cell, 0) : null;
    cell.ghost = has ? this.makeLayer(cell, 1) : null;
  }

  private makeLayer(cell: Cell, pass: 0 | 1): Layer {
    const theme = this.theme;
    const id = `timeline-${pass === 0 ? 'solid' : 'ghost'}-${cell.pack.cellId}`;
    return new this.deps.SolidPolygonLayer<unknown, TimelapseExtensionProps>({
      id,
      ...accessorsFor(cell.pack, theme),
      ...cell.tl,
      extruded: true,
      _normalize: false,
      _windingOrder: 'CW',
      elevationScale: 1,
      extensions: [this.ext],
      timelapsePass: pass,
      updateTriggers: { getFillColor: theme, getTlC: this.tlcVersion },
      pickable: true,
      ...(pass === 0
        ? { autoHighlight: true, highlightColor: hexToRgba(TOKENS[theme].highlight) }
        : { parameters: { depthWriteEnabled: false } }),
      ...(this.labelBeforeId ? { beforeId: this.labelBeforeId } : {})
    } as TimelineLayerProps) as unknown as Layer;
  }

  /** Solids by cellId, then ghosts by cellId, then `timeline-bars`, then the overlay. */
  private emit(): void {
    if (this.destroyed) return;
    const sorted = [...this.cells].sort(byKey);
    const solids: Layer[] = [];
    const ghosts: Layer[] = [];
    for (const [, c] of sorted) {
      if (c.solid) solids.push(c.solid);
      if (c.ghost) ghosts.push(c.ghost);
    }
    this.current = [
      ...solids,
      ...ghosts,
      ...(this.barsLayer ? [this.barsLayer] : []),
      ...this.overlay
    ];
    this.deps.setLayers(this.current);
  }
}

/** At most MAX_CELLS_PER_SLICE cells + removed cells per slice, in update order (§4.1). */
function planTimelineSlices(u: TimelineUpdate): Slice[] {
  const units: [TimedPackedCell | null, string | null][] = [
    ...u.cells.map((c): [TimedPackedCell, null] => [c, null]),
    ...u.removedCells.map((id): [null, string] => [null, id])
  ];
  const out: Slice[] = [];
  for (let i = 0; i < units.length; i += MAX_CELLS_PER_SLICE) {
    const slice: Slice = { cells: [], removed: [] };
    for (const [c, id] of units.slice(i, i + MAX_CELLS_PER_SLICE)) {
      if (c) slice.cells.push(c);
      else slice.removed.push(id!);
    }
    out.push(slice);
  }
  return out;
}
