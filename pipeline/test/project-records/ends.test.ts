import { describe, expect, it } from 'vitest';
import { endOf, lastObserved } from '../../project-records/ends';
import { DEAD_STATUSES } from '../../project-records/link';
import { clampStages, rawStages } from '../../project-records/stages';
import type {
  Child,
  LinkedProject,
  Permit,
  PipelineRow,
  Prj,
  Review
} from '../../project-records/types';
import type { Stage } from '../../../src/lib/timelapse/types';
import type { Day } from '../../../src/lib/timelapse/time';

function d(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

const ASOF = d('2026-10-10');
const CTX = { asOf: ASOF, ppaLag: 100 };

function permit(number: string, over: Partial<Permit> = {}): Permit {
  return {
    number,
    type: '2',
    named: false,
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
    valuation: null,
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
    affordableProp: null,
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

function pipelineRow(statusDay: Day | null): PipelineRow {
  return {
    idx: 0,
    blklot: null,
    nameaddr: null,
    status: null,
    statusDay,
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
    prx: false
  };
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
    parcelIds: [],
    crossBlock: { applies: false, dropped: [] },
    ...over
  };
}

function entered(spec: Partial<Record<Stage, string>>): Partial<Record<Stage, Day>> {
  const out: Partial<Record<Stage, Day>> = {};
  for (const [k, v] of Object.entries(spec)) out[k as Stage] = d(v);
  return out;
}

const E = entered({ filed: '2016-01-01', entitled: '2016-03-01', permitFiled: '2016-04-01' });

describe('endOf rule 1: complete', () => {
  it('ends complete at entered.complete', () => {
    const p = proj({ permits: [permit('1', { status: 'complete' })] });
    const e = entered({ filed: '2016-01-01', complete: '2018-01-01' });
    expect(endOf(p, e, CTX)).toEqual({ kind: 'complete', day: d('2018-01-01') });
  });

  it('is not undone by a later cancelled permit', () => {
    const p = proj({
      permits: [permit('1', { status: 'cancelled', statusDay: d('2019-01-01') })]
    });
    const e = entered({ filed: '2016-01-01', complete: '2018-01-01' });
    expect(endOf(p, e, CTX)).toEqual({ kind: 'complete', day: d('2018-01-01') });
  });
});

describe('endOf rule 2: permit exit', () => {
  const cases: [string, string][] = [
    ['withdrawn', 'withdrawn'],
    ['cancelled', 'cancelled'],
    ['revoked', 'cancelled'],
    ['expired', 'expired'],
    ['disapproved', 'disapproved']
  ];
  for (const [status, reason] of cases) {
    it(`${status} permit exits as ${reason} at its status day`, () => {
      const p = proj({ permits: [permit('1', { status, statusDay: d('2016-06-15') })] });
      expect(endOf(p, E, CTX)).toEqual({
        kind: 'exit',
        stage: 'permitFiled',
        reason,
        day: d('2016-06-15')
      });
    });
  }

  it('lets the latest status day decide, then the highest number', () => {
    const p = proj({
      permits: [
        permit('100', { status: 'withdrawn', statusDay: d('2016-06-15') }),
        permit('200', { status: 'expired', statusDay: d('2016-06-15') }),
        permit('300', { status: 'cancelled', statusDay: d('2016-05-01') })
      ]
    });
    expect(endOf(p, E, CTX)).toEqual({
      kind: 'exit',
      stage: 'permitFiled',
      reason: 'expired',
      day: d('2016-06-15')
    });
  });

  it('uses lastObserved for a null status day', () => {
    const p = proj({
      permits: [
        permit('1', { status: 'withdrawn', statusDay: null, lastActivityDay: d('2016-07-01') })
      ]
    });
    expect(endOf(p, E, CTX)).toEqual({
      kind: 'exit',
      stage: 'permitFiled',
      reason: 'withdrawn',
      day: d('2016-07-01')
    });
  });

  it('does not exit while a live permit remains', () => {
    const p = proj({
      permits: [
        permit('1', { status: 'withdrawn', statusDay: d('2016-06-15') }),
        permit('2', { status: 'issued' })
      ]
    });
    expect(endOf(p, E, CTX).kind).toBe('open');
  });

  it('a live permit beats a PRJ Closed - Withdrawn', () => {
    const p = proj({
      anchors: [prj('R1', { status: 'Closed - Withdrawn', closeDay: d('2016-05-01') })],
      permits: [permit('1', { status: 'issued' })]
    });
    expect(endOf(p, E, CTX).kind).toBe('open');
  });

  it('clamps an exit day earlier than the stage entry to the entry', () => {
    const p = proj({
      permits: [permit('1', { status: 'withdrawn', statusDay: d('2015-01-01') })]
    });
    expect(endOf(p, entered({ filed: '2016-01-01' }), CTX)).toEqual({
      kind: 'exit',
      stage: 'filed',
      reason: 'withdrawn',
      day: d('2016-01-01')
    });
  });

  it('takes the latest entered stage on or before the exit day', () => {
    const p = proj({ permits: [permit('1', { status: 'expired', statusDay: d('2016-03-15') })] });
    const e = entered({ filed: '2016-01-01', entitled: '2016-03-01' });
    expect(endOf(p, e, CTX)).toMatchObject({ kind: 'exit', stage: 'entitled' });
  });

  it('exit before later entered stages moves to the last stage', () => {
    const p = proj({ permits: [permit('1', { status: 'withdrawn', statusDay: 6648 })] });
    const e: Partial<Record<Stage, Day>> = { filed: 6000, entitled: 6678, permitFiled: 6678 };
    expect(endOf(p, e, CTX)).toEqual({
      kind: 'exit',
      stage: 'permitFiled',
      reason: 'withdrawn',
      day: 6678
    });
  });
});

describe('endOf rule 2 after rawStages (Ruling E1: dead issued permits exit at their stage)', () => {
  function endAfterStages(p: LinkedProject) {
    const { entered: e } = clampStages(rawStages(p, 'permitOnly'));
    return { entered: e, end: endOf(p, e, CTX) };
  }

  it('an issued, then expired, permit exits expired at permitIssued on its status day', () => {
    const p = proj({
      permits: [
        permit('1', {
          status: 'expired',
          statusDay: d('2022-05-01'),
          sitePermit: true,
          filedDay: d('2018-03-01'),
          issuedDay: d('2019-04-01')
        })
      ]
    });
    const { entered: e, end } = endAfterStages(p);
    expect(e.permitIssued).toBe(d('2019-04-01'));
    expect(end).toEqual({
      kind: 'exit',
      stage: 'permitIssued',
      reason: 'expired',
      day: d('2022-05-01')
    });
  });

  it('a site permit with an FCD, then cancelled, exits cancelled at construction', () => {
    const p = proj({
      permits: [
        permit('1', {
          status: 'cancelled',
          statusDay: d('2021-06-01'),
          sitePermit: true,
          filedDay: d('2017-02-01'),
          issuedDay: d('2018-01-10'),
          fcdDay: d('2018-03-01')
        })
      ]
    });
    expect(endAfterStages(p).end).toEqual({
      kind: 'exit',
      stage: 'construction',
      reason: 'cancelled',
      day: d('2021-06-01')
    });
  });

  it('a superseded issued permit does not lift the exit past the refile’s stage', () => {
    const old = permit('1', {
      status: 'expired',
      statusDay: d('2016-01-01'),
      filedDay: d('2015-01-01'),
      issuedDay: d('2015-06-01')
    });
    const refile = permit('2', {
      status: 'withdrawn',
      statusDay: d('2019-01-01'),
      filedDay: d('2018-01-01')
    });
    const p = proj({ permits: [old, refile], superseded: new Set(['1']) });
    expect(endAfterStages(p).end).toEqual({
      kind: 'exit',
      stage: 'permitFiled',
      reason: 'withdrawn',
      day: d('2019-01-01')
    });
  });
});

describe('endOf rule 3: planning exit', () => {
  const E2 = entered({ filed: '2016-01-01', entitled: '2016-03-01' });
  const statusCases: [string | null, string | null, string][] = [
    ['Closed - Withdrawn', null, 'withdrawn'],
    ['Withdrawn', null, 'withdrawn'],
    ['Project Withdrawn', null, 'withdrawn'],
    [null, 'Withdawn', 'withdrawn'],
    [null, 'Withdrawn', 'withdrawn'],
    ['Closed - Cancelled', null, 'cancelled'],
    ['Cancelled', null, 'cancelled'],
    [null, 'Cancelled', 'cancelled'],
    ['Disapproved', null, 'disapproved'],
    ['Closed - Disapproved', null, 'disapproved'],
    ['Denied', null, 'disapproved'],
    [null, 'Disapproved', 'disapproved']
  ];
  for (const [status, decision, reason] of statusCases) {
    it(`status ${status} / decision ${decision} -> ${reason}`, () => {
      const p = proj({
        anchors: [prj('R1', { status, decision, closeDay: d('2016-05-01') })]
      });
      expect(endOf(p, E2, CTX)).toEqual({
        kind: 'exit',
        stage: 'entitled',
        reason,
        day: d('2016-05-01')
      });
    });
  }

  it('dates by decision day, then close day, then lastObserved', () => {
    const a = proj({
      anchors: [
        prj('R1', {
          status: 'Withdrawn',
          decisionDay: d('2016-04-01'),
          closeDay: d('2016-05-01')
        })
      ]
    });
    expect(endOf(a, E2, CTX)).toMatchObject({ day: d('2016-04-01') });
    const b = proj({ anchors: [prj('R1', { status: 'Withdrawn', openDay: d('2016-06-01') })] });
    expect(endOf(b, E2, CTX)).toMatchObject({ day: d('2016-06-01') });
  });

  it('lets the first matching anchor in recordId order decide', () => {
    const p = proj({
      anchors: [
        prj('R2', { status: 'Cancelled', closeDay: d('2016-05-01') }),
        prj('R1', { status: 'Withdrawn', closeDay: d('2016-06-01') })
      ]
    });
    expect(endOf(p, E2, CTX)).toMatchObject({ reason: 'withdrawn', day: d('2016-06-01') });
  });

  it('does not apply when the project has permits', () => {
    const p = proj({
      anchors: [prj('R1', { status: 'Closed - Withdrawn', closeDay: d('2016-05-01') })],
      permits: [permit('1', { status: 'issued' })]
    });
    expect(endOf(p, E2, CTX).kind).toBe('open');
  });

  it('does not match near-miss strings', () => {
    const p = proj({ anchors: [prj('R1', { status: 'closed - withdrawn' })] });
    expect(endOf(p, E2, CTX).kind).toBe('open');
  });
});

describe('endOf rule 4: closed without a decision', () => {
  it('withdraws at the latest close day, in the stage it was in (M13)', () => {
    const p = proj({
      anchors: [
        prj('R1', { status: 'Closed', closeDay: d('2016-04-01') }),
        prj('R2', { status: 'Closed', closeDay: d('2016-05-02') })
      ]
    });
    expect(endOf(p, entered({ filed: '2015-12-01' }), CTX)).toEqual({
      kind: 'exit',
      stage: 'filed',
      reason: 'withdrawn',
      day: d('2016-05-02')
    });
  });

  it('stays open when an approval (entitled) date exists', () => {
    const p = proj({ anchors: [prj('R1', { status: 'Closed', closeDay: d('2016-05-02') })] });
    const e = entered({ filed: '2015-12-01', entitled: '2016-02-01' });
    expect(endOf(p, e, CTX)).toEqual({ kind: 'open', lastObserved: d('2016-05-02') });
  });

  it('stays open when a project decision exists', () => {
    const p = proj({
      anchors: [prj('R1', { status: 'Closed', decision: 'Approved', closeDay: d('2016-05-02') })]
    });
    expect(endOf(p, entered({ filed: '2015-12-01' }), CTX).kind).toBe('open');
  });

  it('needs every anchor Closed and the project permitless', () => {
    const mixed = proj({
      anchors: [prj('R1', { status: 'Closed' }), prj('R2', { status: 'Open' })]
    });
    expect(endOf(mixed, entered({ filed: '2015-12-01' }), CTX).kind).toBe('open');
    const withPermit = proj({
      anchors: [prj('R1', { status: 'Closed', closeDay: d('2016-05-02') })],
      permits: [permit('1')]
    });
    expect(endOf(withPermit, entered({ filed: '2015-12-01' }), CTX).kind).toBe('open');
  });
});

describe('endOf rule 5: PPA-only', () => {
  function ppaProj(c: Partial<Child>): LinkedProject {
    return proj({ kind: 'ppaOnly', children: [child('PPA1', c)] });
  }

  it('Closed - Withdrawn withdraws at close', () => {
    const p = ppaProj({
      status: 'Closed - Withdrawn',
      openDay: d('2026-09-01'),
      closeDay: d('2026-09-20')
    });
    expect(endOf(p, entered({ preApplication: '2026-09-01' }), CTX)).toEqual({
      kind: 'exit',
      stage: 'preApplication',
      reason: 'withdrawn',
      day: d('2026-09-20')
    });
  });

  it('Closed - Cancelled cancels at close', () => {
    const p = ppaProj({
      status: 'Closed - Cancelled',
      openDay: d('2026-09-01'),
      closeDay: d('2026-09-20')
    });
    expect(endOf(p, entered({ preApplication: '2026-09-01' }), CTX)).toMatchObject({
      reason: 'cancelled',
      day: d('2026-09-20')
    });
  });

  it('older than ppaLag withdraws at close, else at open', () => {
    const open = ASOF - 200;
    const a = ppaProj({ status: 'Open', openDay: open, closeDay: open + 50 });
    expect(endOf(a, { preApplication: open }, CTX)).toEqual({
      kind: 'exit',
      stage: 'preApplication',
      reason: 'withdrawn',
      day: open + 50
    });
    const b = ppaProj({ status: 'Open', openDay: open });
    expect(endOf(b, { preApplication: open }, CTX)).toMatchObject({
      reason: 'withdrawn',
      day: open
    });
  });

  it('younger than ppaLag is open', () => {
    const open = ASOF - 50;
    const p = ppaProj({ status: 'Open', openDay: open });
    expect(endOf(p, { preApplication: open }, CTX)).toEqual({ kind: 'open', lastObserved: open });
  });

  it('with no valid dates is open at asOf', () => {
    const p = ppaProj({ status: 'Open' });
    expect(endOf(p, {}, CTX)).toEqual({ kind: 'open', lastObserved: ASOF });
  });
});

describe('endOf rule 6 and degenerate inputs', () => {
  it('is open with lastObserved otherwise', () => {
    const p = proj({ permits: [permit('1', { issuedDay: d('2016-08-01') })] });
    expect(endOf(p, E, CTX)).toEqual({ kind: 'open', lastObserved: d('2016-08-01') });
  });

  it('pipelineOnly projects are open', () => {
    const p = proj({ kind: 'pipelineOnly', pipelineRows: [pipelineRow(d('2020-01-01'))] });
    expect(endOf(p, entered({ filed: '2019-01-01' }), CTX)).toEqual({
      kind: 'open',
      lastObserved: d('2020-01-01')
    });
  });

  it('an empty entered map exits at no stage, so it stays open', () => {
    const p = proj({ anchors: [prj('R1', { status: 'Withdrawn', closeDay: d('2016-05-01') })] });
    expect(endOf(p, {}, CTX)).toEqual({ kind: 'open', lastObserved: d('2016-05-01') });
  });
});

describe('lastObserved', () => {
  it('takes the max over every record kind', () => {
    const review: Review = {
      recordId: 'R1',
      startType: null,
      startDay: d('2016-02-01'),
      endType: null,
      endDay: d('2016-09-01')
    };
    const p = proj({
      anchors: [prj('R1', { openDay: d('2016-01-01'), decisionDay: d('2016-03-01') })],
      children: [child('C1', { openDay: d('2016-02-01'), closeDay: d('2016-10-01') })],
      reviews: [review],
      permits: [permit('1', { lastActivityDay: d('2016-11-01') })],
      pipelineRows: [pipelineRow(d('2016-12-01'))]
    });
    expect(lastObserved(p, E, ASOF)).toBe(d('2016-12-01'));
  });

  it('counts each permit date and status day', () => {
    for (const f of [
      'filedDay',
      'issuedDay',
      'fcdDay',
      'completedDateDay',
      'statusDay',
      'lastActivityDay'
    ] as const) {
      const p = proj({ permits: [permit('1', { [f]: d('2017-01-01') })] });
      expect(lastObserved(p, E, ASOF)).toBe(d('2017-01-01'));
    }
  });

  it('clamps to asOf', () => {
    const p = proj({ permits: [permit('1', { lastActivityDay: d('2030-01-01') })] });
    expect(lastObserved(p, E, ASOF)).toBe(ASOF);
  });

  it('clamps up to the first entered day', () => {
    const p = proj({ anchors: [prj('R1', { openDay: d('2015-01-01') })] });
    expect(lastObserved(p, E, ASOF)).toBe(d('2016-01-01'));
  });

  it('falls back to the first entered day with no dates, and asOf when nothing is entered', () => {
    expect(lastObserved(proj(), E, ASOF)).toBe(d('2016-01-01'));
    expect(lastObserved(proj(), {}, ASOF)).toBe(ASOF);
  });

  it('ignores satellites', () => {
    const p = proj({
      anchors: [prj('R1', { openDay: d('2016-01-01') })],
      satellites: [prj('S1', { openDay: d('2018-01-01') })]
    });
    expect(lastObserved(p, E, ASOF)).toBe(d('2016-01-01'));
  });
});
