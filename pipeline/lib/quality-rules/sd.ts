import type { QualityRule } from '../quality';

/**
 * scenario-data's T14 rules (scenario-data spec §4.12). Each entry takes its kind's default
 * shares (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10) unless a comment
 * at the entry states why it departs.
 */
export const SD_RULES: readonly QualityRule[] = [];
