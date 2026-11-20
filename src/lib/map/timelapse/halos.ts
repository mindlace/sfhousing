// Halos and marks (map-on-screen slice 5): CPU records of the `timeline-halos` layer and the CPU
// reference of its shader (`evalHalo`). Pure. Halos live in simulated time: a ring's age is the
// clock's day less its event's, so the layer reads only the clock the bars read. The GLSL port in
// halo-layer.ts keeps `evalHalo`'s rule order; change one with the other.
import type { TokenName } from '../palette';
import type { TimedPackedCell } from '../types';
import { HALO_DAYS, HALO_R_PX, HALO_STILL_R_PX, MARK_PX } from './constants';
import { DYING_DAYS, OPEN_DAY, type Day } from '$lib/timelapse/time';
import { STAGE_ORDER } from '$lib/timelapse/types';

export const HALO_KIND = { approved: 0, started: 1, completed: 2, mark: 3 } as const;

/**
 * The token each ring kind is drawn in (the halo layer's colours) and the key's ring rows show;
 * a project under your policy rings in `tl-halo-policy` instead, as every mark is drawn.
 */
export const HALO_TOKEN = {
  approved: 'tl-halo-approved',
  started: 'tl-halo-started',
  completed: 'tl-halo-complete'
} as const satisfies Record<Exclude<keyof typeof HALO_KIND, 'mark'>, TokenName>;

export interface HaloAttrs {
  projectId: string;
  anchor: [lng: number, lat: number]; // centre of the bbox of the slot's final revision's parts
  day: Day; // the event day; a mark's first stage day
  until: Day; // a ring: day + HALO_DAYS; a mark: OPEN_DAY, or endDay + DYING_DAYS after an exit
  kind: 0 | 1 | 2 | 3;
  policy: boolean; // slotFlags[s] !== 0
}

export interface HaloEval {
  visible: boolean;
  radiusPx: number;
  alpha: number;
}

const NS = STAGE_ORDER.length;
const ENTITLED = STAGE_ORDER.indexOf('entitled');
const PERMIT_ISSUED = STAGE_ORDER.indexOf('permitIssued');
const CONSTRUCTION = STAGE_ORDER.indexOf('construction');

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
 * Per slot of each cell, in cell then slot order: approved (the first of entitled and
 * permitIssued entered), started (construction), completed (slotEnd kind 1), each only when its
 * day is after `from`; then one mark when the slot has a flag and its first stage day is after
 * `from`. A slot without parts has no anchor and no records.
 */
export function buildHalos(cells: Iterable<TimedPackedCell>, from: Day): HaloAttrs[] {
  const out: HaloAttrs[] = [];
  for (const c of cells) {
    const at = anchors(c);
    for (let s = 0; s < c.slotProjectIds.length; s++) {
      const anchor = at[s];
      if (!anchor) continue;
      const projectId = c.slotProjectIds[s];
      const policy = (c.slotFlags?.[s] ?? 0) !== 0;
      const stages = c.slotStages.subarray(NS * s, NS * s + NS);
      const endDay = c.slotEnd[2 * s];
      const endKind = c.slotEnd[2 * s + 1];
      const ring = (day: number, kind: 0 | 1 | 2) => {
        if (!Number.isNaN(day) && day > from)
          out.push({ projectId, anchor, day, until: day + HALO_DAYS, kind, policy });
      };
      ring(earlier(stages[ENTITLED], stages[PERMIT_ISSUED]), HALO_KIND.approved);
      ring(stages[CONSTRUCTION], HALO_KIND.started);
      if (endKind === 1) ring(endDay, HALO_KIND.completed);
      if (!policy) continue;
      let first = NaN;
      for (let j = 0; j < NS; j++) first = earlier(first, stages[j]);
      if (Number.isNaN(first) || first <= from) continue;
      const until = endKind === 2 ? endDay + DYING_DAYS : OPEN_DAY;
      out.push({ projectId, anchor, day: first, until, kind: HALO_KIND.mark, policy });
    }
  }
  return out;
}

/**
 * CPU reference of the halo shader on day t at map zoom `zoom`. Ring: visible iff day <= t <
 * until and zoom >= ringMinZoom (the city layer's handover; 0, no gate, wherever there is no
 * city layer); radius HALO_R_PX[0] + (HALO_R_PX[1] − HALO_R_PX[0]) · age / HALO_DAYS and alpha
 * 1 − age / HALO_DAYS, or, reduced, HALO_STILL_R_PX and 1. Mark: visible iff day <= t < until,
 * MARK_PX, alpha 1, at any zoom.
 */
export function evalHalo(
  h: HaloAttrs,
  t: Day,
  reduced: boolean,
  zoom = Infinity,
  ringMinZoom = 0
): HaloEval {
  // 1. Hidden: outside [day, until).
  if (t < h.day || t >= h.until) return { visible: false, radiusPx: 0, alpha: 0 };
  // 2. A ring below the gate: the city layer's merged ring stands for it.
  if (h.kind !== HALO_KIND.mark && zoom < ringMinZoom)
    return { visible: false, radiusPx: 0, alpha: 0 };
  // 3. A mark: one size, full strength.
  if (h.kind === HALO_KIND.mark) return { visible: true, radiusPx: MARK_PX, alpha: 1 };
  // 4. Reduced motion: a still ring.
  if (reduced) return { visible: true, radiusPx: HALO_STILL_R_PX, alpha: 1 };
  // 5. A ring grows and fades over its life.
  const u = (t - h.day) / HALO_DAYS;
  return {
    visible: true,
    radiusPx: HALO_R_PX[0] + (HALO_R_PX[1] - HALO_R_PX[0]) * u,
    alpha: 1 - u
  };
}
