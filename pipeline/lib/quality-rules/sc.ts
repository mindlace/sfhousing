import type { QualityRule } from '../quality';

/**
 * stage-calibration's T14 rules (design row T14; stage-calibration spec §4.4a). Each entry takes
 * its kind's default shares (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10);
 * none departs. The calibration step changes values only in its own memory.
 */
export const SC_RULES: readonly QualityRule[] = [
  {
    id: 'sc.stages.gap-impute',
    owner: 'stage-calibration',
    source: 'project-histories',
    field: 'entered',
    kind: 'gap',
    action: 'default',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label: "A missing stage between two recorded stages takes the next recorded stage's date",
    denominator: 'qualifying histories',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: 'sc.stages.running-max',
    owner: 'stage-calibration',
    source: 'project-histories',
    field: 'entered',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label: "Stage dates made non-decreasing (re-check of the project records' clamp)",
    denominator: 'qualifying histories',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: 'sc.exit.last-stage',
    owner: 'stage-calibration',
    source: 'project-histories',
    field: 'end',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label:
      "An exit is placed at the last stage the project entered, no earlier than that stage's start",
    denominator: 'qualifying histories that end in an exit',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: 'sc.exit.purge-censor',
    owner: 'stage-calibration',
    source: 'project-histories',
    field: 'end',
    kind: 'outlier',
    action: 'replace',
    // The rule's tier is the worse of its tier-2 detection and tier-4 thresholds (spec §4.4 step 6).
    tier: 4,
    valueTier: 2,
    maskBit: null,
    label:
      'An exit inside an administrative purge window counts as still open, not as a project decision',
    denominator: 'exits of qualifying histories (after step 3)',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: 'sc.revision.ratio-clamp',
    owner: 'stage-calibration',
    source: 'project-histories',
    field: 'unitsAt',
    kind: 'bound',
    action: 'replace',
    tier: 4,
    valueTier: 4,
    maskBit: null,
    label: 'A resize outside 0.25× to 3× is clamped to that range',
    denominator: 'revised pairs',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  }
];
