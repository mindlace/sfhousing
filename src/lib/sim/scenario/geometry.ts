// The timeline geometry of one shown run (spec §4.2 "Geometry", §4.7, §4.8; T7): which cells it
// anchors, which are ready to pack, and the packing of one cell. The scenario host owns the chunk
// loader, the scheduling and the posting; this module only answers what is pending and packs.
//
// - A project's cell is the T11 cell of its smallest `ParcelId` present in T11 (`cellAnchorParcel`).
//   It needs the cells of all its T11 parcels; it is packed once every one of them is ready, and
//   its anchor cell is then repacked in full (a revision n > 0 replaces the whole cell).
// - A parcel id absent from T11 is logged once and ignored: no cell, no demolish entry. A project
//   with no T11 parcel, and a score-only project (empty `parcelIds`, DQ-3), get no geometry; both
//   are still simulated and scored.
// - Every revision gets a massing (`massingsFor`); the slot's pick parcel is `footprintParcel` of
//   the same loaded records the massing used.
//
// Worker-safe, under the determinism lint rule (no transcendental Math).
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { TimedPackedCell } from '$lib/map/types';
import { packTimedCell, type TimedPackInput } from '$lib/map/pack-timed';
import type { Day } from '$lib/timelapse/time';
import { cellAnchorParcel, footprintParcel, massingsFor, type MassingCtx } from './massing';
import type { Schedule, SimInput } from './types';

/** One demolition: a parcel's existing building goes at its first construction start. */
export type Demolition = { parcelId: ParcelId; day: Day };

export interface Geometry {
  /** Every cell that anchors at least one project of the run. */
  anchoredCells(): Set<string>;
  /** The extra cells (beyond `cellIds`) of the multi-parcel projects anchored in `cellIds`. */
  cellsFor(cellIds: Iterable<string>): Set<string>;
  /** A chunk is ready: its cell may now pack, and so may the anchor cells waiting on it. */
  onRecords(cellId: string, recs: readonly ParcelRecord[]): void;
  /** Ready anchor cells with new or newly complete projects, by cell id. */
  packable(): string[];
  /** Every project anchored in `cellId` whose cells are all ready: the cell in full. */
  pack(cellId: string): TimedPackedCell;
  /** T6: no ready anchored cell is waiting to be packed. */
  complete(): boolean;
  /** T7: the complete demolish list (revision 0; it needs no geometry). */
  demolish(): Demolition[];
  /** The run's Schedules on a parcel (the §4.9 choice reads these). */
  schedulesOn(parcelId: ParcelId): Schedule[];
}

export interface GeometryOptions {
  input: SimInput; // the FZP input the run came from
  schedules: readonly Schedule[]; // the shown run's (never a twin's)
  /** The chunks already ready, by cell id. */
  records: ReadonlyMap<string, readonly ParcelRecord[]>;
  /** The massing context without its record lookup: the geometry reads its own ready records. */
  massingCtx: Omit<MassingCtx, 'records'>;
  /** Logs `msg` once per `key`, however often it is called (the caller's responsibility). */
  warnOnce(key: string, msg: string): void;
}

/** A packable project: its Schedule and the distinct cells of its T11 parcels. */
interface Anchored {
  schedule: Schedule;
  cells: string[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function createGeometry(o: GeometryOptions): Geometry {
  const P = o.input.parcels;
  const cellOf = (id: ParcelId): string | undefined => {
    const i = P.index.get(id);
    return i === undefined ? undefined : P.cells[P.cell[i]].cellId;
  };

  const byId = new Map<ParcelId, ParcelRecord>();
  const ready = new Set<string>();
  const ctx: MassingCtx = { ...o.massingCtx, records: (id) => byId.get(id) };

  const byAnchor = new Map<string, Anchored[]>();
  /** cell → the anchor cells with a project that needs it (an anchor needs itself). */
  const dependents = new Map<string, Set<string>>();
  const onParcel = new Map<ParcelId, Schedule[]>();
  const demolitions = new Map<ParcelId, Day>();

  for (const s of o.schedules) {
    const ids = [...new Set(s.parcelIds)];
    for (const id of ids) {
      const list = onParcel.get(id);
      if (list) list.push(s);
      else onParcel.set(id, [s]);
    }
    const present = ids.filter((id) => P.index.has(id));
    for (const id of ids) {
      if (P.index.has(id)) continue;
      o.warnOnce(
        `t11:${id}`,
        `parcel ${id} of ${s.projectId} is not in parcels.bin: ` +
          (present.length === 0 ? 'the project has no geometry' : 'its geometry omits the parcel')
      );
    }
    const c = s.entered.construction;
    if (c !== undefined) {
      for (const id of present) {
        const d = demolitions.get(id);
        if (d === undefined || c < d) demolitions.set(id, c);
      }
    }
    const anchor = cellAnchorParcel(present, P);
    if (anchor === null) continue; // score-only, or no T11 parcel
    const home = cellOf(anchor)!;
    const cells = [home];
    for (const id of present) {
      const cell = cellOf(id)!;
      if (!cells.includes(cell)) cells.push(cell);
    }
    const list = byAnchor.get(home);
    if (list) list.push({ schedule: s, cells });
    else byAnchor.set(home, [{ schedule: s, cells }]);
    for (const cell of cells) {
      const d = dependents.get(cell);
      if (d) d.add(home);
      else dependents.set(cell, new Set([home]));
    }
  }

  /** Projects packed last time, per anchor cell (projects only ever become ready). */
  const packed = new Map<string, number>();
  const pending = new Set<string>();

  const readyProjects = (cell: string): Anchored[] =>
    (byAnchor.get(cell) ?? []).filter((p) => p.cells.every((c) => ready.has(c)));

  const recheck = (anchor: string) => {
    if (!ready.has(anchor)) return;
    if (readyProjects(anchor).length > (packed.get(anchor) ?? 0)) pending.add(anchor);
  };

  const addRecords = (cellId: string, recs: readonly ParcelRecord[]) => {
    for (const r of recs) byId.set(r.id, r);
    ready.add(cellId);
  };

  for (const [cellId, recs] of o.records) addRecords(cellId, recs);
  for (const anchor of byAnchor.keys()) recheck(anchor);

  /** The loaded records of a project's parcels (the set its massing uses). */
  const loadedOf = (s: Schedule): ParcelRecord[] => {
    const out: ParcelRecord[] = [];
    for (const id of new Set(s.parcelIds)) {
      const r = byId.get(id);
      if (r) out.push(r);
    }
    return out;
  };

  /**
   * `packTimedCell` over the cell's items. Should one item be unpackable (say, a degenerate
   * parcel ring), it is logged once and left out, so one bad lot never costs its whole cell.
   */
  const packSafely = (cellId: string, items: TimedPackInput[]): TimedPackedCell => {
    try {
      return packTimedCell(cellId, items);
    } catch {
      const good = items.filter((item) => {
        try {
          packTimedCell(cellId, [item]);
          return true;
        } catch (e) {
          const id = item.schedule.projectId;
          o.warnOnce(`pack:${id}`, `${e instanceof Error ? e.message : String(e)}; not drawn`);
          return false;
        }
      });
      return packTimedCell(cellId, good);
    }
  };

  return {
    anchoredCells: () => new Set(byAnchor.keys()),
    cellsFor(cellIds) {
      const given = new Set(cellIds);
      const out = new Set<string>();
      for (const cell of given)
        for (const p of byAnchor.get(cell) ?? [])
          for (const c of p.cells) if (!given.has(c)) out.add(c);
      return out;
    },
    onRecords(cellId, recs) {
      addRecords(cellId, recs);
      for (const anchor of dependents.get(cellId) ?? []) recheck(anchor);
    },
    packable: () => [...pending].sort(cmp),
    pack(cellId) {
      const projects = readyProjects(cellId);
      const items: TimedPackInput[] = [];
      for (const p of projects) {
        const recs = loadedOf(p.schedule);
        if (recs.length === 0) {
          // a ready cell whose chunk lacks the parcel: nothing to take a footprint from
          const id = p.schedule.projectId;
          o.warnOnce(`records:${id}`, `no chunk record for any parcel of ${id}; not drawn`);
          continue;
        }
        items.push({
          schedule: p.schedule,
          massings: massingsFor(p.schedule, ctx),
          pickParcelId: footprintParcel(recs).id
        });
      }
      packed.set(cellId, projects.length);
      pending.delete(cellId);
      return packSafely(cellId, items);
    },
    complete: () => pending.size === 0,
    demolish: () =>
      [...demolitions.keys()].sort(cmp).map((parcelId) => ({
        parcelId,
        day: demolitions.get(parcelId)!
      })),
    schedulesOn: (parcelId) => onParcel.get(parcelId) ?? []
  };
}
