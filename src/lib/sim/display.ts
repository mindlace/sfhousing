// Worker host display layer (spec §4.9 "Diffs", "Generation", "Score"). Pure TS, worker-safe:
// no zod, no DOM, no $app. Turns per-parcel envelope changes into generated buildings, keeps the
// per-cell buildings, hide set and score accumulator, and posts map-view's GeneratedUpdate diffs.
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import { packCell, packTransferables, type PackInput } from '$lib/map/pack';
import type { GeneratedUpdate, PackedCell } from '$lib/map/types';
import type { Envelope } from '$lib/plan';
import { createScoreAccumulator, type Target } from '$lib/scoreboard';
import type { DiffPhase, DiffResponse, OpStats } from './protocol';

export interface DisplayDeps {
  record(id: ParcelId): ParcelRecord | undefined;
  cellOf(id: ParcelId): string | undefined;
  /**
   * Generate for (rec, env), deterministic in content. The host memoises it in a bounded LRU, so
   * equal inputs usually, but not always, give the same object: correctness here must never
   * depend on identity.
   */
  build(rec: ParcelRecord, env: Envelope): GeneratedBuilding | null;
  targets: readonly Target[];
  post(msg: DiffResponse, transfer: ArrayBuffer[]): void;
  batchParcels: number; // 5000
}

export interface UpdateMeta {
  rev: number;
  phase: DiffPhase;
  stats?: OpStats; // attached to the last diff of this update only
  complete(): boolean; // evaluated per diff
}

export interface Display {
  /** Envelope currently rendered for id (null = none). */
  renderedEnv(id: ParcelId): Envelope | null;
  building(id: ParcelId): GeneratedBuilding | null;
  /**
   * Re-derives each id's building from envFor(id), in ascending cell then id order, applying
   * changes to the accumulator and hide set, and posts ≥ 1 diff (an empty one when nothing changed).
   */
  update(
    ids: Iterable<ParcelId>,
    envFor: (id: ParcelId) => Envelope | null,
    meta: UpdateMeta
  ): void;
  /** Forget everything; the next update's first diff is a revision-0 snapshot. */
  reset(): void;
  readonly revision: number; // last revision posted, -1 before any
}

interface Batch {
  cells: Map<string, Set<ParcelId>>; // touched cell → rising ids
  count: number;
  hideAdd: ParcelId[];
  hideRemove: ParcelId[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function maxTop(b: GeneratedBuilding): number {
  let m = -Infinity;
  for (const p of b.parts) if (p.topM > m) m = p.topM;
  return m;
}

function sameEnv(a: Envelope | null, b: Envelope | null): boolean {
  if (a === null || b === null) return a === b;
  return a.maxStories === b.maxStories;
}

export function createDisplay(deps: DisplayDeps): Display {
  const renderedEnv = new Map<ParcelId, Envelope>();
  const buildings = new Map<string, Map<ParcelId, GeneratedBuilding>>();
  const hidden = new Set<ParcelId>();
  const acc = createScoreAccumulator(deps.targets);
  const sentCells = new Set<string>();
  let revision = -1;
  let snapshotNext = true;

  function buildingOf(id: ParcelId): GeneratedBuilding | null {
    const cell = deps.cellOf(id);
    if (cell === undefined) return null;
    return buildings.get(cell)?.get(id) ?? null;
  }

  function flush(batch: Batch, meta: UpdateMeta, last: boolean): void {
    const snapshot = snapshotNext;
    snapshotNext = false;
    revision = snapshot ? 0 : revision + 1;

    const cells: GeneratedUpdate['cells'] = [];
    const removedCells: string[] = [];
    const transfer: ArrayBuffer[] = [];
    const push = (settled: PackedCell, rising: PackedCell | null): void => {
      cells.push({ settled, rising });
      transfer.push(...packTransferables(settled));
      if (rising) transfer.push(...packTransferables(rising));
    };

    for (const cell of [...batch.cells.keys()].sort(cmp)) {
      const held = buildings.get(cell);
      const items: PackInput[] = [];
      if (held)
        for (const b of held.values())
          items.push({ building: b, existingUnits: deps.record(b.parcelId)?.existingUnits ?? 0 });
      if (items.length === 0) {
        if (!snapshot && sentCells.delete(cell)) removedCells.push(cell);
      } else if (snapshot) {
        push(packCell(cell, items), null);
        sentCells.add(cell);
      } else {
        const risingIds = batch.cells.get(cell)!;
        const settled = items.filter((i) => !risingIds.has(i.building.parcelId));
        const rising = items.filter((i) => risingIds.has(i.building.parcelId));
        push(packCell(cell, settled), rising.length ? packCell(cell, rising) : null);
        sentCells.add(cell);
      }
    }

    const render: GeneratedUpdate = {
      revision,
      cells,
      removedCells,
      hide: { add: batch.hideAdd, remove: batch.hideRemove }
    };
    deps.post(
      {
        type: 'diff',
        rev: meta.rev,
        phase: meta.phase,
        render,
        ...(last && meta.stats ? { stats: meta.stats } : {}),
        complete: meta.complete(),
        score: acc.snapshot()
      },
      transfer
    );

    batch.cells = new Map();
    batch.count = 0;
    batch.hideAdd = [];
    batch.hideRemove = [];
  }

  function update(
    ids: Iterable<ParcelId>,
    envFor: (id: ParcelId) => Envelope | null,
    meta: UpdateMeta
  ): void {
    const byCell = new Map<string, ParcelId[]>();
    const seen = new Set<ParcelId>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (!deps.record(id)) continue;
      const cell = deps.cellOf(id);
      if (cell === undefined) continue;
      const list = byCell.get(cell);
      if (list) list.push(id);
      else byCell.set(cell, [id]);
    }

    const batch: Batch = { cells: new Map(), count: 0, hideAdd: [], hideRemove: [] };
    for (const cell of [...byCell.keys()].sort(cmp)) {
      const cellIds = byCell.get(cell)!.sort(cmp);
      const pending: { id: ParcelId; env: Envelope | null }[] = [];
      for (const id of cellIds) {
        const env = envFor(id);
        if (!sameEnv(env, renderedEnv.get(id) ?? null)) pending.push({ id, env });
      }
      if (pending.length === 0) continue;
      if (batch.count > 0 && batch.count + pending.length > deps.batchParcels)
        flush(batch, meta, false);

      for (const { id, env } of pending) {
        const rec = deps.record(id)!;
        const held = buildings.get(cell);
        const prev = held?.get(id) ?? null;
        const next = env ? deps.build(rec, env) : null;
        if (env) renderedEnv.set(id, env);
        else renderedEnv.delete(id);
        // A shortcut only, never a correctness assumption. pending holds only changed envs, so
        // prev and next come from different memo keys and this fires for null → null alone. An
        // equal but distinct object (a memo eviction) would take the value-based path below
        // (acc.set, replacesExisting, maxTop) and render the same parcels.
        if (next === prev) continue;

        if (next) {
          if (held) held.set(id, next);
          else buildings.set(cell, new Map([[id, next]]));
        } else if (held) {
          held.delete(id);
          if (held.size === 0) buildings.delete(cell);
        }
        acc.set(rec, next);

        if (prev?.replacesExisting && !next?.replacesExisting) {
          hidden.delete(id);
          batch.hideRemove.push(id);
        }
        if (next?.replacesExisting && !prev?.replacesExisting) {
          hidden.add(id);
          batch.hideAdd.push(id);
        }

        let rising = batch.cells.get(cell);
        if (!rising) {
          rising = new Set();
          batch.cells.set(cell, rising);
        }
        if (next && (!prev || maxTop(next) > maxTop(prev))) rising.add(id);
      }
      batch.count += pending.length;
    }
    flush(batch, meta, true); // always: guarantees ≥ 1 diff per update (R4)
  }

  return {
    renderedEnv: (id) => renderedEnv.get(id) ?? null,
    building: buildingOf,
    update,
    reset() {
      renderedEnv.clear();
      buildings.clear();
      hidden.clear();
      acc.clear();
      sentCells.clear();
      snapshotNext = true;
    },
    get revision() {
      return revision;
    }
  };
}
