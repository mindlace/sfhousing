// Owns the deck timeline layers in FZP mode: revision ordering, slicing, the two cell layers per
// timeline cell, the stage bars, the halos and marks, the demolish pump and the overlay-layer slot
// (spec §4.1, §4.3, §4.4, §4.5, §4.7; halos: docs/dev/map-interfaces.md "Halos and marks"). deck
// is type-only here: the layer and extension classes arrive through deps, so deck and the
// timelapse GPU code (timelapse/deck.ts) stay lazy.
import type { Layer } from '@deck.gl/core';
import type { SolidPolygonLayer } from '@deck.gl/layers';
import type { ParcelId } from '$lib/data/parcel';
import type { TypologyId } from '$lib/generator';
import type { Day } from '$lib/timelapse/time';
import { MAX_CELLS_PER_SLICE, SWAP_CELLS_PER_SLICE } from './hide';
import { TOKENS, hexToRgba, type RGBA } from './palette';
import { registerCellBounds } from './cull';
import { appearanceColor } from './appearance';
import {
  TYPOLOGY_ORDER,
  type BarMode,
  type Theme,
  type TimedPackedCell,
  type TimelineUpdate
} from './types';
import { validateCityDelta } from './city-delta';
import { barZoomAt, buildBars, evalBar } from './timelapse/bars';
import { buildHalos, evalHalo, type HaloAttrs } from './timelapse/halos';
import { CityStore } from './timelapse/city';
import { FAR_UNITS_PER_SLICE, FarDeclutter, declutter } from './timelapse/declutter';
import { DemolishPump, type PumpDeps } from './timelapse/demolish';
import { encodeParts, validateTimedCell, type EncodedParts } from './timelapse/encode';
import { packChanceTexture, type ChanceTexture } from './timelapse/lookups';
import type { TimelapseExtension, TimelapseExtensionProps } from './timelapse/extension';
import type { StageBarLayer } from './timelapse/stage-bar-layer';
import type { HaloLayer } from './timelapse/halo-layer';
import type { BarAttrs, TimelineClock, TimelineLookups, TimelineSnapshot } from './timelapse/types';

/** A point in clip space: [x, y, w]. */
export type Clip = [x: number, y: number, w: number];

/** The map's camera as the debug snapshot reads it (never per frame, never on a move). */
export interface DebugView {
  zoom: number;
  /** The view's centre on the ground. */
  centre: [lng: number, lat: number];
  /** A point's clip-space [x, y, w] in the map's camera, `alt` metres up (0: the ground). */
  clip(lng: number, lat: number, alt?: number): Clip;
}

export interface TimelineDeps extends PumpDeps {
  setLayers(layers: Layer[]): void; // overlay.setProps({ layers })
  SolidPolygonLayer: typeof SolidPolygonLayer;
  TimelapseExtension: typeof TimelapseExtension;
  StageBarLayer: typeof StageBarLayer;
  HaloLayer: typeof HaloLayer;
  repaint(): void; // map.triggerRepaint()
  onResyncNeeded(): void;
  /** The map's camera, read by `debugSnapshot` only; absent or null: no map to count against. */
  debugView?(): DebugView | null;
}

export interface TimelinePartLookup {
  projectId: string;
  parcelId: ParcelId;
  typology: TypologyId;
  stories: number;
  units: number;
  existingUnits: number;
}

/** The id suffix of the merged layers (`setMerged`): `timeline-solid-run`, `timeline-ghost-run`. */
const MERGED_ID = 'run';

/**
 * Ids of the per-cell timeline layers (picking and culling). `timeline-bars`, `timeline-halos`
 * and the merged pair (`setMerged`) are not.
 */
export const TIMELINE_PART_LAYER = /^timeline-(solid|ghost)-(?!run$)/;

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
// key and one registered cull bound. `cull` false (the merged join) registers no bound, so
// `generatedCellFilter` keeps the layer.
const packCache = new WeakMap<TimedPackedCell, PackCache>();

function accessorsFor(pack: TimedPackedCell, theme: Theme, cull = true) {
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
    if (cull) registerCellBounds(c.data, pack);
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
  /** Re-encoded after `setLookups`, in slices (tlC depends on typical durations). */
  enc: EncodedParts;
  /** The lookups `enc` was encoded with. */
  encodedWith: TimelineLookups | null;
  /** The cell layers' `updateTriggers.getTlC`: the controller's `tlcVersion` at encode time. */
  tlc: number;
  /** Per-cell attribute accessors; they read `enc` at call time. */
  tl: { getTlA: Accessor<number[]>; getTlB: Accessor<number[]>; getTlC: Accessor<number[]> };
  solid: Layer | null; // null when the cell has no parts
  ghost: Layer | null;
}

interface Slice {
  cells: TimedPackedCell[];
  removed: string[];
  /** Installed cells to re-encode with the current lookups (`setLookups`). */
  reencode: string[];
  /** The last slice of a `complete` update: once it has run, the swap's leftovers go. */
  complete?: true;
  /**
   * A step of this far declutter: FAR_UNITS_PER_SLICE units, or its setup. Dropping the job
   * removes its step; one that is not `barJob` all the same runs as an empty slice.
   */
  bars?: BarJob;
}

/** A far declutter in flight: the bars it was built from, and its state once set up. */
interface BarJob {
  bars: BarAttrs[];
  job: FarDeclutter | null;
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

/** The typed arrays `from` concatenated into a new `Ctor`. */
function concat<A extends Float64Array | Float32Array | Uint32Array | Uint8Array>(
  Ctor: { new (n: number): A },
  from: A[]
): A {
  let n = 0;
  for (const a of from) n += a.length;
  const out = new Ctor(n);
  let o = 0;
  for (const a of from) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/**
 * The cells' parts as one cell, `cellId` MERGED_ID, in the given order: positions, part arrays
 * and encodings concatenated; startIndices offset by the vertices before each cell, ending with
 * the total vertex count. Only the fields the layers read are filled; the slot tables are empty.
 */
function joinCells(cells: Cell[]): { pack: TimedPackedCell; enc: EncodedParts } {
  let parts = 0;
  for (const c of cells) parts += c.pack.partCount;
  const startIndices = new Uint32Array(parts + 1);
  let k = 0;
  let verts = 0;
  for (const { pack } of cells) {
    for (let i = 0; i < pack.partCount; i++) startIndices[k++] = pack.startIndices[i] + verts;
    verts += pack.positions.length / 2;
  }
  startIndices[parts] = verts;
  const packs = cells.map((c) => c.pack);
  const encs = cells.map((c) => c.enc);
  const pack: TimedPackedCell = {
    cellId: MERGED_ID,
    parcelIds: [],
    parcelMeta: new Uint32Array(0),
    partCount: parts,
    startIndices,
    positions: concat(
      Float64Array,
      packs.map((p) => p.positions)
    ),
    partTopM: concat(
      Float32Array,
      packs.map((p) => p.partTopM)
    ),
    partSlot: new Uint32Array(0),
    partAppearance: concat(
      Uint8Array,
      packs.map((p) => p.partAppearance)
    ),
    partTypology: concat(
      Uint8Array,
      packs.map((p) => p.partTypology)
    ),
    slotProjectIds: [],
    partWindow: new Float32Array(0),
    slotStages: new Float32Array(0),
    slotEnd: new Float32Array(0),
    slotPathway: new Uint8Array(0),
    slotCohort: new Uint8Array(0)
  };
  const enc: EncodedParts = {
    tlA: concat(
      Float32Array,
      encs.map((e) => e.tlA)
    ),
    tlB: concat(
      Float32Array,
      encs.map((e) => e.tlB)
    ),
    tlC: concat(
      Float32Array,
      encs.map((e) => e.tlC)
    )
  };
  return { pack, enc };
}

export class TimelineController {
  private lastRevision = -1;
  private cells = new Map<string, Cell>();
  private queue: Slice[] = [];
  /** Cells installed since construction (cumulative; the run-switch bench reads it). */
  private installs = 0;
  private overlay: Layer[] = [];
  private rafHandle: number | null = null;
  private current: Layer[] = [];
  private destroyed = false;
  private readonly clock: TimelineClock;
  private readonly ext: TimelapseExtension;
  private readonly pump: DemolishPump;
  private lookups: TimelineLookups | null = null;
  private chance: ChanceTexture | null = null;
  /** Bumped by `setLookups`; a cell takes it as its `tlc` when it is (re-)encoded. */
  private tlcVersion = 0;
  private bars: BarAttrs[] = [];
  private barsLayer: Layer | null = null;
  /** Cells changed since the bars were last built. */
  private barsDirty = false;
  /** `setBarMode`: how the bars declutter and draw ('street', the default, is today's). */
  private barMode: BarMode = 'street';
  /**
   * The far declutter in flight, run in `bars` slices; the bar layer on the map stays until it
   * ends and swaps in once. Cell updates do not stop it (it is newer than the layer on the map;
   * they mark the bars dirty, so one more run follows). Dropped, never swapped in, on a revision
   * 0, `setLookups`, a bar mode change and `destroy`.
   */
  private barJob: BarJob | null = null;
  /** `setHalos`: policy marks show for events after this day; null (the default) emits no halo layer. */
  private haloFrom: Day | null = null;
  private halos: HaloAttrs[] = [];
  private halosLayer: Layer | null = null;
  /** Cells installed or removed since the halos were last built (a re-encode does not count). */
  private halosDirty = false;
  /** The citywide feed's markers (`TimelineUpdate.city`), by world row. */
  private city = new CityStore();
  private warnedNoLookups = false;
  /**
   * Cells of earlier runs a swap has not yet installed over. They stay on the map until an
   * update with `complete: true` has installed, then go in that frame. Carried across swaps.
   */
  private leftover = new Set<string>();
  /** From a swap's revision 0 until its leftovers go: slices use SWAP_CELLS_PER_SLICE. */
  private swapping = false;
  /** `setMerged`: one solid and one ghost layer over every cell in place of the per-cell pairs. */
  private merged = false;
  /** The merged pair, built by `emit` while merged; null with no parts (or not built yet). */
  private mergedLayers: { solid: Layer; ghost: Layer } | null = null;
  /** A cell's layers were built or a cell went since the merged pair was built. */
  private mergeDirty = true;
  /** The merged layers' `updateTriggers.getTlC`, bumped at each join. */
  private mergeCount = 0;

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

  /** The demolish pump's largest feature-state call count in one frame (bench reporting). */
  get demolishMaxFrameOps(): number {
    return this.pump.maxFrameOps;
  }

  apply(u: TimelineUpdate): void {
    if (this.destroyed) return;
    if (u.revision !== 0 && u.revision !== this.lastRevision + 1) {
      this.deps.onResyncNeeded();
      return;
    }
    for (const c of u.cells) validateTimedCell(c);
    if (u.city) validateCityDelta(u.city);
    if (u.revision === 0) return u.swap ? this.swap(u) : this.snapshot(u);
    this.lastRevision = u.revision;
    if (u.city) this.city.apply(u.city, false);
    if (u.restore?.length || u.demolish.length) this.pump.amend(u.demolish, u.restore ?? []);
    const slices = this.plan(u);
    if (slices.length === 0) {
      // City-only (a `from` with no rows included): the markers are stored; nothing is drawn
      // from them.
      return; // band-only
    }
    // Cells change. A far declutter in flight carries on and swaps in (it is newer than the
    // bars on the map); the installs mark the bars dirty, so one more run starts after it.
    const idle = this.queue.length === 0;
    this.queue.push(...slices);
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
   * Stores the lookups and packs a new chance texture. Every installed cell's tlC (typical
   * construction days) is re-encoded in the slice queue, at most MAX_CELLS_PER_SLICE cells a
   * frame and none in this call, so a revision 0 that follows in the same task drops the work.
   * Cells a queued slice is about to install are skipped: they install with these lookups. The
   * bars are rebuilt once the queue has drained. `packChanceTexture` throws a `RangeError` on a
   * row longer than 2048; nothing changes then.
   */
  setLookups(l: TimelineLookups): void {
    if (this.destroyed) return;
    const chance = packChanceTexture(l.chance, l.inFlight?.chance);
    this.lookups = l;
    this.chance = chance;
    this.tlcVersion++;
    if (this.lastRevision < 0) return;
    const queued = new Set<string>();
    for (const s of this.queue) for (const c of s.cells) queued.add(c.cellId);
    const ids = [...this.cells.keys()].filter((id) => !queued.has(id)).sort();
    this.cancelBars();
    this.barsDirty = true;
    for (let i = 0; i < ids.length; i += MAX_CELLS_PER_SLICE)
      this.queue.push({ cells: [], removed: [], reencode: ids.slice(i, i + MAX_CELLS_PER_SLICE) });
    if (this.queue.length > 0) return this.schedule();
    this.rebuildBars(); // no cells: only the bars depend on the lookups
    if (!this.barJob) this.emit(); // far: the last declutter slice emits
    this.schedule();
  }

  /** One merged solid and ghost layer over every cell while on; per-cell layers while off. */
  setMerged(on: boolean): void {
    if (this.destroyed || on === this.merged) return;
    this.merged = on;
    // Off: drop the join (a copy of every cell); per-cell layers are kept current while merged.
    this.mergedLayers = null;
    this.mergeDirty = true;
    if (this.lastRevision >= 0) this.emit();
  }

  setTheme(t: Theme): void {
    if (t === this.theme) return;
    this.theme = t;
    this.clock.theme = t;
    if (this.destroyed) return;
    for (const cell of this.cells.values()) this.buildCellLayers(cell);
    if (this.lastRevision >= 0) this.emit();
  }

  /**
   * Halos and marks for the events after `from` (the dataset date), or none (`null`, the default).
   * Rebuilds them once when the value changes; before the first `apply` it is only kept.
   */
  setHalos(o: { from: Day } | null): void {
    const from = o === null ? null : o.from;
    if (from !== null && !Number.isFinite(from))
      throw new RangeError(`setHalos: from must be finite, got ${from}`);
    if (this.destroyed || from === this.haloFrom) return;
    this.haloFrom = from;
    if (this.lastRevision < 0) return;
    this.rebuildHalos();
    this.emit();
  }

  /**
   * How the bars draw: 'street' (the default) or 'far' (docs/dev/map-interfaces.md "Bar modes").
   * A change rebuilds the bars once (declutter in the mode, a new layer with `far`); the same
   * mode again does nothing; before the first `apply` it is only kept.
   */
  setBarMode(mode: BarMode): void {
    if (mode !== 'street' && mode !== 'far')
      throw new RangeError(`setBarMode: mode must be 'street' or 'far', got ${String(mode)}`);
    if (this.destroyed || mode === this.barMode) return;
    this.barMode = mode;
    if (this.lastRevision < 0) return;
    // Queued slices end in a rebuild that reads the mode; otherwise rebuild now.
    this.cancelBars();
    if (this.queue.length > 0) {
      this.barsDirty = true;
      return;
    }
    this.rebuildBars();
    if (!this.barJob) this.emit(); // far: the last declutter slice emits
    this.schedule();
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

  /**
   * Counts for e2e and the bench. Debug only, O(parts + records): never called per frame. The
   * shown counts read the map's camera through `deps.debugView` (zoom Infinity without one).
   */
  debugSnapshot(): TimelineSnapshot {
    let parts = 0;
    let flagged = 0;
    let projects = 0;
    for (const cell of this.cells.values()) {
      const p = cell.pack;
      parts += p.partCount;
      const drawn = new Set<number>();
      for (let k = 0; k < p.partCount; k++) drawn.add(p.partSlot[k]);
      projects += drawn.size;
      if (!p.slotFlags) continue;
      for (const s of drawn) if (p.slotFlags[s] !== 0) flagged++;
    }
    const view = this.deps.debugView?.() ?? null;
    const zoom = view ? view.zoom : Infinity;
    const shown = this.halosLayer ? this.halos : [];
    let marksShown = 0;
    for (const h of shown) if (evalHalo(h, this.clock.day, zoom)) marksShown++;
    const barsShown = this.barsShown(view);
    return {
      revision: this.lastRevision,
      cells: this.cells.size,
      parts,
      bars: this.barsLayer ? this.bars.length : 0,
      day: this.clock.day,
      demolish: { total: this.pump.total, applied: this.pump.applied },
      // Queued slices + a scheduled pump frame. 0 = layers and feature-state have converged.
      pending: this.queue.length + (this.pump.pending ? 1 : 0),
      installs: this.installs,
      layerIds: this.current.map((l) => l.id),
      marks: shown.length,
      marksShown,
      flagged,
      projects,
      cityMarkers: this.city.size,
      cityFlagged: this.city.flagged,
      barMode: this.barMode,
      barsShown
    };
  }

  /**
   * Bars `evalBar` shows on the clock's day at the zoom at each anchor, anchors in the view (the
   * raised anchor the shader projects; the bar's px offset above it is ignored). Debug only.
   */
  private barsShown(view: DebugView | null): number {
    const l = this.lookups;
    if (!this.barsLayer || !l) return 0;
    const mode = this.barMode;
    const focalW = view ? view.clip(view.centre[0], view.centre[1])[2] : 1;
    let n = 0;
    for (const b of this.bars) {
      let zoom = Infinity;
      if (view) {
        // At the bar's raised anchor, as the shader projects it.
        const [x, y, w] = view.clip(b.anchor[0], b.anchor[1], b.anchor[2]);
        if (!(w > 0 && Math.abs(x) <= w && Math.abs(y) <= w)) continue;
        zoom = barZoomAt(view.zoom, focalW, w, mode);
      }
      if (evalBar(b, l, this.clock.day, zoom, mode).visible) n++;
    }
    return n;
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelFrame();
    this.pump.destroy();
    this.queue = [];
    this.cells.clear();
    this.leftover.clear();
    this.bars = [];
    this.barsLayer = null;
    this.barJob = null;
    this.halos = [];
    this.halosLayer = null;
    this.mergedLayers = null;
    this.city.clear();
    this.current = [];
  }

  // -------------------------------------------------------------------------------------------

  /** Revision 0: drop queued slices, cells and bars, replace the demolish list, then install. */
  private snapshot(u: TimelineUpdate): void {
    this.cancelFrame();
    this.queue = [];
    this.barJob = null;
    this.cells.clear();
    this.mergeDirty = true;
    this.leftover.clear();
    this.swapping = false;
    this.bars = [];
    this.barsLayer = null;
    this.barsDirty = true;
    this.halos = [];
    this.halosLayer = null;
    this.halosDirty = true;
    this.replaceCity(u);
    this.pump.replace(u.demolish);
    this.lastRevision = 0;
    const slices = this.plan(u);
    this.queue = slices.length > 0 ? slices : [{ cells: [], removed: [], reencode: [] }];
    this.runSlice(this.queue.shift()!);
    this.schedule();
  }

  /**
   * A swap's revision 0: install the new run over the one on the map, which never blanks. Queued
   * installs are dropped (a superseded run's cells never install); queued re-encodes of cells
   * still on the map are kept, after the new run's slices. Every installed cell and the bars
   * stay; the cells become leftovers until a `complete` update has installed. The demolish list
   * converges by a diff.
   */
  private swap(u: TimelineUpdate): void {
    this.cancelFrame();
    this.cancelBars();
    const reencode: string[] = [];
    for (const s of this.queue)
      for (const id of s.reencode) if (this.cells.has(id)) reencode.push(id);
    for (const id of this.cells.keys()) this.leftover.add(id);
    this.swapping = true;
    this.replaceCity(u);
    this.pump.swap(u.demolish);
    this.lastRevision = 0;
    const slices = this.plan(u);
    for (let i = 0; i < reencode.length; i += MAX_CELLS_PER_SLICE)
      slices.push({ cells: [], removed: [], reencode: reencode.slice(i, i + MAX_CELLS_PER_SLICE) });
    this.queue = slices.length > 0 ? slices : [{ cells: [], removed: [], reencode: [] }];
    this.runSlice(this.queue.shift()!);
    this.schedule();
  }

  /**
   * The update's slices at the current budget. A `complete` update during a swap ends with a
   * slice marked `complete` (an empty one if the update is band-only).
   */
  private plan(u: TimelineUpdate): Slice[] {
    const slices = planTimelineSlices(
      u,
      this.swapping ? SWAP_CELLS_PER_SLICE : MAX_CELLS_PER_SLICE
    );
    if (u.complete && this.swapping) {
      if (slices.length === 0) slices.push({ cells: [], removed: [], reencode: [] });
      slices[slices.length - 1].complete = true;
    }
    return slices;
  }

  private runSlice(slice: Slice): void {
    // A far declutter step that does not finish changes nothing on the map: no emit.
    if (slice.bars && !this.stepBars(slice.bars)) return;
    for (const id of slice.removed) {
      // During a swap a removed cell stays as a leftover, so the map never thins mid-switch.
      if (this.swapping) {
        if (this.cells.has(id)) this.leftover.add(id);
      } else if (this.cells.delete(id)) this.barsDirty = this.halosDirty = this.mergeDirty = true;
    }
    for (const pack of slice.cells) this.install(pack);
    for (const id of slice.reencode) {
      const cell = this.cells.get(id);
      // Gone (a removed cell), or (re)installed with the current lookups since the slice was made.
      if (!cell || cell.encodedWith === this.lookups) continue;
      this.encode(cell);
      this.buildCellLayers(cell);
    }
    if (slice.complete) {
      for (const id of this.leftover)
        if (this.cells.delete(id)) this.barsDirty = this.halosDirty = this.mergeDirty = true;
      this.leftover.clear();
      this.swapping = false;
    }
    // Bars and halos are rebuilt once per update, when its last slice has installed (a far
    // run's own steps do not hold them back). Dirty bars wait for the run in flight to swap in,
    // then rebuild.
    if (this.drained()) {
      if (this.barsDirty && !this.barJob) this.rebuildBars();
      if (this.halosDirty) this.rebuildHalos();
    }
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
    const cell = { pack } as Cell;
    this.encode(cell);
    cell.tl = {
      getTlA: vec4Accessor(cell, 'tlA'),
      getTlB: vec4Accessor(cell, 'tlB'),
      getTlC: vec4Accessor(cell, 'tlC')
    };
    this.buildCellLayers(cell);
    this.cells.set(pack.cellId, cell);
    this.leftover.delete(pack.cellId);
    this.installs++;
    this.barsDirty = this.halosDirty = true;
  }

  private encode(cell: Cell): void {
    cell.enc = encodeParts(cell.pack, this.lookups);
    cell.encodedWith = this.lookups;
    cell.tlc = this.tlcVersion;
  }

  /**
   * Street: builds, declutters and lays out the bars now. Far: builds the bars now and queues
   * the declutter (`bars` slices: its setup, then FAR_UNITS_PER_SLICE units a slice); the bar
   * layer on the map stays until the last step swaps the new one in.
   */
  private rebuildBars(): void {
    this.barsDirty = false;
    this.barJob = null;
    const l = this.lookups;
    if (!l || !this.chance) {
      this.bars = [];
      this.barsLayer = null;
      return;
    }
    const sorted = [...this.cells].sort(byKey).map(([, c]) => c.pack);
    const bars = buildBars(sorted, l);
    if (this.barMode === 'far') {
      const job: BarJob = { bars, job: null };
      this.barJob = job;
      this.queue.push({ cells: [], removed: [], reencode: [], bars: job });
      return;
    }
    this.layBars(declutter(bars));
  }

  /** The bar layer over `bars` (decluttered records), in the current mode. */
  private layBars(bars: BarAttrs[]): void {
    this.bars = bars;
    this.barsLayer = new this.deps.StageBarLayer({
      data: bars,
      chance: this.chance,
      clock: this.clock,
      far: this.barMode === 'far',
      ...(this.labelBeforeId ? { beforeId: this.labelBeforeId } : {})
    } as ConstructorParameters<TimelineDeps['StageBarLayer']>[0]) as unknown as Layer;
  }

  /**
   * One `bars` slice: the far declutter's setup, or its next FAR_UNITS_PER_SLICE units. Queues
   * the next slice, or lays the records out once every unit is visited. True when this slice
   * changed the map (the swap) or its job is no longer the one in flight (a dropped one): the
   * slice then runs as any.
   */
  private stepBars(b: BarJob): boolean {
    if (b !== this.barJob) return true;
    const more = () => this.queue.push({ cells: [], removed: [], reencode: [], bars: b });
    if (!b.job) {
      b.job = new FarDeclutter(b.bars);
      more();
      return false;
    }
    if (!b.job.step(FAR_UNITS_PER_SLICE)) {
      more();
      return false;
    }
    this.barJob = null;
    this.layBars(b.job.result());
    return true;
  }

  /**
   * Drops a far declutter in flight (a revision 0, new lookups, a mode change): its queued step
   * goes and it never swaps in; the bars rebuild when the cell slices drain.
   */
  private cancelBars(): void {
    if (!this.barJob) return;
    this.barJob = null;
    this.barsDirty = true;
    this.queue = this.queue.filter((s) => !s.bars);
  }

  /** No cell, removal or re-encode slice is queued: only far declutter steps, or nothing. */
  private drained(): boolean {
    return this.queue.every((s) => s.bars);
  }

  /** Halo records from the installed cells, in cellId order; no lookups needed. */
  private rebuildHalos(): void {
    this.halosDirty = false;
    const from = this.haloFrom;
    if (from === null) {
      this.halos = [];
      this.halosLayer = null;
      return;
    }
    const sorted = [...this.cells].sort(byKey).map(([, c]) => c.pack);
    const halos = buildHalos(sorted, from);
    this.halos = halos;
    this.halosLayer = new this.deps.HaloLayer({
      data: halos,
      clock: this.clock,
      ...(this.labelBeforeId ? { beforeId: this.labelBeforeId } : {})
    } as ConstructorParameters<TimelineDeps['HaloLayer']>[0]) as unknown as Layer;
  }

  /** A revision 0's city replaces the store whole; without one (no feed) the store empties. */
  private replaceCity(u: TimelineUpdate): void {
    if (u.city) this.city.apply(u.city, true);
    else this.city.clear();
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
    cell.solid = has ? this.makeLayer(cell, 0, cell.pack.cellId) : null;
    cell.ghost = has ? this.makeLayer(cell, 1, cell.pack.cellId) : null;
    this.mergeDirty = true;
  }

  /**
   * A cell's layer (`suffix` its cellId, culled per cell) or a merged one (`suffix` MERGED_ID,
   * never culled). Nothing else differs, so the two draw alike.
   */
  private makeLayer(cell: Pick<Cell, 'pack' | 'tl' | 'tlc'>, pass: 0 | 1, suffix: string): Layer {
    const theme = this.theme;
    const id = `timeline-${pass === 0 ? 'solid' : 'ghost'}-${suffix}`;
    return new this.deps.SolidPolygonLayer<unknown, TimelapseExtensionProps>({
      id,
      ...accessorsFor(cell.pack, theme, suffix !== MERGED_ID),
      ...cell.tl,
      extruded: true,
      _normalize: false,
      _windingOrder: 'CW',
      elevationScale: 1,
      extensions: [this.ext],
      timelapsePass: pass,
      updateTriggers: { getFillColor: theme, getTlC: cell.tlc },
      pickable: true,
      ...(pass === 0
        ? { autoHighlight: true, highlightColor: hexToRgba(TOKENS[theme].highlight) }
        : { parameters: { depthWriteEnabled: false } }),
      ...(this.labelBeforeId ? { beforeId: this.labelBeforeId } : {})
    } as TimelineLayerProps) as unknown as Layer;
  }

  /**
   * The merged pair over every cell with parts, in cellId order (the per-cell emit order); null
   * when no cell has parts. Joined again only when a cell's layers were built or a cell went
   * since, and then once per update: while cell, removal or re-encode slices are queued the
   * previous pair stays (as the bars and halos wait), unless there is none yet.
   */
  private mergedPair(sorted: [string, Cell][]): { solid: Layer; ghost: Layer } | null {
    if (!this.mergeDirty || (this.mergedLayers && !this.drained())) return this.mergedLayers;
    this.mergeDirty = false;
    const cells = sorted.map(([, c]) => c).filter((c) => c.pack.partCount > 0);
    if (cells.length === 0) return (this.mergedLayers = null);
    const join = joinCells(cells);
    const tl = {
      getTlA: vec4Accessor(join, 'tlA'),
      getTlB: vec4Accessor(join, 'tlB'),
      getTlC: vec4Accessor(join, 'tlC')
    };
    const cell = { pack: join.pack, tl, tlc: ++this.mergeCount };
    return (this.mergedLayers = {
      solid: this.makeLayer(cell, 0, MERGED_ID),
      ghost: this.makeLayer(cell, 1, MERGED_ID)
    });
  }

  /**
   * Solids by cellId, then ghosts by cellId (merged: `timeline-solid-run`, `timeline-ghost-run`),
   * then `timeline-bars`, then `timeline-halos`, then the overlay.
   */
  private emit(): void {
    if (this.destroyed) return;
    const sorted = [...this.cells].sort(byKey);
    const solids: Layer[] = [];
    const ghosts: Layer[] = [];
    if (this.merged) {
      const pair = this.mergedPair(sorted);
      if (pair) {
        solids.push(pair.solid);
        ghosts.push(pair.ghost);
      }
    } else
      for (const [, c] of sorted) {
        if (c.solid) solids.push(c.solid);
        if (c.ghost) ghosts.push(c.ghost);
      }
    this.current = [
      ...solids,
      ...ghosts,
      ...(this.barsLayer ? [this.barsLayer] : []),
      ...(this.halosLayer ? [this.halosLayer] : []),
      ...this.overlay
    ];
    this.deps.setLayers(this.current);
  }
}

/** At most `per` cells + removed cells per slice, in update order (§4.1). */
function planTimelineSlices(u: TimelineUpdate, per: number): Slice[] {
  const units: [TimedPackedCell | null, string | null][] = [
    ...u.cells.map((c): [TimedPackedCell, null] => [c, null]),
    ...u.removedCells.map((id): [null, string] => [null, id])
  ];
  const out: Slice[] = [];
  for (let i = 0; i < units.length; i += per) {
    const slice: Slice = { cells: [], removed: [], reencode: [] };
    for (const [c, id] of units.slice(i, i + per)) {
      if (c) slice.cells.push(c);
      else slice.removed.push(id!);
    }
    out.push(slice);
  }
  return out;
}
