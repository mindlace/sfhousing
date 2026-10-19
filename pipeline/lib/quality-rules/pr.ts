import { SCORE_ONLY_QUALITY_ID } from '../../../src/lib/timelapse/projects';
import type { QualityRule } from '../quality';

/** project-records' rule ids (project-records spec §4.11), for the code that records them. */
export const PR = {
  dateValidRange: 'pr.date.valid-range',
  storiesParseRange: 'pr.stories.parse-range',
  stagesForwardClamp: 'pr.stages.forward-clamp',
  stagesLastObservedClamp: 'pr.stages.last-observed-clamp',
  stagesCompleteFromEvidence: 'pr.stages.complete-from-evidence',
  stagesStatutoryExpiry: 'pr.stages.statutory-expiry',
  stagesExpiryNoValuation: 'pr.stages.expiry-no-valuation',
  stagesVerifiedConstruction: 'pr.stages.verified-construction',
  stagesInferredLapse: 'pr.stages.inferred-lapse',
  stagesStreamlinedExpiry: 'pr.stages.streamlined-expiry',
  permitsPlaceholderValuation: 'pr.permits.placeholder-valuation',
  projectsSuperseded: 'pr.projects.superseded',
  unitsCapacity: 'pr.units.capacity',
  unitsCapacityCap: 'pr.units.capacity-cap',
  unitsCapacityUnmapped: 'pr.units.capacity-unmapped',
  unitsSplitFiled: 'pr.units.split-filed',
  unitsFiledZero: 'pr.units.filed-zero',
  pipelineStatusDateLinked: 'pr.pipeline.status-date-linked',
  pipelineNoStatusDate: 'pr.pipeline.no-status-date',
  pipelineRecordsWin: 'pr.pipeline.records-win',
  parcelsCrossBlock: 'pr.parcels.cross-block',
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
    id: PR.stagesLastObservedClamp,
    owner: OWNER,
    source: 'derived end',
    field: 'end.lastObserved',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label: 'The last day a project was seen was moved up to its latest stage date',
    denominator: 'open histories',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    // Ruling C2 (partner): T4d only; never on an in-flight project's history, so no T3 value.
    // Evidence (i) reads new-construction xdht rows only (Ruling C4); evidence (ii) skips panel
    // rows imputed for units or carried (mask bits 3 and 5). A multi-building project is dated by
    // its first building's completion (main's ruling 4, accepted).
    id: PR.stagesCompleteFromEvidence,
    owner: OWNER,
    source: 'datasf-housing-production, scenario_panel',
    field: 'end',
    kind: 'gap',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label:
      'A building the records show as finished but never certified complete was treated as complete',
    denominator: 'histories that entered construction',
    // Override (partner-approved): DataSF never records permit expiry or completion for these;
    // the rules supply them from the building code (§106A.4.4) and the assessor roll / xdht;
    // live 2.99% / 3.76%.
    warnShare: 0.05,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    // Ruling E2 (partner): SFBC 106A.4.4 Table B (pipeline/project-records/expiry.ts). Ruling I4:
    // it also ends an in-flight project's history, which then leaves flight
    // (projects.excludedStatutory). A history with a unit-bearing permit that has a completion
    // day is excluded and stays open (I3 rejected), counted as
    // histories.statutoryExpiry.excludedCompletePermit. A revised_cost under $1,000 is a
    // placeholder; the estimate is used.
    id: PR.stagesStatutoryExpiry,
    owner: OWNER,
    source: 'datasf-permits-newcon',
    field: 'end',
    kind: 'gap',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label:
      'A permit past its legal completion deadline with no recorded extension was treated as expired',
    denominator: 'histories that entered permit issued',
    // Override (partner-approved): DataSF never records permit expiry or completion for these;
    // the rules supply them from the building code (§106A.4.4) and the assessor roll / xdht;
    // live 2.99% / 3.76%.
    warnShare: 0.05,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    // Ruling E2's no-valuation case, counted apart (observe; no record carries it).
    id: PR.stagesExpiryNoValuation,
    owner: OWNER,
    source: 'datasf-permits-newcon',
    field: 'revised_cost, estimated_cost',
    kind: 'observe',
    action: 'none',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      'A permit with no recorded valuation was given the middle valuation bracket for its legal completion deadline',
    denominator: 'unit-bearing permits whose deadline the statutory-expiry rule read from Table B',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    // Ruling C3 (partner): pipeline/enrichment/construction-verified.json; T4d only.
    id: PR.stagesVerifiedConstruction,
    owner: OWNER,
    source: 'pipeline/enrichment/construction-verified.json',
    field: 'end',
    kind: 'gap',
    action: 'replace',
    tier: 3,
    valueTier: 3,
    maskBit: null,
    label: 'A stalled project was ended by a check of street or aerial imagery',
    denominator: 'curated verdict entries',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    // Ruling IL1 (partner ruling 2b): rule.json modelingRule.discretionaryExpiryDay
    // (pipeline/project-records/entitlement.ts). The standard condition is not self-executing
    // since 2014 and extensions leave no status, so an inference with a year of grace; an
    // in-flight history that meets the test is only flagged (projects.lapseFlagged). T4d only.
    id: PR.stagesInferredLapse,
    owner: OWNER,
    source: 'datasf-planning-projects, datasf-planning-records (conditions of approval)',
    field: 'end',
    kind: 'shape',
    action: 'replace',
    tier: 3,
    valueTier: 3,
    maskBit: null,
    label:
      'A discretionary approval with no permit or other activity a year past its performance period was treated as lapsed',
    denominator: 'discretionary and Housing Choice-SF histories that entered entitled',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    // Ruling SE1 (partner ruling 2c): Gov. Code 65913.4(g) (SB 35) and 65912.114(l) (AB 2011),
    // 3 years plus the one-time 1-year extension, AB 1561 / AB 2729 applied
    // (pipeline/project-records/entitlement.ts). Never for number_affordable_units_prop x 2 >=
    // number_of_units_prop (histories.streamlinedExpiry.affordableExempt); litigation tolling is
    // unrecorded. Self-executing, so an in-flight project leaves flight
    // (projects.excludedStreamlinedExpiry). T4d only.
    id: PR.stagesStreamlinedExpiry,
    owner: OWNER,
    source: 'datasf-planning-projects',
    field: 'end',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label: 'A streamlined approval past its statutory term was treated as expired',
    denominator: 'SB 35, SB 423 and AB 2011 histories that entered entitled',
    warnShare: 0.01,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    // Main's ruling 4, partner Ruling PV1: a revised_cost under $1,000 is a placeholder (live, e.g.
    // 1.0 against an estimate of 510,000). It takes the first real valuation (>= $1,000) of the
    // permit's own estimated_cost, its other rows, else the nearest permit of its project by filed
    // day (pipeline/project-records/valuation.ts); with none, its own estimate as recorded. Tier 2
    // and valueTier 2: the weakest value it writes, a sibling permit's (counters
    // permits.placeholderFilled.* and permits.placeholderUnfilled).
    id: PR.permitsPlaceholderValuation,
    owner: OWNER,
    source: 'datasf-permits-newcon',
    field: 'revised_cost',
    kind: 'bound',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label:
      'A placeholder permit valuation under $1,000 was replaced by the nearest real valuation of the permit or its project',
    denominator: 'permits with a revised cost',
    // Override (partner ruling): placeholders filled from own estimate or nearest project permit
    // (87/141 live); 54 unfilled (0.53% of permits) move no output; share reflects alteration
    // permits added by named linkage; live 141/10,230 = 1.38%.
    warnShare: 0.02,
    failShare: 0.05,
    unitsWeighted: false
  },
  {
    // Partner ruling 3, Rulings SP1, SP2 and SP3: T3 only (the history is unchanged); no record.
    id: PR.projectsSuperseded,
    owner: OWNER,
    source: 'derived in-flight projects (PRJ address, parcels, units, open day)',
    field: 'projects',
    kind: 'shape',
    action: 'drop',
    tier: 3,
    valueTier: null,
    maskBit: null,
    label: 'A Planning case refiled for the same address replaces the earlier one',
    denominator: 'in-flight projects anchored on a Planning record',
    warnShare: 0.01,
    failShare: 0.1,
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
    // Ruling F1a (comprehension gate F1), Ruling U1: T4d only. A Planning record's
    // number_of_units_prop of 0 is not a recorded size (units precedence, spec 4.8 rule 2, needs
    // > 0); the history's unitsAt.filed is its next recorded count (permitFiled, else complete),
    // or omitted when it has none. A split part is counted under pr.units.split-filed only.
    id: PR.unitsFiledZero,
    owner: OWNER,
    source: 'datasf-planning-projects',
    field: 'unitsAt.filed',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label:
      "A Planning record's home count of zero was replaced by the next recorded count (building permit, else completion)",
    denominator: 'histories whose primary Planning record has a proposed unit count',
    // Override (partner ruling): Planning records often carry no usable unit count at filing
    // (zero, or the whole multi-building case); the model carries the next recorded count
    // backwards. Live 859 / 2,569 = 33.4%.
    warnShare: 0.4,
    failShare: 0.5,
    unitsWeighted: false
  },
  {
    // Ruling S2 (stage-calibration finding 2), Ruling U1: T4d only; no T3 value changes. A split
    // part's unitsAt.filed is its own next recorded count (permitFiled, else complete), or
    // omitted when it has none.
    id: PR.unitsSplitFiled,
    owner: OWNER,
    source: 'datasf-planning-projects',
    field: 'unitsAt.filed',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    maskBit: null,
    label:
      'A building split from a multi-building Planning case takes its own next recorded home count at filing',
    denominator: 'histories whose primary Planning record has a proposed unit count',
    // Override (partner ruling): Planning records often carry no usable unit count at filing
    // (zero, or the whole multi-building case); the model carries the next recorded count
    // backwards. Live 48 / 2,569 = 1.9%.
    warnShare: 0.4,
    failShare: 0.5,
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
    // Override (partner-approved): quarterly pipeline lags the daily records on ended projects
    // (16/413 live).
    warnShare: 0.05,
    failShare: 0.1,
    unitsWeighted: false
  },
  {
    id: PR.parcelsCrossBlock,
    owner: OWNER,
    source: 'project parcels (derived from the permit and Planning lots)',
    field: 'parcelIds',
    kind: 'shape',
    action: 'drop',
    tier: 4,
    valueTier: null,
    maskBit: null,
    label:
      "A parcel from the Planning record on a different block from the permits' lots was not used",
    denominator: 'projects with a resolved permit address parcel',
    // Override (partner-approved): umbrella Planning cases on multi-block master plans record one
    // tracking lot; split building permits sit on other blocks; live 39/3,384 = 1.15%.
    warnShare: 0.03,
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
