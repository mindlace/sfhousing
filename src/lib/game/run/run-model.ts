import type { Day } from '$lib/timelapse/time';
import type { Hands } from '../limits';
import type { RunTake } from '../run-result';
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
