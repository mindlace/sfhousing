// Rulings IL1 and SE1: the lapse tests on open histories at entitled (spec 4.6).
import { describe, expect, it } from 'vitest';
import {
  activityIndex,
  daExcluded,
  inferredLapse,
  otherActivity,
  parcelFamily,
  streamlinedLapse,
  type LapseCtx
} from '../../project-records/lapse';
import type { Child, LinkedProject, Prj } from '../../project-records/types';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const ENT = d('2019-05-01');
const ASOF = d('2026-10-10');

function prj(id: string, over: Partial<Prj> = {}): Prj {
  return {
    recordId: id,
    status: 'Open',
    address: null,
    blklot: '3512002',
    openDay: d('2018-11-01'),
    closeDay: null,
    permits: [],
    decision: null,
    decisionDay: null,
    unitsProp: 10,
    unitsExist: null,
    affordableProp: null,
    newConstruction: true,
    sb35: false,
    hsd: false,
    ab2162: false,
    description: null,
    ...over
  };
}

function proj(id: string, over: Partial<LinkedProject> = {}): LinkedProject {
  const p = prj(id.replace(/^PRJ:/, ''));
  return {
    id,
    kind: 'graph',
    anchors: [p],
    primary: p,
    satellites: [],
    children: [],
    sourceOnlyChildren: [],
    reviews: [],
    permits: [],
    live: [],
    superseded: new Set(),
    lead: null,
    completions: [],
    pipelineRows: [],
    blklots: ['3512002'],
    parcelIds: ['3512002'],
    ...over
  } as unknown as LinkedProject;
}

const child = (type: string, open: number): Child => ({
  recordId: `X-${type}`,
  type,
  status: null,
  blklot: null,
  parentId: null,
  openDay: open,
  closeDay: null
});

const entered = { filed: d('2018-11-01'), entitled: ENT };
const open = (seen = ENT) => ({ kind: 'open' as const, lastObserved: seen });

function ctx(p: LinkedProject, others: { proj: LinkedProject; days: number[] }[] = []): LapseCtx {
  const noDesc = () => [];
  return {
    asOf: ASOF,
    family: parcelFamily(p, noDesc),
    index: activityIndex([{ proj: p, days: [ENT] }, ...others]),
    daParcels: new Set()
  };
}

describe('inferredLapse (Ruling IL1)', () => {
  it('rule expiry, due = max(expiry, lastObserved), exit a year after due', () => {
    const p = proj('PRJ:A');
    // 2019-05-01 + 3 y + the 365-day ZA COVID overlap = 2023-05-01.
    expect(inferredLapse(p, 'discretionary', entered, open(), ctx(p))).toEqual({
      expiry: d('2023-05-01'),
      due: d('2023-05-01'),
      exitDay: d('2023-05-01') + 365
    });
    const late = inferredLapse(p, 'discretionary', entered, open(d('2024-02-01')), ctx(p));
    expect(late?.due).toBe(d('2024-02-01'));
    expect(late?.exitDay).toBe(d('2025-01-31'));
  });

  it('only an open discretionary history whose last stage is entitled', () => {
    const p = proj('PRJ:A');
    expect(inferredLapse(p, 'streamlined', entered, open(), ctx(p))).toBeNull();
    expect(inferredLapse(p, null, entered, open(), ctx(p))).toBeNull();
    expect(
      inferredLapse(p, 'discretionary', { ...entered, permitFiled: ENT + 10 }, open(), ctx(p))
    ).toBeNull();
    const exit = {
      kind: 'exit' as const,
      stage: 'entitled' as const,
      reason: 'withdrawn' as const
    };
    expect(inferredLapse(p, 'discretionary', entered, { ...exit, day: ENT }, ctx(p))).toBeNull();
    expect(inferredLapse(p, 'discretionary', entered, null, ctx(p))).toBeNull();
  });

  it('a permit (after linkage) excludes it', () => {
    const p = proj('PRJ:A', { permits: [{ number: '1' }] as unknown as LinkedProject['permits'] });
    expect(inferredLapse(p, 'discretionary', entered, open(), ctx(p))).toBeNull();
  });

  it('a child record opened after the entitled day excludes it; one opened before does not', () => {
    const after = proj('PRJ:A', { children: [child('CUA', ENT + 1)] });
    expect(inferredLapse(after, 'discretionary', entered, open(), ctx(after))).toBeNull();
    const before = proj('PRJ:A', { children: [child('ENV', ENT - 30)] });
    expect(inferredLapse(before, 'discretionary', entered, open(), ctx(before))).not.toBeNull();
    const same = proj('PRJ:A', { children: [child('ENX', ENT)] });
    expect(inferredLapse(same, 'discretionary', entered, open(), ctx(same))).not.toBeNull();
  });

  it('a DVA child, a DA pipeline row or a DA parcel excludes it', () => {
    const dva = proj('PRJ:A', { children: [child('DVA', ENT - 400)] });
    expect(inferredLapse(dva, 'discretionary', entered, open(), ctx(dva))).toBeNull();
    const row = proj('PRJ:A', {
      pipelineRows: [{ da: 'Fixture Yards' }] as unknown as LinkedProject['pipelineRows']
    });
    expect(inferredLapse(row, 'discretionary', entered, open(), ctx(row))).toBeNull();
    const p = proj('PRJ:A');
    const c = { ...ctx(p), daParcels: new Set(['3512002']) };
    expect(inferredLapse(p, 'discretionary', entered, open(), c)).toBeNull();
    // A descendant of its lot in a DA set counts too.
    const fam = parcelFamily(p, (b) => (b === '3512002' ? ['3512101'] : []));
    expect(daExcluded(p, fam, new Set(['3512101']))).toBe(true);
  });

  it('another project active on its parcels since entitled - 365 excludes it', () => {
    const p = proj('PRJ:A');
    const other = (days: number[], over: Partial<LinkedProject> = {}) => ({
      proj: proj('BP:1', { anchors: [], primary: null, ...over }),
      days
    });
    // On or after entitled - 365: excluded.
    expect(inferredLapse(p, 'discretionary', entered, open(), ctx(p, [other([ENT - 365])]))).toBe(
      null
    );
    // Before: not.
    expect(
      inferredLapse(p, 'discretionary', entered, open(), ctx(p, [other([ENT - 366])]))
    ).not.toBeNull();
    // On another lot: not; on a descendant of its lot: excluded.
    const far = other([ENT + 100], { parcelIds: ['3512005'] });
    expect(inferredLapse(p, 'discretionary', entered, open(), ctx(p, [far]))).not.toBeNull();
    const sub = other([ENT + 100], { parcelIds: ['3512101'] });
    const famCtx = {
      ...ctx(p, [sub]),
      family: parcelFamily(p, (b) => (b === '3512002' ? ['3512101'] : []))
    };
    expect(inferredLapse(p, 'discretionary', entered, open(), famCtx)).toBeNull();
    // A split part of the same Planning record is not another project.
    const part = { proj: proj('PRJ:A:BP:9', { anchors: p.anchors }), days: [ENT + 100] };
    expect(
      otherActivity(
        p,
        parcelFamily(p, () => []),
        activityIndex([part]),
        ENT - 365
      )
    ).toBe(false);
  });
});

describe('streamlinedLapse (Ruling SE1)', () => {
  const sb35 = (affordable: number | null, units: number | null) => {
    const a = prj('A', { sb35: true, affordableProp: affordable, unitsProp: units });
    return proj('PRJ:A', { anchors: [a], primary: a });
  };

  it('expiry day: 3 years with AB 1561 / AB 2729, then the one-time year', () => {
    const p = sb35(1, 10);
    // 2019-05-01 + 3 y = 2022-05-01 (no ZA overlap for streamlined), + 1 y.
    expect(streamlinedLapse(p, 'streamlined', entered, open(), ctx(p))).toEqual({
      exempt: false,
      day: d('2023-05-01')
    });
  });

  it('half or more affordable is exempt; the DA exclusions apply; discretionary is not tested', () => {
    const p = sb35(5, 10);
    expect(streamlinedLapse(p, 'streamlined', entered, open(), ctx(p))).toEqual({ exempt: true });
    const q = sb35(1, 10);
    expect(
      streamlinedLapse(q, 'streamlined', entered, open(), {
        ...ctx(q),
        daParcels: new Set(['3512002'])
      })
    ).toBeNull();
    expect(streamlinedLapse(q, 'discretionary', entered, open(), ctx(q))).toBeNull();
    // No activity test: another project on the lot does not stop it.
    const busy = ctx(q, [{ proj: proj('BP:1', { anchors: [] }), days: [ENT + 100] }]);
    expect(streamlinedLapse(q, 'streamlined', entered, open(), busy)).not.toBeNull();
  });
});
