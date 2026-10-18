import type { QualityRule } from '../quality';

/**
 * project-records' T14 rules (design row T14). Each entry takes its kind's default shares
 * (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10) unless a comment at the
 * entry states why it departs.
 */
export const PR_RULES: readonly QualityRule[] = [];
