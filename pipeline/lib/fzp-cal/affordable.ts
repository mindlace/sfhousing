/**
 * The 100% affordable cohort (finance-data spec, "The cohort"): `calibration.affordableRoutes`
 * (§4.4), and the report-only stage table (§4.7) and site choice (§4.8). The 95% test is
 * `market-baseline`'s affordable-cohort flag, reused; the 10-home floor is this subsystem's.
 */
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import type { ParcelId } from '../../../src/lib/data/parcel';
import { initiationHazard } from '../../../src/lib/timelapse/model';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import {
  PATHWAYS,
  type Calibration,
  type Day,
  type InitiationModel,
  type Pathway
} from '../../../src/lib/timelapse/types';
import { isAffordableCohort, startCohort } from '../affordable-cohort';
import { ajCurve } from './aalen-johansen';
import type { FundingReport } from './funding';
import { firstEntered, primaryParcel, type PanelSource, type PanelYearRow } from './panel';
import { firstRecord } from './pathway-mix';
import { datasf } from './provenance';
import { roundShares } from './round';
import type { CalStage, NormHistory, Spell } from './types';
import { PLANNING_START } from './window';

/** The cohort's floor on the pair's proposed homes (F12). */
export const COHORT_MIN_HOMES = 10;

/** flagged by market-baseline's predicate and pair.units ≥ 10; the only cohort test */
export function inCohort(h: NormHistory): boolean {
  const pair = h.src.planningProposed;
  return isAffordableCohort(pair) && pair != null && (pair.units ?? 0) >= COHORT_MIN_HOMES;
}

export type FundedGroup = 'affordable' | 'some' | 'none';
const FUNDED_GROUPS: readonly FundedGroup[] = ['affordable', 'some', 'none'];

/** spec 4.7 groups; null = left out (no pair, units blank/0/under 10, affordable blank) */
export function fundedGroup(h: NormHistory): FundedGroup | null {
  const pair = h.src.planningProposed;
  if (pair == null || pair.units === null || pair.units < COHORT_MIN_HOMES) return null;
  if (pair.affordable === null) return null;
  if (inCohort(h)) return 'affordable';
  return pair.affordable > 0 ? 'some' : 'none';
}

/** First record (any stage) in `[PLANNING_START, asOf]`: the window of §4.4 and §4.7. */
function inWindow(h: NormHistory, asOf: Day): boolean {
  const first = firstRecord(h);
  return first !== null && first >= isoToDay(PLANNING_START) && first <= asOf;
}

function countsText(c: Record<Pathway, number>): string {
  return PATHWAYS.map((p) => `${p} ${c[p]}`).join(', ');
}

/**
 * `calibration.affordableRoutes` (spec §4.4): the pathway shares of the cohort's windowed
 * histories with a known pathway; fewer than `minProjects`, `forNew`'s shares labelled tier 4.
 */
export function affordableRoutes(
  norm: NormHistory[],
  forNew: Calibration['pathwayForNew'],
  asOf: Day,
  minProjects = 30
): { routes: NonNullable<Calibration['affordableRoutes']>; n: number; fallback: boolean } {
  const counts: Record<Pathway, number> = { discretionary: 0, streamlined: 0, permitOnly: 0 };
  let n = 0;
  for (const h of norm) {
    if (h.pathway === null || !inWindow(h, asOf) || !inCohort(h)) continue;
    counts[h.pathway]++;
    n++;
  }
  const sources = [datasf('planningProjects'), datasf('permits')];
  const window: [string, string] = [PLANNING_START, isoOf(asOf)];

  if (n >= minProjects) {
    const [discretionary, streamlined, permitOnly] = roundShares(PATHWAYS.map((p) => counts[p]));
    return {
      routes: {
        discretionary,
        streamlined,
        permitOnly,
        provenance: {
          tier: 0,
          label: `SF Planning & permit records ${window[0].slice(0, 4)}–${window[1].slice(0, 4)}: pathway of 100% affordable projects (tier 0)`,
          sources,
          method: `Pathway shares among ${n} qualifying histories with a known pathway, first recorded ${window[0]} to ${window[1]}, whose primary Planning record proposes 10 homes or more and at least 95% of them affordable (a proxy for publicly funded: no record carries a funding field); ${countsText(counts)}; shares rounded to 6 decimals, the residual to the largest`,
          n,
          window
        }
      },
      n,
      fallback: false
    };
  }
  return {
    routes: {
      discretionary: forNew.discretionary,
      streamlined: forNew.streamlined,
      permitOnly: forNew.permitOnly,
      provenance: {
        tier: 4,
        label: 'Pathway mix of 100% affordable projects (tier 4: the mix of all new projects)',
        sources,
        // the spec's verbatim wording (§4.4), written for the default threshold of 30
        method: `Only ${n} 100% affordable histories (fewer than 30); the pathway mix of all new projects is used in their place`,
        n,
        window
      }
    },
    n,
    fallback: true
  };
}

/** The live-build warning of a fallback (spec §4.4). */
export function routesWarning(n: number): string {
  return `affordableRoutes: only ${n} 100% affordable histories (fewer than 30); the pathway mix of all new projects is used, labelled tier 4`;
}

export interface StageRow {
  stage: CalStage;
  group: FundedGroup;
  spells: number;
  advances: number;
  exits: number;
  eventualAdvance: number | null;
  eventualExit: number | null;
  medianMonths: number | null;
}

const FUNDED_STAGES: readonly CalStage[] = [
  'filed',
  'entitled',
  'permitFiled',
  'permitIssued',
  'construction'
];

/**
 * The smallest event duration at which the advance cumulative incidence reaches half its end
 * value, in months, read off the one curve; null with no advance. The comparison allows a
 * relative 1e-12, a floating-point tolerance and not a model number: a half reached in exact
 * arithmetic can miss by an ulp (1/3 + (1 − 1/3) × 1/2 is one ulp above 2 × 1/3). The last
 * value is the end value, so the search always finds an index.
 */
function medianMonths(c: { d: number[]; advance: number[] }): number | null {
  const end = c.advance[c.advance.length - 1];
  if (end <= 0) return null;
  const i = c.advance.findIndex((v) => v >= (end / 2) * (1 - 1e-12));
  return c.d[i] / MONTH_DAYS;
}

function stageRow(stage: CalStage, group: FundedGroup, spells: Spell[]): StageRow {
  let advances = 0;
  let exits = 0;
  for (const s of spells) {
    if (s.outcome === 'advance') advances++;
    else if (s.outcome !== 'censored') exits++;
  }
  const c = ajCurve(spells);
  const last = c === null ? -1 : c.d.length - 1;
  return {
    stage,
    group,
    spells: spells.length,
    advances,
    exits,
    eventualAdvance: c === null ? null : c.advance[last],
    eventualExit: c === null ? null : c.exit[last],
    medianMonths: c === null ? null : medianMonths(c)
  };
}

/**
 * The report's pathway and stage tables (spec §4.7, items 2 and 3): the calibration's own spells,
 * filtered by project id to each group and pooled over pathways. Descriptive: no ladder, no tail.
 */
export function fundedStages(
  norm: NormHistory[],
  spells: Spell[],
  asOf: Day
): {
  pathways: Record<FundedGroup, Record<Pathway | 'null', number>>;
  rows: StageRow[];
  leftOut: number;
} {
  const pathways = {} as Record<FundedGroup, Record<Pathway | 'null', number>>;
  for (const g of FUNDED_GROUPS) {
    pathways[g] = { discretionary: 0, streamlined: 0, permitOnly: 0, null: 0 };
  }
  const groupOf = new Map<string, FundedGroup>();
  let leftOut = 0;
  for (const h of norm) {
    if (!inWindow(h, asOf)) continue;
    const g = fundedGroup(h);
    if (g === null) {
      leftOut++;
      continue;
    }
    groupOf.set(h.id, g);
    pathways[g][h.pathway ?? 'null']++;
  }
  const rows: StageRow[] = [];
  for (const stage of FUNDED_STAGES) {
    for (const group of FUNDED_GROUPS) {
      const cell = spells.filter((s) => s.stage === stage && groupOf.get(s.projectId) === group);
      rows.push(stageRow(stage, group, cell));
    }
  }
  return { pathways, rows, leftOut };
}

export interface SiteGroup {
  histories: number;
  onPanel: number;
  offPanel: number;
  meanPerMille: number | null;
  medianPerMille: number | null;
}

export interface SiteChoiceReport {
  affordable: SiteGroup;
  private: SiteGroup;
  neither: number;
  ratio: number | null;
}

/** The record-basis months of the panel (spec §4.8). */
const SITE_FIRST = isoToDay('2015-01-01');
const SITE_LAST = isoToDay('2025-12-31');

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Where funded projects start (spec §4.8, OD-F9b): the published model's hazard on the lots
 * where the cohort's projects started, against the lots where private projects started.
 * Starts outside 2015-01..2025-12 are not events; a start with no parcel, no roll year, no
 * row or a non-hostable row is off panel.
 */
export async function siteChoice(
  panel: PanelSource,
  model: InitiationModel,
  norm: NormHistory[],
  lotArea: (id: ParcelId) => number
): Promise<SiteChoiceReport> {
  type Kind = 'affordable' | 'private';
  const histories: Record<Kind, number> = { affordable: 0, private: 0 };
  const off: Record<Kind, number> = { affordable: 0, private: 0 };
  const hazards: Record<Kind, number[]> = { affordable: [], private: [] };
  let neither = 0;
  const byYear = new Map<number, { kind: Kind; lot: ParcelId }[]>();
  const panelYears = new Set(panel.years);

  for (const h of norm) {
    let kind: Kind;
    if (inCohort(h)) kind = 'affordable';
    else if (startCohort(h.src.planningProposed) !== 'affordable') kind = 'private';
    else {
      neither++;
      continue;
    }
    histories[kind]++;
    const start = firstEntered(h);
    if (start === undefined || start < SITE_FIRST || start > SITE_LAST) continue;
    const year = new Date(start * 86_400_000).getUTCFullYear();
    if (h.parcelIds.length === 0 || !panelYears.has(year)) {
      off[kind]++;
      continue;
    }
    const lot = primaryParcel(h.parcelIds, lotArea);
    let list = byYear.get(year);
    if (!list) byYear.set(year, (list = []));
    list.push({ kind, lot });
  }

  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const rows = new Map<string, PanelYearRow>();
    for (const r of await panel.read(year)) rows.set(r.mapblklot, r);
    for (const { kind, lot } of byYear.get(year)!) {
      const row = rows.get(lot);
      if (row === undefined || !row.hostableBase) off[kind]++;
      else hazards[kind].push(initiationHazard(model, row.features));
    }
  }

  const group = (k: Kind): SiteGroup => {
    const hs = hazards[k];
    return {
      histories: histories[k],
      onPanel: hs.length,
      offPanel: off[k],
      meanPerMille: hs.length === 0 ? null : (hs.reduce((a, b) => a + b, 0) / hs.length) * 1000,
      medianPerMille: hs.length === 0 ? null : median(hs) * 1000
    };
  };
  const affordable = group('affordable');
  const priv = group('private');
  const ratio =
    affordable.meanPerMille === null || priv.meanPerMille === null || priv.meanPerMille === 0
      ? null
      : affordable.meanPerMille / priv.meanPerMille;
  return { affordable, private: priv, neither, ratio };
}

/** The report-only results of §4.7 and §4.8 (`ReportInput.affordable`). */
export interface AffordableReport {
  routes: { n: number; fallback: boolean };
  stages: ReturnType<typeof fundedStages>;
  funding: FundingReport;
  siteChoice: SiteChoiceReport;
}
