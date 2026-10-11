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
