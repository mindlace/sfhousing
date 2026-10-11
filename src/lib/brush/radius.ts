import { RADIUS_MAX_M, RADIUS_MIN_M, STORIES_MAX, STORIES_MIN } from '$lib/plan';

/** Slider positions 0..99. */
export const RADIUS_STEPS = 100;
const LAST = RADIUS_STEPS - 1;
const RATIO = RADIUS_MAX_M / RADIUS_MIN_M;

export function radiusFromPos(pos: number): number {
  const p = Math.min(LAST, Math.max(0, pos));
  return clampRadius(RADIUS_MIN_M * Math.pow(RATIO, p / LAST));
}

export function posFromRadius(r: number): number {
  const c = clampRadius(r);
  const guess = Math.round((Math.log(c / RADIUS_MIN_M) / Math.log(RATIO)) * LAST);
  let lo = Math.min(LAST, Math.max(0, guess));
  let hi = lo;
  // Small radii repeat across adjacent positions; answer the middle of the plateau.
  while (lo > 0 && radiusFromPos(lo - 1) === c) lo--;
  while (hi < LAST && radiusFromPos(hi + 1) === c) hi++;
  return Math.round((lo + hi) / 2);
}

export function clampRadius(r: number): number {
  if (Number.isNaN(r)) return 30;
  return Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, Math.round(r)));
}

export function stepRadius(r: number, dir: 'up' | 'down'): number {
  const cur = clampRadius(r);
  let next: number;
  if (dir === 'up') {
    next = Math.round(cur * 1.25);
    if (next <= cur) next = cur + 1;
  } else {
    next = Math.round(cur / 1.25);
    if (next >= cur) next = cur - 1;
  }
  return clampRadius(next);
}

export function clampStories(s: number): number {
  if (Number.isNaN(s)) return 6;
  return Math.min(STORIES_MAX, Math.max(STORIES_MIN, Math.round(s)));
}

export function heightHintM(stories: number): number {
  return Math.round(stories * 3.1);
}

export const STORY_PRESETS = [2, 3, 4, 6, 8, 12, 20, 40] as const;
