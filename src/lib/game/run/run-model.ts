import type { Day } from '$lib/timelapse/time';
import type { Hands } from '../limits';
import type { RunTake } from '../run-result';
import { credit, total } from '../units';
import type { Drop } from './drops';

export interface Pt {
  x: number;
  y: number;
}

export interface LiveDrop {
  drop: Drop;
  worth: number;
  at: Pt | null;
  bornMs: number;
  endMs: number;
  takenMs: number | null;
}

export interface FloatCount {
  x: number;
  y: number;
  worth: number;
  bornMs: number;
  policy: boolean;
}

export interface RunModel {
  running: boolean;
  drops: readonly Drop[];
  cursor: number;
  highDay: Day;
  seen: Set<number>;
  live: LiveDrop[];
  counts: FloatCount[];
  take: RunTake;
  box: { w: number; h: number };
  ring: Pt;
  sweep: (Pt | null)[];
  ringMoved: boolean;
}

export interface StepInput {
  now: number;
  running: boolean;
  day: Day;
  drops: readonly Drop[];
  hands: Hands;
  auto: boolean;
  reduced: boolean;
  project(lng: number, lat: number): Pt | null;
}

export interface StepResult {
  started: boolean;
  ended: boolean;
  appeared: number;
  collected: number;
  removed: number;
  dirty: boolean;
}

export const RUN_TIMES = {
  appearMs: 160,
  fadeMs: 400,
  takenMs: 400,
  countMs: 800,
  minShownMs: 400
} as const;

export const RUN_CAPS = {
  maxDrawn: 240,
  maxCounts: 40,
  maxSweep: 32
} as const;

export const RING_KEYS = {
  stepPx: 16,
  shiftStepPx: 64
} as const;

export const RING_KEY_DIR: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
};

export function createRun(): RunModel {
  return {
    running: false,
    drops: [],
    cursor: 0,
    highDay: -Infinity,
    seen: new Set(),
    live: [],
    counts: [],
    take: { dropped: {}, collected: {} },
    box: { w: 0, h: 0 },
    ring: { x: 0, y: 0 },
    sweep: [],
    ringMoved: false
  };
}

function clamp(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

export function setBox(m: RunModel, w: number, h: number): void {
  const wasEmpty = m.box.w <= 0 || m.box.h <= 0;
  m.box = { w, h };
  let x: number;
  let y: number;
  if (wasEmpty && w > 0 && h > 0) {
    x = w / 2;
    y = h / 2;
  } else {
    x = clamp(m.ring.x, w);
    y = clamp(m.ring.y, h);
  }
  if (x !== m.ring.x || y !== m.ring.y) {
    m.ring = { x, y };
    m.sweep = [];
  }
}

export function pointRing(m: RunModel, p: Pt, fresh: boolean): void {
  m.sweep.push(fresh ? null : { x: m.ring.x, y: m.ring.y });
  if (m.sweep.length > RUN_CAPS.maxSweep) m.sweep.shift();
  m.ring = { x: clamp(p.x, m.box.w), y: clamp(p.y, m.box.h) };
  m.ringMoved = true;
}

export function nudgeRing(m: RunModel, dx: number, dy: number): void {
  pointRing(m, { x: m.ring.x + dx, y: m.ring.y + dy }, false);
}

function segDist2(a: Pt, b: Pt, p: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = a.x + t * abx - p.x;
  const dy = a.y + t * aby - p.y;
  return dx * dx + dy * dy;
}

export function sweepHits(sweep: readonly (Pt | null)[], ring: Pt, p: Pt, r: number): boolean {
  const r2 = r * r;
  let prev: Pt | null = null;
  for (let i = 0; i <= sweep.length; i++) {
    const cur: Pt | null = i < sweep.length ? sweep[i] : ring;
    if (cur) {
      if (segDist2(prev ?? cur, cur, p) <= r2) return true;
    }
    prev = cur;
  }
  return false;
}

/** The first index in `drops` (sorted by day) whose day is after `day`. */
function firstAfter(drops: readonly Drop[], day: Day): number {
  let lo = 0;
  let hi = drops.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (drops[mid].day <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function start(m: RunModel, drops: readonly Drop[]): void {
  m.running = true;
  m.take = { dropped: {}, collected: {} };
  m.seen.clear();
  m.live.length = 0;
  m.counts.length = 0;
  m.sweep.length = 0;
  m.cursor = 0;
  m.highDay = -Infinity;
  m.drops = drops;
  m.ring = { x: m.box.w / 2, y: m.box.h / 2 };
}

/** Passes one drop: appears unless its row is in `seen`. Returns 1 when it appeared. */
function pass(m: RunModel, i: StepInput, d: Drop, linger: number): number {
  if (m.seen.has(d.row)) return 0;
  m.seen.add(d.row);
  m.take.dropped = credit(m.take.dropped, d.worth);
  m.live.push({
    drop: d,
    worth: total(d.worth),
    at: i.project(d.lng, d.lat),
    bornMs: i.now,
    endMs: i.now + linger,
    takenMs: null
  });
  return 1;
}

function appear(m: RunModel, i: StepInput): number {
  const linger = Math.max(i.hands.lingerMs, RUN_TIMES.minShownMs);
  let appeared = 0;
  if (i.drops !== m.drops) {
    m.drops = i.drops;
    m.cursor = firstAfter(i.drops, m.highDay);
    // Rows whose day was reached before they arrived appear now, in array order.
    for (let k = 0; k < m.cursor; k++) appeared += pass(m, i, i.drops[k], linger);
  }
  if (i.day > m.highDay) m.highDay = i.day;
  const drops = m.drops;
  while (m.cursor < drops.length && drops[m.cursor].day <= m.highDay) {
    appeared += pass(m, i, drops[m.cursor++], linger);
  }
  return appeared;
}

function collect(m: RunModel, i: StepInput): number {
  let collected = 0;
  for (const l of m.live) {
    if (l.takenMs !== null || i.now >= l.endMs) continue;
    if (!i.auto && (l.at === null || !sweepHits(m.sweep, m.ring, l.at, i.hands.radiusPx))) {
      continue;
    }
    l.takenMs = i.now;
    l.endMs = i.now + RUN_TIMES.takenMs;
    m.take.collected = credit(m.take.collected, l.drop.worth);
    if (l.at !== null) {
      m.counts.push({
        x: l.at.x,
        y: l.at.y,
        worth: l.worth,
        bornMs: i.now,
        policy: l.drop.policy
      });
      if (m.counts.length > RUN_CAPS.maxCounts) m.counts.shift();
    }
    collected++;
  }
  m.sweep.length = 0;
  m.ringMoved = false;
  return collected;
}

function end(m: RunModel, i: StepInput): void {
  m.running = false;
  const fadeEnd = i.reduced ? i.now : i.now + RUN_TIMES.fadeMs;
  for (const l of m.live) {
    if (l.takenMs === null && fadeEnd < l.endMs) l.endMs = fadeEnd;
  }
  m.sweep.length = 0;
}

/** Removes ended drops and counts in place; returns how many went. */
function removeEnded(m: RunModel, now: number): number {
  let w = 0;
  for (let r = 0; r < m.live.length; r++) {
    const l = m.live[r];
    if (now < l.endMs) m.live[w++] = l;
  }
  let removed = m.live.length - w;
  m.live.length = w;
  w = 0;
  for (let r = 0; r < m.counts.length; r++) {
    const c = m.counts[r];
    if (now < c.bornMs + RUN_TIMES.countMs) m.counts[w++] = c;
  }
  removed += m.counts.length - w;
  m.counts.length = w;
  return removed;
}

function animating(m: RunModel, now: number): boolean {
  if (m.counts.length > 0) return true;
  for (const l of m.live) {
    if (l.takenMs !== null) return true;
    if (now < l.bornMs + RUN_TIMES.appearMs) return true;
    if (now >= l.endMs - RUN_TIMES.fadeMs) return true;
  }
  return false;
}

export function step(m: RunModel, i: StepInput): StepResult {
  const started = i.running && !m.running;
  const ended = !i.running && m.running;
  const moved = m.ringMoved;
  m.ringMoved = false;
  if (started) start(m, i.drops);
  let appeared = 0;
  let collected = 0;
  if (m.running) {
    appeared = appear(m, i);
    collected = collect(m, i);
  }
  if (ended) end(m, i);
  const removed = removeEnded(m, i.now);
  const dirty =
    started ||
    ended ||
    appeared > 0 ||
    collected > 0 ||
    removed > 0 ||
    moved ||
    (!i.reduced && animating(m, i.now));
  return { started, ended, appeared, collected, removed, dirty };
}

export function reproject(m: RunModel, project: StepInput['project']): void {
  for (const l of m.live) l.at = project(l.drop.lng, l.drop.lat);
}

export function idle(m: RunModel): boolean {
  return !m.running && m.live.length === 0 && m.counts.length === 0;
}
