import { describe, expect, it } from 'vitest';
import {
  PPA_UMBRELLA_DAYS,
  clampStages,
  filedEvidenceDay,
  permitCompletionDay,
  permitDays,
  pipelineOnlyHistory,
  rawStages
} from '../../project-records/stages';
import type {
  Child,
  Completion,
  LinkedProject,
  PipelineRow,
  Permit,
  Prj,
  Review
} from '../../project-records/types';

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

function child(recordId: string, type: string, over: Partial<Child> = {}): Child {
  return {
    recordId,
    type,
    status: null,
    blklot: null,
    parentId: null,
    openDay: null,
    closeDay: null,
    ...over
  };
}

function review(recordId: string, over: Partial<Review> = {}): Review {
  return { recordId, startType: null, startDay: null, endType: null, endDay: null, ...over };
}

function comp(
  permitNo: string,
  day: string,
  kind: 'TCO' | 'CFC',
  units: number | null
): Completion {
  return { permit: permitNo, day: d(day), kind, units };
}

function proj(over: Partial<LinkedProject> = {}): LinkedProject {
  const anchors = over.anchors ?? [];
  const permits = over.permits ?? [];
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
    live: permits,
    superseded: new Set(),
    lead: permits[0] ?? null,
    completions: [],
    pipelineRows: [],
    blklots: [],
    parcelIds: [],
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

describe('constants', () => {
  it('has a 7 day PPA umbrella window', () => {
    expect(PPA_UMBRELLA_DAYS).toBe(7);
  });
});

describe('permitCompletionDay', () => {
  it('is the first TCO or CFC with units > 0', () => {
    const p = permit('A');
    const cs = [
      comp('A', '2019-11-01', 'CFC', 12),
      comp('A', '2019-08-01', 'TCO', 12),
      comp('A', '2019-01-01', 'TCO', 0),
      comp('B', '2018-01-01', 'TCO', 5)
    ];
    expect(permitCompletionDay(p, cs)).toBe(d('2019-08-01'));
  });

  it('falls back to completed_date when status is complete and there is no j67f', () => {
    const p = permit('A', { status: 'complete', completedDateDay: d('2015-04-02') });
    expect(permitCompletionDay(p, [])).toBe(d('2015-04-02'));
  });

  it('has no completion for a non-complete permit without j67f', () => {
    const p = permit('A', { status: 'issued', completedDateDay: d('2015-04-02') });
    expect(permitCompletionDay(p, [])).toBeNull();
  });

  it('ignores j67f rows with no units, no kind or no day', () => {
    const p = permit('A', { status: 'complete', completedDateDay: d('2015-04-02') });
    const cs: Completion[] = [
      { permit: 'A', day: d('2010-01-01'), kind: 'TCO', units: null },
      { permit: 'A', day: null, kind: 'TCO', units: 3 },
      { permit: 'A', day: d('2010-01-01'), kind: null, units: 3 }
    ];
    expect(permitCompletionDay(p, cs)).toBe(d('2015-04-02'));
  });
});

describe('permitDays', () => {
  it('reports filed, issued, construction and complete for one permit without a clamp', () => {
    const p = permit('A', {
      sitePermit: true,
      filedDay: d('2019-06-01'),
      issuedDay: d('2019-09-01'),
      fcdDay: d('2019-08-01')
    });
    expect(permitDays(p, [])).toEqual({
      filed: d('2019-06-01'),
      issued: d('2019-09-01'),
      construction: d('2019-08-01'),
      complete: null
    });
  });

  it('uses issued for a full permit and null for a site permit without an FCD', () => {
    const full = permit('A', { issuedDay: d('2019-09-01'), fcdDay: d('2019-12-01') });
    const site = permit('B', { sitePermit: true, issuedDay: d('2019-09-01') });
    expect(permitDays(full, []).construction).toBe(d('2019-09-01'));
    expect(permitDays(site, []).construction).toBeNull();
  });
});

describe('filedEvidenceDay', () => {
  it('(a) uses the anchor PRJ open date', () => {
    const p = proj({ anchors: [prj('PRJ-1', { openDay: d('2020-01-10') })] });
    expect(filedEvidenceDay(p)).toBe(d('2020-01-10'));
  });

  it('(a) skips an anchor opened the same day as a PPA (umbrella)', () => {
    const p = proj({
      anchors: [prj('PRJ-1', { openDay: d('2026-08-03') })],
      children: [child('PPA-1', 'PPA', { openDay: d('2026-08-03') })]
    });
    expect(filedEvidenceDay(p)).toBeNull();
  });

  it('(a) keeps an anchor whose PPA opened 8 days off, drops at 7', () => {
    const anchors = [prj('PRJ-1', { openDay: d('2026-08-11') })];
    const eight = proj({
      anchors,
      children: [child('PPA-1', 'PPA', { openDay: d('2026-08-03') })]
    });
    const seven = proj({
      anchors,
      children: [child('PPA-1', 'PPA', { openDay: d('2026-08-04') })]
    });
    expect(filedEvidenceDay(eight)).toBe(d('2026-08-11'));
    expect(filedEvidenceDay(seven)).toBeNull();
  });

  it('(b) uses the open date of a listed child type but not PPA or DRP', () => {
    const p = proj({
      children: [
        child('C1', 'PPA', { openDay: d('2019-01-01') }),
        child('C2', 'DRP', { openDay: d('2019-02-01') }),
        child('C3', 'ENV', { openDay: d('2019-05-05') }),
        child('C4', 'CUA', { openDay: d('2019-04-04') })
      ]
    });
    expect(filedEvidenceDay(p)).toBe(d('2019-04-04'));
  });

  it('(c) uses d4jk start_event_date', () => {
    const p = proj({ reviews: [review('R', { startDay: d('2018-03-03') })] });
    expect(filedEvidenceDay(p)).toBe(d('2018-03-03'));
  });

  it('(d) uses the filed day of any permit and takes the minimum of all', () => {
    const p = proj({
      anchors: [prj('PRJ-1', { openDay: d('2020-01-10') })],
      permits: [
        permit('A', { filedDay: d('2019-07-07') }),
        permit('B', { filedDay: d('2021-01-01') })
      ]
    });
    expect(filedEvidenceDay(p)).toBe(d('2019-07-07'));
  });

  it('is null with no evidence', () => {
    expect(filedEvidenceDay(proj())).toBeNull();
  });
});

describe('rawStages', () => {
  it('preApplication is the min PPA open date when strictly before filed', () => {
    const p = proj({
      anchors: [prj('PRJ-1', { openDay: d('2020-03-01') })],
      children: [
        child('PPA-1', 'PPA', { openDay: d('2019-11-01') }),
        child('PPA-2', 'PPA', { openDay: d('2019-10-01') })
      ]
    });
    const raw = rawStages(p, 'discretionary');
    expect(raw.preApplication).toBe(d('2019-10-01'));
    expect(raw.filed).toBe(d('2020-03-01'));
  });

  it('drops preApplication when it is not strictly before filed', () => {
    const p = proj({
      anchors: [prj('PRJ-1', { openDay: d('2020-03-01') })],
      reviews: [review('R', { startDay: d('2019-12-01') })],
      children: [child('PPA-1', 'PPA', { openDay: d('2019-12-01') })]
    });
    expect(rawStages(p, 'discretionary').preApplication).toBeUndefined();
  });

  it('PPA umbrella: PPA and PRJ open the same day, nothing else', () => {
    const p = proj({
      anchors: [prj('PRJ-1', { openDay: d('2026-08-03') })],
      children: [child('PPA-1', 'PPA', { openDay: d('2026-08-03') })]
    });
    const raw = rawStages(p, 'discretionary');
    expect(raw.filed).toBeUndefined();
    expect(raw.preApplication).toBe(d('2026-08-03'));
  });

  it('PPA opened 8 days off keeps the PRJ open as filed', () => {
    const p = proj({
      anchors: [prj('PRJ-1', { openDay: d('2026-08-11') })],
      children: [child('PPA-1', 'PPA', { openDay: d('2026-08-03') })]
    });
    const raw = rawStages(p, 'discretionary');
    expect(raw.filed).toBe(d('2026-08-11'));
    expect(raw.preApplication).toBe(d('2026-08-03'));
  });

  it('treats a null pathway as discretionary', () => {
    const p = proj({ anchors: [prj('PRJ-1', { openDay: d('2020-03-01') })] });
    expect(rawStages(p, null).filed).toBe(d('2020-03-01'));
  });

  it('permitOnly gets no filed or entitled but keeps preApplication', () => {
    const p = proj({
      anchors: [
        prj('PRJ-1', {
          openDay: d('2020-03-01'),
          decision: 'Approved',
          decisionDay: d('2020-04-01')
        })
      ],
      children: [child('PPA-1', 'PPA', { openDay: d('2019-01-01') })],
      permits: [permit('A', { filedDay: d('2020-05-01'), issuedDay: d('2020-06-01') })]
    });
    const raw = rawStages(p, 'permitOnly');
    expect(raw.filed).toBeUndefined();
    expect(raw.entitled).toBeUndefined();
    expect(raw.preApplication).toBe(d('2019-01-01'));
    expect(raw.permitFiled).toBe(d('2020-05-01'));
  });

  describe('entitled', () => {
    it('prefers d4jk approval end events', () => {
      const p = proj({
        anchors: [prj('PRJ-1', { decision: 'Approved', decisionDay: d('2020-08-01') })],
        reviews: [
          review('R1', { endType: 'approval', endDay: d('2020-06-01') }),
          review('R2', { endType: 'disapproval', endDay: d('2020-01-01') })
        ],
        pipelineRows: [row({ approvedDay: d('2020-05-01') })]
      });
      expect(rawStages(p, 'discretionary').entitled).toBe(d('2020-06-01'));
    });

    it('then an Approved project decision', () => {
      const p = proj({
        anchors: [prj('PRJ-1', { decision: 'Approved', decisionDay: d('2020-08-01') })],
        pipelineRows: [row({ approvedDay: d('2020-05-01') })]
      });
      expect(rawStages(p, 'discretionary').entitled).toBe(d('2020-08-01'));
    });

    it('does not take a non-Approved decision', () => {
      const p = proj({
        anchors: [prj('PRJ-1', { decision: 'Disapproved', decisionDay: d('2020-08-01') })]
      });
      expect(rawStages(p, 'discretionary').entitled).toBeUndefined();
    });

    it('then pipeline approved_date_planning', () => {
      const p = proj({
        pipelineRows: [
          row({ approvedDay: d('2020-05-01') }),
          row({ idx: 1, approvedDay: d('2020-04-01') })
        ],
        children: [child('C', 'CUA', { status: 'Approved', closeDay: d('2020-09-09') })]
      });
      expect(rawStages(p, 'discretionary').entitled).toBe(d('2020-04-01'));
    });

    it('then the max close date of Approved rule-2 children excluding PPA', () => {
      const p = proj({
        children: [
          child('C1', 'CUA', { status: 'Approved - Final', closeDay: d('2020-09-09') }),
          child('C2', 'VAR', { status: 'Approved', closeDay: d('2020-10-10') }),
          child('C3', 'DRP', { status: 'Disapproved', closeDay: d('2021-01-01') }),
          child('C4', 'ENV', { status: 'Approved', closeDay: d('2021-02-02') }),
          child('C5', 'PPA', { status: 'Approved', closeDay: d('2021-03-03') })
        ]
      });
      expect(rawStages(p, 'discretionary').entitled).toBe(d('2020-10-10'));
    });
  });

  describe('permit stages', () => {
    const permits = [
      permit('A', {
        filedDay: d('2021-02-01'),
        issuedDay: d('2021-06-01'),
        fcdDay: d('2021-07-01'),
        sitePermit: true
      }),
      permit('B', { filedDay: d('2020-12-01'), issuedDay: d('2021-04-01') })
    ];

    it('permitFiled is the min over all permits, permitIssued and construction over the live set', () => {
      const dead = permit('C', { status: 'cancelled', filedDay: d('2019-01-01') });
      const p = proj({
        anchors: [prj('PRJ-1', { decision: 'Approved', decisionDay: d('2020-01-01') })],
        permits: [dead, ...permits],
        live: permits
      });
      const raw = rawStages(p, 'discretionary');
      expect(raw.permitFiled).toBe(d('2019-01-01'));
      expect(raw.permitIssued).toBe(d('2021-04-01'));
      expect(raw.construction).toBe(d('2021-04-01'));
    });

    it('construction: a site permit without FCD has not started', () => {
      const site = permit('S', { sitePermit: true, issuedDay: d('2021-04-01') });
      const p = proj({ permits: [site], live: [site] });
      const raw = rawStages(p, 'permitOnly');
      expect(raw.permitIssued).toBe(d('2021-04-01'));
      expect(raw.construction).toBeUndefined();
    });

    it('parallel permit: discretionary, filed, no entitled, no issued gives no permitFiled', () => {
      const parallel = permit('P', { status: 'filed', filedDay: d('2020-01-01') });
      const p = proj({
        anchors: [prj('PRJ-1', { openDay: d('2019-12-01') })],
        permits: [parallel],
        live: [parallel]
      });
      const raw = rawStages(p, 'discretionary');
      expect(raw.permitFiled).toBeUndefined();
      expect(raw.filed).toBe(d('2019-12-01'));
    });

    it('permitFiled is kept for streamlined when permitIssued exists', () => {
      const pm = permit('P', { filedDay: d('2020-01-01'), issuedDay: d('2020-05-01') });
      const p = proj({ permits: [pm], live: [pm] });
      expect(rawStages(p, 'streamlined').permitFiled).toBe(d('2020-01-01'));
    });

    it('permitFiled is kept for permitOnly with nothing else', () => {
      const pm = permit('P', { status: 'filed', filedDay: d('2020-01-01') });
      const p = proj({ permits: [pm], live: [pm] });
      expect(rawStages(p, 'permitOnly').permitFiled).toBe(d('2020-01-01'));
    });
  });

  describe('complete', () => {
    const a = permit('A', { issuedDay: d('2019-01-01') });
    const b = permit('B', { issuedDay: d('2019-01-01') });

    it('is the max completion day when every live permit has one', () => {
      const p = proj({
        permits: [a, b],
        completions: [comp('A', '2019-08-01', 'TCO', 12), comp('B', '2020-02-02', 'CFC', 4)]
      });
      expect(rawStages(p, 'permitOnly').complete).toBe(d('2020-02-02'));
    });

    it('is absent while one live permit lacks a completion', () => {
      const p = proj({ permits: [a, b], completions: [comp('A', '2019-08-01', 'TCO', 12)] });
      expect(rawStages(p, 'permitOnly').complete).toBeUndefined();
    });

    it('is absent with an empty live set', () => {
      const dead = permit('D', { status: 'cancelled' });
      const p = proj({ permits: [dead], live: [] });
      expect(rawStages(p, 'permitOnly').complete).toBeUndefined();
    });

    it('uses the completed_date fallback', () => {
      const c = permit('C', { status: 'complete', completedDateDay: d('2017-05-05') });
      const p = proj({ permits: [c] });
      expect(rawStages(p, 'permitOnly').complete).toBe(d('2017-05-05'));
    });
  });
});

describe('clampStages', () => {
  it('forward-clamps an earlier stage up to the previous entered day', () => {
    const { entered, clamped } = clampStages({
      permitFiled: d('2019-06-01'),
      entitled: d('2020-03-02')
    });
    expect(entered.permitFiled).toBe(d('2020-03-02'));
    expect(entered.entitled).toBe(d('2020-03-02'));
    expect(clamped).toEqual(['permitFiled']);
  });

  it('clamps construction to issued for a site permit with FCD before issuance', () => {
    const { entered, clamped } = clampStages({
      permitIssued: d('2020-05-01'),
      construction: d('2020-04-01')
    });
    expect(entered.construction).toBe(d('2020-05-01'));
    expect(clamped).toEqual(['construction']);
  });

  it('leaves ordered dates alone and skips absent stages', () => {
    const raw = { filed: d('2020-01-01'), permitIssued: d('2020-06-01') };
    const { entered, clamped } = clampStages(raw);
    expect(entered).toEqual(raw);
    expect(clamped).toEqual([]);
  });

  it('does not mutate its input and propagates the clamp', () => {
    const raw = {
      filed: d('2020-01-01'),
      entitled: d('2020-09-01'),
      permitFiled: d('2020-03-01'),
      permitIssued: d('2020-04-01')
    };
    const { entered, clamped } = clampStages(raw);
    expect(raw.permitFiled).toBe(d('2020-03-01'));
    expect(entered.permitFiled).toBe(d('2020-09-01'));
    expect(entered.permitIssued).toBe(d('2020-09-01'));
    expect(clamped).toEqual(['permitFiled', 'permitIssued']);
  });
});

describe('pipelineOnlyHistory', () => {
  it('maps each status to its stage', () => {
    const cases: [string, string][] = [
      ['PL Filed', 'filed'],
      ['PL Approved', 'entitled'],
      ['BP Filed', 'permitFiled'],
      ['BP Approved', 'permitFiled'],
      ['BP Issued', 'permitIssued'],
      ['BP BP Issued', 'permitIssued'],
      ['Construction', 'construction']
    ];
    for (const [status, stage] of cases) {
      const h = pipelineOnlyHistory(row({ status, statusDay: d('2012-01-01') }));
      expect(h).toEqual({ [stage]: d('2012-01-01') });
    }
  });

  it('trims the status', () => {
    expect(pipelineOnlyHistory(row({ status: ' PL Filed ', statusDay: d('2012-01-01') }))).toEqual({
      filed: d('2012-01-01')
    });
  });

  it('PL Approved with approved date earlier than status uses the approved date', () => {
    const h = pipelineOnlyHistory(
      row({ status: 'PL Approved', statusDay: d('2008-06-12'), approvedDay: d('2008-05-01') })
    );
    expect(h).toEqual({ entitled: d('2008-05-01') });
  });

  it('PL Approved with approved date later than status uses the status date', () => {
    const h = pipelineOnlyHistory(
      row({ status: 'PL Approved', statusDay: d('2008-06-12'), approvedDay: d('2008-07-01') })
    );
    expect(h).toEqual({ entitled: d('2008-06-12') });
  });

  it('adds entitled to a later-stage row when approved is present and not later', () => {
    const h = pipelineOnlyHistory(
      row({ status: 'BP Issued', statusDay: d('2012-01-01'), approvedDay: d('2011-01-01') })
    );
    expect(h).toEqual({ entitled: d('2011-01-01'), permitIssued: d('2012-01-01') });
  });

  it('does not add entitled to a PL Filed row or when approved is later than status', () => {
    expect(
      pipelineOnlyHistory(
        row({ status: 'PL Filed', statusDay: d('2012-01-01'), approvedDay: d('2011-01-01') })
      )
    ).toEqual({ filed: d('2012-01-01') });
    expect(
      pipelineOnlyHistory(
        row({ status: 'Construction', statusDay: d('2012-01-01'), approvedDay: d('2013-01-01') })
      )
    ).toEqual({ construction: d('2012-01-01') });
  });

  it('drops a row with an invalid status day or unknown status', () => {
    expect(pipelineOnlyHistory(row({ status: 'PL Filed', statusDay: null }))).toBeNull();
    expect(pipelineOnlyHistory(row({ status: 'Mystery', statusDay: d('2012-01-01') }))).toBeNull();
    expect(pipelineOnlyHistory(row({ status: null, statusDay: d('2012-01-01') }))).toBeNull();
  });

  it('drops a status that names an Object.prototype key', () => {
    for (const status of ['constructor', 'toString', '__proto__']) {
      expect(pipelineOnlyHistory(row({ status, statusDay: d('2012-01-01') }))).toBeNull();
    }
  });
});
