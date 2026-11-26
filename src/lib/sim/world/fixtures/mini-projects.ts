// The mini `scenarios/fzp/projects.json` (T3) over the mini city (mini-parcels.ts). Browser-safe.
// Fixture values only (tier 4, made up for the timelapse-sim tests): not data.
//
// Two spec §6 cases cannot be written into a file that passes `parseProjectsFile`, which requires
// `stage` to be the last history stage and every history day to be <= `asOf`: a missing
// current-stage day and a history day after `asOf`. Tests build them by editing a parsed copy
// (e.g. delete `history[stage]`, or set `history.filed = asOf + 30`).
import type { ParcelId } from '$lib/data/parcel';
import type { InFlightProject, QualityRuleRef } from '$lib/timelapse/projects';
import { dayOf } from '../dates';

/** Snapshot day of every mini file: 2026-10-16. */
export const MINI_AS_OF = dayOf(2026, 10, 16);
/** The horizon the simulation tests use: 2050-12-31. */
export const MINI_HORIZON = dayOf(2050, 12, 31);

/** Stable names for the mini projects later tests refer to. */
export const MINI_PROJECTS = {
  /** discretionary at preApplication, 1 LP parcel, stories 5 (tier 3) */
  preApplication: 'PPA:2026-000101PPA',
  /** discretionary at filed since 2025-11-20 (m = 10, 25 days into the current month at asOf:
   * the in-flight redraw candidate); 2 neighbouring parcels in one cell; a source with no key */
  filedPair: 'PRJ:2025-000102PRJ',
  /** streamlined at entitled on an LP parcel, stories 6 (tier 0), units well below the yield */
  entitledStreamlined: 'PRJ:2024-000103PRJ',
  /** discretionary at permitFiled, neighbours across two cells (2999A019 / 2999A020) */
  crossCell: 'PRJ:2023-000104PRJ',
  /** permitOnly at permitFiled, null label and stories */
  permitFiled: 'BP:202405010105',
  /** permitOnly at permitIssued, stories 3 (tier 0) */
  permitIssued: 'BP:202310020106',
  /** discretionary at construction since 2024-06-03 (construction before asOf) */
  construction: 'PRJ:2021-000107PRJ',
  /** complete (skipped by simulate) */
  complete: 'PRJ:2019-000108PRJ',
  /** a row linked by parcel (DQ-2): quality status-date-linked and forward-clamp, in id order */
  linked: 'PRJ:2020-000109PRJ',
  /** permitOnly on 3512012 with its full assessor units (2) */
  sharedFirst: 'BP:202501150110',
  /** discretionary on 3512012 too, existingUnits 0 < assessor 2: pr.parcels.shared-existing */
  sharedExisting: 'PRJ:2025-000111PRJ',
  /** invalid: units -3 (skipped per project by parseProjectsFile with onInvalid) */
  invalid: 'PRJ:2025-000113PRJ',
  /** every parcel absent from the mini city */
  absentOnly: 'PRJ:2026-000114PRJ',
  /** one parcel in the mini city (3600014), one absent (9900002) */
  absentMixed: 'BP:202602020115',
  /** a 1-unit permitOnly project on the 6 × 6 m lot 0026T013 (generateForUnits gives null) */
  oneUnit: 'BP:202606010116',
  /** multiPhase with phases null and parcels (a drawing last-resort master) */
  unphased: 'CASE:2015-000115PRX',
  /** entitled master, 3 phases: plan date after asOf, overdue, null; a 4th DA parcel in no phase */
  entitled3: 'CASE:2012.000201PRX',
  /** unentitled master (filed since 2023-04-01), 2 phases; phase 1 planned asOf + 45 */
  unentitled2: 'CASE:2023-000202PRX',
  /** entitled master with one unenriched phase on one parcel (P = 1) */
  singlePhase: 'CASE:2010-000203PRX',
  /** score-only last-resort master (DQ-3): parcelIds [] */
  scoreOnly: 'CASE:2014-000204PRX'
} as const;

/** Parcel ids the projects name that are not in `miniCity()`. */
export const MINI_ABSENT_PARCEL_IDS: readonly ParcelId[] = ['9900001', '9900002'];
/** Phase 1 of `unentitled2` files on this plan date unless the drawn entitlement is later. */
export const MINI_UNENTITLED_PLAN_DAY = MINI_AS_OF + 45;

const d = dayOf;

const QUALITY_RULES: QualityRuleRef[] = [
  {
    id: 'pr.multiphase.da-netting',
    label:
      'Remaining Development Agreement homes reduced by projects filed after ' +
      "Planning's quarterly count",
    tier: 2,
    valueTier: 2
  },
  {
    id: 'pr.multiphase.score-only',
    label: 'Counted in the score but not drawn: no free lot in the plan area',
    tier: 2,
    valueTier: null
  },
  {
    id: 'pr.parcels.shared-existing',
    label: 'Existing homes counted once on a shared lot',
    tier: 2,
    valueTier: 2
  },
  {
    id: 'pr.pipeline.status-date-linked',
    label: 'Dates taken from the Planning record on this lot',
    tier: 2,
    valueTier: 0
  },
  {
    id: 'pr.stages.forward-clamp',
    label: "A stage date earlier than the stage before it was moved up to that stage's date",
    tier: 2,
    valueTier: 2
  }
];

const base = {
  label: null,
  stories: null,
  storiesTier: null,
  multiPhase: false,
  phases: null,
  quality: []
} satisfies Partial<InFlightProject>;

const daSource = (label: string) => ({
  label: `${label} DA phasing schedule`,
  url: 'https://example.org/mini-da.pdf',
  retrieved: '2026-10-01'
});
const bp = (permit: string) => [
  { dataset: '6jgi-cpb4', id: permit, key: 'bpa_no' },
  { dataset: 'i98e-djp9', id: permit, key: 'permit_number' }
];
const prj = (record: string) => [
  { dataset: '6jgi-cpb4', id: record, key: 'case_no' },
  { dataset: 'qvu5-m3a2', id: record }
];

function projects(): InFlightProject[] {
  const P = MINI_PROJECTS;
  return [
    {
      ...base,
      id: P.permitIssued,
      label: '36 Mini Ave',
      parcelIds: ['3512006'],
      pathway: 'permitOnly',
      stage: 'permitIssued',
      history: { permitFiled: d(2023, 10, 2), permitIssued: d(2025, 3, 14) },
      units: 4,
      existingUnits: 0,
      stories: 3,
      storiesTier: 0,
      sources: bp('202310020106')
    },
    {
      ...base,
      id: P.permitFiled,
      parcelIds: ['3512005'],
      pathway: 'permitOnly',
      stage: 'permitFiled',
      history: { permitFiled: d(2024, 5, 1) },
      units: 2,
      existingUnits: 1,
      sources: bp('202405010105')
    },
    {
      ...base,
      id: P.sharedFirst,
      parcelIds: ['3512012'],
      pathway: 'permitOnly',
      stage: 'permitFiled',
      history: { permitFiled: d(2025, 1, 15) },
      units: 3,
      existingUnits: 2,
      sources: bp('202501150110')
    },
    {
      ...base,
      id: P.absentMixed,
      parcelIds: ['3600014', '9900002'],
      pathway: 'permitOnly',
      stage: 'permitFiled',
      history: { permitFiled: d(2026, 2, 2) },
      units: 3,
      existingUnits: 1,
      sources: bp('202602020115')
    },
    {
      ...base,
      id: P.oneUnit,
      parcelIds: ['0026T013'],
      pathway: 'permitOnly',
      stage: 'permitFiled',
      history: { permitFiled: d(2026, 6, 1) },
      units: 1,
      existingUnits: 0,
      sources: bp('202606010116')
    },
    {
      ...base,
      id: P.singlePhase,
      label: 'Mini Village',
      parcelIds: ['3600009'],
      pathway: 'discretionary',
      stage: 'entitled',
      history: { entitled: d(2011, 2, 1) },
      units: 100,
      existingUnits: 0,
      multiPhase: true,
      phases: [{ units: 100, parcelIds: ['3600009'], plannedPermitFiled: null, source: null }],
      sources: [{ dataset: '6jgi-cpb4', id: '2010-000203PRX', key: 'case_no' }]
    },
    {
      ...base,
      id: P.entitled3,
      label: 'Mini Shipyard',
      parcelIds: ['3600003', '3600004', '3600005', '3600006'],
      pathway: 'discretionary',
      stage: 'entitled',
      history: { filed: d(2009, 3, 2), entitled: d(2012, 6, 15) },
      units: 900,
      existingUnits: 5,
      multiPhase: true,
      phases: [
        {
          units: 300,
          parcelIds: ['3600003'],
          plannedPermitFiled: d(2027, 6, 1),
          source: daSource('Mini Shipyard')
        },
        {
          units: 350,
          parcelIds: ['3600004'],
          plannedPermitFiled: d(2024, 3, 1),
          source: daSource('Mini Shipyard')
        },
        {
          units: 250,
          parcelIds: ['3600005'],
          plannedPermitFiled: null,
          source: daSource('Mini Shipyard')
        }
      ],
      sources: [{ dataset: '6jgi-cpb4', id: '2012.000201PRX', key: 'case_no' }],
      quality: ['pr.multiphase.da-netting']
    },
    {
      ...base,
      id: P.scoreOnly,
      label: 'Mini Basin',
      parcelIds: [],
      pathway: 'discretionary',
      stage: 'entitled',
      history: { entitled: d(2015, 3, 2) },
      units: 75,
      existingUnits: 0,
      multiPhase: true,
      sources: [{ dataset: '6jgi-cpb4', id: '2014-000204PRX', key: 'case_no' }],
      quality: ['pr.multiphase.da-netting', 'pr.multiphase.score-only']
    },
    {
      ...base,
      id: P.unphased,
      label: 'Mini Landing',
      parcelIds: ['3600001', '3600002'],
      pathway: 'discretionary',
      stage: 'entitled',
      history: { entitled: d(2016, 5, 2) },
      units: 150,
      existingUnits: 0,
      multiPhase: true,
      sources: [{ dataset: '6jgi-cpb4', id: '2015-000115PRX', key: 'case_no' }]
    },
    {
      ...base,
      id: P.unentitled2,
      label: 'Mini Yards',
      parcelIds: ['3600007', '3600008'],
      pathway: 'discretionary',
      stage: 'filed',
      history: { filed: d(2023, 4, 1) },
      units: 400,
      existingUnits: 0,
      multiPhase: true,
      phases: [
        {
          units: 150,
          parcelIds: ['3600007'],
          plannedPermitFiled: MINI_UNENTITLED_PLAN_DAY,
          source: daSource('Mini Yards')
        },
        {
          units: 250,
          parcelIds: ['3600008'],
          plannedPermitFiled: null,
          source: daSource('Mini Yards')
        }
      ],
      sources: [{ dataset: '6jgi-cpb4', id: '2023-000202PRX', key: 'case_no' }]
    },
    {
      ...base,
      id: P.preApplication,
      label: '12 Mini St',
      parcelIds: ['0026T002'],
      pathway: 'discretionary',
      stage: 'preApplication',
      history: { preApplication: d(2026, 8, 3) },
      units: 12,
      existingUnits: 1,
      stories: 5,
      storiesTier: 3,
      sources: [{ dataset: 'y673-d69b', id: '2026-000101PPA', key: 'record_id' }]
    },
    {
      ...base,
      id: P.complete,
      parcelIds: ['2999A007'],
      pathway: 'discretionary',
      stage: 'complete',
      history: {
        filed: d(2019, 1, 10),
        entitled: d(2019, 9, 3),
        permitFiled: d(2019, 12, 2),
        permitIssued: d(2020, 8, 3),
        construction: d(2021, 2, 1),
        complete: d(2025, 12, 1)
      },
      units: 8,
      existingUnits: 0,
      sources: prj('2019-000108PRJ')
    },
    {
      ...base,
      id: P.construction,
      label: '500 Mini Blvd',
      parcelIds: ['2999A005'],
      pathway: 'discretionary',
      stage: 'construction',
      history: {
        filed: d(2021, 3, 1),
        entitled: d(2021, 12, 1),
        permitFiled: d(2022, 4, 1),
        permitIssued: d(2023, 2, 1),
        construction: d(2024, 6, 3)
      },
      units: 60,
      existingUnits: 3,
      stories: 8,
      storiesTier: 0,
      sources: prj('2021-000107PRJ'),
      quality: ['pr.stages.forward-clamp']
    },
    {
      ...base,
      id: P.crossCell,
      label: '19 Mini Ct',
      parcelIds: ['2999A019', '2999A020'],
      pathway: 'discretionary',
      stage: 'permitFiled',
      history: {
        preApplication: d(2022, 5, 2),
        filed: d(2022, 8, 10),
        entitled: d(2023, 6, 1),
        permitFiled: d(2024, 1, 22)
      },
      units: 48,
      existingUnits: 3,
      stories: 7,
      storiesTier: 0,
      sources: prj('2023-000104PRJ')
    },
    {
      ...base,
      id: P.entitledStreamlined,
      parcelIds: ['3512010'],
      pathway: 'streamlined',
      stage: 'entitled',
      history: { filed: d(2024, 2, 1), entitled: d(2024, 9, 16) },
      units: 9,
      existingUnits: 1,
      stories: 6,
      storiesTier: 0,
      sources: prj('2024-000103PRJ')
    },
    {
      ...base,
      id: P.linked,
      label: 'Mini West',
      parcelIds: ['3600010'],
      pathway: 'discretionary',
      stage: 'filed',
      history: { filed: d(2020, 7, 24) },
      units: 240,
      existingUnits: 0,
      sources: [
        { dataset: '6jgi-cpb4', id: '2020-000109PRX', key: 'case_no' },
        { dataset: 'qvu5-m3a2', id: '2020-000109PRJ' }
      ],
      quality: ['pr.pipeline.status-date-linked', 'pr.stages.forward-clamp']
    },
    {
      ...base,
      id: P.filedPair,
      parcelIds: ['0026T003', '0026T004'],
      pathway: 'discretionary',
      stage: 'filed',
      history: { filed: d(2025, 11, 20) },
      units: 30,
      existingUnits: 2,
      sources: [{ dataset: 'qvu5-m3a2', id: '2025-000102PRJ' }]
    },
    {
      ...base,
      id: P.sharedExisting,
      parcelIds: ['3512012'],
      pathway: 'discretionary',
      stage: 'filed',
      history: { filed: d(2025, 6, 9) },
      units: 6,
      existingUnits: 0,
      sources: prj('2025-000111PRJ'),
      quality: ['pr.parcels.shared-existing']
    },
    {
      ...base,
      id: P.invalid,
      parcelIds: ['3512015'],
      pathway: 'discretionary',
      stage: 'filed',
      history: { filed: d(2025, 8, 1) },
      units: -3,
      existingUnits: 0,
      sources: prj('2025-000113PRJ')
    },
    {
      ...base,
      id: P.absentOnly,
      parcelIds: ['9900001'],
      pathway: 'discretionary',
      stage: 'filed',
      history: { filed: d(2026, 3, 3) },
      units: 5,
      existingUnits: 0,
      sources: prj('2026-000114PRJ')
    }
  ];
}

/** Index of the invalid project in `miniProjectsJson().projects`. */
export const MINI_INVALID_INDEX = projects().findIndex((p) => p.id === MINI_PROJECTS.invalid);

/** A fresh, full `projects.json` value (validate it with `parseProjectsFile`). */
export function miniProjectsJson(): unknown {
  return {
    schema: 1,
    asOf: MINI_AS_OF,
    rhnaCompletedNet: {
      units: 1234,
      since: d(2022, 6, 30),
      provenance: {
        tier: 4,
        label: 'Net homes completed since 30 Jun 2022 (mini fixture)',
        sources: [{ label: 'timelapse-sim mini fixture', url: 'https://example.org/mini-fixture' }],
        method: 'Hand-written simulator fixture (tier 4, made up); not data.'
      }
    },
    qualityRules: QUALITY_RULES.map((r) => ({ ...r })),
    projects: projects()
  };
}
