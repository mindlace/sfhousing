import { SCORE_ONLY_QUALITY_ID } from '../../../src/lib/timelapse/projects';
import type { QualityRule } from '../quality';

/** project-records' rule ids (project-records spec §4.11), for the code that records them. */
export const PR = {
  dateValidRange: 'pr.date.valid-range',
  storiesParseRange: 'pr.stories.parse-range',
  stagesForwardClamp: 'pr.stages.forward-clamp',
  unitsCapacity: 'pr.units.capacity',
  unitsCapacityCap: 'pr.units.capacity-cap',
  unitsCapacityUnmapped: 'pr.units.capacity-unmapped',
  pipelineStatusDateLinked: 'pr.pipeline.status-date-linked',
  pipelineNoStatusDate: 'pr.pipeline.no-status-date',
  pipelineRecordsWin: 'pr.pipeline.records-win',
  parcelsSharedExisting: 'pr.parcels.shared-existing',
  /** The T3 validator's marker of a score-only master (src/lib/timelapse/projects.ts). */
  multiphaseScoreOnly: SCORE_ONLY_QUALITY_ID,
  multiphaseDaNetting: 'pr.multiphase.da-netting'
} as const;

export type PrRuleId = (typeof PR)[keyof typeof PR];

const OWNER = 'project-records';

/**
 * project-records' T14 rules (design row T14; project-records spec §4.11). Each entry takes its
 * kind's default shares (`warnShare` 0.05 for `kind: 'missing'`, else 0.01; `failShare` 0.10)
 * unless a comment at the entry states why it departs. Records carry these ids in `quality`
 * instead of mask bits, so every `maskBit` is null.
 */
export const PR_RULES: readonly QualityRule[] = [
  {
    id: PR.dateValidRange,
    owner: OWNER,
    source:
      'datasf-permits-newcon, datasf-planning-projects, datasf-planning-records, datasf-planning-review, datasf-unit-completions, datasf-housing-production, datasf-dev-pipeline',
    field: 'every date field',
    kind: 'bound',
    action: 'null',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label: 'A date outside 1970 to the snapshot day was treated as missing',
    denominator: 'non-empty date values parsed',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: PR.storiesParseRange,
    owner: OWNER,
    source: 'datasf-planning-projects, datasf-dev-pipeline',
    field: 'stories parsed from description / description_planning',
    kind: 'bound',
    action: 'null',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label: 'A story count read from the project description was outside 1 to 80 and was not used',
    denominator: 'stories values parsed from text',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: PR.stagesForwardClamp,
    owner: OWNER,
    source: 'derived stage entry days',
    field: 'entered',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label: "A stage date earlier than the stage before it was moved up to that stage's date",
    denominator: 'histories',
    // Override (tier-4 check bound, approved in reappraisal 1): a declared normalisation of
    // cross-record dates, which are routinely out of order. On the 2026-10-16 smoke lock it moved
    // 1,697 stage days across 10,212 histories (at most 16.6% of histories), above the 0.10
    // default fail share.
    warnShare: 0.25,
    failShare: 0.5,
    unitsWeighted: false
  },
  {
    id: PR.unitsCapacity,
    owner: OWNER,
    source: 'datasf-permits-newcon',
    field: 'proposed_units',
    kind: 'outlier',
    action: 'null',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label: "A permit's unit count was more than its lot could physically hold and was not used",
    denominator: 'permits with recorded stories and units on a project with parcels',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: true
  },
  {
    id: PR.unitsCapacityCap,
    owner: OWNER,
    source: 'datasf-permits-newcon',
    field: 'proposed_units',
    kind: 'outlier',
    action: 'replace',
    tier: 4,
    valueTier: 4,
    maskBit: null,
    label:
      "A permit's unit count was more than its lot could physically hold, so the most homes the lot can hold at the minimum space per home was used",
    denominator: 'permits with recorded stories and units on a project with parcels',
    // Override (partner-approved): two impossible permit records, 8500988 dominant; fallback or
    // minimum-space cap. Live units share 4.52%.
    warnShare: 0.05,
    failShare: 0.1,
    unitsWeighted: true
  },
  {
    id: PR.unitsCapacityUnmapped,
    owner: OWNER,
    source: 'datasf-permits-newcon',
    field: 'block, lot (the permit address rows)',
    kind: 'observe',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      "A permit's unit count was not checked against its lot because the permit's lot could not be matched to a parcel",
    denominator: 'permits with recorded stories and units on a project with parcels',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: PR.pipelineStatusDateLinked,
    owner: OWNER,
    source: 'datasf-dev-pipeline',
    field: 'current_status_date',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 0,
    maskBit: null,
    label: 'Dates taken from the Planning record on this lot',
    denominator: 'pipeline rows',
    // Override (partner-approved): two mega-project pipeline rows (Freedom West in, Flower Mart
    // out), outcomes per DQ-2; live units share 8.0%, rows 2 of 1,917.
    warnShare: 0.1,
    failShare: 0.2,
    unitsWeighted: true
  },
  {
    id: PR.pipelineNoStatusDate,
    owner: OWNER,
    source: 'datasf-dev-pipeline',
    field: 'current_status_date',
    kind: 'shape',
    action: 'drop',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label: 'A pipeline row with no status date and no Planning record on its lot was left out',
    denominator: 'pipeline rows',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: true
  },
  {
    id: PR.pipelineRecordsWin,
    owner: OWNER,
    source: 'datasf-dev-pipeline',
    field: 'current_status (against the end of the daily-record history)',
    kind: 'observe',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'The quarterly pipeline lists a project that the daily permit and Planning records show has finished or ended; the daily records are used',
    denominator: 'population projects matching at least one pipeline row',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: PR.parcelsSharedExisting,
    owner: OWNER,
    source: 'scenario_panel',
    field: 'existing_units',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label: 'Existing homes counted once on a shared lot',
    denominator: 'in-flight projects',
    // Override (tier-4 check bound, approved in reappraisal 1): an allocation, not an error rate.
    // Live, 81 of 438 in-flight projects (18.5%) share a parcel.
    warnShare: 0.25,
    failShare: 0.5,
    unitsWeighted: false
  },
  {
    id: PR.multiphaseScoreOnly,
    owner: OWNER,
    source: 'derived master parcels',
    field: 'parcelIds',
    kind: 'shape',
    action: 'none',
    // Main's ruling 5 (F2 live; Ruling Q1 overturned): tier 2, as in the design's rules table.
    tier: 2,
    valueTier: null,
    maskBit: null,
    label: 'Counted in the score but not drawn: no free lot in the plan area',
    denominator: 'in-flight PRX masters after netting',
    // Override (tier-4 check bound, approved in reappraisal 1): a small denominator of about 17
    // in-flight masters live, up to 4 of which could be score-only (the 4 overlaps of DQ-3),
    // about 24%.
    warnShare: 0.25,
    failShare: 0.5,
    unitsWeighted: true
  },
  {
    id: PR.multiphaseDaNetting,
    owner: OWNER,
    source: 'datasf-dev-pipeline',
    field: 'new_pipeline_units (master R)',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label:
      "Remaining Development Agreement homes reduced by projects filed after Planning's quarterly count",
    denominator: 'in-flight PRX masters before netting',
    // Override (tier-4 check bound, approved in reappraisal 1): about 17 in-flight masters live,
    // so one firing is about 6% and two would pass the default fail share. Netting is expected
    // wherever a DA has post-snapshot permits.
    warnShare: 0.1,
    failShare: 0.5,
    unitsWeighted: true
  }
];
