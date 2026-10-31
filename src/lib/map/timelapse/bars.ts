// Stage progress bars (spec §4.4.1–§4.4.3): CPU bar records, the CPU reference of the bar
// shader (`evalBar`), bar size and the chance colour ramp. Pure. The GLSL port keeps
// `evalBar`'s rule order and straight-line shape; do not restructure one without the other.
import type { RGBA } from '../palette';
import { TOKENS, hexToRgba } from '../palette';
import type { Theme, TimedPackedCell } from '../types';
import { typicalDays, validateTimedCell } from './encode';
import {
  BAR_H_PX,
  BAR_MIN_ZOOM,
  BAR_TOP_GAP_M,
  BAR_W_PX,
  BAR_ZOOM_RAMP,
  COMPLETE_FADE_DAYS,
  COMPLETE_HOLD_DAYS,
  DYING_FADE_DAYS,
  DYING_HOLD_DAYS,
  FLOOR_CAP,
  RAMP_STOPS
} from './constants';
import { ROWS_PER_COHORT, ROWS_PER_PATHWAY, chanceRow } from './lookups';
import type { BarAttrs, BarEval, TimelineLookups } from './types';
import { DYING_DAYS, OPEN_DAY, monthsIn, type Day } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER, type Pathway, type Stage } from '$lib/timelapse/types';

type BarStage = Exclude<Stage, 'complete'>;

/** §4.4.2 segments per pathway. `preApplication` is prepended per slot when it was entered. */
export const BAR_SEGMENTS: Record<Pathway, BarStage[]> = {
  discretionary: ['filed', 'entitled', 'permitFiled', 'permitIssued', 'construction'],
  streamlined: ['filed', 'entitled', 'permitFiled', 'permitIssued', 'construction'],
  permitOnly: ['permitFiled', 'permitIssued', 'construction']
};

const NS = STAGE_ORDER.length;
const PRE = STAGE_ORDER.indexOf('preApplication');
const day = (d: number) => (Number.isNaN(d) ? OPEN_DAY : d);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

type SlotBar = Omit<BarAttrs, 'anchor' | 'from' | 'to'> & { ghostFrom: Day };

/** The revision-independent part of slot `s`'s bar. */
function slotBar(c: TimedPackedCell, s: number, l: TimelineLookups): SlotBar {
  const stages = c.slotStages.subarray(NS * s, NS * s + NS);
  const pi = c.slotPathway[s];
  const pathway = PATHWAYS[pi];
  const cohort = c.slotCohort[s] as 0 | 1;
  const segs: BarStage[] = Number.isNaN(stages[PRE])
    ? [...BAR_SEGMENTS[pathway]]
    : ['preApplication', ...BAR_SEGMENTS[pathway]];
  // Effective entry: the stage's own day, else the earliest later effective entry (a skipped
  // stage counts as passed once a later stage has started), else OPEN_DAY.
  const segEntry = new Array<number>(segs.length);
  let later = OPEN_DAY;
  for (let k = segs.length - 1; k >= 0; k--) {
    const own = stages[STAGE_ORDER.indexOf(segs[k])];
    segEntry[k] = Number.isNaN(own) ? later : own;
    later = Math.min(later, segEntry[k]);
  }
  let ghostFrom = OPEN_DAY;
  for (let j = 0; j < NS; j++) ghostFrom = Math.min(ghostFrom, day(stages[j]));
  const endDay = day(c.slotEnd[2 * s]);
  const endKind = c.slotEnd[2 * s + 1];
  const completeDay = endKind === 1 ? endDay : OPEN_DAY;
  const barEnd =
    endKind === 2
      ? endDay + DYING_DAYS
      : endKind === 1
        ? completeDay + COMPLETE_HOLD_DAYS + COMPLETE_FADE_DAYS
        : OPEN_DAY;
  return {
    projectId: c.slotProjectIds[s],
    parcelId: c.parcelIds[s],
    units: c.parcelMeta[4 * s],
    pathway: pi,
    ghostFrom,
    barEnd,
    endDay,
    endKind,
    completeDay,
    segCount: segs.length,
    segEntry,
    segTypicalDays: segs.map((st) => typicalDays(l, pathway, st, cohort)),
    segRow: segs.map((st) => chanceRow(pi, st, cohort)),
    minZoom: BAR_MIN_ZOOM
  };
}

/**
 * One bar per (slot, revision) with parts, in cell order, then first-part order. Validates each
 * cell. `minZoom` is `BAR_MIN_ZOOM` until declutter fills it.
 */
export function buildBars(cells: Iterable<TimedPackedCell>, l: TimelineLookups): BarAttrs[] {
  const out: BarAttrs[] = [];
  for (const c of cells) {
    validateTimedCell(c);
    const groups = new Map<string, number[]>();
    for (let k = 0; k < c.partCount; k++) {
      const key = `${c.partSlot[k]}|${c.partWindow[2 * k]}|${c.partWindow[2 * k + 1]}`;
      const g = groups.get(key);
      if (g) g.push(k);
      else groups.set(key, [k]);
    }
    const slots = new Map<number, SlotBar>();
    for (const parts of groups.values()) {
      const s = c.partSlot[parts[0]];
      let sb = slots.get(s);
      if (!sb) slots.set(s, (sb = slotBar(c, s, l)));
      let [x0, y0, x1, y1, top] = [Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const k of parts) {
        top = Math.max(top, c.partTopM[k]);
        for (let v = c.startIndices[k]; v < c.startIndices[k + 1]; v++) {
          const x = c.positions[2 * v];
          const y = c.positions[2 * v + 1];
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
      const { ghostFrom, ...rest } = sb;
      const k0 = parts[0];
      out.push({
        ...rest,
        segEntry: [...rest.segEntry],
        segTypicalDays: [...rest.segTypicalDays],
        segRow: [...rest.segRow],
        anchor: [(x0 + x1) / 2, (y0 + y1) / 2, top + BAR_TOP_GAP_M],
        from: Math.max(ghostFrom, day(c.partWindow[2 * k0])),
        to: Math.min(day(c.partWindow[2 * k0 + 1]), sb.barEnd)
      });
    }
  }
  return out;
}

/**
 * `chance[pathway][stage][min(m, len − 1)]` for a texture row, from `l.inFlight` (else `l`) for
 * rows of cohort 1; 0 for an absent row (bad data).
 */
function chanceAt(l: TimelineLookups, row: number, m: number): number {
  const set = row >= ROWS_PER_COHORT ? (l.inFlight ?? l) : l;
  const r = row % ROWS_PER_COHORT;
  const pathway = PATHWAYS[Math.floor(r / ROWS_PER_PATHWAY)];
  const stage = STAGE_ORDER[r % ROWS_PER_PATHWAY] as BarStage;
  const values = set.chance[pathway]?.[stage];
  if (!values || values.length === 0) return 0;
  return values[Math.min(Math.max(m, 0), values.length - 1)];
}

/** The bar on day `t` at map zoom `zoom` (§4.4). CPU reference of the bar shader. */
export function evalBar(b: BarAttrs, l: TimelineLookups, t: Day, zoom: number): BarEval {
  const gate = Math.max(BAR_MIN_ZOOM, b.minZoom);
  const zoomAlpha = clamp01((zoom - (gate - BAR_ZOOM_RAMP)) / BAR_ZOOM_RAMP);
  const dead = b.endKind === 2 && t >= b.endDay;
  const complete = t >= b.completeDay;

  // 1. Hidden: outside [from, to) or below the zoom ramp.
  if (t < b.from || t >= b.to || zoomAlpha <= 0) {
    return { visible: false, fill: 0, segCount: b.segCount, chance: null, dead, alpha: 0 };
  }

  // 2. Time alpha: the ghost's death fade after an exit, the hold and fade after completion.
  let timeAlpha = 1;
  if (dead) {
    const age = t - b.endDay;
    timeAlpha = age < DYING_HOLD_DAYS ? 1 : 1 - (age - DYING_HOLD_DAYS) / DYING_FADE_DAYS;
  } else if (complete) {
    const age = t - b.completeDay;
    timeAlpha = age < COMPLETE_HOLD_DAYS ? 1 : 1 - (age - COMPLETE_HOLD_DAYS) / COMPLETE_FADE_DAYS;
  }
  const alpha = zoomAlpha * timeAlpha;

  // 3. Complete: full, no chance.
  if (complete) return { visible: true, fill: 1, segCount: b.segCount, chance: null, dead, alpha };

  // 4. Fill: the last segment entered by tEff, plus the capped within-segment share.
  const tEff = b.endKind === 2 ? Math.min(t, b.endDay) : t;
  let k = 0;
  for (let j = 1; j < b.segCount; j++) if (b.segEntry[j] <= tEff) k = j;
  const elapsed = (tEff - b.segEntry[k]) / b.segTypicalDays[k];
  const fill = (k + Math.max(0, Math.min(elapsed, FLOOR_CAP))) / b.segCount;

  // 5. Chance: none once dead, else the table at the months spent in the current stage.
  const chance = dead ? null : chanceAt(l, b.segRow[k], monthsIn(b.segEntry[k], tEff));
  return { visible: true, fill, segCount: b.segCount, chance, dead, alpha };
}

/** Zooms over which the bar grows from its z15 size to its full size (the shader's too). */
export const BAR_GROW_ZOOMS = 2;

/** Bar size in px: `W = clamp(32 + 8·(zoom − 15), 32, 48)`, `H = clamp(6 + (zoom − 15), 6, 8)`. */
export function barSizePx(zoom: number): { w: number; h: number } {
  const g = clamp01((zoom - BAR_MIN_ZOOM) / BAR_GROW_ZOOMS);
  return {
    w: BAR_W_PX[0] + (BAR_W_PX[1] - BAR_W_PX[0]) * g,
    h: BAR_H_PX[0] + (BAR_H_PX[1] - BAR_H_PX[0]) * g
  };
}

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) =>
  Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const linearRgb = (hex: string) =>
  [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16)));

/** Per theme: the unlikely, uncertain and likely stops in linear RGB (the bar shader's too). */
export const RAMP: Record<Theme, number[][]> = {
  light: (['tl-bar-unlikely', 'tl-bar-uncertain', 'tl-bar-likely'] as const).map((id) =>
    linearRgb(TOKENS.light[id])
  ),
  dark: (['tl-bar-unlikely', 'tl-bar-uncertain', 'tl-bar-likely'] as const).map((id) =>
    linearRgb(TOKENS.dark[id])
  )
};

/**
 * Chance `c` to the bar colour (sRGB 0–255, opaque): piecewise linear in linear RGB through
 * `tl-bar-unlikely` (c ≤ 0.15), `tl-bar-uncertain` (0.45) and `tl-bar-likely` (c ≥ 0.75).
 * Linear-RGB blends keep relative luminance between the stops', so each keeps 3:1 on the track.
 */
export function rampColor(c: number, theme: Theme): RGBA {
  const [s0, s1, s2] = RAMP_STOPS;
  const [lo, mid, hi] = RAMP[theme];
  let a = lo;
  let b = lo;
  let u = 0;
  if (c > s0 && c <= s1) [a, b, u] = [lo, mid, (c - s0) / (s1 - s0)];
  else if (c > s1 && c < s2) [a, b, u] = [mid, hi, (c - s1) / (s2 - s1)];
  else if (c >= s2) [a, b, u] = [hi, hi, 0];
  const ch = (i: number) => toSrgb(a[i] + (b[i] - a[i]) * u);
  return [ch(0), ch(1), ch(2), 255];
}

/**
 * The fill colour of an evaluated bar (§4.4.3), opaque sRGB 0–255: `tl-bar-dead` once exited,
 * `tl-bar-likely` when complete (evalBar rule 3: no chance, never dead), else `rampColor`.
 * CPU reference of the bar shader's colour choice.
 */
export function barColor(e: BarEval, theme: Theme): RGBA {
  if (e.dead) return hexToRgba(TOKENS[theme]['tl-bar-dead']);
  if (e.chance === null) return hexToRgba(TOKENS[theme]['tl-bar-likely']);
  return rampColor(e.chance, theme);
}
