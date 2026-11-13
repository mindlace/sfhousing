// map-stream (spec S17): world 1's events to the map's whole-cell `TimelineUpdate`s. `onEvent`
// marks a project's cell dirty; `flush` packs dirty cells, oldest first, within a time budget.
//
// - A row's parcel ids come from the statics (not from `scheduleAt`), once per row. A project's
//   cell is the cell of its smallest T11 parcel (`cellAnchorParcel`); a parcel absent from T11 is
//   warned once and ignored, and a row with no T11 parcel gets no cell (as geometry.ts:96-121).
// - A cell is packed whole, from `scheduleAt(world, statics, row, lastDay)` of every project in it,
//   once every cell of every one of its projects is ready (rule 6); otherwise it keeps its place.
// - One massing per revision, memoised by the revision's content (rule 11).
//
// Worker-safe, under the determinism lint rule (no transcendental Math).
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { packTimedCell, type TimedPackInput } from '$lib/map/pack-timed';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import { createLru } from '$lib/sim/lru';
import {
  cellAnchorParcel,
  footprintParcel,
  massingFor,
  type MassingCtx
} from '$lib/sim/scenario/massing';
import type { Massing, Schedule } from '$lib/sim/scenario/types';
import { monthLastDay } from './months';
import { scheduleAt } from './read';
import type { Statics } from './statics';
import {
  ORIGIN_MASTER,
  ORIGIN_PHASE,
  ORIGIN_PIPELINE,
  ORIGIN_SIM,
  type World,
  type WorldEvent
} from './types';

/** Massings kept (today's `MEMO_CAP`, scenario-host.ts:253). */
export const MASSING_CAP = 60_000;

export interface MapStreamDeps {
  /** `records` answers for every parcel of every ready cell; `input.parcels` places cells. */
  massing: MassingCtx;
  /** True once the cell's chunk records answer `massing.records`. */
  cellReady(cellId: string): boolean;
  /** Logs once per key (a parcel absent from T11, an unpackable item). */
  warnOnce(key: string, msg: string): void;
  /** Budget clock in ms; default `performance.now`. */
  now?(): number;
  /** Test seam; default MASSING_CAP. */
  massingCap?: number;
}

export interface MapStream {
  onEvent(e: WorldEvent, world: World, statics: Statics): void;
  flush(world: World, statics: Statics, budgetMs: number): TimelineUpdate | null;
  rewind(world: World, statics: Statics): void;
  snapshot(world: World, statics: Statics): TimelineUpdate;
}

/** Where a row sits on the map: its anchor cell and every cell of its T11 parcels (anchor first). */
interface Placed {
  ids: ParcelId[];
  cells: string[];
}

const NOWHERE: Placed = { ids: [], cells: [] };

export function createMapStream(deps: MapStreamDeps, windowMonths: number): MapStream {
  const P = deps.massing.input.parcels;
  const now = deps.now ?? (() => performance.now());
  const massings = createLru<string, Massing>(deps.massingCap ?? MASSING_CAP);

  /** Per row, computed on its first event; `NOWHERE` for a master or a row without T11 parcel. */
  const placed: Placed[] = [];
  /** Anchor cell → its rows, in first-event order. */
  const rowsIn = new Map<string, Set<number>>();
  /** Dirty anchor cells in first-dirtied order (re-dirtying keeps the place). */
  const dirty = new Map<string, true>();
  let revision = 0;

  const cellOf = (id: ParcelId): string => P.cells[P.cell[P.index.get(id)!]].cellId;

  /** The row's parcel ids from the statics (read.ts:67, 105, 119, 126-135); none for a master. */
  function parcelIdsOf(world: World, statics: Statics, row: number): ParcelId[] {
    const p = world.projects;
    const origin = p.origin[row];
    if (origin === ORIGIN_SIM) return [statics.parcelId[p.src[row]]];
    if (origin === ORIGIN_PIPELINE) return statics.projects[p.src[row]].parcelIds;
    if (origin === ORIGIN_PHASE) {
      return (statics.projects[p.src[row]].phases ?? [])[p.sub[row] - 1].parcelIds;
    }
    if (origin === ORIGIN_MASTER) return [];
    throw new Error(`map-stream: row ${row} has origin ${origin}`);
  }

  function place(world: World, statics: Statics, row: number): Placed {
    const hit = placed[row];
    if (hit !== undefined) return hit;
    const ids = [...new Set(parcelIdsOf(world, statics, row))];
    const present = ids.filter((id) => P.index.has(id));
    for (const id of ids) {
      if (P.index.has(id)) continue;
      deps.warnOnce(
        `t11:${id}`,
        `parcel ${id} of row ${row} is not in parcels.bin: ` +
          (present.length === 0 ? 'the project has no geometry' : 'its geometry omits the parcel')
      );
    }
    const anchor = cellAnchorParcel(present, P);
    let out = NOWHERE;
    if (anchor !== null) {
      const cells = [cellOf(anchor)];
      for (const id of present) {
        const c = cellOf(id);
        if (!cells.includes(c)) cells.push(c);
      }
      out = { ids: present, cells };
      const home = cells[0];
      const rows = rowsIn.get(home);
      if (rows) rows.add(row);
      else rowsIn.set(home, new Set([row]));
    }
    placed[row] = out;
    return out;
  }

  /** Every cell of every project anchored in `cell` is ready. */
  const packable = (cell: string): boolean => {
    for (const row of rowsIn.get(cell) ?? []) {
      for (const c of placed[row].cells) if (!deps.cellReady(c)) return false;
    }
    return true;
  };

  /** The memoised massing of revision `k` (rule 11): keyed by the revision's content. */
  function massingOf(s: Schedule, k: number): Massing {
    const r = s.revisions[k];
    const key = `${s.projectId}|${k}|${r.day}|${r.units}|${r.stories}`;
    let m = massings.get(key);
    if (m === undefined) {
      m = massingFor(s, k, deps.massing);
      massings.set(key, m);
    }
    return m;
  }

  /**
   * `packTimedCell` over the cell's items, leaving out (and warning once about) an item that will
   * not pack, so one bad lot never costs its whole cell (as geometry.ts:166-182).
   */
  function packSafely(cellId: string, items: TimedPackInput[]): TimedPackedCell {
    try {
      return packTimedCell(cellId, items);
    } catch {
      const good = items.filter((item) => {
        try {
          packTimedCell(cellId, [item]);
          return true;
        } catch (e) {
          const id = item.schedule.projectId;
          deps.warnOnce(`pack:${id}`, `${e instanceof Error ? e.message : String(e)}; not drawn`);
          return false;
        }
      });
      return packTimedCell(cellId, good);
    }
  }

  /** The cell whole at `day`, or null when it holds no project with a loaded record. */
  function pack(world: World, statics: Statics, cell: string, day: number): TimedPackedCell | null {
    const items: TimedPackInput[] = [];
    for (const row of rowsIn.get(cell) ?? []) {
      const schedule = scheduleAt(world, statics, row, day);
      if (schedule === null) continue;
      const recs: ParcelRecord[] = [];
      for (const id of placed[row].ids) {
        const r = deps.massing.records(id);
        if (r) recs.push(r);
      }
      if (recs.length === 0) {
        // a ready cell whose chunk lacks the parcel: nothing to take a footprint from
        const id = schedule.projectId;
        deps.warnOnce(`records:${id}`, `no chunk record for any parcel of ${id}; not drawn`);
        continue;
      }
      items.push({
        schedule,
        massings: schedule.revisions.map((_, k) => massingOf(schedule, k)),
        pickParcelId: footprintParcel(recs).id
      });
    }
    return items.length === 0 ? null : packSafely(cell, items);
  }

  return {
    onEvent(e, world, statics) {
      const at = place(world, statics, e.row);
      if (at.cells.length > 0) dirty.set(at.cells[0], true);
    },

    flush(world, statics, budgetMs) {
      const day = monthLastDay(statics.asOf, world.month);
      const cells: TimedPackedCell[] = [];
      // at least one ready cell per call, so a flush always makes progress
      const start = now();
      let packed = 0;
      for (const cell of dirty.keys()) {
        if (!packable(cell)) continue;
        if (packed > 0 && now() - start >= budgetMs) break;
        dirty.delete(cell);
        packed++;
        const c = pack(world, statics, cell, day);
        if (c !== null) cells.push(c);
      }
      if (cells.length === 0) return null;
      let complete = false;
      if (world.month >= windowMonths) {
        complete = true;
        for (const cell of dirty.keys()) {
          if (packable(cell)) {
            complete = false;
            break;
          }
        }
      }
      return { revision: revision++, cells, removedCells: [], demolish: [], complete };
    },

    rewind() {
      throw new Error('map-stream: not built yet');
    },

    snapshot() {
      throw new Error('map-stream: not built yet');
    }
  };
}
