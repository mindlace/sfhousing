// Shared by the bench:map files (docs/dev/map-perf.md).
import type { Page } from '@playwright/test';
import { VIEW_KEY, DEFAULT_VIEW } from '../../src/lib/view/prefs';

/**
 * Stores the View prefs with both transit layers on (they start off), before any page script, so
 * the bench measures them. Other fields keep their defaults.
 */
export async function transitLayersOn(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, view]) => localStorage.setItem(key, view),
    [VIEW_KEY, JSON.stringify({ ...DEFAULT_VIEW, transitStops: true, transitAccess: true })]
  );
}

/** The pass bar: p95 frame time in ms (60 fps). */
export const BAR_MS = 16.7;

/** Nearest-rank percentile of an ascending-sorted array. */
export function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export const verdict = (p95: number): string => (p95 <= BAR_MS ? 'PASS' : 'FAIL');
