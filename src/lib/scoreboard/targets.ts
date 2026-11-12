import type { Target } from './types';

// Spec §4.2. Verified 2026-10-10: the primer gives 82,069 for 2023–2031 and a buffer of
// "at least 15% more capacity". 82,069 × 1.15 = 94,379.35, rounded down to 94,379.
const RHNA_PRIMER = Object.freeze({
  label: 'SF Planning, RHNA Primer',
  url: 'https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/RHNA-Primer.pdf'
});

/** M1 target registry. Order is display order; the first target is primary. */
export const M1_TARGETS: readonly Target[] = Object.freeze([
  Object.freeze({ id: 'rhna', label: 'RHNA 2023–2031', units: 82069, source: RHNA_PRIMER }),
  Object.freeze({
    id: 'rhna-buffer',
    label: 'RHNA + 15% buffer',
    units: 94379,
    source: RHNA_PRIMER
  })
]);

// ABAG, Final RHNA Plan 2023–2031, Table 4 (p. 28): San Francisco's allocation by income tier,
// 82,069 in all. Budget Analyst Exhibit D (p. 5), tier 1, carries the same split.
const ABAG_TABLE_4 = Object.freeze({
  label: 'ABAG, Final RHNA Plan 2023–2031, Table 4',
  url: 'https://abag.ca.gov/sites/default/files/documents/2021-12/Final_RHNA_Allocation_Report_2023-2031-approved_0.pdf'
});

/** RHNA 2023–2031 by income tier. Order is display order; the units sum to the `rhna` target. */
export const RHNA_TIER_TARGETS: readonly Target[] = Object.freeze([
  Object.freeze({
    id: 'rhna-very-low',
    label: 'Very low income (under 50% of area median)',
    units: 20867,
    tier: 'veryLow',
    source: ABAG_TABLE_4
  }),
  Object.freeze({
    id: 'rhna-low',
    label: 'Low income (50% to 80% of area median)',
    units: 12014,
    tier: 'low',
    source: ABAG_TABLE_4
  }),
  Object.freeze({
    id: 'rhna-moderate',
    label: 'Moderate income (80% to 120% of area median)',
    units: 13717,
    tier: 'moderate',
    source: ABAG_TABLE_4
  }),
  Object.freeze({
    id: 'rhna-above-moderate',
    label: 'Above moderate income (over 120% of area median)',
    units: 35471,
    tier: 'aboveModerate',
    source: ABAG_TABLE_4
  })
]);
