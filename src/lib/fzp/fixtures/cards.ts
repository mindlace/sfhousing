/**
 * `ProjectCard` fixtures for the card logic and component tests (spec §4.8). Every day is an
 * offset from `FIX_ASOF` (2026-10-16), so recorded stages sit before it and simulated ones after.
 */
import type { ProjectCard } from '$lib/sim/protocol';
import { dayFromUtc } from '../time';
import { FIX_ASOF } from './timeline-score';

export { FIX_ASOF };

const at = (offset: number) => FIX_ASOF + offset;

/** A recorded, matched-massing, pipeline card with no quality marks; each fixture overrides. */
function pipeline(over: Partial<ProjectCard>): ProjectCard {
  return {
    projectId: 'pr-1',
    origin: 'pipeline',
    label: '1234 Mission St',
    pathway: 'discretionary',
    units: 24,
    existingUnits: 2,
    stories: 6,
    storiesTier: 0,
    massing: 'matched',
    multiPhase: false,
    phase: null,
    localProgram: false,
    lookups: 'inFlight',
    chanceShift: null,
    stages: [
      { stage: 'filed', day: at(-900), actual: true },
      { stage: 'entitled', day: at(-600), actual: true },
      { stage: 'permitFiled', day: at(-300), actual: true }
    ],
    revisions: [{ day: at(-900), units: 24, stories: 6 }],
    end: null,
    sources: [],
    quality: [],
    ...over
  };
}

/** A simulated card: stages after `asOf`, none recorded, stories from the size draw. */
function simulated(over: Partial<ProjectCard>): ProjectCard {
  return pipeline({
    projectId: 'sim-1',
    origin: 'simulated',
    lookups: 'fresh',
    label: 'Block 3512, Lot 004',
    storiesTier: null,
    stages: [
      { stage: 'filed', day: at(100), actual: false },
      { stage: 'entitled', day: at(400), actual: false },
      { stage: 'permitFiled', day: at(700), actual: false },
      { stage: 'permitIssued', day: at(900), actual: false },
      { stage: 'construction', day: at(1000), actual: false }
    ],
    revisions: [{ day: at(100), units: 24, stories: 6 }],
    end: { kind: 'complete', day: at(1500) },
    ...over
  });
}

/** Real project, every stage recorded up to construction, finishing after `asOf`. */
export const REAL_ACTUAL = pipeline({
  stages: [
    { stage: 'filed', day: at(-1200), actual: true },
    { stage: 'entitled', day: at(-900), actual: true },
    { stage: 'permitFiled', day: at(-600), actual: true },
    { stage: 'permitIssued', day: at(-300), actual: true },
    { stage: 'construction', day: at(-120), actual: true }
  ],
  revisions: [{ day: at(-1200), units: 24, stories: 6 }],
  end: { kind: 'complete', day: at(400) },
  sources: [
    { dataset: '6jgi-cpb4', id: '2007.0001PRX', key: 'case_no' },
    { dataset: 'i98e-djp9', id: '201801010001' }
  ]
});

/** Simulated project on the discretionary pathway, complete in the simulated future. */
export const SIMULATED = simulated({});

/** Simulated Local Program project (streamlined tables are its proxy). */
export const SIMULATED_LOCAL = simulated({
  projectId: 'sim-2',
  pathway: 'streamlined',
  localProgram: true,
  stages: [
    { stage: 'filed', day: at(50), actual: false },
    { stage: 'entitled', day: at(200), actual: false },
    { stage: 'permitFiled', day: at(300), actual: false }
  ],
  revisions: [{ day: at(50), units: 24, stories: 6 }],
  end: null
});

/** Simulated project that stops in Planning review in March 2031 (withdrawn). */
export const EXITED = simulated({
  projectId: 'sim-3',
  stages: [{ stage: 'filed', day: dayFromUtc(2029, 6, 1), actual: false }],
  revisions: [{ day: dayFromUtc(2029, 6, 1), units: 24, stories: 6 }],
  end: { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: dayFromUtc(2031, 3, 12) }
});

/** Simulated project resized from 24 to 30 homes on entering `entitled` (March 2028). */
export const REVISED = simulated({
  projectId: 'sim-4',
  stages: [
    { stage: 'filed', day: at(50), actual: false },
    { stage: 'entitled', day: dayFromUtc(2028, 3, 10), actual: false },
    { stage: 'permitFiled', day: dayFromUtc(2028, 9, 1), actual: false }
  ],
  units: 30,
  stories: 8,
  revisions: [
    { day: at(50), units: 24, stories: 6 },
    { day: dayFromUtc(2028, 3, 10), units: 30, stories: 8 }
  ],
  end: null
});

export const APPROXIMATE = pipeline({ projectId: 'pr-2', massing: 'approximate' });

/** Phase 3 of 12 of Candlestick Point; the permit filing is the stagger's estimate. */
export const PHASE_ESTIMATED = pipeline({
  projectId: 'pr-3#3',
  label: 'Candlestick Point',
  multiPhase: true,
  phase: { masterId: 'pr-3', index: 3, of: 12, start: 'estimated' },
  stages: [
    { stage: 'filed', day: at(-5000), actual: true },
    { stage: 'entitled', day: at(-4000), actual: true },
    { stage: 'permitFiled', day: at(400), actual: false }
  ],
  revisions: [{ day: at(-5000), units: 300, stories: null }],
  units: 300,
  stories: null,
  storiesTier: null
});

/** As above, but the permit filing is the published plan date. */
export const PHASE_SCHEDULED = pipeline({
  ...PHASE_ESTIMATED,
  projectId: 'pr-3#4',
  phase: { masterId: 'pr-3', index: 4, of: 12, start: 'scheduled' }
});

/** A multi-phase master row with no phases: one footprint on free lots. */
export const UNENRICHED = pipeline({
  projectId: 'pr-4',
  label: 'Treasure Island',
  multiPhase: true,
  phase: null,
  massing: 'none',
  stages: [
    { stage: 'filed', day: at(-5000), actual: true },
    { stage: 'entitled', day: at(-4000), actual: true }
  ],
  revisions: [{ day: at(-5000), units: 8000, stories: null }],
  units: 8000,
  stories: null,
  storiesTier: null
});

/** A pipeline card whose stories are unknown. */
export const NULL_STORIES = pipeline({
  projectId: 'pr-5',
  stories: null,
  storiesTier: null,
  revisions: [{ day: at(-900), units: 24, stories: null }]
});

/** Stories recorded on the record (tier 0). */
export const TIER0 = pipeline({ projectId: 'pr-6' });

/** Stories parsed from the project description (tier 3). */
export const TIER3 = pipeline({ projectId: 'pr-7', storiesTier: 3 });

/** Stories from the simulator's massing (tier 4). */
export const TIER4_MASSING = pipeline({ projectId: 'pr-8', storiesTier: 4 });

/** Stories from a later revision's proportional scaling (tier 4). */
export const TIER4_SCALED = pipeline({
  projectId: 'pr-9',
  units: 30,
  stories: 6,
  storiesTier: 4,
  revisions: [
    { day: at(-900), units: 24, stories: 5 },
    { day: at(-600), units: 30, stories: 6 }
  ]
});

/** Stories present but no tier: T6 says it cannot happen, the card treats it as tier 4. */
export const TIER_NULL = pipeline({
  projectId: 'pr-10',
  stories: 5,
  storiesTier: null,
  revisions: [{ day: at(-900), units: 24, stories: 5 }]
});

/** A record some data checks touched: tier 2 over tier-0 values, tier 2, and tier 4. */
export const WITH_QUALITY = pipeline({
  projectId: 'pr-11',
  label: 'Freedom West',
  existingUnits: 0,
  quality: [
    { label: 'Dates taken from the Planning record on this lot', tier: 2, valueTier: 0 },
    {
      label: 'Counted in the score but not drawn: no free lot in the plan area',
      tier: 2,
      valueTier: null
    },
    {
      label: 'A date outside 1970 to the snapshot day was treated as missing',
      tier: 4,
      valueTier: null
    }
  ]
});

export const NO_QUALITY = pipeline({ projectId: 'pr-12', quality: [] });
