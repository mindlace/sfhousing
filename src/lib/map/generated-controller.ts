// Owns the deck generated-building layers: revision ordering, rise-in, hide batching and the
// overlay-layer slot (spec §4.5, §4.6, §4.12). deck is type-only here: the layer class arrives
// through deps so deck stays lazy.
import type { Layer } from '@deck.gl/core';
import type { SolidPolygonLayer } from '@deck.gl/layers';
import type { ParcelId } from '$lib/data/parcel';
import type { TypologyId } from '$lib/generator';
import { applyHideDiff, planSlices, type Slice } from './hide';
import { concatPacks } from './pack';
import { GEN_RGBA, TOKENS, hexToRgba, type RGBA } from './palette';
import { TYPOLOGY_ORDER, type GeneratedUpdate, type PackedCell, type Theme } from './types';

export interface ControllerDeps {
  setLayers(layers: Layer[]): void; // overlay.setProps({ layers })
  setReplaced(id: ParcelId): void; // setFeatureState({source:'buildings', sourceLayer:'buildings', id}, {replaced:true})
  clearReplaced(id: ParcelId): void; // removeFeatureState({…id}, 'replaced')
  clearAllReplaced(): void; // removeFeatureState({source:'buildings', sourceLayer:'buildings'})
  SolidPolygonLayer: typeof SolidPolygonLayer;
  raf(cb: (t: number) => void): number;
  cancelRaf(h: number): void;
  now(): number;
  reducedMotion(): boolean; // live matchMedia check
  onResyncNeeded(): void;
}

export const RISE_MS = 400;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export interface PartLookup {
  parcelId: ParcelId;
  typology: TypologyId;
  stories: number;
  units: number;
  existingUnits: number;
}

export interface LayerAttributes {
  vertexCount: number;
  firstColor: number[];
}

export interface ControllerSnapshot {
  revision: number;
  cells: number;
  parts: number;
  hidden: number;
  layerIds: string[];
  elevationScale: Record<string, number>;
  /** Read from deck's attribute manager once a layer has been rendered (C3). */
  attributes: Record<string, LayerAttributes>;
  /** Queued slices + rising cells + pending merges. 0 = fully drained. */
  pending: number;
}

type Accessor<T> = (o: unknown, info: { index: number }) => T;

interface Rise {
  pack: PackedCell;
  rev: number;
  start: number;
  order: number;
  scale: number;
  layer: Layer;
}

interface Cell {
  settled: PackedCell;
  layer: Layer | null; // null when settled has no parts
  rise: Rise | null;
}

interface Job {
  rev: number;
  slice: Slice;
  animate: boolean;
}

interface PackCache {
  data: { length: number; startIndices: Uint32Array; attributes: object };
  getElevation: Accessor<number>;
  fill: Partial<Record<Theme, Accessor<RGBA>>>;
}

// Created once per pack (data, elevation) and per (pack, theme) (fill colour).
const packCache = new WeakMap<PackedCell, PackCache>();

function accessorsFor(pack: PackedCell, theme: Theme) {
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
    packCache.set(pack, c);
  }
  let fill = c.fill[theme];
  if (!fill) {
    const palette = GEN_RGBA[theme];
    const { partTypology } = pack;
    fill = c.fill[theme] = (_, { index }) => palette[partTypology[index]];
  }
  return { data: c.data, getElevation: c.getElevation, getFillColor: fill };
}

const RESERVED = /^(generated|rising)-/;

// sfh-slice measures feed the C5 budget tests (dev) and e2e builds; production builds skip
// them so they never accumulate in the performance timeline.
const MEASURE = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';

const idsOf = (c: GeneratedUpdate['cells'][number]): ParcelId[][] =>
  c.rising ? [c.settled.parcelIds, c.rising.parcelIds] : [c.settled.parcelIds];

export class GeneratedController {
  private lastRevision = -1;
  private cells = new Map<string, Cell>();
  /** Parcel ids per cell as of the latest accepted revision (queued slices included). */
  private membership = new Map<string, ParcelId[][]>();
  private mirror = new Set<ParcelId>();
  private queue: Job[] = [];
  private merges: string[] = [];
  private overlay: Layer[] = [];
  private riseSeq = 0;
  private rafHandle: number | null = null;
  private layerPacks = new Map<string, PackedCell>();
  private current: Layer[] = [];
  private destroyed = false;

  constructor(
    private deps: ControllerDeps,
    private theme: Theme
  ) {}

  get hidden(): ReadonlySet<ParcelId> {
    return this.mirror;
  }

  apply(u: GeneratedUpdate): void {
    if (this.destroyed) return;
    if (u.revision === 0) return this.snapshot(u);
    if (u.revision !== this.lastRevision + 1) {
      this.deps.onResyncNeeded();
      return;
    }
    this.lastRevision = u.revision;
    // A touched cell's pending rise finalises when its own slice runs (install / removal).
    const jobs = planSlices(u, this.prevCellLookup(u)).map((slice): Job => ({
      rev: u.revision,
      slice,
      animate: true
    }));
    for (const c of u.cells) this.membership.set(c.settled.cellId, idsOf(c));
    for (const id of u.removedCells) this.membership.delete(id);
    const idle = this.queue.length === 0;
    this.queue.push(...jobs);
    if (idle) this.runJob(this.queue.shift()!);
    this.schedule();
  }

  setTheme(t: Theme): void {
    if (t === this.theme) return;
    this.theme = t;
    for (const cell of this.cells.values()) {
      cell.layer = this.settledLayer(cell.settled);
      const r = cell.rise;
      if (r) r.layer = this.makeLayer(`rising-${r.rev}-${cell.settled.cellId}`, r.pack, r.scale);
    }
    this.emit();
  }

  setOverlayLayers(layers: Layer[]): void {
    for (const l of layers)
      if (RESERVED.test(l.id)) throw new Error(`setOverlayLayers: reserved layer id ${l.id}`);
    this.overlay = [...layers];
    this.emit();
  }

  lookup(layerId: string, index: number): PartLookup | null {
    const p = this.layerPacks.get(layerId);
    if (!p || index < 0 || index >= p.partCount) return null;
    const s = p.partSlot[index];
    const m = p.parcelMeta;
    return {
      parcelId: p.parcelIds[s],
      typology: TYPOLOGY_ORDER[m[4 * s + 3]],
      stories: m[4 * s + 2],
      units: m[4 * s],
      existingUnits: m[4 * s + 1]
    };
  }

  debugSnapshot(): ControllerSnapshot {
    const elevationScale: Record<string, number> = {};
    const attributes: Record<string, LayerAttributes> = {};
    let parts = 0;
    let rising = 0;
    for (const cell of this.cells.values()) {
      parts += cell.settled.partCount + (cell.rise?.pack.partCount ?? 0);
      if (cell.rise) rising++;
    }
    for (const l of this.current) {
      if (!RESERVED.test(l.id)) continue;
      elevationScale[l.id] = (l.props as unknown as { elevationScale: number }).elevationScale;
      const a = readAttributes(l);
      if (a) attributes[l.id] = a;
    }
    return {
      revision: this.lastRevision,
      cells: this.cells.size,
      parts,
      hidden: this.mirror.size,
      layerIds: this.current.map((l) => l.id),
      elevationScale,
      attributes,
      pending: this.queue.length + rising + this.merges.length
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelFrame();
    this.queue = [];
    this.merges = [];
    this.cells.clear();
    this.membership.clear();
    this.layerPacks.clear();
    this.current = [];
  }

  // -------------------------------------------------------------------------------------------

  private snapshot(u: GeneratedUpdate): void {
    this.cancelFrame();
    this.queue = [];
    this.merges = [];
    this.cells.clear();
    this.membership.clear();
    this.mirror.clear();
    this.deps.clearAllReplaced();
    this.lastRevision = 0;
    // Never animated: rising installs as settled. Cells still ride with their hide slice.
    const cells = u.cells.map((c) => ({
      settled: c.rising ? concatPacks(c.settled, c.rising) : c.settled,
      rising: null
    }));
    for (const c of cells) this.membership.set(c.settled.cellId, idsOf(c));
    const slices = planSlices({
      ...u,
      cells,
      removedCells: [],
      hide: { add: u.hide.add, remove: [] }
    });
    this.queue = slices.map((slice) => ({ rev: 0, slice, animate: false }));
    this.runJob(this.queue.shift()!);
    this.schedule();
  }

  private runJob(job: Job): void {
    const t0 = MEASURE ? performance.now() : 0;
    const { slice } = job;
    for (const id of slice.removed) {
      this.finalise(id);
      this.cells.delete(id);
    }
    for (const id of slice.remove) this.deps.clearReplaced(id);
    for (const c of slice.cells) this.install(c.settled, c.rising, job);
    for (const id of slice.add) this.deps.setReplaced(id);
    applyHideDiff(this.mirror, slice);
    this.emit();
    if (MEASURE) performance.measure('sfh-slice', { start: t0, end: performance.now() });
  }

  /**
   * Previous cell of a parcel, among the cells this update touches. Built lazily: planSlices
   * asks only when the update is sliced and has removes.
   */
  private prevCellLookup(u: GeneratedUpdate): (id: ParcelId) => string | undefined {
    let index: Map<ParcelId, string> | null = null;
    return (id) => {
      if (!index) {
        index = new Map();
        const touched = [...u.cells.map((c) => c.settled.cellId), ...u.removedCells];
        for (const cellId of touched)
          for (const ids of this.membership.get(cellId) ?? [])
            for (const p of ids) index.set(p, cellId);
      }
      return index.get(id);
    };
  }

  private install(settled: PackedCell, rising: PackedCell | null, job: Job): void {
    const id = settled.cellId;
    this.finalise(id);
    const animate = rising && rising.partCount > 0 && job.animate && !this.deps.reducedMotion();
    if (rising && animate) {
      this.cells.set(id, {
        settled,
        layer: this.settledLayer(settled),
        rise: {
          pack: rising,
          rev: job.rev,
          start: this.deps.now(),
          order: this.riseSeq++,
          scale: 0,
          layer: this.makeLayer(`rising-${job.rev}-${id}`, rising, 0)
        }
      });
      return;
    }
    const pack = rising && rising.partCount > 0 ? concatPacks(settled, rising) : settled;
    this.cells.set(id, { settled: pack, layer: this.settledLayer(pack), rise: null });
  }

  /** Ends a cell's pending rise now: scale 1, merge into settled, drop the rising layer. */
  private finalise(id: string): void {
    const cell = this.cells.get(id);
    if (!cell?.rise) return;
    cell.settled = concatPacks(cell.settled, cell.rise.pack);
    cell.layer = this.settledLayer(cell.settled);
    cell.rise = null;
    const i = this.merges.indexOf(id);
    if (i >= 0) this.merges.splice(i, 1);
  }

  private frame = (): void => {
    this.rafHandle = null;
    if (this.destroyed) return;
    const now = this.deps.now();
    const toMerge = this.merges[0]; // finished on an earlier frame: scale 1 was drawn
    let dirty = false;
    for (const [id, cell] of this.cells) {
      const r = cell.rise;
      if (!r || r.scale >= 1) continue;
      r.scale = easeOutCubic(Math.min(1, Math.max(0, (now - r.start) / RISE_MS)));
      // New instance, same data and accessors: deck re-uploads only the uniform.
      r.layer = r.layer.clone({ elevationScale: r.scale } as Partial<Layer['props']>);
      dirty = true;
      if (r.scale >= 1) this.merges.push(id);
    }
    // At most one heavy step per frame: a hide slice (with its cells), else one merge.
    if (this.queue.length > 0) {
      this.runJob(this.queue.shift()!);
      dirty = false;
    } else if (toMerge !== undefined) {
      this.finalise(toMerge);
      dirty = true;
    }
    if (dirty) this.emit();
    this.schedule();
  };

  private schedule(): void {
    if (this.rafHandle !== null || this.destroyed) return;
    let rising = false;
    for (const c of this.cells.values()) if (c.rise) rising = true;
    if (this.queue.length > 0 || this.merges.length > 0 || rising)
      this.rafHandle = this.deps.raf(this.frame);
  }

  private cancelFrame(): void {
    if (this.rafHandle !== null) this.deps.cancelRaf(this.rafHandle);
    this.rafHandle = null;
  }

  private settledLayer(pack: PackedCell): Layer | null {
    return pack.partCount > 0 ? this.makeLayer(`generated-${pack.cellId}`, pack, 1) : null;
  }

  private makeLayer(id: string, pack: PackedCell, elevationScale: number): Layer {
    const theme = this.theme;
    return new this.deps.SolidPolygonLayer({
      id,
      ...accessorsFor(pack, theme),
      extruded: true,
      _normalize: false,
      _windingOrder: 'CW',
      elevationScale,
      updateTriggers: { getFillColor: theme },
      pickable: true,
      autoHighlight: true,
      highlightColor: hexToRgba(TOKENS[theme].highlight)
    } as ConstructorParameters<ControllerDeps['SolidPolygonLayer']>[0]) as unknown as Layer;
  }

  /** Settled by cellId, then rising by start order, then overlay layers. One setLayers call. */
  private emit(): void {
    const settled: [string, Layer][] = [];
    const rising: Rise[] = [];
    this.layerPacks.clear();
    for (const [id, cell] of this.cells) {
      if (cell.layer) {
        settled.push([id, cell.layer]);
        this.layerPacks.set(cell.layer.id, cell.settled);
      }
      if (cell.rise) {
        rising.push(cell.rise);
        this.layerPacks.set(cell.rise.layer.id, cell.rise.pack);
      }
    }
    settled.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    rising.sort((a, b) => a.order - b.order);
    this.current = [...settled.map((s) => s[1]), ...rising.map((r) => r.layer), ...this.overlay];
    this.deps.setLayers(this.current);
  }
}

/** Vertex count from the tessellator and the first vertex's fill colour, once deck has rendered. */
function readAttributes(layer: Layer): LayerAttributes | null {
  const live = layer.getCurrentLayer?.() ?? layer;
  const state = (live as unknown as { state?: { polygonTesselator?: { instanceCount: number } } })
    .state;
  const colors = live.getAttributeManager?.()?.getAttributes().fillColors?.value;
  const vertexCount = state?.polygonTesselator?.instanceCount;
  if (vertexCount === undefined || !colors || colors.length < 4) return null;
  return { vertexCount, firstColor: [0, 1, 2, 3].map((i) => colors[i]) };
}
