import type { QualityRule } from '../quality';

/**
 * stage-calibration's T14 rules (design row T14; stage-calibration spec §4.4a). Each entry takes
 * its kind's default shares (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10)
 * except `sc.stages.gap-impute`, whose departure is stated at the entry. The calibration step
 * changes values only in its own memory.
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
    denominator: 'qualifying histories that contribute a spell in a pooled window',
    // Departs from the `gap` defaults (conductor ruling C1 / partner DQ-4, 2026-10-18): stage model
    // fills unrecorded intermediate stages; construction-start (FCD) dates sparse.
    warnShare: 0.1,
    failShare: 0.2,
    unitsWeighted: false
  },
  {
    // Partner ruling P1 / controller ruling R13 (2026-10-18): a completion with no construction
    // start keeps its incidence; its permit and construction durations are left out (the cells'
    // observed advances are up-weighted instead, pipeline/lib/fzp-cal/no-fcd.ts).
    id: 'sc.stages.no-fcd-duration',
    owner: 'stage-calibration',
    source: 'project-histories',
    field: 'entered',
    kind: 'missing',
    action: 'drop',
    tier: 2,
    valueTier: null,
    maskBit: null,
    label:
      'A completed project with no recorded construction start counts as finished, but not in the time spent in permit and construction',
    denominator: 'qualifying histories that contribute a spell in a pooled window',
    warnShare: 0.05,
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
    // Counted over windowed exits (conductor ruling C3, 2026-10-18); the unwindowed counts and
    // every purge window stay in the report and provenance.
    denominator: 'exits of qualifying histories that contribute a spell in a pooled window',
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
