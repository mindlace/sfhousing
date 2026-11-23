/**
 * What the deleted score chart left behind (spec §4.6): the stroke colours the timeline chart and
 * its legend use, the series names About's assumptions compare published estimates with, and
 * `niceCeil`, the scale rounding the timeline chart. Pure.
 */
import { GOAL_BASE } from '$lib/goal/goal';
import type { TimelineScore } from '$lib/sim/protocol';
import { formatShortMonthYear } from './format';

/**
 * Stroke colours (spec §4.6) as the custom properties layout.css defines per theme; each has at
 * least 3:1 contrast on its theme's surfaces (SC 1.4.11, checked in accent.spec.ts).
 */
export const COLORS = {
  total: 'var(--chart-total)',
  pipeline: 'var(--chart-pipeline)',
  fresh: 'var(--chart-fresh)',
  plan: 'var(--chart-plan)'
} as const;

export const SERIES_NAME: Record<
  'total' | 'pipeline' | 'fresh' | 'planCompleted' | 'planEntitled',
  string
> = {
  total: `Toward the goal, since ${formatShortMonthYear(GOAL_BASE.countsFrom)}`,
  pipeline: "From today's pipeline",
  fresh: 'New projects',
  planCompleted: 'Plan effect, completed',
  planEntitled: 'Plan effect, approved'
};

/** Round up to 1, 2 or 5 × 10ⁿ (at least 1). */
export function niceCeil(v: number): number {
  if (!(v > 1)) return 1;
  let p = 10 ** Math.floor(Math.log10(v));
  // Math.log10 can land a hair either side of an exact power of ten.
  while (p * 10 <= v) p *= 10;
  while (p > v) p /= 10;
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** The drawn series a published reference is compared with (About's assumptions). */
export const MEASURE_SERIES = {
  'planEffect.entitledNew': 'planEntitled',
  'planEffect.completedNetNew': 'planCompleted',
  completedNet: 'total'
} as const satisfies Record<
  TimelineScore['references'][number]['measure'],
  keyof typeof SERIES_NAME
>;
