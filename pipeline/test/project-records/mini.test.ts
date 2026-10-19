/**
 * The mini fixture's project records (spec 4.9 Fixture table, M1-M23 and the xdht extras) through
 * deriveProjects with stub callbacks that mirror scenario-data's fixture. V21-V24 use literal
 * fixture thresholds: coverage min 0.9, RHNA tolerance year 0.1 and total 0.05. M15-M20 values are
 * qualitative in the spec; the exact values asserted here are the goldens computed at
 * implementation (Task F2-7).
 */
import { describe, expect, it } from 'vitest';
import type { ProjectHistory, Stage } from '../../../src/lib/timelapse/types';
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
  'BP:202501150019',
  'CASE:2007.0001PRX',
  'CASE:2010.0002PRX',
  'CASE:2012-000020PRX',
  'PRJ:2019-000001PRJ',
  'PRJ:2020-000008PRJ',
  'PRJ:2020-000010PRJ',
  'PRJ:2022-000035PRJ',
  'PRJ:2024-000016PRJ',
  'PRJ:2025-000015PRJ',
  'PRJ:2026-000002PRJ',
  'PRJ:2026-000011PRJ',
  'PRJ:2026-000012PRJ',
  'PRJ:2026-000033PRJ'
];

const HISTORIES_ONLY = [
  'PPA:2021-000004PPA',
  'PRJ:2017-000005PRJ',
  'PRJ:2016-000006PRJ',
  'BP:201410070008',
  'PRJ:2015-000013PRJ',
  'PRJ:2010.0002',
  'BP:201803010021',
  'BP:201702010022',
  'PRJ:2009-000023PRJ:BP:201102010023',
  'PRJ:2009-000023PRJ:BP:201102020023',
  'BP:200406010024',
  'BP:201409010025',
  'BP:201112010026',
  'BP:201410010027',
  'BP:202503010028',
  'PRJ:2016-000029PRJ',
  'PRJ:2018-000030PRJ',
  'PRJ:2019-000031PRJ'
];

/**
 * Ruling E1 (stage-calibration finding): a project whose permits are all dead exits no earlier
 * than `permitIssued` when one of its non-superseded permits was issued, and no earlier than
 * `construction` when one has a construction day. Returns the problems and, per expected stage,
 * the histories the check covered, so a caller can assert the records exist.
 */
function deadIssuedExitCheck(
  histories: ProjectHistory[],
  permits: typeof r.permits
): { problems: string[]; covered: Partial<Record<Stage, number>> } {
  const byProject = new Map<string, typeof r.permits>();
  for (const q of permits) {
    byProject.set(q.project_id, [...(byProject.get(q.project_id) ?? []), q]);
  }
  const problems: string[] = [];
  const covered: Partial<Record<Stage, number>> = {};
  for (const h of histories) {
    const rows = byProject.get(h.id) ?? [];
    if (rows.length === 0 || rows.some((q) => q.live)) continue;
    const bearing = rows.filter((q) => !q.superseded);
    const floor: Stage | null = bearing.some((q) => q.construction_day !== null)
      ? 'construction'
      : bearing.some((q) => q.issued_day !== null)
        ? 'permitIssued'
        : null;
    if (floor === null) continue;
    covered[floor] = (covered[floor] ?? 0) + 1;
    if (h.end.kind !== 'exit') {
      problems.push(`${h.id}: ${h.end.kind}, expected an exit at ${floor} or later`);
    } else if (STAGE_ORDER.indexOf(h.end.stage) < STAGE_ORDER.indexOf(floor)) {
      problems.push(`${h.id}: exit at ${h.end.stage}, expected ${floor} or later`);
    }
  }
  return { problems, covered };
}

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

describe('mini project records: the stub roll mirrors the built panel’s existing units', () => {
  // The stub sums the landed fixture roll's number_of_units per current parcel and roll year,
  // through lineage, then overlays scenario-data's post-rule values (RA1_PANEL_UNITS in
  // fixtures/mini/projects-raw.ts: lot 3's 5,000 becomes 4, lot 4's 2024 900 becomes 3).
  // golden.test.ts checks the stub against the built panel on every parcel-year.
  it('gives the panel’s post-rule units per current parcel and roll year, through lineage', () => {
    const input = miniProjectInput();
    const table = (year: number) =>
      Object.fromEntries([...MINI_PARCELS].map((id) => [id, input.assessorUnits(id, year)]));
    const common = {
      '3512001': 2,
      '3512002': 3,
      '8711023C': 4,
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
  it('ships exactly M1, M2, M3, M8-M12, M14-M16, M19, M20, M33 and M35', () => {
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

  it('M17 and M18 are neither in flight nor histories', () => {
    const ids = [...r.file.projects.map((p) => p.id), ...r.histories.map((h) => h.id)];
    for (const id of [
      'CASE:2025-000017PRX',
      'PRJ:2025-000017PRJ',
      'CASE:2026-000018PRJ',
      'PRJ:2026-000018PRJ'
    ]) {
      expect(ids, id).not.toContain(id);
    }
    // No project names M17's or M18's row in its sources.
    const rows = r.file.projects.flatMap((p) => p.sources.map((s) => s.id));
    expect(rows).not.toContain('2025-000017PRX');
    expect(rows).not.toContain('2026-000018PRJ');
  });

  it('lists exactly the carried quality ids in qualityRules (spec 4.9)', () => {
    expect(r.file.qualityRules.map((q) => q.id)).toEqual([
      'pr.date.valid-range',
      'pr.multiphase.da-netting',
      'pr.multiphase.score-only',
      'pr.parcels.shared-existing',
      'pr.pipeline.status-date-linked',
      'pr.stages.forward-clamp',
      'pr.units.capacity'
    ]);
  });

  it('keeps pipelineCutoff at 2026-07-28 (M3)', () => {
    expect(r.counts['pipeline.cutoffDay']).toBe(day('2026-07-28'));
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
      phases: null,
      // M35 (in flight on lot 010) shares its parcel.
      quality: ['pr.date.valid-range', 'pr.parcels.shared-existing', 'pr.stages.forward-clamp']
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

  it('M7: stale-open; the curated dead verdict ends its history (Ruling C3)', () => {
    const h = history('BP:201410070008');
    // An imagery check found no building: withdrawn at the last stage, dated by the check.
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'permitFiled',
      reason: 'withdrawn',
      day: day('2026-09-01')
    });
    expect(h.quality).toEqual(['pr.stages.verified-construction']);
    // The in-flight decision reads the spec 4.6 end: M7, M24, M25, M26, M29, M30, M31, M34, M37,
    // M38, M39 and M40 are stale-open.
    expect(r.counts['projects.staleOpen']).toBe(12);
    expect(r.counts['projects.staleOpenUnits']).toBe(54);
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

  it('M10: permitFiled forced up to the approval; 6 units on 2 existing, holding lot 1', () => {
    const p = project('PRJ:2020-000010PRJ');
    expect(p.history.permitFiled).toBe(day('2021-11-01'));
    expect(p.units).toBe(6);
    // M10 entered lot 1 before M19, so it holds the lot's 2 units (pr.parcels.shared-existing).
    expect(p.existingUnits).toBe(2);
    expect(p.quality).toEqual(['pr.parcels.shared-existing', 'pr.stages.forward-clamp']);
  });

  it('M11: unclassifiable history, defaulted to discretionary in flight', () => {
    expect(history('PRJ:2026-000011PRJ').pathway).toBeNull();
    expect(project('PRJ:2026-000011PRJ')).toMatchObject({
      pathway: 'discretionary',
      stage: 'filed',
      units: 3,
      existingUnits: 2,
      parcelIds: ['3512006'],
      quality: []
    });
    // M11 and M33 (neither has pathway evidence).
    expect(r.counts['projects.pathwayDefaulted']).toBe(2);
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

  it('M15: the capacity rule nulls the permit units; units fall through to the PRJ', () => {
    const p = project('PRJ:2025-000015PRJ');
    expect(p).toMatchObject({
      pathway: 'permitOnly',
      stage: 'permitFiled',
      parcelIds: ['8711023C'],
      units: 10,
      // Lot 3's 2025 roll units after scenario-data's sd.roll.units-capacity (5,000 -> 4): net 6.
      existingUnits: 4,
      stories: 3,
      storiesTier: 0,
      multiPhase: false,
      phases: null,
      quality: ['pr.units.capacity']
    });
    expect(p.history).toEqual({ permitFiled: day('2025-04-01') });
    expect(p.sources).toEqual([
      { dataset: '6jgi-cpb4', id: '202504010015', key: 'bpa_no' },
      { dataset: 'i98e-djp9', id: '202504010015', key: 'permit_number' },
      { dataset: 'qvu5-m3a2', id: '2025-000015PRJ' }
    ]);
    const h = history('PRJ:2025-000015PRJ');
    expect(h).toMatchObject({ pathway: 'permitOnly', existingUnits: 4 });
    expect(h.quality).toEqual(['pr.units.capacity']);
    expect(h.unitsAt).toEqual({ filed: 10 });
    expect(h.unitsAt.permitFiled).toBeUndefined();
    expect(r.permits.find((q) => q.permit_number === '202504010015')).toMatchObject({
      project_id: 'PRJ:2025-000015PRJ',
      prj_record_id: '2025-000015PRJ',
      proposed_units: null,
      live: true
    });
  });

  it('M16: the no-date PRX row links to its Planning record (DQ-2), which keeps its values', () => {
    const p = project('PRJ:2024-000016PRJ');
    expect(p).toMatchObject({
      pathway: 'discretionary',
      stage: 'filed',
      parcelIds: ['0026T001A'],
      units: 200,
      existingUnits: 3,
      multiPhase: false,
      phases: null,
      quality: ['pr.pipeline.status-date-linked']
    });
    expect(p.history).toEqual({ filed: day('2024-02-01') });
    expect(p.sources).toEqual([
      { dataset: '6jgi-cpb4', id: '2024-000016PRX', key: 'case_no' },
      { dataset: 'd4jk-jw33', id: '2024-000016PRJ', key: 'b1_alt_id' },
      { dataset: 'qvu5-m3a2', id: '2024-000016PRJ' },
      { dataset: 'y673-d69b', id: '2024-000016ENV' }
    ]);
    // At filing (roll year 2024) lot 4's 900 is scenario-data's replacement 3.
    const h = history('PRJ:2024-000016PRJ');
    expect(h).toMatchObject({ pathway: 'discretionary', existingUnits: 3 });
    expect(h.quality).toEqual(['pr.pipeline.status-date-linked']);
    expect(r.file.projects.map((x) => x.id)).not.toContain('CASE:2024-000016PRX');
    expect(r.warnings).toContain(
      '2024-000016PRX: linked to 2024-000016PRJ; multiphase entry unused'
    );
  });

  it('M17: linked to a Planning record with no units, so excluded and named', () => {
    expect(r.counts['projects.excludedNoUnits']).toBe(900);
    expect(r.counts['projects.excludedAlterationUnits']).toBe(0);
    expect(r.warnings).toContain(
      '2025-000017PRX: linked to 2025-000017PRJ with no units; excluded'
    );
    expect(r.counts['quality.pr.pipeline.status-date-linked.fired']).toBe(2);
    expect(r.counts['quality.pr.pipeline.status-date-linked.units']).toBe(220 + 900);
  });

  it('M18: a no-date row with no record and no open PRJ on its lot is dropped', () => {
    expect(r.counts['quality.pr.pipeline.no-status-date.fired']).toBe(1);
    expect(r.counts['quality.pr.pipeline.no-status-date.units']).toBe(20);
    expect(r.warnings).toContain(
      '2026-000018PRJ: no status date and no open Planning record on its lot; dropped'
    );
    // It has no da, so it is none of M14's DA rows: M14 keeps its one phase of 100 on lot 9.
    expect(project('CASE:2010.0002PRX').phases?.[0].parcelIds).toEqual(['3512009']);
  });

  it('M19: shares lot 1 with M10, which holds its units; the history keeps them', () => {
    const p = project('BP:202501150019');
    expect(p).toMatchObject({
      pathway: 'permitOnly',
      stage: 'permitFiled',
      parcelIds: ['3512001'],
      units: 3,
      existingUnits: 0,
      quality: ['pr.parcels.shared-existing']
    });
    expect(p.history).toEqual({ permitFiled: day('2025-01-15') });
    const h = history('BP:202501150019');
    expect(h.existingUnits).toBe(2);
    expect(h.quality).toEqual([]);
    // M19 and M10 on lot 001; M1 and M35 on lot 010.
    expect(r.counts['quality.pr.parcels.shared-existing.fired']).toBe(4);
  });

  it('M20: netted by M11 to 7 and score-only (no u, no free DA parcel)', () => {
    const p = project('CASE:2012-000020PRX');
    expect(p).toMatchObject({
      label: 'Fixture Yards',
      pathway: 'discretionary',
      stage: 'entitled',
      parcelIds: [],
      units: 7,
      existingUnits: 0,
      multiPhase: true,
      phases: null,
      sources: [{ dataset: '6jgi-cpb4', id: '2012-000020PRX', key: 'case_no' }],
      quality: ['pr.multiphase.da-netting', 'pr.multiphase.score-only']
    });
    expect(p.history).toEqual({ entitled: day('2013-05-01') });
    expect(r.counts['multiphase.netted.2012-000020PRX']).toBe(3);
    expect(r.counts['multiphase.netted.2007.0001PRX']).toBe(0);
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(0);
    expect(r.counts['multiphase.nettedOut']).toBe(0);
    expect(r.counts['multiphase.lastResort']).toBe(1);
    expect(r.counts['multiphase.scoreOnly']).toBe(1);
    // No project u (no base case, no other row with its da) and no citywide u (no completed
    // permit of 50 or more units since 2015 in the fixture).
    expect(r.counts).not.toHaveProperty('multiphase.u.2012-000020PRX');
    expect(
      r.permits.filter(
        (q) =>
          q.complete_day !== null &&
          q.complete_day >= day('2015-01-01') &&
          (q.proposed_units ?? 0) >= 50
      )
    ).toEqual([]);
    expect(r.checks.multiphase.masters['CASE:2012-000020PRX'].daParcels).toEqual(['3512006']);
    expect(r.warnings).toContain('2012-000020PRX: no free DA parcel; score-only');
    expect(r.histories.map((h) => h.id)).not.toContain('CASE:2012-000020PRX');
    // Ruling D1 (revised): every mini tracking lot is active, so each descends only to itself.
    expect(r.counts['multiphase.descendants.2012-000020PRX']).toBe(1);
    expect(r.counts['multiphase.descendants.2007.0001PRX']).toBe(1);
    expect(r.counts['multiphase.descendants.2010.0002PRX']).toBe(1);
    // M11 holds the tracking lot without a DA row, but it nets M20, so it is not flagged (B2).
    expect(r.warnings.filter((w) => w.includes('descendant parcel'))).toEqual([]);
  });

  it('M21: an issued permit that expired unstarted exits expired at permitIssued', () => {
    const h = history('BP:201803010021');
    expect(h.pathway).toBe('permitOnly');
    expect(h.entered).toEqual({
      permitFiled: day('2018-03-01'),
      permitIssued: day('2019-04-01')
    });
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'permitIssued',
      reason: 'expired',
      day: day('2022-05-02')
    });
    expect(h.existingUnits).toBe(0);
  });

  it('M22: a started site permit, then cancelled, exits cancelled at construction', () => {
    const h = history('BP:201702010022');
    expect(h.pathway).toBe('permitOnly');
    expect(h.entered).toEqual({
      permitFiled: day('2017-02-01'),
      permitIssued: day('2018-01-10'),
      construction: day('2018-03-01')
    });
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'construction',
      reason: 'cancelled',
      day: day('2021-06-01')
    });
  });

  it('Ruling E1: dead issued permits exit at permitIssued and construction (M21, M22)', () => {
    const { problems, covered } = deadIssuedExitCheck(r.histories, r.permits);
    expect(problems).toEqual([]);
    expect(covered).toEqual({ permitIssued: 1, construction: 1 });
    const exits = r.histories.filter((h) => h.end.kind === 'exit');
    const at = (s: Stage) => exits.filter((h) => h.end.kind === 'exit' && h.end.stage === s);
    // M24 and M27 exit there too, by the statutory-expiry rule (live permits, not covered above).
    expect(at('permitIssued').map((h) => h.id)).toEqual([
      'BP:200406010024',
      'BP:201410010027',
      'BP:201803010021'
    ]);
    expect(at('construction').map((h) => h.id)).toEqual(['BP:201702010022']);
  });

  it('M23: two pipeline rows split the 100-unit PRJ; each part carries its own count to filing', () => {
    const ids = ['PRJ:2009-000023PRJ:BP:201102010023', 'PRJ:2009-000023PRJ:BP:201102020023'];
    const [a, b] = ids.map(history);
    for (const h of [a, b]) {
      expect(h.pathway, h.id).toBe('discretionary');
      expect(h.parcelIds, h.id).toEqual(['3512011']);
      expect(h.quality, h.id).toEqual(['pr.units.split-filed']);
      expect(h.entered.filed, h.id).toBe(day('2009-03-02'));
      expect(h.entered.entitled, h.id).toBe(day('2010-06-01'));
      expect(h.existingUnits, h.id).toBe(0);
    }
    // Ruling U1: not the whole case's 100, but each part's own permit count, carried back.
    expect(a.unitsAt).toEqual({ filed: 40, permitFiled: 40 });
    expect(b.unitsAt).toEqual({ filed: 60, permitFiled: 60 });
    expect(a.end).toEqual({ kind: 'complete', day: day('2014-03-03') });
    expect(b.end).toEqual({ kind: 'complete', day: day('2014-06-02') });
    // A PRJ that is not split keeps its proposed units at filing (M1).
    expect(history('PRJ:2019-000001PRJ').unitsAt.filed).toBe(24);
    expect(r.counts['link.splitComponents']).toBe(1);
    expect(r.counts['quality.pr.units.split-filed.fired']).toBe(2);
    // Of the 25 histories whose primary PRJ records number_of_units_prop (M29's 0, M30-M40).
    expect(r.counts['quality.pr.units.split-filed.of']).toBe(25);
    // Both ended complete while the pipeline lists them (observe rule; neither carries it).
    expect(r.counts['quality.pr.pipeline.records-win.fired']).toBe(2);
    // T3 is unchanged: no project carries the id and qualityRules does not list it.
    expect(r.file.qualityRules.map((q) => q.id)).not.toContain('pr.units.split-filed');
  });

  it('a DQ-2-linked project nets no master (spec 4.10.2: it matches a pipeline row)', () => {
    // Move M20's tracking lot to lot 4, where only M16 (linked to M16's no-date row) is in flight.
    const input = miniProjectInput();
    const raw = { ...input.raw };
    raw['datasf-dev-pipeline'] = raw['datasf-dev-pipeline'].map((row) =>
      row.case_no === '2012-000020PRX' ? { ...row, blklot: '0026T001A' } : row
    );
    const moved = deriveProjects({ ...input, raw });
    const m16 = moved.file.projects.find((x) => x.id === 'PRJ:2024-000016PRJ');
    expect(m16?.parcelIds).toEqual(['0026T001A']);
    expect(m16?.quality).toContain('pr.pipeline.status-date-linked');
    expect(moved.counts['multiphase.netted.2012-000020PRX']).toBe(0);
    const m20 = moved.file.projects.find((x) => x.id === 'CASE:2012-000020PRX');
    expect(m20?.units).toBe(10);
    expect(m20?.quality).not.toContain('pr.multiphase.da-netting');
  });

  it('M24: an E0 permit, $200k, still issued, is expired at permitIssued (Ruling E2)', () => {
    const h = history('BP:200406010024');
    expect(h.pathway).toBe('permitOnly');
    expect(h.entered).toEqual({ permitFiled: day('2004-06-01'), permitIssued: day('2005-03-01') });
    // Table B 360 days + one 90-day extension.
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'permitIssued',
      reason: 'expired',
      day: day('2006-05-25')
    });
    expect(h.quality).toEqual(['pr.stages.statutory-expiry']);
  });

  it('M25: open at construction with an xdht completion is complete, not expired (Ruling C2)', () => {
    const h = history('BP:201409010025');
    expect(h.entered.construction).toBe(day('2015-06-01'));
    expect(h.end).toEqual({ kind: 'complete', day: day('2018-03-01') });
    expect(h.entered.complete).toBe(day('2018-03-01'));
    // No units were certified, so none is recorded at complete.
    expect(h.unitsAt).toEqual({ permitFiled: 4 });
    expect(h.quality).toEqual(['pr.stages.complete-from-evidence']);
    expect(h.sources).toContainEqual({ dataset: 'xdht-4php', id: '201409010025', key: 'bpa' });
  });

  it('M26: activity after the deadline keeps it open; the unknown verdict changes nothing', () => {
    const h = history('BP:201112010026');
    expect(h.end).toEqual({ kind: 'open', lastObserved: day('2016-01-04') });
    expect(h.quality).toEqual([]);
  });

  it('stale-open rules: T14 rows, the verdict warning and the left-flight counts', () => {
    const q = (id: string) => [r.counts[`quality.${id}.fired`], r.counts[`quality.${id}.of`]];
    // Of the 7 histories that entered construction (M1, M6, PRJ:2010.0002, M22, M23 x2, M25).
    expect(q('pr.stages.complete-from-evidence')).toEqual([1, 7]);
    // Of the 14 that entered permitIssued (M30 included): M24 and M27.
    expect(q('pr.stages.statutory-expiry')).toEqual([2, 14]);
    // The bracketed permits of the histories examined (M1, M8, M24, M26, M27, M28, M30): M26's.
    expect(q('pr.stages.expiry-no-valuation')).toEqual([1, 7]);
    // Three entries; M7's dead verdict applied.
    expect(q('pr.stages.verified-construction')).toEqual([1, 3]);
    expect(r.warnings).toContain(
      'construction-verified.json: BP:209901010099 names no open history; not applied'
    );
    expect(r.counts['histories.statutoryExpiry.excludedCompletePermit']).toBe(0);
    // M1 and M8 ($3M site permits) are within their time and stay in flight.
    expect(history('PRJ:2019-000001PRJ').end.kind).toBe('open');
  });

  it('M27: in the pipeline, past its deadline: expired at permitIssued, leaves flight (Ruling I4)', () => {
    const h = history('BP:201410010027');
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'permitIssued',
      reason: 'expired',
      day: day('2015-04-01') + 1080 + 720
    });
    expect(h.quality).toEqual(['pr.stages.statutory-expiry']);
    expect(r.file.projects.map((p) => p.id)).not.toContain('BP:201410010027');
    expect(r.counts['projects.excludedStatutory']).toBe(1);
    expect(r.counts['projects.excludedStatutoryUnits']).toBe(2);
    expect(r.warnings).toContain(
      'BP:201410010027: past statutory completion deadline; expired, left flight'
    );
  });

  it('M28: in the pipeline, every permit suspended: leaves flight, history open (Ruling I4)', () => {
    expect(history('BP:202503010028').end.kind).toBe('open');
    expect(r.file.projects.map((p) => p.id)).not.toContain('BP:202503010028');
    expect(r.counts['projects.status.suspended']).toBe(1);
    expect(r.counts['projects.excludedSuspended']).toBe(1);
    expect(r.counts['projects.excludedSuspendedUnits']).toBe(2);
    expect(r.warnings).toContain('BP:202503010028: every permit suspended; left flight');
  });

  it('M29: a referral PRJ recording 0 units takes its permit count at filing (F1a, U1)', () => {
    const h = history('PRJ:2016-000029PRJ');
    expect(h.pathway).toBe('permitOnly');
    expect(h.end.kind).toBe('open');
    expect(h.unitsAt).toEqual({ filed: 2, permitFiled: 2 });
    expect(h.quality).toEqual(['pr.units.filed-zero']);
    // M23's two parts and M29 carried a count back; none of the fixture's is left omitted.
    expect(r.counts['histories.unitsFiledCarried']).toBe(3);
    expect(r.counts['histories.unitsFiledOmitted']).toBe(0);
    expect(r.counts['quality.pr.units.filed-zero.fired']).toBe(1);
    expect(r.counts['quality.pr.units.filed-zero.of']).toBe(25);
  });

  it('M30: a PRJ-named type 3 alteration advances the entitled PRJ to permitIssued (Ruling L1)', () => {
    const h = history('PRJ:2018-000030PRJ');
    expect(h.pathway).toBe('discretionary');
    expect(h.entered).toEqual({
      filed: day('2018-03-01'),
      entitled: day('2018-10-01'),
      permitFiled: day('2019-01-15'),
      permitIssued: day('2019-06-03')
    });
    expect(h.unitsAt).toEqual({ filed: 5, permitFiled: 5 });
    expect(h.end.kind).toBe('open');
    expect(h.sources).toContainEqual({
      dataset: 'i98e-djp9',
      id: '201901150030',
      key: 'permit_number'
    });
    // Not a new-construction permit: no permits.parquet row.
    expect(r.permits.map((p) => p.permit_number)).not.toContain('201901150030');
    // The unnamed ADU is dropped and seeds no project.
    expect(r.histories.map((x) => x.id)).not.toContain('BP:202001010032');
    expect(r.counts['parse.named.kept']).toBe(1);
    expect(r.counts['parse.named.unnamed']).toBe(1);
  });

  it('M31: an unnamed BP on the entitled PRJ lot joins it (Ruling L2)', () => {
    const h = history('PRJ:2019-000031PRJ');
    expect(h.entered).toMatchObject({
      entitled: day('2019-09-03'),
      permitFiled: day('2020-03-02')
    });
    expect(h.unitsAt).toEqual({ filed: 6, permitFiled: 6 });
    expect(r.histories.map((x) => x.id)).not.toContain('BP:202003020031');
    expect(r.permits.find((p) => p.permit_number === '202003020031')?.project_id).toBe(
      'PRJ:2019-000031PRJ'
    );
    expect(r.counts['link.bpMerged']).toBe(1);
  });

  it('M32/M33: the same address refiled; the later record stays in flight (Ruling SP1)', () => {
    expect(project('PRJ:2026-000033PRJ')).toMatchObject({ units: 12, stage: 'filed' });
    expect(r.file.projects.map((p) => p.id)).not.toContain('PRJ:2026-000032PRJ');
    // T3 only: both histories stay, unchanged.
    expect(history('PRJ:2026-000032PRJ').end.kind).toBe('open');
    expect(history('PRJ:2026-000032PRJ').quality).toEqual([]);
    expect(r.counts['projects.status.superseded']).toBe(1);
    expect(r.counts['projects.excludedSuperseded']).toBe(1);
    expect(r.counts['projects.excludedSupersededUnits']).toBe(10);
    expect(r.counts['quality.pr.projects.superseded.fired']).toBe(1);
    expect(r.warnings).toContain(
      'PRJ:2026-000032PRJ: superseded by PRJ:2026-000033PRJ (same address, block and units); left flight'
    );
    // Carried by no record, so not in qualityRules.
    expect(r.file.qualityRules.map((q) => q.id)).not.toContain('pr.projects.superseded');
  });

  it('M34: an entitled approval with no activity exits as an inferred lapse (Ruling IL1)', () => {
    // Rule expiry 2023-05-01 (3 y and the ZA COVID overlap); lastObserved 2019-05-01; + 365 days.
    expect(history('PRJ:2018-000034PRJ').end).toEqual({
      kind: 'exit',
      stage: 'entitled',
      reason: 'expired',
      day: day('2023-05-01') + 365
    });
    expect(history('PRJ:2018-000034PRJ').quality).toEqual(['pr.stages.inferred-lapse']);
    expect(r.counts['quality.pr.stages.inferred-lapse.fired']).toBe(1);
    // T4d only: never in qualityRules.
    expect(r.file.qualityRules.map((q) => q.id)).not.toContain('pr.stages.inferred-lapse');
  });

  it('M35: an in-flight project that looks lapsed is flagged, not ended (ruling 2d)', () => {
    expect(project('PRJ:2022-000035PRJ')).toMatchObject({ units: 10, stage: 'entitled' });
    expect(history('PRJ:2022-000035PRJ').end.kind).toBe('open');
    expect(r.counts['projects.lapseFlagged']).toBe(1);
    expect(r.counts['projects.lapseFlaggedUnits']).toBe(10);
    expect(r.warnings).toContain(
      'in-flight project PRJ:2022-000035PRJ (10 u) looks lapsed: entitled 2023-03-01, rule expiry 2026-03-01'
    );
  });

  it('M36-M38: streamlined expiry fires in flight; affordable and recent ones stay (SE1)', () => {
    expect(history('PRJ:2020-000036PRJ').end).toEqual({
      kind: 'exit',
      stage: 'entitled',
      reason: 'expired',
      day: day('2026-07-15')
    });
    expect(r.file.projects.map((p) => p.id)).not.toContain('PRJ:2020-000036PRJ');
    expect(r.counts['projects.excludedStreamlinedExpiry']).toBe(1);
    expect(r.counts['projects.excludedStreamlinedExpiryUnits']).toBe(8);
    expect(r.warnings).toContain(
      'PRJ:2020-000036PRJ: past its streamlined approval term (3 years and one extension); expired, left flight'
    );
    expect(history('PRJ:2018-000037PRJ').end.kind).toBe('open');
    expect(history('PRJ:2022-000038PRJ').end.kind).toBe('open');
    expect(r.counts['histories.streamlinedExpiry.affordableExempt']).toBe(1);
    expect(r.counts['quality.pr.stages.streamlined-expiry.fired']).toBe(1);
    expect(r.counts['quality.pr.stages.streamlined-expiry.of']).toBe(3);
  });

  it('M39 (DA lot) and M40 (activity on its lot) stay open (Ruling IL1, review I2)', () => {
    expect(history('PRJ:2018-000039PRJ').end.kind).toBe('open');
    expect(history('PRJ:2020-000040PRJ').end.kind).toBe('open');
    expect(history('PRJ:2020-000040PRJ').quality).not.toContain('pr.stages.inferred-lapse');
  });

  it('IL1 grace boundary: the exit day equal to asOf exits, the day before asOf does not', () => {
    const exitDay = day('2023-05-01') + 365;
    const at = deriveProjects({ ...miniProjectInput(), asOf: exitDay });
    expect(at.histories.find((h) => h.id === 'PRJ:2018-000034PRJ')?.end.kind).toBe('exit');
    const before = deriveProjects({ ...miniProjectInput(), asOf: exitDay - 1 });
    expect(before.histories.find((h) => h.id === 'PRJ:2018-000034PRJ')?.end.kind).toBe('open');
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

  it('passes V21 at 0.9, below 1.0 because M16 covers less than its row', () => {
    expect(checkV21(r.checks, 0.9)).toMatchObject({ id: 'V21', ok: true });
    // M16's row says 220, its record 200; M17's row is outside the population and not counted.
    // Ruling V1: M18's dropped no-date row (20 units) has no project and leaves V21 entirely.
    // Ruling I4: M27's row leaves with its ended history; M28's (2 units, open) is unmatched.
    // Ruling SE1: M36's row leaves with its ended history; M35's (10 units) is matched.
    expect(r.checks.coverage).toEqual({ matchedUnits: 709, rowUnits: 731, rows: 13 });
    expect(checkV21(r.checks, 0.98).ok).toBe(false);
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

  it('passes V24 with M9 enriched, M14 fallback and M20 a score-only last resort', () => {
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
    expect(r.checks.multiphase.lastResort).toEqual(['CASE:2012-000020PRX']);
  });
});
