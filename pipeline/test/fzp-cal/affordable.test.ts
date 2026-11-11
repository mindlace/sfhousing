// The 100% affordable cohort: routes, stage table, site choice (finance-data spec §4.4, §4.7, §4.8).
import { describe, expect, it } from 'vitest';
import { startCohort } from '../../lib/affordable-cohort';
import {
  COHORT_MIN_HOMES,
  SITE_MONTHS,
  affordableRoutes,
  fundedGroup,
  fundedStages,
  inCohort,
  routesWarning,
  siteChoice
} from '../../lib/fzp-cal/affordable';
import type { PanelSource, PanelYearRow } from '../../lib/fzp-cal/panel';
import type { NormHistory, Spell } from '../../lib/fzp-cal/types';
import { PANEL_LAST_MONTH, PLANNING_START } from '../../lib/fzp-cal/window';
import { isoToDay } from '../../project-records/multiphase';
import { initiationHazard } from '../../../src/lib/timelapse/model';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import type {
  Calibration,
  Day,
  FeatureId,
  InitiationModel,
  Pathway,
  ProjectHistory,
  Stage
} from '../../../src/lib/timelapse/types';

const d = isoToDay;
const ASOF = d('2026-09-30');

type Pair = ProjectHistory['planningProposed'];

function hist(
  id: string,
  pair: Pair,
  opts: {
    pathway?: Pathway | null;
    parcelIds?: string[];
    entered?: Partial<Record<Stage, Day>>;
  } = {}
): NormHistory {
  const pathway = opts.pathway === undefined ? 'discretionary' : opts.pathway;
  const parcelIds = opts.parcelIds ?? ['A'];
  const entered = opts.entered ?? { filed: d('2016-03-10') };
  const end: ProjectHistory['end'] = { kind: 'open', lastObserved: d('2026-09-30') };
  const src: ProjectHistory = {
    id,
    pathway,
    parcelIds,
    entered,
    end,
    unitsAt: { filed: 10 },
    existingUnits: 0,
    storiesProposed: null,
    baseStoriesAtFiling: null,
    sources: [],
    quality: []
  };
  if (pair !== undefined) src.planningProposed = pair;
  return { id, pathway, parcelIds, eff: { ...entered }, end, purgeCensored: false, src };
}

const FOR_NEW: Calibration['pathwayForNew'] = {
  discretionary: 0.2,
  streamlined: 0.3,
  permitOnly: 0.5,
  provenance: { tier: 0, label: 'for new', sources: [], method: 'm' }
};

describe('the cohort', () => {
  it('reuses the 95% flag and adds the 10-home floor', () => {
    expect(COHORT_MIN_HOMES).toBe(10);
    expect(inCohort(hist('a', { units: 100, affordable: 95 }))).toBe(true);
    expect(inCohort(hist('b', { units: 100, affordable: 94 }))).toBe(false);
    expect(startCohort({ units: 9, affordable: 9 })).toBe('affordable');
    expect(inCohort(hist('c', { units: 9, affordable: 9 }))).toBe(false);
    expect(inCohort(hist('d', null))).toBe(false);
    expect(inCohort(hist('e', undefined))).toBe(false);
  });

  it('groups by the pair; no pair, blank or small units and blank affordable are left out', () => {
    expect(fundedGroup(hist('a', { units: 100, affordable: 95 }))).toBe('affordable');
    expect(fundedGroup(hist('b', { units: 100, affordable: 94 }))).toBe('some');
    expect(fundedGroup(hist('c', { units: 10, affordable: 0 }))).toBe('none');
    expect(fundedGroup(hist('d', { units: 9, affordable: 9 }))).toBeNull();
    expect(fundedGroup(hist('e', { units: 0, affordable: 0 }))).toBeNull();
    expect(fundedGroup(hist('f', { units: null, affordable: 5 }))).toBeNull();
    expect(fundedGroup(hist('g', { units: 50, affordable: null }))).toBeNull();
    expect(fundedGroup(hist('h', null))).toBeNull();
    expect(fundedGroup(hist('i', undefined))).toBeNull();
  });
});

describe('affordableRoutes', () => {
  const flagged = { units: 100, affordable: 100 };
  const cohort = (disc: number, stream: number): NormHistory[] => [
    ...Array.from({ length: disc }, (_, i) => hist(`D${i}`, flagged)),
    ...Array.from({ length: stream }, (_, i) => hist(`S${i}`, flagged, { pathway: 'streamlined' }))
  ];
  const noise = [
    hist('X1', { units: 100, affordable: 94 }),
    hist('X2', { units: 9, affordable: 9 }),
    hist('X3', flagged, { pathway: null }),
    hist('X4', flagged, { entered: { filed: d('2014-12-31') } }),
    hist('X5', flagged, { entered: { filed: d('2026-10-01') } }),
    hist('X6', null)
  ];

  it('counts each split part whose PRJ pair is flagged once', () => {
    const parts = [hist('PRJ:1:BP:A', flagged), hist('PRJ:1:BP:B', flagged)];
    expect(affordableRoutes([...cohort(10, 19), ...noise], FOR_NEW, ASOF).n).toBe(29);
    const r = affordableRoutes([...cohort(10, 19), ...noise, ...parts], FOR_NEW, ASOF);
    expect(r.n).toBe(31);
    expect(r.fallback).toBe(false);
  });

  it('measures the shares at 30 histories (tier 0)', () => {
    const r = affordableRoutes([...cohort(10, 20), ...noise], FOR_NEW, ASOF);
    expect(r.n).toBe(30);
    expect(r.fallback).toBe(false);
    expect(Object.keys(r.routes)).toEqual([
      'discretionary',
      'streamlined',
      'permitOnly',
      'provenance'
    ]);
    const { provenance, ...shares } = r.routes;
    expect(shares).toEqual({ discretionary: 0.333333, streamlined: 0.666667, permitOnly: 0 });
    expect(provenance).toEqual({
      tier: 0,
      label: 'SF Planning & permit records 2015–2026: pathway of 100% affordable projects (tier 0)',
      sources: [
        { label: expect.any(String), url: 'https://data.sf.gov/d/qvu5-m3a2' },
        { label: expect.any(String), url: expect.stringContaining('https://data.sf.gov/d/') }
      ],
      method:
        'Pathway shares among 30 qualifying histories with a known pathway, first recorded 2015-01-01 to 2026-09-30, whose primary Planning record proposes 10 homes or more and at least 95% of them affordable (a proxy for publicly funded: no record carries a funding field); discretionary 10, streamlined 20, permitOnly 0; shares rounded to 6 decimals, the residual to the largest',
      n: 30,
      window: ['2015-01-01', '2026-09-30']
    });
  });

  it("falls back to pathwayForNew's shares below 30 (tier 4)", () => {
    const r = affordableRoutes([...cohort(10, 19), ...noise], FOR_NEW, ASOF);
    expect(r.fallback).toBe(true);
    expect(r.n).toBe(29);
    const { provenance, ...shares } = r.routes;
    expect(shares).toEqual({ discretionary: 0.2, streamlined: 0.3, permitOnly: 0.5 });
    expect(Object.keys(r.routes)).toEqual([
      'discretionary',
      'streamlined',
      'permitOnly',
      'provenance'
    ]);
    expect(provenance.tier).toBe(4);
    expect(provenance.label).toBe(
      'Pathway mix of 100% affordable projects (tier 4: the mix of all new projects)'
    );
    expect(provenance.method).toBe(
      'Only 29 100% affordable histories (fewer than 30); the pathway mix of all new projects is used in their place'
    );
    expect(provenance.n).toBe(29);
    expect(provenance.window).toEqual(['2015-01-01', '2026-09-30']);
  });

  it('takes minProjects as an argument', () => {
    expect(affordableRoutes(cohort(1, 1), FOR_NEW, ASOF, 2).fallback).toBe(false);
    expect(affordableRoutes(cohort(1, 0), FOR_NEW, ASOF, 2).fallback).toBe(true);
  });

  it('words the warning', () => {
    expect(routesWarning(29)).toBe(
      'affordableRoutes: only 29 100% affordable histories (fewer than 30); the pathway mix of all new projects is used, labelled tier 4'
    );
  });
});

describe('fundedStages', () => {
  const flagged = { units: 50, affordable: 50 };
  const spell = (projectId: string, x: number, outcome: Spell['outcome']): Spell => ({
    pathway: 'discretionary',
    stage: 'filed',
    a: 0,
    e: d('2016-03-10'),
    x,
    outcome,
    projectId
  });
  const base = [
    hist('c1', flagged),
    hist('c2', flagged, { pathway: 'streamlined' }),
    hist('c3', flagged, { pathway: null }),
    hist('s1', { units: 50, affordable: 10 }),
    hist('n1', { units: 50, affordable: 0 }, { pathway: 'permitOnly' }),
    hist('np', null)
  ];
  const spells = [
    spell('c1', 60, 'advance'),
    spell('c2', 120, 'advance'),
    spell('c3', 200, 'censored'),
    spell('np', 30, 'withdrawn')
  ];
  const row = (r: ReturnType<typeof fundedStages>['rows'], stage: string, group: string) =>
    r.find((x) => x.stage === stage && x.group === group)!;

  it('fits the cohort on hand spells against hand-computed Aalen–Johansen values', () => {
    const t = fundedStages(base, spells, ASOF);
    expect(t.leftOut).toBe(1);
    expect(t.rows.map((r) => `${r.stage}/${r.group}`).slice(0, 6)).toEqual([
      'filed/affordable',
      'filed/some',
      'filed/none',
      'entitled/affordable',
      'entitled/some',
      'entitled/none'
    ]);
    expect(t.rows).toHaveLength(15);
    const c = row(t.rows, 'filed', 'affordable');
    expect(c.spells).toBe(3);
    expect(c.advances).toBe(2);
    expect(c.exits).toBe(0);
    expect(c.eventualAdvance).toBeCloseTo(2 / 3, 12);
    expect(c.eventualExit).toBe(0);
    expect(c.medianMonths).toBe(60 / MONTH_DAYS);
    for (const g of ['some', 'none']) {
      expect(row(t.rows, 'filed', g)).toEqual({
        stage: 'filed',
        group: g,
        spells: 0,
        advances: 0,
        exits: 0,
        eventualAdvance: null,
        eventualExit: null,
        medianMonths: null
      });
    }
    expect(t.pathways).toEqual({
      affordable: { discretionary: 1, streamlined: 1, permitOnly: 0, null: 1 },
      some: { discretionary: 1, streamlined: 0, permitOnly: 0, null: 0 },
      none: { discretionary: 0, streamlined: 0, permitOnly: 1, null: 0 }
    });
  });

  it('counts a competing exit', () => {
    const t = fundedStages(
      [...base, hist('c4', flagged)],
      [...spells, spell('c4', 90, 'withdrawn')],
      ASOF
    );
    const c = row(t.rows, 'filed', 'affordable');
    expect(c.spells).toBe(4);
    expect(c.advances).toBe(2);
    expect(c.exits).toBe(1);
    expect(c.eventualAdvance).toBeCloseTo(0.5, 12);
    expect(c.eventualExit).toBeCloseTo(0.25, 12);
    expect(c.medianMonths).toBe(60 / MONTH_DAYS);
  });

  it('keeps to the first-record window', () => {
    const t = fundedStages(
      [
        ...base,
        hist('late', flagged, { entered: { filed: d('2026-10-01') } }),
        hist('old', null, { entered: { filed: d('2014-01-01') } })
      ],
      [...spells, spell('late', 10, 'advance')],
      ASOF
    );
    expect(row(t.rows, 'filed', 'affordable').spells).toBe(3);
    expect(t.leftOut).toBe(1);
  });
});

describe('siteChoice', () => {
  const MODEL: InitiationModel = {
    kind: 'logit-monthly',
    intercept: -6,
    terms: [{ feature: 'potentialRatio', bins: [0, 1, 2], coef: [0, 0.5, 1.5] }],
    provenance: { tier: 4, label: 'test', sources: [], method: 'm' }
  };
  const feats = (potentialRatio: number): Record<FeatureId, number> => ({
    potentialRatio,
    existingUnits: 0,
    lotAreaM2: 300,
    yearBuilt: 1925,
    storiesGap: 0,
    improvementShare: 0.3,
    rentControlLikely: 0,
    landUseClass: 0
  });
  const r = (mapblklot: string, pr: number, hostableBase = true): PanelYearRow => ({
    mapblklot,
    hostableBase,
    imputed: 0,
    features: feats(pr)
  });
  const ROWS: Record<number, PanelYearRow[]> = {
    2016: [r('A', 2.5), r('C', 2.5, false)],
    2017: [r('B', 1.2)]
  };
  const source = (reads: number[]): PanelSource => ({
    years: [2016, 2017],
    read: async (y) => {
      reads.push(y);
      return ROWS[y] ?? [];
    }
  });
  const area = () => 100;
  const h1 = initiationHazard(MODEL, feats(2.5));
  const h2 = initiationHazard(MODEL, feats(1.2));
  const flagged = { units: 40, affordable: 40 };

  it('compares the hazard where funded and private projects start', async () => {
    const reads: number[] = [];
    const norm = [
      hist('c16', flagged, { parcelIds: ['A'], entered: { filed: d('2016-05-01') } }),
      hist(
        'p17',
        { units: 100, affordable: 10 },
        {
          parcelIds: ['B'],
          entered: { permitFiled: d('2017-02-01') }
        }
      ),
      hist('cOff', flagged, { parcelIds: ['C'], entered: { filed: d('2016-07-01') } }),
      hist('pNoPair', undefined, { parcelIds: [], entered: { filed: d('2017-04-01') } }),
      hist('small', { units: 8, affordable: 8 }, { parcelIds: ['A'] })
    ];
    const s = await siteChoice(source(reads), MODEL, norm, area);
    expect(reads).toEqual([2016, 2017]);
    expect(s.neither).toBe(1);
    expect(s.affordable).toEqual({
      histories: 2,
      onPanel: 1,
      offPanel: 1,
      meanPerMille: h1 * 1000,
      medianPerMille: h1 * 1000
    });
    expect(s.private).toEqual({
      histories: 2,
      onPanel: 1,
      offPanel: 1,
      meanPerMille: h2 * 1000,
      medianPerMille: h2 * 1000
    });
    expect(s.ratio).toBeCloseTo(h1 / h2, 12);
  });

  it('puts a start with no roll year off panel; no private start on the panel gives no ratio', async () => {
    const reads: number[] = [];
    const norm = [
      hist('c16', flagged, { parcelIds: ['A'], entered: { filed: d('2016-05-01') } }),
      hist(
        'p18',
        { units: 100, affordable: 0 },
        {
          parcelIds: ['B'],
          entered: { filed: d('2018-03-01') }
        }
      ),
      hist('p14', null, { parcelIds: ['B'], entered: { filed: d('2014-12-31') } })
    ];
    const s = await siteChoice(source(reads), MODEL, norm, area);
    expect(reads).toEqual([2016]);
    expect(s.private).toEqual({
      histories: 2,
      onPanel: 0,
      offPanel: 1,
      meanPerMille: null,
      medianPerMille: null
    });
    expect(s.affordable.onPanel).toBe(1);
    expect(s.ratio).toBeNull();
  });

  it('counts starts from PLANNING_START to the end of PANEL_LAST_MONTH only', async () => {
    expect(SITE_MONTHS).toEqual([PLANNING_START.slice(0, 7), PANEL_LAST_MONTH]);
    const years = [2014, 2015, 2025, 2026];
    const edge: PanelSource = { years, read: async () => [r('A', 2.5)] };
    const at = (id: string, iso: string) =>
      hist(id, flagged, { parcelIds: ['A'], entered: { filed: d(iso) } });
    const norm = [
      at('before', '2014-12-31'),
      at('first', '2015-01-01'),
      at('last', '2025-12-31'),
      at('after', '2026-01-01')
    ];
    const s = await siteChoice(edge, MODEL, norm, area);
    expect(s.affordable.histories).toBe(4);
    expect(s.affordable.onPanel + s.affordable.offPanel).toBe(2);
    expect(s.affordable.onPanel).toBe(2);
  });

  it('takes the median of several hazards and the primary parcel', async () => {
    const norm = [
      hist('a', flagged, { parcelIds: ['C', 'A'], entered: { filed: d('2016-05-01') } }),
      hist('b', flagged, { parcelIds: ['A'], entered: { filed: d('2016-06-01') } }),
      hist('c', flagged, { parcelIds: ['B'], entered: { filed: d('2017-06-01') } }),
      hist(
        'p',
        { units: 20, affordable: 1 },
        { parcelIds: ['B'], entered: { filed: d('2017-06-01') } }
      )
    ];
    const areas: Record<string, number> = { A: 500, C: 100 };
    const s = await siteChoice(source([]), MODEL, norm, (id) => areas[id] ?? 0);
    expect(s.affordable.onPanel).toBe(3);
    expect(s.affordable.meanPerMille).toBeCloseTo(((2 * h1 + h2) / 3) * 1000, 12);
    expect(s.affordable.medianPerMille).toBe(h1 * 1000);
    expect(s.ratio).toBeCloseTo((2 * h1 + h2) / 3 / h2, 12);
  });
});
