import { describe, expect, it } from 'vitest';
import { parseProjectsFile } from '../../../src/lib/timelapse/projects';
import { STAGE_ORDER } from '../../../src/lib/timelapse/types';
import type { MultiphaseEntry } from '../../enrichment/schema';
import {
  deriveProjects,
  serializeHistories,
  serializeProjects,
  type DeriveResult
} from '../../project-records/derive';
import { checkV23, checkV24 } from '../../project-records/invariants';
import type { ProjectRecordsInput, ProjectSourceId, RawRow } from '../../project-records/types';
import { ASOF, PARCELS, baseInput, baseMultiphase, baseRaw, day } from './derive-input';

const T3_KEYS = [
  'id',
  'label',
  'parcelIds',
  'pathway',
  'stage',
  'history',
  'units',
  'existingUnits',
  'stories',
  'storiesTier',
  'multiPhase',
  'phases',
  'sources',
  'quality'
];

const T4D_KEYS = [
  'id',
  'pathway',
  'parcelIds',
  'entered',
  'end',
  'unitsAt',
  'existingUnits',
  'storiesProposed',
  'baseStoriesAtFiling',
  'sources',
  'quality'
];

function project(r: DeriveResult, id: string) {
  const p = r.file.projects.find((x) => x.id === id);
  if (!p) throw new Error(`no project ${id}`);
  return p;
}

function history(r: DeriveResult, id: string) {
  const h = r.histories.find((x) => x.id === id);
  if (!h) throw new Error(`no history ${id}`);
  return h;
}

/** Strips JSON string literals, leaving only the structural characters. */
function structure(json: string): string {
  return json.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function mapRaw(
  raw: Record<ProjectSourceId, RawRow[]>,
  f: (rows: RawRow[]) => RawRow[]
): Record<ProjectSourceId, RawRow[]> {
  const out = {} as Record<ProjectSourceId, RawRow[]>;
  for (const k of Object.keys(raw) as ProjectSourceId[]) out[k] = f([...raw[k]]);
  return out;
}

const rotate = (k: number) => (rows: RawRow[]) =>
  rows.length === 0 ? rows : [...rows.slice(k % rows.length), ...rows.slice(0, k % rows.length)];

const ts = (iso: string) => `${iso}T00:00:00.000`;

function fallbackEntry(caseNo: string, label: string): MultiphaseEntry {
  return {
    caseNo,
    label,
    schedule: null,
    searched: [{ url: 'https://example.invalid/search', retrieved: '2026-10-01' }],
    phases: []
  };
}

/** Adds the base-case PRJ `2010.0002` of master D with one completed 40-unit permit (lot 009). */
function withBaseCase(): ProjectRecordsInput {
  const raw = baseRaw();
  raw['datasf-planning-projects'].push({
    record_id: '2010.0002',
    record_status: 'Closed',
    block: '3512',
    lot: '009',
    open_date: ts('2010-01-05'),
    building_permits: '201501150014',
    number_of_units_prop: '40',
    new_construction: 'CHECKED'
  });
  raw['datasf-planning-review'].push({
    b1_alt_id: '2010.0002',
    start_event_type: 'accepted',
    start_event_date: ts('2010-02-01'),
    end_event_type: 'approval',
    end_event_date: ts('2012-03-01')
  });
  raw['datasf-permits-newcon'].push({
    permit_number: '201501150014',
    permit_type: '2',
    block: '3512',
    lot: '009',
    status: 'complete',
    status_date: ts('2017-04-01'),
    filed_date: ts('2015-01-15'),
    issued_date: ts('2015-06-01'),
    first_construction_document_date: ts('2015-08-01'),
    completed_date: ts('2017-04-01'),
    proposed_units: '40',
    site_permit: 'Y',
    primary_address_flag: 'Y'
  });
  raw['datasf-unit-completions'].push({
    building_permit_application: '201501150014',
    date_issued: ts('2017-03-01'),
    document_type: 'CFC',
    number_of_units_certified: '40'
  });
  return baseInput(raw);
}

/**
 * Adds an earlier master H `2007.0001PRX` (lot 008, 300 units) sharing D's da, fallback, and an
 * alteration row with that da on lot 009 (so both masters' DA parcels hold lot 009).
 */
function withEarlierMaster(): ProjectRecordsInput {
  const raw = baseRaw();
  raw['datasf-dev-pipeline'].push({
    blklot: '3512008',
    current_status: 'PL Approved',
    current_status_date: ts('2008-06-12'),
    case_no: '2007.0001PRX',
    new_pipeline_units: '300',
    da: 'Fixture Village'
  });
  // An alteration row on lot 009 with the same da puts lot 009 in both masters' DA parcels.
  raw['datasf-dev-pipeline'].push({
    blklot: '3512009',
    current_status: 'BP Filed',
    current_status_date: ts('2026-01-01'),
    bpa_no: '209901018888',
    new_pipeline_units: '3',
    da: 'Fixture Village'
  });
  const mp = baseMultiphase();
  mp.projects.unshift(fallbackEntry('2007.0001PRX', 'Fixture Shipyard'));
  return baseInput(raw, mp);
}

/** Adds an enriched master H `2007.0001PRX` (lot 008, 300 units, own da), schedule Σ 320. */
function withEnrichedMaster(): ProjectRecordsInput {
  const raw = baseRaw();
  raw['datasf-dev-pipeline'].push({
    blklot: '3512008',
    current_status: 'PL Approved',
    current_status_date: ts('2008-06-12'),
    case_no: '2007.0001PRX',
    new_pipeline_units: '300',
    da: 'Fixture Shipyard'
  });
  const fact = {
    url: 'https://example.invalid/fixture-da.pdf',
    retrieved: '2026-10-01',
    locator: 'Exhibit B'
  };
  const mp = baseMultiphase();
  mp.projects.unshift({
    caseNo: '2007.0001PRX',
    label: 'Fixture Shipyard',
    schedule: {
      label: 'Fixture Shipyard DA phasing schedule',
      url: fact.url,
      retrieved: '2026-10-01'
    },
    searched: [],
    phases: [
      {
        name: 'Phase A',
        units: 120,
        blklots: ['3512008'],
        plannedPermitFiled: null,
        status: 'remaining',
        facts: { units: fact, blklots: fact }
      },
      {
        name: 'Phase B',
        units: 200,
        blklots: ['3512009'],
        plannedPermitFiled: '2027-03-01',
        status: 'remaining',
        facts: { units: fact, blklots: fact, plannedPermitFiled: fact }
      }
    ]
  });
  return baseInput(raw, mp);
}

const LINK_KEYS = [
  'link.permitsMultiPrj',
  'link.satellites',
  'link.ppaAttached',
  'link.ppaOnly',
  'link.splitComponents',
  'link.pipelineOnly',
  'link.excludedRows',
  'link.orphanChildren',
  'link.pipelineNoIds'
];

describe('deriveProjects: output shape', () => {
  const r = deriveProjects(baseInput());

  it('passes the T3 validator with the snapshot day and parcel set', () => {
    expect(() =>
      parseProjectsFile(JSON.parse(serializeProjects(r.file)), { asOf: ASOF, parcelIds: PARCELS })
    ).not.toThrow();
    expect(r.file.schema).toBe(1);
    expect(r.file.asOf).toBe(ASOF);
  });

  it('sorts projects and histories by id, with T3 and T4d key order', () => {
    const ids = r.file.projects.map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual([
      'BP:202403150003',
      'CASE:2010.0002PRX',
      'CASE:2099-000099PRJ',
      'PRJ:2019-000001PRJ'
    ]);
    expect(Object.keys(r.file.projects[0])).toEqual(T3_KEYS);
    const parsed = JSON.parse(serializeProjects(r.file));
    for (const p of parsed.projects) expect(Object.keys(p)).toEqual(T3_KEYS);
    const hids = r.histories.map((h) => h.id);
    expect(hids).toEqual([...hids].sort());
    const hist = JSON.parse(serializeHistories({ schema: 1, asOf: ASOF, histories: r.histories }));
    expect(Object.keys(hist)).toEqual(['schema', 'asOf', 'histories']);
    for (const h of hist.histories) {
      expect(Object.keys(h)).toEqual(T4D_KEYS);
      expect(Object.keys(h.end)[0]).toBe('kind');
      const order = (o: object) => Object.keys(o).map((k) => STAGE_ORDER.indexOf(k as never));
      expect(order(h.entered)).toEqual([...order(h.entered)].sort((a, b) => a - b));
      expect(order(h.unitsAt)).toEqual([...order(h.unitsAt)].sort((a, b) => a - b));
    }
  });

  it('serialises minified, in key order whatever the insertion order', () => {
    const s = serializeProjects(r.file);
    expect(structure(s)).not.toMatch(/\s/);
    expect(
      structure(serializeHistories({ schema: 1, asOf: ASOF, histories: r.histories }))
    ).not.toMatch(/\s/);
    const reversed = JSON.parse(s, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v
    );
    expect(Object.keys(reversed)[0]).toBe('projects');
    expect(serializeProjects(reversed)).toBe(s);
    const top = JSON.parse(s);
    expect(Object.keys(top)).toEqual([
      'schema',
      'asOf',
      'rhnaCompletedNet',
      'qualityRules',
      'projects'
    ]);
    const rule = { valueTier: null, tier: 2, label: 'x', id: 'pr.a.b' } as const;
    const withRule = JSON.parse(serializeProjects({ ...reversed, qualityRules: [rule] }));
    expect(Object.keys(withRule.qualityRules[0])).toEqual(['id', 'label', 'tier', 'valueTier']);
    expect(Object.keys(top.rhnaCompletedNet)).toEqual(['units', 'since', 'provenance']);
    expect(Object.keys(top.rhnaCompletedNet.provenance)).toEqual([
      'tier',
      'label',
      'sources',
      'method',
      'n',
      'window'
    ]);
    const src = top.projects[0].sources[0];
    expect(Object.keys(src)).toEqual(['dataset', 'id', 'key']);
  });
});

describe('deriveProjects: values', () => {
  const r = deriveProjects(baseInput());

  it('derives the in-flight projects', () => {
    const a = project(r, 'PRJ:2019-000001PRJ');
    expect(a).toMatchObject({
      label: '100 Fixture St',
      parcelIds: ['3512001', '3512002'],
      pathway: 'discretionary',
      stage: 'construction',
      units: 24,
      existingUnits: 1,
      stories: 6,
      storiesTier: 0,
      multiPhase: false,
      phases: null
    });
    expect(a.history.permitFiled).toBe(day('2020-03-02'));
    const b = project(r, 'BP:202403150003');
    expect(b.pathway).toBe('permitOnly');
    expect(Object.keys(b.history)).toEqual(['permitFiled']);
  });

  it('gives a non-PRX pipeline-only row multiPhase false and phases null', () => {
    const e = project(r, 'CASE:2099-000099PRJ');
    expect(e).toMatchObject({
      label: '5 Example Ave',
      pathway: 'discretionary',
      stage: 'filed',
      units: 5,
      multiPhase: false,
      phases: null
    });
  });

  it('phases the PRX master by the fallback, excluding in-flight and completed parcels', () => {
    const d = project(r, 'CASE:2010.0002PRX');
    expect(d.label).toBe('Fixture Village');
    expect(d.multiPhase).toBe(true);
    expect(d.stage).toBe('entitled');
    expect(d.parcelIds).toEqual(['3512006']);
    expect(d.phases).toEqual([
      { units: 100, parcelIds: ['3512006'], plannedPermitFiled: null, source: null }
    ]);
    expect(r.counts['multiphase.u.2010.0002PRX']).toBe(60);
    expect(r.counts['multiphase.u.2010.0002PRX.n']).toBe(1);
    expect(r.counts['multiphase.fallback']).toBe(1);
    expect(r.counts['multiphase.phases.fallback']).toBe(1);
  });

  it('keeps histories to non-pipeline-only population projects', () => {
    expect(r.histories.map((h) => h.id)).toEqual([
      'BP:201410070008',
      'BP:201801010007',
      'BP:202403150003',
      'PRJ:2016-000006PRJ',
      'PRJ:2019-000001PRJ'
    ]);
    const c = history(r, 'PRJ:2016-000006PRJ');
    expect(c.end).toEqual({ kind: 'complete', day: day('2019-08-01') });
    expect(c.unitsAt).toEqual({ filed: 60, permitFiled: 60, complete: 60 });
    expect(c.baseStoriesAtFiling).toBe(4);
    const f = history(r, 'BP:201410070008');
    expect(f.end).toEqual({ kind: 'open', lastObserved: day('2014-10-07') });
    expect(f.existingUnits).toBe(1);
  });

  it('sets unitsAt.complete only when the history entered complete', () => {
    const g = history(r, 'BP:201801010007');
    expect(g.end).toMatchObject({ kind: 'exit', reason: 'cancelled', stage: 'permitFiled' });
    expect(g.entered.complete).toBeUndefined();
    expect(g.unitsAt).toEqual({ permitFiled: 8 });
  });

  it('emits one ordered permits row per linked permit', () => {
    expect(r.permits.map((p) => p.permit_number)).toEqual([
      '201906010001',
      '201410070008',
      '201605010006',
      '201801010007',
      '202403150003'
    ]);
    expect(r.permits[0]).toEqual({
      permit_number: '201906010001',
      project_id: 'PRJ:2019-000001PRJ',
      prj_record_id: '2019-000001PRJ',
      dva_record_id: null,
      prx_case_no: '2010.0002PRX',
      da: 'Fixture Village',
      parcel_ids: ['3512001', '3512002'],
      proposed_units: 24,
      site_permit: true,
      status: 'issued',
      live: true,
      superseded: false,
      filed_day: day('2019-06-01'),
      issued_day: day('2021-02-01'),
      construction_day: day('2021-05-03'),
      complete_day: null,
      status_day: day('2021-02-01')
    });
    const g = r.permits.find((p) => p.permit_number === '201801010007')!;
    expect(g).toMatchObject({ live: false, superseded: false, complete_day: day('2019-06-01') });
  });

  it('reports every count key', () => {
    const keys = [
      'projects.inFlight',
      'projects.inFlightUnits',
      'projects.byPathway.discretionary',
      'projects.byPathway.streamlined',
      'projects.byPathway.permitOnly',
      ...STAGE_ORDER.map((s) => `projects.byStage.${s}`),
      'projects.staleOpen',
      'projects.staleOpenUnits',
      'projects.pathwayDefaulted',
      'projects.excludedAlterationUnits',
      'projects.excludedNoUnits',
      'projects.netDropped',
      'projects.stories.tier0',
      'projects.stories.tier3',
      'projects.stories.null',
      'projects.parcels.mapped',
      'projects.parcels.unmapped',
      'histories.total',
      'histories.droppedNoDates',
      'histories.ppaLagDays',
      'histories.ppaLagN',
      'rhna.units',
      'rhna.crossCheck.2023',
      'rhna.crossCheck.2024',
      'rhna.crossCheck.2025',
      'rhna.xdhtLagDays',
      'params.ppaUmbrellaDays',
      'params.ppaUmbrellaDays.tier',
      'params.referralToleranceDays',
      'params.referralToleranceDays.tier',
      'multiphase.enriched',
      'multiphase.fallback',
      'multiphase.lastResort',
      'multiphase.merged',
      'multiphase.phases.enriched',
      'multiphase.phases.fallback',
      'multiphase.u.2010.0002PRX',
      'multiphase.u.2010.0002PRX.n',
      'pipeline.cutoffDay',
      ...LINK_KEYS
    ];
    for (const k of keys) expect(r.counts, k).toHaveProperty([k]);
    expect(r.counts).toMatchObject({
      'projects.inFlight': 4,
      'projects.inFlightUnits': 131,
      'projects.byPathway.discretionary': 3,
      'projects.byPathway.streamlined': 0,
      'projects.byPathway.permitOnly': 1,
      'projects.byStage.preApplication': 0,
      'projects.byStage.filed': 1,
      'projects.byStage.entitled': 1,
      'projects.byStage.permitFiled': 1,
      'projects.byStage.construction': 1,
      'projects.byStage.complete': 0,
      'projects.staleOpen': 1,
      'projects.staleOpenUnits': 3,
      'projects.pathwayDefaulted': 0,
      'projects.excludedAlterationUnits': 4,
      'projects.excludedNoUnits': 0,
      'projects.netDropped': 0,
      'projects.stories.tier0': 1,
      'projects.stories.tier3': 0,
      'projects.stories.null': 3,
      'histories.total': 5,
      'histories.ppaLagDays': -1,
      'histories.ppaLagN': 0,
      'rhna.units': 4,
      'rhna.crossCheck.2023': 3,
      'rhna.crossCheck.2024': 2,
      'rhna.crossCheck.2025': -1,
      'rhna.xdhtLagDays': ASOF - day('2025-01-15'),
      'params.ppaUmbrellaDays': 7,
      'params.ppaUmbrellaDays.tier': 4,
      'params.referralToleranceDays': 30,
      'params.referralToleranceDays.tier': 4,
      'pipeline.cutoffDay': day('2026-07-28'),
      'link.excludedRows': 1
    });
    expect(r.warnings.some((w) => w.includes('xdhtLagDays'))).toBe(true);
  });

  it('fills the V2x inputs', () => {
    expect(r.checks.asOf).toBe(ASOF);
    expect(r.checks.file).toBe(r.file);
    expect(r.checks.histories).toBe(r.histories);
    expect(r.checks.coverage).toEqual({ matchedUnits: 131, rowUnits: 131, rows: 4 });
    expect(r.checks.rhna).toEqual({ byYear: { 2023: 3, 2024: 2, 2025: -1 }, total: 4 });
    expect(r.checks.multiphase).toEqual({
      problems: [],
      fileProblems: [],
      lastResort: [],
      scales: {}
    });
  });
});

describe('deriveProjects: masters', () => {
  it('uses the base-case PRJ project for the phase size and excludes its completed parcels', () => {
    const r = deriveProjects(withBaseCase());
    expect(r.counts['multiphase.u.2010.0002PRX']).toBe(40);
    expect(r.counts['multiphase.u.2010.0002PRX.n']).toBe(1);
    const d = project(r, 'CASE:2010.0002PRX');
    expect(d.parcelIds).toEqual(['3512006']);
    expect(d.phases).toEqual([
      { units: 100, parcelIds: ['3512006'], plannedPermitFiled: null, source: null }
    ]);
    expect(history(r, 'PRJ:2010.0002').end).toEqual({ kind: 'complete', day: day('2017-03-01') });
    const row = r.permits.find((p) => p.permit_number === '201501150014')!;
    expect(row).toMatchObject({ prj_record_id: '2010.0002', prx_case_no: '2010.0002PRX' });
  });

  it("excludes other masters' own parcels and earlier masters' final parcels, in id order", () => {
    const r = deriveProjects(withEarlierMaster());
    // H (first in id order) may not take D's tracking lot 006; it splits lots 009 and 008.
    expect(project(r, 'CASE:2007.0001PRX').phases).toEqual([
      { units: 150, parcelIds: ['3512009'], plannedPermitFiled: null, source: null },
      { units: 150, parcelIds: ['3512008'], plannedPermitFiled: null, source: null }
    ]);
    // D may not take H's final lot 009, so P = 1 and D keeps one fallback phase on its own lot.
    expect(project(r, 'CASE:2010.0002PRX').phases).toEqual([
      { units: 100, parcelIds: ['3512006'], plannedPermitFiled: null, source: null }
    ]);
    expect(project(r, 'CASE:2010.0002PRX').parcelIds).toEqual(['3512006']);
    expect(r.checks.multiphase.lastResort).toEqual([]);
    expect(r.counts['multiphase.lastResort']).toBe(0);
    expect(r.counts['multiphase.fallback']).toBe(2);
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });

  it('enriches from the schedule, scaled to the control total', () => {
    const r = deriveProjects(withEnrichedMaster());
    const h = project(r, 'CASE:2007.0001PRX');
    const source = {
      label: 'Fixture Shipyard DA phasing schedule',
      url: 'https://example.invalid/fixture-da.pdf',
      retrieved: '2026-10-01'
    };
    expect(h.phases).toEqual([
      { units: 113, parcelIds: ['3512008'], plannedPermitFiled: null, source },
      { units: 187, parcelIds: ['3512009'], plannedPermitFiled: day('2027-03-01'), source }
    ]);
    const parsed = JSON.parse(serializeProjects(r.file));
    const ph = parsed.projects.find((p: { id: string }) => p.id === 'CASE:2007.0001PRX').phases[0];
    expect(Object.keys(ph)).toEqual(['units', 'parcelIds', 'plannedPermitFiled', 'source']);
    expect(Object.keys(ph.source)).toEqual(['label', 'url', 'retrieved']);
    expect(r.counts['multiphase.scale.2007.0001PRX']).toBe(300 / 320);
    expect(r.checks.multiphase.scales).toEqual({ '2007.0001PRX': 300 / 320 });
    expect(r.counts['multiphase.enriched']).toBe(1);
    expect(r.counts['multiphase.phases.enriched']).toBe(2);
    // u is reported only where buildPhases used one (D's fallback), not for the enriched H.
    expect(r.counts).not.toHaveProperty(['multiphase.u.2007.0001PRX']);
    expect(r.counts['multiphase.u.2010.0002PRX']).toBe(60);
  });

  it('reports an out-of-bounds scale factor once in V24', () => {
    const input = withEnrichedMaster();
    input.multiphase.projects[0].phases[1].units = 300; // R 300 / Σ 420
    const r = deriveProjects(input);
    expect(r.checks.multiphase.scales).toEqual({ '2007.0001PRX': 300 / 420 });
    const v24 = checkV24(r.checks);
    expect(v24.ok).toBe(false);
    expect(v24.detail?.match(/scale factor/g)).toHaveLength(1);
  });

  it('reports multiphase file problems and buildPhases warnings', () => {
    const mp = baseMultiphase();
    mp.projects.push(fallbackEntry('2001.0001PRX', 'Nowhere'));
    const r = deriveProjects(baseInput(baseRaw(), mp));
    expect(r.checks.multiphase.fileProblems.join('\n')).toContain('2001.0001PRX');

    const enriched = withEnrichedMaster();
    enriched.multiphase.projects[0].phases[0].blklots.push('9999999');
    const w = deriveProjects(enriched);
    expect(w.warnings.some((x) => x.includes('9999999'))).toBe(true);
  });
});

describe('deriveProjects: PRX rows', () => {
  /** Adds PRX row `2023-000001PRX` naming F's fetched permit, with a curated entry. */
  function withJoinedPrx(): ProjectRecordsInput {
    const raw = baseRaw();
    raw['datasf-dev-pipeline'].push({
      blklot: '3512002',
      current_status: 'BP Filed',
      current_status_date: ts('2026-07-01'),
      case_no: '2023-000001PRX',
      bpa_no: '201410070008',
      new_pipeline_units: '3'
    });
    const mp = baseMultiphase();
    mp.projects.push(fallbackEntry('2023-000001PRX', 'Joined Tower'));
    return baseInput(raw, mp);
  }

  it('joins a PRX row with a fetched bpa_no to the permit project, not multi-phase', () => {
    const base = deriveProjects(baseInput());
    expect(base.counts['projects.staleOpen']).toBe(1);
    const r = deriveProjects(withJoinedPrx());
    expect(r.file.projects.map((p) => p.id)).not.toContain('CASE:2023-000001PRX');
    const f = project(r, 'BP:201410070008');
    expect(f).toMatchObject({ units: 3, multiPhase: false, phases: null });
    expect(f.label).not.toBe('Joined Tower');
    expect(f.sources).toContainEqual({
      dataset: '6jgi-cpb4',
      id: '2023-000001PRX',
      key: 'case_no'
    });
    expect(r.counts['projects.staleOpen']).toBe(0);
    expect(r.counts['multiphase.fallback']).toBe(1);
    expect(r.warnings).toContain(
      '2023-000001PRX: PRX row joins permit 201410070008; multiphase entry unused'
    );
    expect(r.checks.multiphase.fileProblems).toEqual([]);
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });

  it('keeps a PRX row without a fetched bpa_no a CASE multi-phase master', () => {
    const raw = baseRaw();
    const d = raw['datasf-dev-pipeline'].find((x) => x.case_no === '2010.0002PRX')!;
    d.bpa_no = '209901017777';
    const r = deriveProjects(baseInput(raw));
    expect(project(r, 'CASE:2010.0002PRX')).toMatchObject({ multiPhase: true, units: 100 });
    expect(r.warnings.some((w) => w.includes('multiphase entry unused'))).toBe(false);
    expect(r.counts['link.excludedRows']).toBe(1);
  });
});

describe('deriveProjects: shared parcels (pr.parcels.shared-existing)', () => {
  const ID = 'pr.parcels.shared-existing';

  it('is a zero tally when no in-flight project shares a parcel', () => {
    const r = deriveProjects(baseInput());
    expect(r.counts[`quality.${ID}.fired`]).toBe(0);
    expect(r.counts[`quality.${ID}.of`]).toBe(r.file.projects.length);
    expect(r.file.projects.every((p) => !p.quality.includes(ID))).toBe(true);
  });

  it("counts a lot's 1 assessor unit once: the earlier project holds it, both carry the id", () => {
    const raw = baseRaw();
    // E's pipeline row moves onto lot 002, which A (filed 2019) already holds with 1 unit.
    const e = raw['datasf-dev-pipeline'].find((x) => x.case_no === '2099-000099PRJ')!;
    e.blklot = '3512002';
    const base = deriveProjects(baseInput());
    const r = deriveProjects(baseInput(raw));
    expect(project(r, 'PRJ:2019-000001PRJ')).toMatchObject({ existingUnits: 1 });
    expect(project(r, 'PRJ:2019-000001PRJ').quality).toContain(ID);
    expect(project(r, 'CASE:2099-000099PRJ')).toMatchObject({ units: 5, existingUnits: 0 });
    expect(project(r, 'CASE:2099-000099PRJ').quality).toEqual([ID]);
    expect(r.counts[`quality.${ID}.fired`]).toBe(2);
    expect(r.counts[`quality.${ID}.of`]).toBe(r.file.projects.length);
    // Σ existing across in-flight projects no longer double counts lot 002.
    const sum = (x: DeriveResult) => x.file.projects.reduce((s, p) => s + p.existingUnits, 0);
    expect(sum(r)).toBe(sum(base));
    // Histories keep their at-filing value and never carry the id.
    expect(history(r, 'PRJ:2019-000001PRJ').quality).not.toContain(ID);
    expect(r.histories.every((h) => !h.quality.includes(ID))).toBe(true);
    expect(checkV23(r.checks, true)).toMatchObject({ id: 'V23', ok: true });
  });
});

describe('deriveProjects: exits before later stages', () => {
  it('moves a permit exit that precedes later entered stages to the last stage (V23)', () => {
    const raw = baseRaw();
    raw['datasf-planning-projects'].push({
      record_id: '2019-000010PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '008',
      open_date: ts('2019-01-01'),
      building_permits: '201906010010',
      number_of_units_prop: '10',
      new_construction: 'CHECKED'
    });
    raw['datasf-planning-review'].push({
      b1_alt_id: '2019-000010PRJ',
      start_event_type: 'accepted',
      start_event_date: ts('2019-01-10'),
      end_event_type: 'approval',
      end_event_date: ts('2020-03-01')
    });
    raw['datasf-permits-newcon'].push({
      permit_number: '201906010010',
      permit_type: '2',
      block: '3512',
      lot: '008',
      status: 'withdrawn',
      status_date: ts('2019-09-01'),
      filed_date: ts('2019-06-01'),
      proposed_units: '10',
      site_permit: 'N',
      primary_address_flag: 'Y'
    });
    const r = deriveProjects(baseInput(raw));
    const h = history(r, 'PRJ:2019-000010PRJ');
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'permitFiled',
      reason: 'withdrawn',
      day: day('2020-03-01')
    });
    expect(checkV23(r.checks, true)).toMatchObject({ id: 'V23', ok: true });
  });
});

/** DQ-2: two no-date rows contend for one open PRJ on lot 008 (the first in row order wins). */
function withNoDateRows(): ProjectRecordsInput {
  const raw = baseRaw();
  raw['datasf-planning-projects'].push({
    record_id: '2020-006887PRJ',
    record_status: 'Under Review',
    block: '3512',
    lot: '008',
    open_date: ts('2020-07-24'),
    number_of_units_prop: '2387',
    new_construction: 'CHECKED'
  });
  for (const [caseNo, units] of [
    ['2023-007911PRJ', '2537'],
    ['2024-000030PRJ', '12']
  ]) {
    raw['datasf-dev-pipeline'].push({
      blklot: '3512008',
      current_status: 'PL Filed',
      case_no: caseNo,
      new_pipeline_units: units
    });
  }
  return baseInput(raw);
}

describe('deriveProjects: determinism', () => {
  for (const [name, make] of [
    ['base', () => baseInput()],
    ['base case', withBaseCase],
    ['earlier master', withEarlierMaster],
    ['enriched', withEnrichedMaster],
    ['no-date rows', withNoDateRows]
  ] as const) {
    it(`permuting every raw array leaves the output byte-identical (${name})`, () => {
      const input = make();
      const ref = deriveProjects(input);
      const refOut = [
        serializeProjects(ref.file),
        serializeHistories({ schema: 1, asOf: ASOF, histories: ref.histories }),
        JSON.stringify(ref.permits),
        JSON.stringify(ref.counts)
      ];
      for (const f of [(rows: RawRow[]) => rows.reverse(), rotate(1), rotate(2), rotate(3)]) {
        const r = deriveProjects({ ...input, raw: mapRaw(input.raw, f) });
        expect([
          serializeProjects(r.file),
          serializeHistories({ schema: 1, asOf: ASOF, histories: r.histories }),
          JSON.stringify(r.permits),
          JSON.stringify(r.counts)
        ]).toEqual(refOut);
      }
    });
  }
});
