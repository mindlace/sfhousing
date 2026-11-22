// Policy marks (map-on-screen slice 5): CPU records of the `timeline-halos` layer and the CPU
// reference of its shader (`evalHalo`). Pure. A mark lives in simulated time: it shows from its
// first stage day, so the layer reads only the clock the bars read. The GLSL port in
// halo-layer.ts keeps `evalHalo`'s rule order; change one with the other.
import type { TimedPackedCell } from '../types';
import { MARK_AREA_ZOOM } from './constants';
import { cityGroup } from './city-grid';
import { DYING_DAYS, OPEN_DAY, type Day } from '$lib/timelapse/time';
import { STAGE_ORDER } from '$lib/timelapse/types';

export interface HaloAttrs {
  projectId: string;
  anchor: [lng: number, lat: number]; // centre of the bbox of the slot's final revision's parts
  day: Day; // the mark's first stage day
  until: Day; // OPEN_DAY, or endDay + DYING_DAYS after an exit
  /**
   * From this day until `until`, the mark is its city square's one diamond below the gate
   * (`areaMarks`); `until` when it never is.
   */
  areaFrom: Day;
}

const NS = STAGE_ORDER.length;

/** The earlier of two entry days, NaN (never) losing to any day. */
const earlier = (a: number, b: number) =>
  Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.min(a, b);

/** Per slot, the bbox centre of its final revision's parts (the revision that starts last). */
function anchors(c: TimedPackedCell): ([number, number] | null)[] {
  const n = c.slotProjectIds.length;
  const last = new Array<number>(n).fill(-Infinity);
  for (let k = 0; k < c.partCount; k++)
    last[c.partSlot[k]] = Math.max(last[c.partSlot[k]], c.partWindow[2 * k]);
  const box = Array.from({ length: n }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let k = 0; k < c.partCount; k++) {
    const s = c.partSlot[k];
    if (c.partWindow[2 * k] !== last[s]) continue;
    const b = box[s];
    for (let v = c.startIndices[k]; v < c.startIndices[k + 1]; v++) {
      const x = c.positions[2 * v];
      const y = c.positions[2 * v + 1];
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    }
  }
  return box.map((b) => (b[0] <= b[2] ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null));
}

/**
 * Per flagged slot of each cell, in cell then slot order, one mark when its first stage day is
 * after `from`. A slot without parts has no anchor and no mark. Each mark's `areaFrom` comes
 * from `areaMarks`.
 */
export function buildHalos(cells: Iterable<TimedPackedCell>, from: Day): HaloAttrs[] {
  const out: HaloAttrs[] = [];
  const marks: { mark: HaloAttrs; homes: number }[] = [];
  for (const c of cells) {
    const at = anchors(c);
    for (let s = 0; s < c.slotProjectIds.length; s++) {
      const anchor = at[s];
      if (!anchor || (c.slotFlags?.[s] ?? 0) === 0) continue;
      const stages = c.slotStages.subarray(NS * s, NS * s + NS);
      let first = NaN;
      for (let j = 0; j < NS; j++) first = earlier(first, stages[j]);
      if (Number.isNaN(first) || first <= from) continue;
      const endDay = c.slotEnd[2 * s];
      const until = c.slotEnd[2 * s + 1] === 2 ? endDay + DYING_DAYS : OPEN_DAY;
      const mark: HaloAttrs = {
        projectId: c.slotProjectIds[s],
        anchor,
        day: first,
        until,
        areaFrom: until
      };
      out.push(mark);
      marks.push({ mark, homes: c.parcelMeta[4 * s] });
    }
  }
  areaMarks(marks);
  return out;
}

/**
 * Sets each mark's `areaFrom` so that below the gate every city square (`cityGroup` of the
 * mark's anchor, the 800 m grid of city-grid.ts) with a standing mark (day <= t < until) shows
 * exactly one. The square's mark at t is its standing mark first by (day, then homes
 * descending, then projectId); it keeps the square until its own end, since a mark revealed
 * later never comes first, and then the square hands over to the first still standing, or,
 * with none, to the next revealed. Each mark stands for its square at most once, over
 * [areaFrom, until), so the records stay one per mark. Runs once per halo rebuild, never per
 * frame: O(m log m) for the sort plus O(m · h) per square of m marks and h handovers (h <= m;
 * one plus the square's exits, as most marks last to OPEN_DAY).
 */
function areaMarks(marks: { mark: HaloAttrs; homes: number }[]): void {
  const squares = new Map<number, { mark: HaloAttrs; homes: number }[]>();
  for (const m of marks) {
    const g = cityGroup(m.mark.anchor[0], m.mark.anchor[1]);
    let list = squares.get(g);
    if (!list) squares.set(g, (list = []));
    list.push(m);
  }
  for (const list of squares.values()) {
    list.sort(
      (a, b) =>
        a.mark.day - b.mark.day ||
        b.homes - a.homes ||
        (a.mark.projectId < b.mark.projectId ? -1 : a.mark.projectId > b.mark.projectId ? 1 : 0)
    );
    // The square's mark from day `t`: the first in order standing at t, else the first revealed
    // after it (list order breaks ties on the start).
    let t = -Infinity;
    for (;;) {
      let next: HaloAttrs | null = null;
      let start = Infinity;
      for (const { mark } of list) {
        if (mark.until <= t) continue;
        const s = Math.max(mark.day, t);
        if (s < start) {
          next = mark;
          start = s;
        }
      }
      if (!next) break;
      next.areaFrom = start;
      t = next.until;
    }
  }
}

/**
 * CPU reference of the halo shader: whether a mark shows on day t at map zoom `zoom`. It shows
 * while day <= t < until; below MARK_AREA_ZOOM only from its `areaFrom`, its square's one diamond.
 */
export function evalHalo(h: HaloAttrs, t: Day, zoom = Infinity): boolean {
  return h.day <= t && t < h.until && (zoom >= MARK_AREA_ZOOM || t >= h.areaFrom);
}
