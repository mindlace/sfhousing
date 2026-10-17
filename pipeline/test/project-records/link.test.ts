import { describe, expect, it } from 'vitest';
import { DEAD_STATUSES, linkProjects, type LinkedProject } from '../../project-records/link';
import type {
  AddressRow,
  Child,
  Completion,
  Parsed,
  Permit,
  PipelineRow,
  Prj,
  Review
} from '../../project-records/types';
import type { Day } from '../../../src/lib/timelapse/time';

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 864e5;
const ASOF = day(2026, 10, 16);

function rows(...blklots: (string | null)[]): AddressRow[] {
  return blklots.map((blklot, i) => ({
    blklot,
    streetNumber: null,
    streetName: null,
    streetSuffix: null,
    primary: i === 0
  }));
}

function permit(number: string, over: Partial<Permit> = {}): Permit {
  return {
    number,
    sitePermit: true,
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
    rows: rows('3512001'),
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

type RowIn = Partial<Omit<PipelineRow, 'idx' | 'prx'>>;

function parsedOf(o: {
  permits?: Permit[];
  prjs?: Prj[];
  children?: Child[];
  reviews?: Review[];
  completions?: Completion[];
  pipeline?: RowIn[];
}): Parsed {
  const byKey = <T>(xs: T[], key: (x: T) => string) =>
    new Map([...xs].sort((a, b) => (key(a) < key(b) ? -1 : 1)).map((x) => [key(x), x]));
  return {
    asOf: ASOF,
    permits: byKey(o.permits ?? [], (x) => x.number),
    prjs: byKey(o.prjs ?? [], (x) => x.recordId),
    children: o.children ?? [],
    reviews: o.reviews ?? [],
    completions: o.completions ?? [],
    housing: [],
    pipeline: (o.pipeline ?? []).map((r, idx) => ({
      idx,
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
      ...r,
      prx: r.caseNo != null && r.caseNo.endsWith('PRX')
    })),
    counts: {}
  };
}

/** Condo sub-lots 3512101..103 map to 3512002; everything else maps to itself. */
const CONDO: Record<string, string> = { '3512101': '3512002', '3512102': '3512002' };
const resolve = (b: string[]) => [...new Set(b.map((x) => CONDO[x] ?? x))].sort();

/** Stand-in for Task 5's filedEvidenceDay: min of anchor opens and permit filed days. */
function filedDay(proj: LinkedProject): Day | null {
  const ds = [...proj.anchors.map((a) => a.openDay), ...proj.permits.map((q) => q.filedDay)].filter(
    (d): d is Day => d !== null
  );
  return ds.length ? Math.min(...ds) : null;
}

const link = (p: Parsed) => linkProjects(p, { resolve, filedDay });
const ids = (r: ReturnType<typeof link>) => r.projects.map((x) => x.id);
const byId = (r: ReturnType<typeof link>, id: string) => {
  const proj = r.projects.find((x) => x.id === id);
  if (!proj) throw new Error(`no project ${id}`);
  return proj;
};
const nums = (ps: Permit[]) => ps.map((q) => q.number);

describe('DEAD_STATUSES', () => {
  it('lists the five dead permit statuses', () => {
    expect([...DEAD_STATUSES].sort()).toEqual([
      'cancelled',
      'disapproved',
      'expired',
      'revoked',
      'withdrawn'
    ]);
  });
});

describe('PRJ to permit assignment', () => {
  const twoPrjs = (filed: Day) =>
    parsedOf({
      permits: [
        permit('P1', { filedDay: filed }),
        permit('PA', { filedDay: day(2018, 2, 1) }),
        permit('PB', { filedDay: day(2019, 3, 5) })
      ],
      prjs: [
        prj('A', { openDay: day(2018, 1, 1), permits: ['PA', 'P1'] }),
        prj('B', { openDay: day(2019, 3, 1), permits: ['P1', 'PB'] })
      ]
    });

  it('assigns a shared permit to the latest PRJ opened on or before its filing', () => {
    const r = link(twoPrjs(day(2019, 4, 1)));
    expect(ids(r)).toEqual(['PRJ:A', 'PRJ:B']);
    expect(nums(byId(r, 'PRJ:A').permits)).toEqual(['PA']);
    expect(nums(byId(r, 'PRJ:B').permits)).toEqual(['P1', 'PB']);
    expect(r.counts['link.permitsMultiPrj']).toBe(1);
    expect(r.counts['link.satellites']).toBe(0);
  });

  it('assigns it to the earliest-opened PRJ when none opened before the filing', () => {
    const r = link(twoPrjs(day(2017, 6, 1)));
    expect(nums(byId(r, 'PRJ:A').permits)).toEqual(['P1', 'PA']);
    expect(nums(byId(r, 'PRJ:B').permits)).toEqual(['PB']);
  });
});

describe('satellites', () => {
  it('makes a PRJ that loses its only permit a source-only satellite of one project', () => {
    const r = link(
      parsedOf({
        permits: [permit('P1', { filedDay: day(2019, 4, 1) })],
        prjs: [
          prj('A', { openDay: day(2018, 1, 1), permits: ['P1'], blklot: '3512777' }),
          prj('B', { openDay: day(2019, 3, 1), permits: ['P1'] })
        ],
        children: [
          child('A-ENV', { type: 'ENV', parentId: 'A' }),
          child('B-ENV', { type: 'ENV', parentId: 'B' })
        ],
        reviews: [{ recordId: 'A', startType: null, startDay: null, endType: null, endDay: null }]
      })
    );
    expect(ids(r)).toEqual(['PRJ:B']);
    const p = r.projects[0];
    expect(p.anchors.map((x) => x.recordId)).toEqual(['B']);
    expect(p.satellites.map((x) => x.recordId)).toEqual(['A']);
    expect(p.primary?.recordId).toBe('B');
    expect(p.children.map((c) => c.recordId)).toEqual(['B-ENV']);
    expect(p.sourceOnlyChildren.map((c) => c.recordId)).toEqual(['A-ENV']);
    expect(p.reviews).toEqual([]);
    expect(p.blklots).toEqual(['3512001']); // satellite blklot is not a candidate
    expect(r.counts['link.satellites']).toBe(1);
  });
});

describe('PPAs', () => {
  const X_OPEN = day(2019, 1, 15);
  const base = (extra: Child[]) =>
    parsedOf({
      prjs: [prj('X', { openDay: X_OPEN, blklot: '3512010' })],
      children: [
        child('PPA-PARENTED', { parentId: 'X', openDay: day(2018, 11, 1), blklot: '3512010' }),
        ...extra
      ]
    });

  it('joins a parented PPA and attaches an unparented one within ppaLag', () => {
    const r = link(
      base([
        child('U-IN', { openDay: day(2018, 12, 1), blklot: '3512010' }),
        child('U-MISSING-PARENT', {
          parentId: 'NOPE',
          openDay: day(2018, 12, 15),
          blklot: '3512010'
        }),
        child('U-OUT', { openDay: day(2018, 9, 1), blklot: '3512010' })
      ])
    );
    expect(r.ppaLag).toEqual({ days: 75, n: 1 });
    expect(ids(r)).toEqual(['PPA:U-OUT', 'PRJ:X']);
    expect(byId(r, 'PRJ:X').children.map((c) => c.recordId)).toEqual([
      'PPA-PARENTED',
      'U-IN',
      'U-MISSING-PARENT'
    ]);
    const only = byId(r, 'PPA:U-OUT');
    expect(only.kind).toBe('ppaOnly');
    expect(only.children.map((c) => c.recordId)).toEqual(['U-OUT']);
    expect(only.blklots).toEqual(['3512010']);
    expect(only.parcelIds).toEqual(['3512010']);
    expect(only.primary).toBeNull();
    expect(r.counts['link.ppaAttached']).toBe(2);
    expect(r.counts['link.ppaOnly']).toBe(1);
  });

  it('does not attach a PPA on another lot, or one opened after the filing', () => {
    const r = link(
      base([
        child('U-LOT', { openDay: day(2018, 12, 1), blklot: '3512099' }),
        child('U-AFTER', { openDay: day(2019, 2, 1), blklot: '3512010' })
      ])
    );
    expect(ids(r)).toEqual(['PPA:U-AFTER', 'PPA:U-LOT', 'PRJ:X']);
  });

  it('attaches through a resolved parcel (condo sub-lot)', () => {
    const r = link(
      parsedOf({
        prjs: [prj('X', { openDay: X_OPEN, blklot: '3512002' })],
        children: [child('U', { openDay: day(2019, 1, 1), blklot: '3512101' })]
      })
    );
    expect(ids(r)).toEqual(['PRJ:X']);
    expect(r.ppaLag).toEqual({ days: Infinity, n: 0 });
  });

  it('prefers the earliest-filed qualifying project, then the lowest id', () => {
    const r = link(
      parsedOf({
        prjs: [
          prj('A', { openDay: day(2019, 1, 20), blklot: '3512010' }),
          prj('B', { openDay: day(2019, 1, 10), blklot: '3512010' }),
          prj('C', { openDay: day(2019, 1, 10), blklot: '3512010' })
        ],
        children: [child('U', { openDay: day(2019, 1, 1), blklot: '3512010' })]
      })
    );
    expect(byId(r, 'PRJ:B').children.map((c) => c.recordId)).toEqual(['U']);
    expect(byId(r, 'PRJ:A').children).toEqual([]);
    expect(byId(r, 'PRJ:C').children).toEqual([]);
  });

  it('computes ppaLag as the nearest-rank 90th percentile of filed - PPA open', () => {
    const prjs: Prj[] = [];
    const children: Child[] = [];
    for (let i = 1; i <= 10; i++) {
      const open = day(2020, 1, 1) + i * 1000;
      prjs.push(prj(`R${String(i).padStart(2, '0')}`, { openDay: open }));
      children.push(child(`Q${i}`, { parentId: prjs[i - 1].recordId, openDay: open - i * 10 }));
    }
    expect(link(parsedOf({ prjs, children })).ppaLag).toEqual({ days: 90, n: 10 });
    expect(link(parsedOf({ prjs })).ppaLag).toEqual({ days: Infinity, n: 0 });
  });
});

describe('splits', () => {
  it('splits a component with two pipeline rows into one project per named permit', () => {
    const r = link(
      parsedOf({
        permits: [
          permit('P0', { status: 'withdrawn', filedDay: day(2018, 1, 1), rows: rows('3512001') }),
          permit('P1', { filedDay: day(2019, 1, 1), rows: rows('3512001') }),
          permit('P2', { filedDay: day(2019, 2, 1), rows: rows('3512002') }),
          permit('P3', { filedDay: day(2019, 3, 1), rows: rows('3512003') })
        ],
        prjs: [prj('X', { openDay: day(2017, 1, 1), permits: ['P0', 'P1', 'P2', 'P3'] })],
        children: [child('X-ENV', { type: 'ENV', parentId: 'X' })],
        pipeline: [
          { caseNo: 'X', bpaNo: 'P1', blklot: '3512001' },
          { caseNo: 'X', bpaNo: 'P2', blklot: '3512002' }
        ]
      })
    );
    expect(ids(r)).toEqual(['PRJ:X:BP:P1', 'PRJ:X:BP:P2', 'PRJ:X:BP:P3']);
    const p1 = byId(r, 'PRJ:X:BP:P1');
    expect(nums(p1.permits)).toEqual(['P0', 'P1']);
    expect([...p1.superseded]).toEqual(['P0']);
    expect(nums(p1.live)).toEqual(['P1']);
    expect(p1.pipelineRows.map((x) => x.idx)).toEqual([0]);
    expect(nums(byId(r, 'PRJ:X:BP:P2').permits)).toEqual(['P2']);
    expect(byId(r, 'PRJ:X:BP:P2').pipelineRows.map((x) => x.idx)).toEqual([1]);
    const p3 = byId(r, 'PRJ:X:BP:P3');
    expect(nums(p3.permits)).toEqual(['P3']);
    expect(p3.pipelineRows).toEqual([]);
    for (const p of r.projects) {
      expect(p.anchors.map((a) => a.recordId)).toEqual(['X']);
      expect(p.children.map((c) => c.recordId)).toEqual(['X-ENV']);
    }
    expect(r.counts['link.splitComponents']).toBe(1);
  });

  it('keeps a remainder without permits as PRJ:<id> holding the case-only row', () => {
    const r = link(
      parsedOf({
        permits: [permit('P1', { filedDay: day(2019, 1, 1) })],
        prjs: [prj('X', { openDay: day(2017, 1, 1), permits: ['P1'] })],
        pipeline: [{ caseNo: 'X', bpaNo: 'P1' }, { caseNo: 'X' }]
      })
    );
    expect(ids(r)).toEqual(['PRJ:X', 'PRJ:X:BP:P1']);
    expect(byId(r, 'PRJ:X').permits).toEqual([]);
    expect(byId(r, 'PRJ:X').pipelineRows.map((x) => x.idx)).toEqual([1]);
  });

  it('does not split when every row names the same permit', () => {
    const r = link(
      parsedOf({
        permits: [permit('P1')],
        prjs: [prj('X', { permits: ['P1'] })],
        pipeline: [
          { caseNo: 'X', bpaNo: 'P1' },
          { caseNo: 'X', bpaNo: 'P1' }
        ]
      })
    );
    expect(ids(r)).toEqual(['PRJ:X']);
    expect(byId(r, 'PRJ:X').pipelineRows).toHaveLength(2);
    expect(r.counts['link.splitComponents']).toBe(0);
  });
});

describe('ids and pipeline rows', () => {
  it('produces all five id forms', () => {
    const r = link(
      parsedOf({
        permits: [
          permit('P1'),
          permit('P2'),
          permit('P3'),
          permit('P9', { filedDay: day(2014, 10, 7) })
        ],
        prjs: [prj('S', { permits: ['P1', 'P2'] }), prj('T', { permits: ['P3'] })],
        children: [child('U', { openDay: day(2020, 1, 1), blklot: '3512050' })],
        pipeline: [
          { caseNo: 'S', bpaNo: 'P1' },
          { caseNo: 'S', bpaNo: 'P2' },
          { caseNo: '2007.0001PRX', blklot: '3512014' }
        ]
      })
    );
    expect(ids(r)).toEqual([
      'BP:P9',
      'CASE:2007.0001PRX',
      'PPA:U',
      'PRJ:S:BP:P1',
      'PRJ:S:BP:P2',
      'PRJ:T'
    ]);
    expect(byId(r, 'BP:P9').kind).toBe('graph');
    expect(byId(r, 'BP:P9').primary).toBeNull();
    const c = byId(r, 'CASE:2007.0001PRX');
    expect(c.kind).toBe('pipelineOnly');
    expect(c.blklots).toEqual(['3512014']);
    expect(r.counts['link.pipelineOnly']).toBe(1);
  });

  it('gives a PRX row its own CASE project even when it matches a PRJ id', () => {
    const r = link(
      parsedOf({
        prjs: [prj('2010.0002')],
        pipeline: [{ caseNo: '2010.0002PRX' }, { caseNo: '2010.0002' }]
      })
    );
    expect(ids(r)).toEqual(['CASE:2010.0002PRX', 'PRJ:2010.0002']);
    expect(byId(r, 'PRJ:2010.0002').pipelineRows.map((x) => x.idx)).toEqual([1]);
  });

  it('joins a PRX row whose bpa_no names a fetched permit to that permit project', () => {
    const r = link(
      parsedOf({
        permits: [permit('P1')],
        prjs: [prj('A', { permits: ['P1'] })],
        pipeline: [{ caseNo: '2023-010914PRX', bpaNo: 'P1', blklot: '3512001' }]
      })
    );
    expect(ids(r)).toEqual(['PRJ:A']);
    const a = byId(r, 'PRJ:A');
    expect(a.kind).toBe('graph');
    expect(a.pipelineRows.map((x) => x.caseNo)).toEqual(['2023-010914PRX']);
    expect(r.counts['link.pipelineOnly']).toBe(0);
    expect(r.excludedRows).toEqual([]);
  });

  it('keeps a PRX row whose bpa_no names no fetched permit a CASE project', () => {
    const r = link(
      parsedOf({
        permits: [permit('P1')],
        pipeline: [{ caseNo: '2023-010956PRX', bpaNo: 'X999', blklot: '3512002' }]
      })
    );
    expect(ids(r)).toEqual(['BP:P1', 'CASE:2023-010956PRX']);
    expect(byId(r, 'CASE:2023-010956PRX').kind).toBe('pipelineOnly');
    expect(r.excludedRows).toEqual([]);
    expect(r.counts['link.pipelineOnly']).toBe(1);
  });

  it('treats a row whose bpa_no resolves to nothing as an excluded alteration', () => {
    const r = link(parsedOf({ pipeline: [{ bpaNo: 'X999', newUnits: 1 }] }));
    expect(r.projects).toEqual([]);
    expect(r.excludedRows.map((x) => x.bpaNo)).toEqual(['X999']);
    expect(r.counts['link.excludedRows']).toBe(1);
  });

  it('makes a non-PRX row with an unresolved case and no bpa_no pipeline-only', () => {
    const r = link(parsedOf({ pipeline: [{ caseNo: '2015-000001PRJ' }] }));
    expect(ids(r)).toEqual(['CASE:2015-000001PRJ']);
    expect(r.excludedRows).toEqual([]);
  });

  it('joins a row by case and bpa_no, merging their components', () => {
    const r = link(
      parsedOf({
        permits: [permit('P1'), permit('P2', { rows: rows('3512002', null) })],
        prjs: [prj('A', { permits: ['P1'], blklot: '3512003' })],
        pipeline: [{ caseNo: 'A', bpaNo: 'P2', blklot: '3512004' }]
      })
    );
    expect(ids(r)).toEqual(['PRJ:A']);
    const p = r.projects[0];
    expect(nums(p.permits)).toEqual(['P1', 'P2']);
    expect(p.blklots).toEqual(['3512001', '3512002', '3512003', '3512004']);
    expect(p.parcelIds).toEqual(['3512001', '3512002', '3512003', '3512004']);
  });

  it('throws on a duplicate project id', () => {
    expect(() =>
      link(parsedOf({ pipeline: [{ caseNo: '2007.0001PRX' }, { caseNo: '2007.0001PRX' }] }))
    ).toThrow('duplicate project id CASE:2007.0001PRX');
  });
});

describe('live set, superseded and lead', () => {
  it('supersedes a withdrawn permit refiled later', () => {
    const r = link(
      parsedOf({
        permits: [
          permit('A', { status: 'withdrawn', filedDay: day(2020, 1, 10) }),
          permit('B', { status: 'filed', filedDay: day(2022, 3, 1) })
        ],
        prjs: [prj('M10', { permits: ['A', 'B'] })]
      })
    );
    const p = byId(r, 'PRJ:M10');
    expect([...p.superseded]).toEqual(['A']);
    expect(nums(p.live)).toEqual(['B']);
    expect(p.lead?.number).toBe('B');
  });

  it('does not supersede a dead permit with no later-filed permit', () => {
    const r = link(
      parsedOf({
        permits: [
          permit('A', { status: 'expired', filedDay: day(2022, 1, 1) }),
          permit('B', { filedDay: day(2020, 1, 1) }),
          permit('C', { filedDay: null })
        ],
        prjs: [prj('X', { permits: ['A', 'B', 'C'] })]
      })
    );
    const p = r.projects[0];
    expect([...p.superseded]).toEqual([]);
    expect(nums(p.live)).toEqual(['B', 'C']);
  });

  it('picks the lead by site permit, units, filed day, then number', () => {
    const lead = (ps: Permit[]) =>
      link(parsedOf({ permits: ps, prjs: [prj('X', { permits: nums(ps) })] })).projects[0].lead
        ?.number;
    expect(lead([permit('A', { sitePermit: false, proposedUnits: 99 }), permit('B')])).toBe('B');
    expect(lead([permit('A', { proposedUnits: null }), permit('B', { proposedUnits: 3 })])).toBe(
      'B'
    );
    expect(
      lead([permit('A', { filedDay: null }), permit('B', { filedDay: day(2020, 1, 1) })])
    ).toBe('B');
    expect(lead([permit('B'), permit('A')])).toBe('A');
    // an all-dead project picks its lead from every permit
    expect(
      lead([
        permit('A', { status: 'cancelled', proposedUnits: 2 }),
        permit('B', { status: 'revoked', proposedUnits: 5 })
      ])
    ).toBe('B');
  });

  it('chooses as primary the anchor the lead permit is assigned to', () => {
    const r = link(
      parsedOf({
        permits: [permit('P1', { filedDay: day(2020, 6, 1) }), permit('P2', { sitePermit: false })],
        prjs: [
          prj('A', { openDay: day(2019, 1, 1), permits: ['P2'] }),
          prj('B', { openDay: day(2020, 1, 1), permits: ['P1'] })
        ],
        pipeline: [{ caseNo: 'A', bpaNo: 'P1' }]
      })
    );
    expect(ids(r)).toEqual(['PRJ:B']);
    expect(r.projects[0].anchors.map((a) => a.recordId)).toEqual(['A', 'B']);
  });
});

describe('joins', () => {
  it('joins reviews of anchors and completions of the project permits', () => {
    const review: Review = {
      recordId: 'X',
      startType: null,
      startDay: day(2019, 1, 20),
      endType: 'approval',
      endDay: day(2020, 3, 2)
    };
    const r = link(
      parsedOf({
        permits: [permit('P1')],
        prjs: [prj('X', { permits: ['P1'] })],
        reviews: [review, { ...review, recordId: 'Y' }],
        completions: [
          { permit: 'P1', day: day(2021, 1, 1), kind: 'TCO', units: 4 },
          { permit: 'P7', day: day(2021, 1, 1), kind: 'TCO', units: 4 }
        ]
      })
    );
    const p = r.projects[0];
    expect(p.reviews).toEqual([review]);
    expect(p.completions.map((c) => c.permit)).toEqual(['P1']);
  });
});
