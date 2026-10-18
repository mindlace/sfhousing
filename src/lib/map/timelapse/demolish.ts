// Time-driven demolish pump (spec §4.5). Hides existing buildings by feature-state `replaced`
// as the timeline day passes each parcel's demolish day. Pure TS with injected deps, like
// GeneratedController, so it tests without MapLibre.
//
// `setTarget` is called from `setTime` on every scrub tick: it must stay O(1) and
// allocation-free, so it only compares the target against two sorted days and schedules at
// most one frame. The frame body moves the cursor by at most SLICE_IDS entries.
import { SLICE_IDS } from '../hide';
import type { ParcelId } from '$lib/data/parcel';
import type { Day } from '$lib/timelapse/time';

/** Same gate as generated-controller's `sfh-slice`: dev builds and e2e only. */
const MEASURE = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';

export interface PumpDeps {
  setReplaced(id: ParcelId): void;
  clearReplaced(id: ParcelId): void;
  clearAllReplaced(): void;
  raf(cb: (t: number) => void): number;
  cancelRaf(h: number): void;
}

export class DemolishPump {
  private readonly deps: PumpDeps;
  private days = new Float64Array(0);
  private ids: ParcelId[] = [];
  /** Entry count per parcel among applied entries; a parcel is replaced iff its count > 0. */
  private refs = new Map<ParcelId, number>();
  private cursor = 0;
  private target = -Infinity;
  private handle: number | null = null;
  private destroyed = false;

  /** Feature-state calls made by the most recent frame (bench reporting). */
  lastFrameOps = 0;
  /** The largest `lastFrameOps` seen since construction. */
  maxFrameOps = 0;

  constructor(deps: PumpDeps) {
    this.deps = deps;
  }

  /** Entries currently applied (day ≤ target, once converged). */
  get applied(): number {
    return this.cursor;
  }
  get total(): number {
    return this.days.length;
  }
  /** True while a frame is scheduled. */
  get pending(): boolean {
    return this.handle !== null;
  }

  /** Revision 0: drop all feature-state, load the sorted list, and pump from 0 to the target. */
  replace(list: readonly { parcelId: ParcelId; day: Day }[]): void {
    if (this.destroyed) return;
    this.cancel();
    const sorted = list.slice().sort((x, y) => {
      if (x.day !== y.day) return x.day - y.day;
      return x.parcelId < y.parcelId ? -1 : x.parcelId > y.parcelId ? 1 : 0;
    });
    this.days = new Float64Array(sorted.length);
    this.ids = new Array<ParcelId>(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      this.days[i] = sorted[i].day;
      this.ids[i] = sorted[i].parcelId;
    }
    this.refs = new Map();
    this.cursor = 0;
    this.deps.clearAllReplaced();
    this.schedule();
  }

  /** O(1): records the target and schedules one frame only when it crosses the cursor. */
  setTarget(day: Day): void {
    if (this.destroyed) return;
    this.target = day;
    this.schedule();
  }

  /** Whether the parcel's existing building is currently hidden (applied set, O(1)). */
  has(id: ParcelId): boolean {
    return this.refs.has(id);
  }

  /** The parcels currently replaced, for re-applying after a buildings tile reload. */
  appliedIds(): Iterable<ParcelId> {
    return this.refs.keys();
  }

  destroy(): void {
    this.cancel();
    this.destroyed = true;
    this.days = new Float64Array(0);
    this.ids = [];
    this.refs = new Map();
    this.cursor = 0;
  }

  private crossing(): boolean {
    const { cursor, days, target } = this;
    return (
      (cursor < days.length && days[cursor] <= target) || (cursor > 0 && days[cursor - 1] > target)
    );
  }

  private schedule(): void {
    if (this.handle === null && this.crossing()) {
      this.handle = this.deps.raf(this.frame);
    }
  }

  private cancel(): void {
    if (this.handle !== null) {
      this.deps.cancelRaf(this.handle);
      this.handle = null;
    }
  }

  /**
   * One frame: moves the cursor toward the target by at most SLICE_IDS entries. An arrow field,
   * bound once, so scheduling from `setTarget` allocates no closure. Emits the `sfh-pump`
   * measure under MEASURE (the §4.5 pass bar, timed by timeline-perf.svelte.spec.ts).
   */
  private readonly frame = (): void => {
    this.handle = null;
    if (this.destroyed) return;
    const t0 = MEASURE ? performance.now() : 0;
    const { days, ids, refs, deps, target } = this;
    let cursor = this.cursor;
    let ops = 0;
    let moved = 0;
    while (moved < SLICE_IDS && cursor < days.length && days[cursor] <= target) {
      const id = ids[cursor++];
      const n = (refs.get(id) ?? 0) + 1;
      refs.set(id, n);
      if (n === 1) {
        deps.setReplaced(id);
        ops++;
      }
      moved++;
    }
    while (moved < SLICE_IDS && cursor > 0 && days[cursor - 1] > target) {
      const id = ids[--cursor];
      const n = (refs.get(id) ?? 1) - 1;
      if (n === 0) {
        refs.delete(id);
        deps.clearReplaced(id);
        ops++;
      } else {
        refs.set(id, n);
      }
      moved++;
    }
    this.cursor = cursor;
    this.lastFrameOps = ops;
    if (ops > this.maxFrameOps) this.maxFrameOps = ops;
    if (MEASURE) performance.measure('sfh-pump', { start: t0, end: performance.now() });
    this.schedule();
  };
}
