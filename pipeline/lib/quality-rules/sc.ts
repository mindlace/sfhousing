import type { QualityRule } from '../quality';

/**
 * stage-calibration's T14 rules (design row T14). Each entry takes its kind's default shares
 * (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10) unless a comment at the
 * entry states why it departs.
 */
export const SC_RULES: readonly QualityRule[] = [];
