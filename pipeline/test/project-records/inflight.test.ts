import { describe, expect, it } from 'vitest';
import {
  MAX_STORIES,
  STALE_WINDOW_DAYS,
  applyCapacity,
  baseStoriesAt,
  capacityOk,
  existingUnitsAt,
  grossUnits,
  inFlightStatus,
  isPopulation,
  labelOf,
  parseStories,
  pipelineConflict,
  rollYearOf,
  sourcesOf,
  storiesOf,
  titleCase,
  unitBearingPermits,
  unitsAt
} from '../../project-records/inflight';
import { shareExisting } from '../../project-records/assemble';
import { DEAD_STATUSES } from '../../project-records/link';
import type {
  AddressRow,
  Child,
  Completion,
  LinkedProject,
  Permit,
  PipelineRow,
  Prj,
  Review
} from '../../project-records/types';
import type { InFlightProject } from '../../../src/lib/timelapse/projects';
import type { ProjectHistory } from '../../../src/lib/timelapse/types';

function d(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

function permit(number: string, over: Partial<Permit> = {}): Permit {
  return {
    number,
    sitePermit: false,
    status: 'issued',
    statusDay: null,
    filedDay: null,
    issuedDay: null,
    fcdDay: null,
    completedDateDay: null,
    lastActivityDay: null,
    stories: null,
    existingUnits: null,
    proposedUnits: null,
    rows: [],
    ...over
  };
}

function prj(recordId: string, over: Partial<Prj> = {}): Prj {
  return {
    recordId,
    status: null,
    address: null,
    blklot: null,
    openDay: null,
    closeDay: null,
    permits: [],
    decision: null,
    decisionDay: null,
    unitsProp: null,
    unitsExist: null,
    newConstruction: false,
    sb35: false,
    hsd: false,
    ab2162: false,
    description: null,
    ...over
  };
}

function child(recordId: string, over: Partial<Child> = {}): Child {
  return {
    recordId,
    type: 'PPA',
    status: null,
    blklot: null,
    parentId: null,
    openDay: null,
    closeDay: null,
    ...over
  };
}

function row(over: Partial<PipelineRow> = {}): PipelineRow {
  return {
    idx: 0,
    blklot: null,
    nameaddr: null,
    status: null,
    statusDay: null,
    approvedDay: null,
    caseNo: null,
    bpaNo: null,
    newUnits: null,
    existingUnits: null,
    proposedUnits: null,
    completedNewUnits: null,
    netUnits: null,
    description: null,
    da: null,
    prx: false,
    ...over
  };
}

function addr(
  n: string | null,
  name: string | null,
  suffix: string | null,
  primary = true
): AddressRow {
  return { blklot: null, streetNumber: n, streetName: name, streetSuffix: suffix, primary };
}

function proj(over: Partial<LinkedProject> = {}): LinkedProject {
  const anchors = over.anchors ?? [];
  const permits = over.permits ?? [];
  const live = over.live ?? permits.filter((q) => !DEAD_STATUSES.has(q.status));
  return {
    id: 'P',
    kind: 'graph',
    anchors,
    primary: anchors[0] ?? null,
    satellites: [],
    children: [],
    sourceOnlyChildren: [],
    reviews: [],
    permits,
    live,
    superseded: new Set(),
    lead: permits[0] ?? null,
    completions: [],
    pipelineRows: [],
    blklots: [],
    parcelIds: ['0001001'],
    ...over
  };
}

describe('constants', () => {
  it('exposes the tier-1 window and the story cap', () => {
    expect(STALE_WINDOW_DAYS).toBe(92);
    expect(MAX_STORIES).toBe(80);
  });
});

describe('titleCase', () => {
  it('title-cases words and keeps ordinals lower-case', () => {
    expect(titleCase('123 MAIN ST')).toBe('123 Main St');
    expect(titleCase('16TH')).toBe('16th');
    expect(titleCase('1500 VAN NESS AVE')).toBe('1500 Van Ness Ave');
  });
});

describe('labelOf', () => {
  const lead = permit('1', { rows: [addr('123', 'MAIN', 'ST')] });

  it('rule 0: the curated label wins for a PRX pipeline-only row', () => {
    const p = proj({
      kind: 'pipelineOnly',
      pipelineRows: [row({ prx: true, caseNo: '2000-001PRX', nameaddr: 'X' })]
    });
    expect(labelOf(p, 'Curated Name')).toBe('Curated Name');
  });

  it('ignores the curated label when the project is not a PRX row', () => {
    const p = proj({ permits: [lead], lead });
    expect(labelOf(p, 'Curated Name')).toBe('123 Main St');
  });

  it('rule 1: the lead permit primary address row, title-cased', () => {
    const l = permit('1', { rows: [addr('9', 'OTHER', 'ST', false), addr('123', 'MAIN', 'ST')] });
    const p = proj({ permits: [l], lead: l, anchors: [prj('A', { address: 'PRJ ADDR' })] });
    expect(labelOf(p, null)).toBe('123 Main St');
  });

  it('joins only the non-null address parts', () => {
    const l = permit('1', { rows: [addr(null, 'EMBARCADERO', null)] });
    expect(labelOf(proj({ permits: [l], lead: l }), null)).toBe('Embarcadero');
  });

  it('rule 2: the anchor project_address', () => {
    const p = proj({
      permits: [permit('1', { rows: [addr(null, null, null)] })],
      anchors: [prj('A', { address: '55 Pine St' })],
      pipelineRows: [row({ nameaddr: 'NAME' })]
    });
    expect(labelOf(p, null)).toBe('55 Pine St');
  });

  it('rule 3: the pipeline nameaddr, then null', () => {
    const p = proj({ pipelineRows: [row({ nameaddr: 'Mission Bay Block 9' })] });
    expect(labelOf(p, null)).toBe('Mission Bay Block 9');
    expect(labelOf(proj(), null)).toBeNull();
  });

  it('rule 3 skips a row linked under DQ-2 (spec §4.2 step 10)', () => {
    const p = proj({ pipelineRows: [row({ nameaddr: 'Freedom West', linkedNoDate: true })] });
    expect(labelOf(p, null)).toBeNull();
  });
});

describe('unitBearingPermits and grossUnits', () => {
  it('uses the live set, else the non-superseded permits', () => {
    const a = permit('1', { status: 'withdrawn', proposedUnits: 24 });
    const b = permit('2', { status: 'cancelled', proposedUnits: 5 });
    const p = proj({ permits: [a, b], live: [], superseded: new Set(['2']) });
    expect(unitBearingPermits(p).map((q) => q.number)).toEqual(['1']);
    const live = permit('3', { proposedUnits: 7 });
    expect(unitBearingPermits(proj({ permits: [a, live] })).map((q) => q.number)).toEqual(['3']);
  });

  it('dead permit units: all permits withdrawn, 24 proposed -> 24', () => {
    const a = permit('1', { status: 'withdrawn', proposedUnits: 24 });
    expect(grossUnits(proj({ permits: [a], live: [] }))).toBe(24);
  });

  it('rule 1 sums live proposed units', () => {
    const p = proj({
      permits: [permit('1', { proposedUnits: 10 }), permit('2', { proposedUnits: 5 })],
      anchors: [prj('A', { unitsProp: 99 })]
    });
    expect(grossUnits(p)).toBe(15);
  });

  it('rule 2: the primary unitsProp when > 0', () => {
    const p = proj({
      permits: [permit('1')],
      anchors: [prj('A', { unitsProp: 40 })],
      pipelineRows: [row({ newUnits: 3 })]
    });
    expect(grossUnits(p)).toBe(40);
  });

  it('rule 3: the first pipeline row newUnits when unitsProp is 0', () => {
    const p = proj({
      anchors: [prj('A', { unitsProp: 0 })],
      pipelineRows: [row({ newUnits: 12 })]
    });
    expect(grossUnits(p)).toBe(12);
    expect(grossUnits(proj())).toBeNull();
  });

  it('rule 3 skips a row linked under DQ-2 (spec §4.2 step 10)', () => {
    const p = proj({
      anchors: [prj('A', { unitsProp: 0 })],
      pipelineRows: [row({ newUnits: 2537, linkedNoDate: true })]
    });
    expect(grossUnits(p)).toBeNull();
  });

  it('pipeline-only rows use newUnits', () => {
    const p = proj({ kind: 'pipelineOnly', pipelineRows: [row({ newUnits: 300, prx: true })] });
    expect(grossUnits(p)).toBe(300);
  });
});

describe('parseStories', () => {
  it('parses digits and number words after the keyword', () => {
    expect(parseStories('construct a new 8-story building')).toBe(8);
    expect(parseStories('Erect a Twelve Stories tower')).toBe(12);
    expect(parseStories('new twenty-story building')).toBe(20);
  });

  it('skips the existing building stories before the keyword', () => {
    expect(
      parseStories('demolish existing two-story building and construct a new 8-story building')
    ).toBe(8);
  });

  it('is null without the keyword guard', () => {
    expect(parseStories('existing 5-story building')).toBeNull();
    expect(parseStories(null)).toBeNull();
  });

  it('falls back to feet / 10, floored', () => {
    expect(parseStories('construct a 65-foot building')).toBe(6);
    expect(parseStories('new building 120 feet tall')).toBe(12);
  });

  it('discards values outside 1..80', () => {
    expect(parseStories('new 81-story tower')).toBeNull();
    expect(parseStories('new eighty-one-story tower')).toBeNull();
    expect(parseStories('new 0-story')).toBeNull();
    expect(parseStories('new 900 foot tower')).toBeNull();
  });
});

describe('storiesOf', () => {
  it('rule 1: max permit stories > 0 is tier 0', () => {
    const p = proj({
      permits: [
        permit('1', { stories: 0 }),
        permit('2', { stories: 7 }),
        permit('3', { stories: 5 })
      ],
      anchors: [prj('A', { description: 'construct a new 3-story building' })]
    });
    expect(storiesOf(p)).toEqual({ stories: 7, tier: 0 });
  });

  it('rule 2: anchor description is tier 3', () => {
    const p = proj({
      permits: [permit('1', { stories: 0 })],
      anchors: [prj('A', { description: 'construct a new 9-story building' })]
    });
    expect(storiesOf(p)).toEqual({ stories: 9, tier: 3 });
  });

  it('falls back to the pipeline description, then null', () => {
    const p = proj({ pipelineRows: [row({ description: 'new 4-story building' })] });
    expect(storiesOf(p)).toEqual({ stories: 4, tier: 3 });
    expect(storiesOf(proj())).toEqual({ stories: null, tier: null });
  });
});

describe('assessor and roll year helpers', () => {
  it('rollYearOf clamps the UTC year to 2007..latest', () => {
    expect(rollYearOf(d('1999-05-01'), 2024)).toBe(2007);
    expect(rollYearOf(d('2015-12-31'), 2024)).toBe(2015);
    expect(rollYearOf(d('2030-01-01'), 2024)).toBe(2024);
  });

  it('existingUnitsAt sums parcels with null as 0', () => {
    const f = (id: string): number | null => ({ a: 4, b: null, c: 2 })[id as 'a'] ?? null;
    expect(existingUnitsAt(['a', 'b', 'c'], 2020, f)).toBe(6);
    expect(existingUnitsAt([], 2020, f)).toBe(0);
  });

  it('baseStoriesAt is the max over parcels, else null', () => {
    const f = (id: string): number | null => ({ a: 2, b: null, c: 5 })[id as 'a'] ?? null;
    expect(baseStoriesAt(['a', 'b', 'c'], 2020, f)).toBe(5);
    expect(baseStoriesAt(['b'], 2020, f)).toBeNull();
    expect(baseStoriesAt([], 2020, f)).toBeNull();
  });
});

describe('sourcesOf', () => {
  it('uses the key table and sorts by (dataset, id, key)', () => {
    const rev: Review = {
      recordId: 'B1',
      startType: null,
      startDay: null,
      endType: null,
      endDay: null
    };
    const comp: Completion[] = [
      { permit: '201', day: null, kind: 'TCO', units: 1 },
      { permit: '201', day: null, kind: 'CFC', units: 3 }
    ];
    const p = proj({
      anchors: [prj('2020-000001PRJ')],
      satellites: [prj('2019-000002PRJ')],
      children: [child('2020-000003PPA')],
      sourceOnlyChildren: [child('2019-000004CUA', { type: 'CUA' })],
      reviews: [rev],
      permits: [permit('201')],
      completions: comp,
      pipelineRows: [
        row({ idx: 0, caseNo: '2018-000005PRJ', bpaNo: 'ignored' }),
        row({ idx: 1, caseNo: null, bpaNo: '202012345678' }),
        row({ idx: 2, caseNo: '2018-000006PRX' })
      ]
    });
    expect(sourcesOf(p)).toEqual([
      { dataset: '6jgi-cpb4', id: '2018-000005PRJ', key: 'case_no' },
      { dataset: '6jgi-cpb4', id: '2018-000006PRX', key: 'case_no' },
      { dataset: '6jgi-cpb4', id: '202012345678', key: 'bpa_no' },
      { dataset: 'd4jk-jw33', id: 'B1', key: 'b1_alt_id' },
      { dataset: 'i98e-djp9', id: '201', key: 'permit_number' },
      { dataset: 'j67f-aayr', id: '201', key: 'building_permit_application' },
      { dataset: 'qvu5-m3a2', id: '2019-000002PRJ' },
      { dataset: 'qvu5-m3a2', id: '2020-000001PRJ' },
      { dataset: 'y673-d69b', id: '2019-000004CUA' },
      { dataset: 'y673-d69b', id: '2020-000003PPA' }
    ]);
  });

  it('omits key for record_id datasets and deduplicates', () => {
    const a = prj('X');
    const p = proj({ anchors: [a], children: [child('C'), child('C')] });
    const s = sourcesOf(p);
    expect(s.filter((r) => r.id === 'C')).toHaveLength(1);
    expect(s.every((r) => !('key' in r))).toBe(true);
  });
});

describe('unitsAt', () => {
  it('filed is the primary unitsProp, permitFiled the live proposed sum', () => {
    const p = proj({
      anchors: [prj('A', { unitsProp: 30 })],
      permits: [permit('1', { proposedUnits: 20 }), permit('2', { proposedUnits: 8 })]
    });
    expect(unitsAt(p)).toEqual({ filed: 30, permitFiled: 28 });
  });

  it('omits stages with no value', () => {
    expect(unitsAt(proj())).toEqual({});
  });

  it('complete: per permit max(sum TCO, max CFC) when every permit is complete', () => {
    const p = proj({
      permits: [
        permit('1', { proposedUnits: 120 }),
        permit('2', { proposedUnits: 10, status: 'complete', completedDateDay: d('2020-01-01') })
      ],
      completions: [
        { permit: '1', day: d('2019-01-01'), kind: 'TCO', units: 2 },
        { permit: '1', day: d('2019-06-01'), kind: 'TCO', units: 3 },
        { permit: '1', day: d('2020-01-01'), kind: 'CFC', units: 120 },
        { permit: '2', day: d('2020-02-01'), kind: 'TCO', units: 4 },
        { permit: '2', day: d('2020-03-01'), kind: 'TCO', units: 6 },
        { permit: '2', day: d('2020-04-01'), kind: 'CFC', units: 9 }
      ]
    });
    expect(unitsAt(p).complete).toBe(120 + 10);
  });

  it('no complete when a unit-bearing permit has no completion', () => {
    const p = proj({
      permits: [permit('1', { proposedUnits: 5 }), permit('2', { proposedUnits: 5 })],
      completions: [{ permit: '1', day: d('2019-01-01'), kind: 'CFC', units: 5 }]
    });
    expect(unitsAt(p).complete).toBeUndefined();
  });
});

describe('isPopulation', () => {
  it('requires new construction and net units >= 1', () => {
    const p = proj({ permits: [permit('1')] });
    expect(isPopulation(p, 10, 3)).toBe(true);
    expect(isPopulation(p, 3, 3)).toBe(false);
    expect(isPopulation(p, null, 0)).toBe(false);
    expect(isPopulation(proj({ anchors: [prj('A')] }), 10, 0)).toBe(false);
  });

  it('keeps ppaOnly always, and pipelineOnly when newUnits >= 1', () => {
    expect(isPopulation(proj({ kind: 'ppaOnly' }), null, 0)).toBe(true);
    expect(isPopulation(proj({ kind: 'pipelineOnly' }), 5, 99)).toBe(true);
    expect(isPopulation(proj({ kind: 'pipelineOnly' }), 0, 0)).toBe(false);
    expect(isPopulation(proj({ kind: 'pipelineOnly' }), null, 0)).toBe(false);
  });
});

describe('inFlightStatus', () => {
  const CUTOFF = d('2026-07-28');
  const open = { kind: 'open' as const, lastObserved: d('2026-01-01') };
  const base = {
    inPopulation: true,
    end: open as ProjectHistory['end'] | null,
    units: 10 as number | null,
    existingLatest: 0,
    firstEntered: d('2020-01-01') as number | null,
    pipelineCutoff: CUTOFF,
    multiPhase: false
  };
  const withPipe = proj({ pipelineRows: [row()] });

  it('pipeline match: in flight however old', () => {
    expect(inFlightStatus(withPipe, base)).toBe('inFlight');
  });

  it('a DQ-2 linked row is a pipeline match (spec §4.7)', () => {
    const linked = proj({ pipelineRows: [row({ statusDay: null, linkedNoDate: true })] });
    expect(inFlightStatus(linked, base)).toBe('inFlight');
  });

  it('after-cutoff window: first entered 2026-04-28 is in, 2026-04-27 is stale', () => {
    const p = proj();
    expect(inFlightStatus(p, { ...base, firstEntered: d('2026-04-28') })).toBe('inFlight');
    expect(inFlightStatus(p, { ...base, firstEntered: d('2026-04-27') })).toBe('staleOpen');
  });

  it('stale-open when first entered is null and no pipeline row', () => {
    expect(inFlightStatus(proj(), { ...base, firstEntered: null })).toBe('staleOpen');
  });

  it('conflict: a pipeline row on a project ending exit', () => {
    const exit: ProjectHistory['end'] = {
      kind: 'exit',
      stage: 'filed',
      reason: 'withdrawn',
      day: d('2026-01-01')
    };
    expect(pipelineConflict(withPipe, exit)).toBe(true);
    expect(inFlightStatus(withPipe, { ...base, end: exit })).toBe('ended');
    expect(pipelineConflict(withPipe, open)).toBe(false);
    expect(pipelineConflict(proj(), exit)).toBe(false);
    expect(pipelineConflict(withPipe, null)).toBe(false);
    expect(pipelineConflict(withPipe, { kind: 'complete', day: 5 })).toBe(true);
  });

  it('conflict: a stage mismatch alone is not a conflict (partner ruling, ended only)', () => {
    const at = (status: string | null) => proj({ pipelineRows: [row({ status })] });
    expect(pipelineConflict(at('PL Approved'), open)).toBe(false);
    expect(pipelineConflict(at('PL Filed'), open)).toBe(false);
    expect(pipelineConflict(at(null), open)).toBe(false);
    expect(pipelineConflict(at('PL Filed'), { kind: 'complete', day: 5 })).toBe(true);
  });

  it('pipeline-only rows have a null end and are in flight', () => {
    const p = proj({ kind: 'pipelineOnly', pipelineRows: [row()] });
    expect(inFlightStatus(p, { ...base, end: null })).toBe('inFlight');
  });

  it('checks in the stated order', () => {
    expect(inFlightStatus(withPipe, { ...base, inPopulation: false, units: null })).toBe(
      'notPopulation'
    );
    expect(inFlightStatus(proj(), { ...base, firstEntered: null, units: null })).toBe('staleOpen');
    expect(inFlightStatus(withPipe, { ...base, units: null })).toBe('noUnits');
    expect(inFlightStatus(withPipe, { ...base, units: 0 })).toBe('noUnits');
    const noParcels = proj({ pipelineRows: [row()], parcelIds: [] });
    expect(inFlightStatus(noParcels, { ...base, existingLatest: 99 })).toBe('noParcels');
  });

  it('net on latest roll: units 3, existing 3 -> netDropped, unless multiPhase', () => {
    expect(inFlightStatus(withPipe, { ...base, units: 3, existingLatest: 3 })).toBe('netDropped');
    expect(
      inFlightStatus(withPipe, { ...base, units: 3, existingLatest: 3, multiPhase: true })
    ).toBe('inFlight');
  });
});

describe('capacity (pr.units.capacity, spec 4.8)', () => {
  // Σ area x max(stories, 1) / MIN_GROSS_M2_PER_UNIT (10): 300 m² on 3 stories holds 90.
  const area = (id: string) => (id === '0001001' ? 300 : 0);
  const big = (over: Partial<Permit> = {}) =>
    permit('8500988', { stories: 3, proposedUnits: 5540, ...over });

  it('capacityOk: 5,540 units on 3 stories over 300 m² fail (limit 90); the limit itself passes', () => {
    expect(capacityOk(big(), ['0001001'], area)).toBe(false);
    expect(capacityOk(big({ proposedUnits: 91 }), ['0001001'], area)).toBe(false);
    expect(capacityOk(big({ proposedUnits: 90 }), ['0001001'], area)).toBe(true);
  });

  it('capacityOk: stories below 1 count as 1, the area sums over parcels', () => {
    expect(capacityOk(big({ stories: 0, proposedUnits: 31 }), ['0001001'], area)).toBe(false);
    expect(capacityOk(big({ stories: 0, proposedUnits: 30 }), ['0001001'], area)).toBe(true);
    const two = (id: string) => (id === 'a' || id === 'b' ? 150 : 0);
    expect(capacityOk(big({ proposedUnits: 90 }), ['a', 'b'], two)).toBe(true);
    expect(capacityOk(big({ proposedUnits: 91 }), ['a', 'b'], two)).toBe(false);
  });

  it('capacityOk: no check without recorded stories, without units or without parcels', () => {
    expect(capacityOk(big({ stories: null }), ['0001001'], area)).toBe(true);
    expect(capacityOk(big({ proposedUnits: null }), ['0001001'], area)).toBe(true);
    expect(capacityOk(big(), [], area)).toBe(true);
  });

  it('a failing permit has missing units: grossUnits falls through to the PRJ', () => {
    const p = proj({ permits: [big()], anchors: [prj('A', { unitsProp: 10 })] });
    expect(grossUnits(p)).toBe(5540);
    const capped = applyCapacity(p, area);
    expect(grossUnits(capped.proj)).toBe(10);
    expect(capped.capped).toBe(false);
    expect(capped.failing.map((q) => q.number)).toEqual(['8500988']);
    expect(capped.checked.map((q) => q.number)).toEqual(['8500988']);
  });

  it('only the failing permit loses its units; live and lead follow; the input is untouched', () => {
    const bad = big();
    const good = permit('2', { stories: 3, proposedUnits: 40 });
    const p = proj({ permits: [bad, good] });
    const capped = applyCapacity(p, area);
    expect(grossUnits(capped.proj)).toBe(40);
    expect(capped.proj.permits.map((q) => q.proposedUnits)).toEqual([null, 40]);
    expect(capped.proj.live.map((q) => q.proposedUnits)).toEqual([null, 40]);
    expect(capped.proj.lead?.proposedUnits).toBeNull();
    expect(capped.proj.lead?.number).toBe('8500988');
    expect(capped.original).toBe(p);
    expect(bad.proposedUnits).toBe(5540);
    expect(p.permits[0]).toBe(bad);
    // The failing permit's other fields are kept.
    expect(capped.proj.permits[0]).toMatchObject({ number: '8500988', stories: 3 });
  });

  it('no fallback unit source: the failing permit is capped at its lot capacity (8500988)', () => {
    // 289.7 m², 3 stories: floor(289.7 x 3 / 10) = 86.
    const lot = (id: string) => (id === '0001001' ? 289.7 : 0);
    const p = proj({ permits: [big()] });
    const capped = applyCapacity(p, lot);
    expect(capped.capped).toBe(true);
    expect(capped.failing.map((q) => q.number)).toEqual(['8500988']);
    expect(capped.failing[0].proposedUnits).toBe(5540);
    expect(capped.proj.permits.map((q) => q.proposedUnits)).toEqual([86]);
    expect(capped.proj.live.map((q) => q.proposedUnits)).toEqual([86]);
    expect(capped.proj.lead?.proposedUnits).toBe(86);
    expect(grossUnits(capped.proj)).toBe(86);
    expect(unitsAt(capped.proj)).toEqual({ permitFiled: 86 });
    expect(p.permits[0].proposedUnits).toBe(5540);
    // The capped value now fits.
    expect(capacityOk(capped.proj.permits[0], ['0001001'], lot)).toBe(true);
  });

  it('no fallback, two failing permits: both are capped', () => {
    const p = proj({
      permits: [big(), permit('9', { stories: 1, proposedUnits: 700 })]
    });
    const capped = applyCapacity(p, area);
    expect(capped.capped).toBe(true);
    expect(capped.failing.map((q) => q.number)).toEqual(['8500988', '9']);
    // 300 m² x 3 / 10 = 90; 300 m² x 1 / 10 = 30.
    expect(capped.proj.permits.map((q) => q.proposedUnits)).toEqual([90, 30]);
    expect(grossUnits(capped.proj)).toBe(120);
  });

  it('a pipeline row that is not DQ-2 linked, or another permit with units, is a fallback', () => {
    const withRow = proj({ permits: [big()], pipelineRows: [row({ newUnits: 12 })] });
    expect(applyCapacity(withRow, area).capped).toBe(false);
    expect(grossUnits(applyCapacity(withRow, area).proj)).toBe(12);
    const withPermit = proj({ permits: [big(), permit('2', { proposedUnits: 3 })] });
    expect(applyCapacity(withPermit, area).capped).toBe(false);
    const prjZero = proj({ permits: [big()], anchors: [prj('A', { unitsProp: 0 })] });
    expect(applyCapacity(prjZero, area).capped).toBe(true);
  });

  it('no stories, or no parcels: no check, the same project comes back', () => {
    const noStories = proj({ permits: [big({ stories: null })] });
    const a = applyCapacity(noStories, area);
    expect(a.proj).toBe(noStories);
    expect(a.failing).toEqual([]);
    expect(a.checked).toEqual([]);
    expect(grossUnits(a.proj)).toBe(5540);
    const noParcels = proj({ permits: [big()], parcelIds: [] });
    const b = applyCapacity(noParcels, area);
    expect(b.proj).toBe(noParcels);
    expect(b.checked).toEqual([]);
    expect(grossUnits(b.proj)).toBe(5540);
  });

  it('unitsAt.permitFiled follows: absent when no permit keeps units', () => {
    const p = proj({ permits: [big()], anchors: [prj('A', { unitsProp: 10 })] });
    expect(unitsAt(p)).toEqual({ filed: 10, permitFiled: 5540 });
    expect(unitsAt(applyCapacity(p, area).proj)).toEqual({ filed: 10 });
  });

  it('checked holds permits with stories and units, whether or not they fail', () => {
    const p = proj({
      permits: [
        big(),
        permit('2', { stories: 3, proposedUnits: 40 }),
        permit('3', { proposedUnits: 7 }),
        permit('4', { stories: 2 })
      ]
    });
    const capped = applyCapacity(p, area);
    expect(capped.checked.map((q) => q.number)).toEqual(['8500988', '2']);
    expect(capped.failing.map((q) => q.number)).toEqual(['8500988']);
  });
});

describe('shared parcels (pr.parcels.shared-existing, spec 4.8)', () => {
  const ID = 'pr.parcels.shared-existing';
  const units = (id: string): number => ({ L1: 2, L2: 5, L3: 0 })[id as 'L1'] ?? 0;

  function t3(id: string, first: string, parcelIds: string[], quality: string[] = []) {
    const base: InFlightProject = {
      id,
      label: null,
      parcelIds,
      pathway: 'discretionary',
      stage: 'filed',
      history: { filed: d(first) },
      units: 10,
      existingUnits: parcelIds.reduce((s, p) => s + units(p), 0),
      stories: null,
      storiesTier: null,
      multiPhase: false,
      phases: null,
      sources: [{ dataset: 'x', id }],
      quality
    };
    return base;
  }

  const by = (ps: InFlightProject[], id: string) => ps.find((p) => p.id === id)!;

  it('the earliest first day holds the parcel; the others get 0; all carry the id', () => {
    const out = shareExisting(
      [t3('B', '2021-01-01', ['L1']), t3('A', '2022-01-01', ['L1', 'L2'])],
      units
    );
    expect(by(out, 'B').existingUnits).toBe(2);
    expect(by(out, 'A').existingUnits).toBe(5);
    expect(by(out, 'B').quality).toEqual([ID]);
    expect(by(out, 'A').quality).toEqual([ID]);
  });

  it('a tie goes to the smallest id', () => {
    const out = shareExisting(
      [t3('PRJ:2', '2021-01-01', ['L1']), t3('BP:9', '2021-01-01', ['L1'])],
      units
    );
    expect(by(out, 'BP:9').existingUnits).toBe(2);
    expect(by(out, 'PRJ:2').existingUnits).toBe(0);
  });

  it('the first day is the minimum of the whole history, not the current stage', () => {
    const early = t3('Z', '2020-01-01', ['L1']);
    early.history = { filed: d('2020-01-01'), entitled: d('2024-01-01') };
    const out = shareExisting([t3('A', '2021-01-01', ['L1']), early], units);
    expect(by(out, 'Z').existingUnits).toBe(2);
    expect(by(out, 'A').existingUnits).toBe(0);
  });

  it('a shared parcel with 0 units marks nobody', () => {
    const ps = [t3('A', '2021-01-01', ['L3']), t3('B', '2022-01-01', ['L3'])];
    const out = shareExisting(ps, units);
    expect(out.map((p) => p.quality)).toEqual([[], []]);
    expect(out.map((p) => p.existingUnits)).toEqual([0, 0]);
  });

  it('a project on one shared and one unshared parcel carries the id', () => {
    const out = shareExisting(
      [t3('A', '2021-01-01', ['L1']), t3('B', '2022-01-01', ['L1', 'L2'])],
      units
    );
    expect(by(out, 'B').quality).toEqual([ID]);
    expect(by(out, 'B').existingUnits).toBe(5);
  });

  it('an unshared project keeps its value and quality; quality stays sorted', () => {
    const out = shareExisting(
      [
        t3('A', '2021-01-01', ['L2'], ['pr.stages.forward-clamp']),
        t3('B', '2021-01-01', ['L1'], ['pr.units.capacity']),
        t3('C', '2022-01-01', ['L1'], ['pr.units.capacity'])
      ],
      units
    );
    expect(by(out, 'A')).toMatchObject({ existingUnits: 5, quality: ['pr.stages.forward-clamp'] });
    expect(by(out, 'B').quality).toEqual([ID, 'pr.units.capacity']);
    expect(by(out, 'C').quality).toEqual([ID, 'pr.units.capacity']);
  });

  it('a score-only master (no parcels) is untouched; a phased master holds by its parcelIds', () => {
    const score = { ...t3('S', '2019-01-01', []), multiPhase: true };
    const master = { ...t3('M', '2020-01-01', ['L1', 'L2']), multiPhase: true };
    const out = shareExisting([score, master, t3('A', '2021-01-01', ['L2'])], units);
    expect(by(out, 'S')).toMatchObject({ existingUnits: 0, quality: [] });
    expect(by(out, 'M').existingUnits).toBe(7);
    expect(by(out, 'A').existingUnits).toBe(0);
  });

  it('does not mutate its input and leaves untouched projects identical', () => {
    const ps = [
      t3('A', '2021-01-01', ['L1']),
      t3('B', '2022-01-01', ['L1']),
      t3('C', '2022-01-01', ['L2'])
    ];
    const before = JSON.stringify(ps);
    const out = shareExisting(ps, units);
    expect(JSON.stringify(ps)).toBe(before);
    expect(out[2]).toBe(ps[2]);
  });
});
