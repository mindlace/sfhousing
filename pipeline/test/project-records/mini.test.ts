/**
 * The mini fixture's project records (spec 4.9 Fixture table, M1-M14 and the xdht extras) through
 * deriveProjects with stub callbacks that mirror scenario-data's fixture. V21-V24 use literal
 * fixture thresholds: coverage min 1.0, RHNA tolerance year 0.1 and total 0.05.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectHistory } from '../../../src/lib/timelapse/types';
import { STAGE_ORDER } from '../../../src/lib/timelapse/types';
import {
  deriveProjects,
  serializeHistories,
  serializeProjects
} from '../../project-records/derive';
import { checkV20, checkV21, checkV22, checkV23, checkV24 } from '../../project-records/invariants';
import { PROJECT_SOURCE_IDS } from '../../project-records/types';
import {
  MINI_ASOF,
  MINI_PARCELS,
  PROJECT_RAW,
  miniProjectInput
} from '../fixtures/mini/projects-raw';

function day(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

const r = deriveProjects(miniProjectInput());

function project(id: string) {
  const p = r.file.projects.find((x) => x.id === id);
  if (!p) throw new Error(`no in-flight project ${id}`);
  return p;
}

function history(id: string): ProjectHistory {
  const h = r.histories.find((x) => x.id === id);
  if (!h) throw new Error(`no history ${id}`);
  return h;
}

const IN_FLIGHT = [
  'BP:202403150003',
  'CASE:2007.0001PRX',
  'CASE:2010.0002PRX',
  'PRJ:2019-000001PRJ',
  'PRJ:2020-000008PRJ',
  'PRJ:2020-000010PRJ',
  'PRJ:2026-000002PRJ',
  'PRJ:2026-000011PRJ',
  'PRJ:2026-000012PRJ'
];

const HISTORIES_ONLY = [
  'PPA:2021-000004PPA',
  'PRJ:2017-000005PRJ',
  'PRJ:2016-000006PRJ',
  'BP:201410070008',
  'PRJ:2015-000013PRJ',
  'PRJ:2010.0002'
];

describe('mini project records: raw shape', () => {
  it('has a SODA-shaped row array for every project source', () => {
    expect(Object.keys(PROJECT_RAW).sort()).toEqual([...PROJECT_SOURCE_IDS].sort());
    for (const id of PROJECT_SOURCE_IDS) {
      expect(PROJECT_RAW[id].length, id).toBeGreaterThan(0);
      for (const row of PROJECT_RAW[id]) {
        for (const [k, v] of Object.entries(row)) {
          expect(k, `${id} key`).toMatch(/^[a-z0-9_]+$/);
          expect(typeof v, `${id}.${k}`).toBe('string');
        }
      }
    }
  });
});

describe('mini project records: the stub roll mirrors the landed fixture roll', () => {
  it('sums number_of_units per current parcel and roll year, through lineage', () => {
    const input = miniProjectInput();
    const table = (year: number) =>
      Object.fromEntries([...MINI_PARCELS].map((id) => [id, input.assessorUnits(id, year)]));
    const common = {
      '3512001': 2,
      '3512002': 3,
      '8711023C': 0,
      '0026T001A': 3,
      '3512005': 1,
      '3512006': 2,
      '3512007': 0,
      '3512008': 12,
      '3512009': null,
      '3512010': 3,
      '3512011': 0,
      '3512014': 40
    };
    expect(table(2025)).toEqual({ ...common, '3512012': null, '3512013': null });
    expect(table(2024)).toEqual({ ...common, '3512012': 7, '3512013': 5 });
    expect(input.assessorUnits('3512001', 2023)).toBeNull();
  });
});

describe('mini project records: the in-flight set and histories', () => {
  it('ships exactly M1, M2, M3, M8, M9, M10, M11, M12 and M14', () => {
    expect(r.file.projects.map((p) => p.id)).toEqual(IN_FLIGHT);
    expect(r.file.asOf).toBe(MINI_ASOF);
  });

  it('keeps M4-M7, M13 and PRJ:2010.0002 as histories only', () => {
    const ids = r.histories.map((h) => h.id);
    for (const id of HISTORIES_ONLY) {
      expect(ids, id).toContain(id);
      expect(IN_FLIGHT, id).not.toContain(id);
    }
  });

  it('covers every non-complete stage with an in-flight project', () => {
    const stages = new Set(r.file.projects.map((p) => p.stage));
    for (const s of STAGE_ORDER) if (s !== 'complete') expect(stages.has(s), s).toBe(true);
  });

  it('no in-flight project has a history that ended', () => {
    for (const p of r.file.projects) {
      const h = r.histories.find((x) => x.id === p.id);
      if (h) expect(h.end.kind, p.id).toBe('open');
    }
  });
});

describe('mini project records: per-project values (spec 4.9 table)', () => {
  it('M1: discretionary at construction, permitFiled forced to the approval', () => {
    const p = project('PRJ:2019-000001PRJ');
    expect(p).toMatchObject({
      pathway: 'discretionary',
      stage: 'construction',
      parcelIds: ['3512010', '3512011'],
      units: 24,
      existingUnits: 3,
      stories: 6,
      storiesTier: 0,
      multiPhase: false,
      phases: null
    });
    expect(p.history.permitFiled).toBe(day('2020-03-02'));
  });

  it('M2: streamlined at filed, 8 stories parsed from the description (tier 3)', () => {
    expect(project('PRJ:2026-000002PRJ')).toMatchObject({
      pathway: 'streamlined',
      stage: 'filed',
      units: 40,
      stories: 8,
      storiesTier: 3
    });
  });

  it('M3: permitOnly with a permitFiled-only history', () => {
    const p = project('BP:202403150003');
    expect(p.pathway).toBe('permitOnly');
    expect(p.stage).toBe('permitFiled');
    expect(Object.keys(p.history)).toEqual(['permitFiled']);
    // Lot 005 holds 1 unit in the fixture roll: net 1 still clears the >= 1 rule.
    expect(p.units).toBe(2);
    expect(p.existingUnits).toBe(1);
  });

  it('M4: a PPA-only project withdrawn at preApplication', () => {
    expect(history('PPA:2021-000004PPA').end).toMatchObject({
      kind: 'exit',
      reason: 'withdrawn',
      stage: 'preApplication'
    });
  });

  it('M5: withdrawn at filed', () => {
    expect(history('PRJ:2017-000005PRJ').end).toMatchObject({
      kind: 'exit',
      reason: 'withdrawn',
      stage: 'filed'
    });
  });

  it('M6: complete at the first TCO with 12 units', () => {
    const h = history('PRJ:2016-000006PRJ');
    expect(h.end).toEqual({ kind: 'complete', day: day('2019-08-01') });
    expect(h.unitsAt.complete).toBe(12);
  });

  it('M7: open, last observed at its filing, and the only stale-open project', () => {
    expect(history('BP:201410070008').end).toEqual({
      kind: 'open',
      lastObserved: day('2014-10-07')
    });
    expect(r.counts['projects.staleOpen']).toBe(1);
  });

  it('M8: a referral PRJ is permitOnly, on the retired lot mapped to lot 12', () => {
    expect(project('PRJ:2020-000008PRJ')).toMatchObject({
      pathway: 'permitOnly',
      stage: 'permitIssued',
      parcelIds: ['3512012']
    });
  });

  it('M9: an enriched PRX master with phases A and B', () => {
    const p = project('CASE:2007.0001PRX');
    const source = {
      label: 'Fixture Shipyard DA phasing schedule',
      url: 'https://example.invalid/fixture-da.pdf',
      retrieved: '2026-10-01'
    };
    expect(p).toMatchObject({
      label: 'Fixture Shipyard',
      pathway: 'discretionary',
      stage: 'entitled',
      units: 300,
      multiPhase: true,
      // DA parcels left after excluding completed lot 007: lot 002 (3 units) and lot 014 (40).
      parcelIds: ['3512002', '3512014'],
      existingUnits: 43
    });
    expect(p.phases).toEqual([
      { units: 120, parcelIds: ['3512014'], plannedPermitFiled: null, source },
      { units: 180, parcelIds: ['3512002'], plannedPermitFiled: day('2027-03-01'), source }
    ]);
    expect(r.counts['multiphase.scale.2007.0001PRX']).toBe(1);
    expect(r.histories.map((h) => h.id)).not.toContain('CASE:2007.0001PRX');
  });

  it('M10: permitFiled forced up to the approval; 6 units on 2 existing', () => {
    const p = project('PRJ:2020-000010PRJ');
    expect(p.history.permitFiled).toBe(day('2021-11-01'));
    expect(p.units).toBe(6);
    expect(p.existingUnits).toBe(2);
  });

  it('M11: unclassifiable history, defaulted to discretionary in flight', () => {
    expect(history('PRJ:2026-000011PRJ').pathway).toBeNull();
    expect(project('PRJ:2026-000011PRJ')).toMatchObject({
      pathway: 'discretionary',
      stage: 'filed',
      existingUnits: 2
    });
    expect(r.counts['projects.pathwayDefaulted']).toBe(1);
  });

  it('M12: the umbrella PRJ sits at preApplication with its units', () => {
    expect(project('PRJ:2026-000012PRJ')).toMatchObject({
      pathway: 'discretionary',
      stage: 'preApplication',
      units: 24,
      existingUnits: 12,
      parcelIds: ['3512008']
    });
  });

  it('M13: closed without a decision is withdrawn at filed on its close date', () => {
    expect(history('PRJ:2015-000013PRJ').end).toEqual({
      kind: 'exit',
      stage: 'filed',
      reason: 'withdrawn',
      day: day('2016-05-02')
    });
  });

  it('M14: one fallback phase of 100 on lot 9; its base case is a complete history', () => {
    const p = project('CASE:2010.0002PRX');
    expect(p.multiPhase).toBe(true);
    expect(p.phases).toEqual([
      { units: 100, parcelIds: ['3512009'], plannedPermitFiled: null, source: null }
    ]);
    expect(r.counts['multiphase.u.2010.0002PRX']).toBe(40);
    expect(r.counts['multiphase.u.2010.0002PRX.n']).toBe(1);
    expect(r.counts['multiphase.enriched']).toBe(1);
    expect(r.counts['multiphase.fallback']).toBe(1);
    expect(history('PRJ:2010.0002').end.kind).toBe('complete');
    const permit = r.permits.find((q) => q.permit_number === '201501150014');
    expect(permit).toMatchObject({ prj_record_id: '2010.0002', prx_case_no: '2010.0002PRX' });
  });

  it('xdht extras: rhnaCompletedNet is 4 units over 3 rows', () => {
    expect(r.file.rhnaCompletedNet.units).toBe(4);
    expect(r.file.rhnaCompletedNet.provenance.n).toBe(3);
  });
});

describe('mini project records: V20-V24 with the fixture thresholds', () => {
  it('passes V20 on the serialised file', () => {
    const v = checkV20(Buffer.from(serializeProjects(r.file)), {
      asOf: MINI_ASOF,
      parcelIds: MINI_PARCELS,
      maxBytes: 2_000_000,
      warnBytes: 1_000_000
    });
    expect(v).toMatchObject({ id: 'V20', ok: true });
  });

  it('passes V21 at coverage 1.0', () => {
    expect(checkV21(r.checks, 1)).toMatchObject({ id: 'V21', ok: true });
    expect(r.checks.coverage.matchedUnits).toBe(r.checks.coverage.rowUnits);
  });

  it('passes V22 against the fixture hiNet', () => {
    const v = checkV22(r.checks, { 2023: 3, 2024: 2, 2025: -1 }, { year: 0.1, total: 0.05 });
    expect(v).toMatchObject({ id: 'V22', ok: true });
  });

  it('passes V23, with a rerun byte-identical', () => {
    const again = deriveProjects(miniProjectInput());
    const bytes = (x: typeof r) => [
      serializeProjects(x.file),
      serializeHistories({ schema: 1, asOf: MINI_ASOF, histories: x.histories })
    ];
    const identical = JSON.stringify(bytes(again)) === JSON.stringify(bytes(r));
    expect(identical).toBe(true);
    expect(checkV23(r.checks, identical)).toMatchObject({ id: 'V23', ok: true });
  });

  it('passes V24 with M9 enriched and M14 fallback', () => {
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
    expect(r.checks.multiphase.lastResort).toEqual([]);
  });
});
