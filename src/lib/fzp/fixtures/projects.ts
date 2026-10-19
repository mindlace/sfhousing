/**
 * `projects.json` fixtures for the fzp-mode unit tests (spec §4.10 section 10). Plain JSON-shaped
 * objects, typed `unknown` like a fetched body. `PROJECTS_JSON` has one project that fails
 * per-project validation (a malformed id) and passes every file-level check, so
 * `parseProjectsFile(json, { onInvalid })` drops it and does not throw.
 */
import { FIX_ASOF } from './timeline-score';

const rhnaCompletedNet = {
  units: 12000,
  since: 19173,
  provenance: {
    tier: 1,
    label: 'Net homes completed since 30 Jun 2022 (actual)',
    sources: [{ label: 'DataSF Housing Production', url: 'https://data.sf.gov/d/xdht-4php' }],
    method: 'Sum of net units completed since the start of the RHNA period.',
    window: ['2022-06-30', '2026-10-16']
  }
};

function project(
  id: string,
  parcel: string,
  quality: string[],
  stage: 'permitFiled' | 'permitIssued' = 'permitFiled'
) {
  return {
    id,
    label: null,
    parcelIds: [parcel],
    pathway: 'permitOnly',
    stage,
    history: { [stage]: FIX_ASOF - 90 },
    units: 4,
    existingUnits: 1,
    stories: null,
    storiesTier: null,
    multiPhase: false,
    phases: null,
    sources: [{ dataset: 'i98e-djp9', id: id.slice(3), key: 'permit_number' }],
    quality
  };
}

const RULES = [
  {
    id: 'pr.date.valid-range',
    label: 'A date outside 1970 to the snapshot day was treated as missing',
    tier: 4,
    valueTier: null
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

export const PROJECTS_JSON: unknown = {
  schema: 1,
  asOf: FIX_ASOF,
  rhnaCompletedNet,
  qualityRules: RULES,
  projects: [
    project('BP:2024-0001', '3512001', ['pr.date.valid-range', 'pr.stages.forward-clamp']),
    project('BP:2024-0002', '3512002', [
      'pr.pipeline.status-date-linked',
      'pr.stages.forward-clamp'
    ]),
    project('BP:2024-0003', '3512003', [], 'permitIssued'),
    // Fails per-project validation: not a valid project id.
    project('NOT-A-PROJECT-ID', '3512004', ['pr.pipeline.status-date-linked'])
  ]
};

/** No rule fired: `qualityRules` is empty and every project's `quality` is `[]`. */
export const PROJECTS_JSON_NO_RULES: unknown = {
  schema: 1,
  asOf: FIX_ASOF,
  rhnaCompletedNet,
  qualityRules: [],
  projects: [project('BP:2024-0001', '3512001', []), project('BP:2024-0003', '3512003', [])]
};
