// map-stream (spec S17): world 1's events to the map's whole-cell `TimelineUpdate`s. `onEvent`
// marks a project's cell dirty; `flush` packs dirty cells, oldest first, within a time budget.
//
// - A row's parcel ids come from the statics (not from `scheduleAt`), once per row. A project's
//   cell is the cell of its smallest T11 parcel (`cellAnchorParcel`); a parcel absent from T11 is
//   warned once and ignored, and a row with no T11 parcel gets no cell (as geometry.ts:96-121).
// - A cell is packed whole, from `scheduleAt(world, statics, row, lastDay)` of every project in it,
//   once every cell of every one of its projects is ready (rule 6); otherwise it keeps its place.
// - One massing per revision, memoised by the revision's content (rule 11). The memo is also the
//   state that slices a cell across flushes: `flush` may stop between projects of a cell, and the
//   cell is sent whole once every massing it needs is in the memo.
// - Demolitions (rule 8, T13): a T11 lot and the earliest day a project entered construction on
//   it. Revision 0 carries every one known; later updates those new or changed since the last.
//   A lot can be sent in `demolish` more than once (an earlier day found later); the map's pump
//   keeps every entry and the earliest governs, so the stream never assumes one entry per lot.
// - `rewind` (rule 9): per row the stream keeps the key (entered, end, revisions) of the schedule
//   it last sent, and per cell whether it was ever sent. A row gone from the restored world, or
//   whose schedule now differs, dirties its cell. A dirty cell left with no project goes into
//   `removedCells` if it was sent, and is dropped silently if not. Demolitions are recomputed
//   from the restored world and diffed against those sent: a lot lost or whose day changed goes
//   into `restore` (taking back every pump entry), and then, if it still has a day, into
//   `demolish` with that day; both may travel in one update (restore is applied first).
// - An update goes out when a cell is packed or removed, or a demolition or restore is pending.
//   `complete` (rule 7, ruled: no *ready* dirty cell) is computed on every update; once the world
//   has stepped month `windowMonths` with no ready dirty cell left, one update says so even with
//   nothing else in it (a finite-budget flush can return null while a cell is part-warmed, so a
//   host drains until `complete`). It is sent once; a rewind or an update without it re-arms it.
// - `snapshot` (rule 10): every ready cell with a project, packed with no budget, as revision 0
//   with the whole demolish list computed from the world (so a fresh stream answers alike). The
//   sent bookkeeping (`sentKeys`, `sentCells`, `sentDemolitions`) becomes what it sent; pending
//   removals, restores and demolitions are superseded. Cells waiting on chunks stay dirty.
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
import { STAGE_ORDER } from '$lib/timelapse/types';
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

/** `ParcelId` order, as geometry.ts sorts the demolish list. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function createMapStream(deps: MapStreamDeps, windowMonths: number): MapStream {
  const P = deps.massing.input.parcels;
  const now = deps.now ?? (() => performance.now());
  // A cell needing more massings than the cap would evict its own and never finish under a finite
  // budget; no cell comes near 60,000.
  const massings = createLru<string, Massing>(deps.massingCap ?? MASSING_CAP);

  /** Per row, computed on its first event; `NOWHERE` for a master or a row without T11 parcel. */
  const placed: Placed[] = [];
  /** Anchor cell → its rows, in first-event order. */
  const rowsIn = new Map<string, Set<number>>();
  /** Dirty anchor cells in first-dirtied order (re-dirtying keeps the place). */
  const dirty = new Map<string, true>();
  /** T11 lot → the earliest day a project entered construction on it (rule 8, T13). */
  let demolitions = new Map<ParcelId, number>();
  /** Lots whose earliest construction day is new or changed since the last update. */
  const newDemolitions = new Set<ParcelId>();
  /** T11 lot → the earliest day the map holds for it (what has been sent, less restores). */
  const sentDemolitions = new Map<ParcelId, number>();
  /** Lots whose demolition no longer holds after a rewind, not yet sent in `restore`. */
  const restores = new Set<ParcelId>();
  /** Row → the key of the schedule last packed and sent for it (rule 9). */
  const sentKeys = new Map<number, string>();
  /** Cells the map holds: sent in `cells` and not since in `removedCells`. */
  const sentCells = new Set<string>();
  let revision = 0;
  /** The last update sent said `complete` and nothing has re-armed it since. */
  let completeSent = false;

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

  /** The memo key of revision `k` (rule 11): the revision's content. */
  function massingKey(s: Schedule, k: number): string {
    const r = s.revisions[k];
    return `${s.projectId}|${k}|${r.day}|${r.units}|${r.stories}`;
  }

  /** What a packed slot shows of a row (rule 9): its stage days, end and revisions; '-' for none. */
  function scheduleKey(s: Schedule | null): string {
    if (s === null) return '-';
    let k = '';
    for (const stage of STAGE_ORDER) k += `${s.entered[stage] ?? ''},`;
    const e = s.end;
    k +=
      e.kind === 'open' ? '|open' : e.kind === 'complete' ? `|c${e.day}` : `|x${e.day}${e.stage}`;
    for (const r of s.revisions) k += `|${r.day}:${r.units}:${r.stories}`;
    return k;
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

  /**
   * The cell's pack items at `day`, one project at a time, its massings from the memo. Before a
   * project with a revision not in the memo, `mayWork()` is asked; on false the cell is left
   * unfinished (null) and the massings done so far stay in the memo for the next call. `keys`
   * gets each row's schedule key, for `sentKeys` once the cell is sent.
   */
  function itemsOf(
    world: World,
    statics: Statics,
    cell: string,
    day: number,
    mayWork: () => boolean,
    worked: () => void,
    keys: [number, string][]
  ): TimedPackInput[] | null {
    const items: TimedPackInput[] = [];
    for (const row of rowsIn.get(cell) ?? []) {
      const schedule = scheduleAt(world, statics, row, day);
      keys.push([row, scheduleKey(schedule)]);
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
      let cold = false;
      const ms: Massing[] = [];
      for (let k = 0; k < schedule.revisions.length; k++) {
        const key = massingKey(schedule, k);
        let m = massings.get(key);
        if (m === undefined) {
          if (!cold) {
            if (!mayWork()) return null;
            cold = true;
          }
          m = massingFor(schedule, k, deps.massing);
          massings.set(key, m);
        }
        ms.push(m);
      }
      if (cold) worked();
      items.push({ schedule, massings: ms, pickParcelId: footprintParcel(recs).id });
    }
    return items;
  }

  /** Rule 7 (ruled): month `windowMonths` stepped and no ready dirty cell. */
  function isComplete(world: World): boolean {
    if (world.month < windowMonths) return false;
    for (const cell of dirty.keys()) if (packable(cell)) return false;
    return true;
  }

  /** T11 lot → the earliest day a project of `world` entered construction on it, at `day`. */
  function demolitionsOf(world: World, statics: Statics, day: number): Map<ParcelId, number> {
    const out = new Map<ParcelId, number>();
    for (let row = 0; row < world.projects.n; row++) {
      const c = scheduleAt(world, statics, row, day)?.entered.construction;
      if (c === undefined) continue;
      for (const id of place(world, statics, row).ids) {
        const d = out.get(id);
        if (d === undefined || c < d) out.set(id, c);
      }
    }
    return out;
  }

  return {
    onEvent(e, world, statics) {
      const at = place(world, statics, e.row);
      if (at.cells.length > 0) dirty.set(at.cells[0], true);
      if (e.kind === 'enter' && e.stage === 'construction') {
        for (const id of at.ids) {
          const d = demolitions.get(id);
          if (d !== undefined && d <= e.day) continue;
          demolitions.set(id, e.day);
          newDemolitions.add(id);
        }
      }
    },

    flush(world, statics, budgetMs) {
      const day = monthLastDay(statics.asOf, world.month);
      const cells: TimedPackedCell[] = [];
      // Work is one project's massings or one cell's pack. The first piece of a call goes ahead
      // unasked, so a flush always makes progress; every later one only while budget is left.
      // A cell is packed only once all its massings are in the memo; until then it keeps its
      // place in the queue, and its warmed massings carry over to the next call.
      const start = now();
      let worked = false;
      let spent = false;
      const mayWork = () => {
        if (worked && now() - start >= budgetMs) spent = true;
        return !spent;
      };
      let warmed = 0;
      const didWork = () => {
        worked = true;
        warmed++;
      };
      const removedCells: string[] = [];
      for (const cell of dirty.keys()) {
        if (!packable(cell)) continue;
        if (!mayWork()) break;
        const before = warmed;
        const keys: [number, string][] = [];
        const items = itemsOf(world, statics, cell, day, mayWork, didWork, keys);
        if (items === null) break;
        // a cell warmed in this call packs only while budget is left
        if (warmed > before && items.length > 0 && !mayWork()) break;
        dirty.delete(cell);
        for (const [row, key] of keys) sentKeys.set(row, key);
        // a cell with nothing to pack is not work: a null flush with no massing work then means
        // no packable dirty cell is left. One the map holds is removed (rule 9); one it never
        // had is dropped.
        if (items.length === 0) {
          if (sentCells.delete(cell)) removedCells.push(cell);
          continue;
        }
        worked = true;
        cells.push(packSafely(cell, items));
        sentCells.add(cell);
      }
      const complete = isComplete(world);
      if (
        cells.length === 0 &&
        removedCells.length === 0 &&
        newDemolitions.size === 0 &&
        restores.size === 0 &&
        (!complete || completeSent)
      ) {
        return null;
      }
      // revision 0 carries every demolition known; later updates those new or changed since
      const lots = revision === 0 ? [...demolitions.keys()] : [...newDemolitions];
      newDemolitions.clear();
      const demolish = lots.sort(cmp).map((parcelId) => ({
        parcelId,
        day: demolitions.get(parcelId)!
      }));
      // revision 0 replaces the map's list: nothing to take back
      const restore = revision === 0 ? [] : [...restores].sort(cmp);
      restores.clear();
      if (revision === 0) sentDemolitions.clear();
      for (const d of demolish) {
        const held = sentDemolitions.get(d.parcelId);
        if (held === undefined || d.day < held) sentDemolitions.set(d.parcelId, d.day);
      }
      completeSent = complete;
      const u: TimelineUpdate = { revision: revision++, cells, removedCells, demolish, complete };
      if (restore.length > 0) u.restore = restore;
      return u;
    },

    rewind(world, statics) {
      const n = world.projects.n;
      const day = monthLastDay(statics.asOf, world.month);
      // rows past the restored world's end are gone: their cells are dirty and they leave the
      // stream (a later row of that index is a new project, placed afresh)
      for (let row = n; row < placed.length; row++) {
        const at = placed[row];
        sentKeys.delete(row);
        if (at === undefined || at.cells.length === 0) continue;
        const home = at.cells[0];
        dirty.set(home, true);
        const rows = rowsIn.get(home)!;
        rows.delete(row);
        if (rows.size === 0) rowsIn.delete(home);
      }
      placed.length = Math.min(placed.length, n);
      for (const row of [...sentKeys.keys()]) if (row >= n) sentKeys.delete(row);
      // a row whose schedule differs from the one sent (stage days or end unknown again)
      for (const [row, key] of sentKeys) {
        if (scheduleKey(scheduleAt(world, statics, row, day)) === key) continue;
        const at = placed[row];
        if (at !== undefined && at.cells.length > 0) dirty.set(at.cells[0], true);
      }
      // demolitions of the restored world, diffed against those the map holds
      const now = demolitionsOf(world, statics, day);
      for (const [lot, held] of sentDemolitions) {
        if (now.get(lot) === held) continue;
        restores.add(lot);
        sentDemolitions.delete(lot);
      }
      newDemolitions.clear();
      for (const [lot, d] of now) if (sentDemolitions.get(lot) !== d) newDemolitions.add(lot);
      demolitions = now;
      completeSent = false;
    },

    snapshot(world, statics) {
      const day = monthLastDay(statics.asOf, world.month);
      // every row placed: a fresh stream has seen no event
      for (let row = 0; row < world.projects.n; row++) place(world, statics, row);
      sentKeys.clear();
      sentCells.clear();
      const cells: TimedPackedCell[] = [];
      const waiting = new Set<string>();
      for (const cell of [...rowsIn.keys()].sort(cmp)) {
        if (!packable(cell)) {
          waiting.add(cell);
          continue;
        }
        // unbudgeted: every massing the cell needs is made now
        const keys: [number, string][] = [];
        const items = itemsOf(
          world,
          statics,
          cell,
          day,
          () => true,
          () => {},
          keys
        )!;
        for (const [row, key] of keys) sentKeys.set(row, key);
        if (items.length === 0) continue;
        cells.push(packSafely(cell, items));
        sentCells.add(cell);
      }
      // revision 0 replaces the map: only the cells waiting on chunks are left to send, those
      // already queued keeping their place
      const queued = [...dirty.keys()].filter((c) => waiting.has(c));
      dirty.clear();
      for (const c of queued) dirty.set(c, true);
      for (const c of waiting) dirty.set(c, true);
      demolitions = demolitionsOf(world, statics, day);
      newDemolitions.clear();
      restores.clear();
      sentDemolitions.clear();
      for (const [lot, d] of demolitions) sentDemolitions.set(lot, d);
      const demolish = [...demolitions.keys()].sort(cmp).map((parcelId) => ({
        parcelId,
        day: demolitions.get(parcelId)!
      }));
      const complete = isComplete(world);
      completeSent = complete;
      revision = 1;
      return { revision: 0, cells, removedCells: [], demolish, complete };
    }
  };
}
