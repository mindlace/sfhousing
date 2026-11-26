import { describe, expect, it } from 'vitest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { ParcelId } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import type { Target } from '$lib/scoreboard';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type {
  Calibration,
  Dollars,
  ExitReason,
  LimitStatement,
  MarketStep,
  Pathway,
  Pool,
  PoolKind,
  Programme,
  Provenance,
  ResolvedTerms,
  Stage,
  TierUnits
} from '$lib/timelapse/types';
import type { StageScale } from '../../levers/timers';
import type * as Protocol from '../../protocol';
import type { ParcelSummary, SimRequest } from '../../protocol';
import type * as Scenario from './types';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// The real assertion in this file is the type-level `Assert` below, which `npm run check`
// enforces. The runtime `expect` only closes the chain so vitest has an assertion to count.
// Each row is restated literally from the design doc interface table (T5, T6, T8) and the
// timelapse-sim spec section 2 block, then compared with the export.

// T5
interface RowSchedule {
  projectId: string;
  origin: 'pipeline' | 'simulated';
  parcelIds: ParcelId[];
  pathway: Pathway;
  entered: Partial<Record<Stage, Day>>;
  end:
    | { kind: 'complete'; day: Day }
    | { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day }
    | { kind: 'open' }; // still in progress at horizon
  revisions: { day: Day; units: number; stories: number | null }[];
  existingUnits: number;
  multiPhase: boolean;
  phase: {
    masterId: string;
    index: number;
    of: number;
    start: 'scheduled' | 'estimated';
  } | null;
  regime?: number; // the dated regime the project started in
  inFlight?: true; // plan 4 Task 6 (Call 15)
  kind?: 'affordable';
  funding?: {
    programmes: string[];
    applied: Day;
    granted: Dollars;
    lent: Dollars;
    guaranteed: Dollars;
    displaced: number;
    certain: boolean;
  };
}
type RowSimInput = {
  parcels: ScenarioParcels;
  projects: InFlightProject[];
  calibration: Calibration;
  asOf: Day;
  districtMaxStories: number | null;
  newProjects?: { calibration: Calibration; scale: StageScale }; // plan 2 Task 8
  inFlightScale?: StageScale;
  regimes?: { day: Day; parcels: ScenarioParcels }[]; // dated parcel views
  reservedFrom?: Int32Array;
  market?: MarketStep[];
  finance?: {
    pools: Pool[];
    programmes: Programme[];
    off: { pool: string; from: Day; to: Day | null }[];
    slope: number;
    terms: ResolvedTerms;
  };
};

// T6
type RowProjectCard = {
  projectId: string;
  origin: 'pipeline' | 'simulated';
  label: string;
  pathway: Pathway;
  units: number;
  existingUnits: number;
  stories: number | null;
  storiesTier: 0 | 1 | 3 | 4 | null;
  massing: 'matched' | 'approximate' | 'none';
  multiPhase: boolean;
  phase: RowSchedule['phase'];
  kind?: 'affordable';
  funding?: { programmes: string[]; certain: boolean };
  localProgram: boolean;
  lookups: 'inFlight' | 'fresh';
  chanceShift: { stage: Stage; months: number } | null;
  stages: { stage: Stage; day: Day; actual: boolean }[];
  revisions: RowSchedule['revisions'];
  end: RowSchedule['end'] | null;
  sources: { dataset: string; id: string; key?: string }[];
  quality: { label: string; tier: 2 | 3 | 4; valueTier: 0 | 1 | 2 | 3 | 4 | null }[];
};
type RowMassing = GeneratedBuilding | { footprint: [lng: number, lat: number][] };

// T8
interface RowTimelineScore {
  months: Day[];
  shown: {
    completedNet: number;
    completedNetPipeline: number;
    completedNetNew: number;
    entitledNew: number;
    inProgress: Record<Exclude<Stage, 'complete'>, number>;
    exitedUnits: number;
  }[];
  planEffect: { entitledNew: number; completedNetNew: number }[];
  planEffectBand: { p10: number; p50: number; p90: number }[];
  band: { p10: number; p50: number; p90: number }[];
  baseline: { completedNet: number; since: Day; provenance: Provenance };
  phasing: {
    masters: number;
    enrichedMasters: number;
    phasesScheduled: number;
    phasesEstimated: number;
    unenriched: { projectId: string; label: string | null; units: number; drawn: boolean }[];
  };
  targets: RowTargetProgressAt[];
  references: {
    id: string;
    label: string;
    units: number;
    from: Day;
    by: Day;
    measure: 'planEffect.entitledNew' | 'planEffect.completedNetNew' | 'completedNet';
    provenance: Provenance;
  }[];
  tiers?: {
    completed: TierUnits[];
    baseline: TierUnits;
    targets: RowTargetProgressAt[];
  };
  money?: {
    pools: {
      id: string;
      label: string;
      kind: PoolKind;
      received: number[];
      committed: number[];
      out: number[];
      spent: number[];
      repaid: number[];
      lost: number[];
      lostCredit: number[];
    }[];
    fundedHomes: number[];
    displacedHomes: number[];
    publicSpent: number[];
    owed: { pool: string; principal: Dollars; repayment: number; nominal: true }[];
    limits: LimitStatement[];
  };
}
type RowTargetProgressAt = { target: Target; deadline: Day; fraction: number[] };

const rowsMatch: Assert<
  Equals<Scenario.Schedule, RowSchedule> extends true
    ? Equals<Scenario.SimInput, RowSimInput> extends true
      ? Equals<Scenario.ProjectCard, RowProjectCard> extends true
        ? Equals<Scenario.Massing, RowMassing> extends true
          ? Equals<Scenario.TimelineScore, RowTimelineScore> extends true
            ? Equals<Scenario.TargetProgressAt, RowTargetProgressAt>
            : false
          : false
        : false
      : false
    : false
> = true;

// The names the protocol re-exports are the same types as the ones in ./types.
const reExported: Assert<
  Equals<Protocol.ProjectCard, Scenario.ProjectCard> extends true
    ? Equals<Protocol.TimelineScore, Scenario.TimelineScore>
    : false
> = true;

// The editor's request and its parcelSummary member are unchanged.
const editorUnchanged: Assert<
  Equals<
    Extract<SimRequest, { type: 'parcelSummary' }>,
    { type: 'parcelSummary'; reqId: number; parcelId: ParcelId }
  >
> = true;

// ParcelSummary gains an optional project card the editor never sets.
const cardOptional: Assert<Equals<ParcelSummary['project'], Scenario.ProjectCard | undefined>> =
  true;

// Reappraisal 1 members, asserted on their own so a failure names the member.
const phaseShape: Assert<
  Equals<
    Scenario.Schedule['phase'],
    {
      masterId: string;
      index: number;
      of: number;
      start: 'scheduled' | 'estimated';
    } | null
  >
> = true;
const startShape: Assert<
  Equals<NonNullable<Scenario.Schedule['phase']>['start'], 'scheduled' | 'estimated'>
> = true;
const storiesTierShape: Assert<Equals<Scenario.ProjectCard['storiesTier'], 0 | 1 | 3 | 4 | null>> =
  true;
const qualityShape: Assert<
  Equals<
    Scenario.ProjectCard['quality'][number],
    { label: string; tier: 2 | 3 | 4; valueTier: 0 | 1 | 2 | 3 | 4 | null }
  >
> = true;
const drawnShape: Assert<
  Equals<Scenario.TimelineScore['phasing']['unenriched'][number]['drawn'], boolean>
> = true;

describe('compile-time row checks', () => {
  it('scenario types equal the T5 and T8 rows and protocol re-exports them', () => {
    expect([rowsMatch, reExported, editorUnchanged, cardOptional]).toEqual([
      true,
      true,
      true,
      true
    ]);
  });
});

describe('reappraisal 1 members', () => {
  it('Schedule.phase carries start', () => {
    expect([phaseShape, startShape]).toEqual([true, true]);
  });
  it('ProjectCard carries storiesTier 1 and 4, and quality', () => {
    expect([storiesTierShape, qualityShape]).toEqual([true, true]);
  });
  it('unenriched entries carry drawn', () => {
    expect(drawnShape).toBe(true);
  });
});
