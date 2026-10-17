import { describe, expect, it } from 'vitest';
import {
  DISCRETIONARY_CHILD_TYPES,
  REFERRAL_TOLERANCE_DAYS,
  isNewConstruction,
  pathwayOf,
  streamlinedByText
} from '../../project-records/classify';
import type { Child, LinkedProject, Permit, Prj, Review } from '../../project-records/types';

function permit(number: string, filedDay: number | null): Permit {
  return {
    number,
    sitePermit: false,
    status: 'issued',
    statusDay: null,
    filedDay,
    issuedDay: null,
    fcdDay: null,
    completedDateDay: null,
    lastActivityDay: null,
    stories: null,
    existingUnits: null,
    proposedUnits: null,
    rows: []
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

function child(recordId: string, type: string, parentId: string | null): Child {
  return { recordId, type, status: null, blklot: null, parentId, openDay: null, closeDay: null };
}

function review(recordId: string): Review {
  return { recordId, startType: null, startDay: null, endType: null, endDay: null };
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

describe('streamlinedByText', () => {
  it.each([
    'SB 35',
    'SB-423',
    'AB2011',
    'AB 2162',
    'Housing Choice - San Francisco',
    'HCSF',
    'Section 206.10',
    'Housing Sustainability District'
  ])('matches %s', (text) => {
    expect(streamlinedByText(`Project under ${text} review`)).toBe(true);
  });

  it('rejects negations and non-indicators', () => {
    expect(streamlinedByText('project is not eligible for SB 423')).toBe(false);
    expect(streamlinedByText('ADU Local Program')).toBe(false);
    expect(streamlinedByText(null)).toBe(false);
  });
});

describe('constants', () => {
  it('lists the discretionary child types and the tolerance', () => {
    expect([...DISCRETIONARY_CHILD_TYPES].sort()).toEqual(
      'CUA VAR DNX ENX OFA AHB PHA DVA MAP PCA GPA CTZ COA PTA DRP DRM PPA'.split(' ').sort()
    );
    expect(REFERRAL_TOLERANCE_DAYS).toBe(30);
  });
});

describe('pathwayOf', () => {
  it.each(['sb35', 'hsd', 'ab2162'] as const)('%s CHECKED is streamlined', (flag) => {
    const a = prj('A', { [flag]: true });
    expect(pathwayOf(proj({ anchors: [a] }))).toBe('streamlined');
  });

  it('description text is streamlined', () => {
    const a = prj('A', { description: 'Project using SB 35 streamlining' });
    expect(pathwayOf(proj({ anchors: [a] }))).toBe('streamlined');
  });

  it('streamlined wins over discretionary evidence', () => {
    const a = prj('A', { sb35: true });
    expect(pathwayOf(proj({ anchors: [a], reviews: [review('A')] }))).toBe('streamlined');
  });

  it('a d4jk row is discretionary', () => {
    const a = prj('A');
    expect(pathwayOf(proj({ anchors: [a], reviews: [review('A')] }))).toBe('discretionary');
  });

  it('a DRM child is discretionary', () => {
    const a = prj('A');
    expect(pathwayOf(proj({ anchors: [a], children: [child('c', 'DRM', 'A')] }))).toBe(
      'discretionary'
    );
  });

  it('a non-discretionary child type (ENV) is not evidence', () => {
    const a = prj('A', { openDay: 100 });
    const p = proj({
      anchors: [a],
      children: [child('c', 'ENV', 'A')],
      permits: [permit('1', 105)]
    });
    expect(pathwayOf(p)).toBe('permitOnly');
  });

  it('an attached PPA is discretionary evidence for the project', () => {
    const a = prj('A', { openDay: 100 });
    const p = proj({
      anchors: [a],
      children: [child('ppa', 'PPA', null)],
      permits: [permit('1', 105)]
    });
    expect(pathwayOf(p)).toBe('discretionary');
  });

  it('pipelineOnly and ppaOnly are discretionary', () => {
    expect(pathwayOf(proj({ kind: 'pipelineOnly' }))).toBe('discretionary');
    expect(pathwayOf(proj({ kind: 'ppaOnly' }))).toBe('discretionary');
  });

  it('a referral PRJ opened 10 days before the permit filing is permitOnly', () => {
    const a = prj('A', { openDay: 990 });
    expect(pathwayOf(proj({ anchors: [a], permits: [permit('1', 1000)] }))).toBe('permitOnly');
  });

  it('opened exactly 30 days before the earliest filing is still a referral', () => {
    const a = prj('A', { openDay: 970 });
    const p = proj({ anchors: [a], permits: [permit('1', 1000), permit('2', 1200)] });
    expect(pathwayOf(p)).toBe('permitOnly');
  });

  it('opened 40 days before the permit filing is unclassifiable', () => {
    const a = prj('A', { openDay: 960 });
    expect(pathwayOf(proj({ anchors: [a], permits: [permit('1', 1000)] }))).toBeNull();
  });

  it('uses the earliest filed day over all permits, ignoring null', () => {
    const a = prj('A', { openDay: 1100 });
    const p = proj({ anchors: [a], permits: [permit('1', null), permit('2', 1050)] });
    expect(pathwayOf(p)).toBe('permitOnly');
  });

  it('a null openDay is not a referral', () => {
    const a = prj('A', { openDay: null });
    expect(pathwayOf(proj({ anchors: [a], permits: [permit('1', 1000)] }))).toBeNull();
  });

  it('every anchor must be a referral', () => {
    const a = prj('A', { openDay: 990 });
    const b = prj('B', { openDay: 900 });
    expect(pathwayOf(proj({ anchors: [a, b], permits: [permit('1', 1000)] }))).toBeNull();
  });

  it('no PRJ is permitOnly', () => {
    expect(pathwayOf(proj({ permits: [permit('1', 1000)] }))).toBe('permitOnly');
  });

  it('an anchor with no evidence and no permits is unclassifiable', () => {
    expect(pathwayOf(proj({ anchors: [prj('A', { openDay: 100 })] }))).toBeNull();
  });

  it('an anchor with no evidence and permits without filed days is unclassifiable', () => {
    const a = prj('A', { openDay: 100 });
    expect(pathwayOf(proj({ anchors: [a], permits: [permit('1', null)] }))).toBeNull();
  });
});

describe('isNewConstruction', () => {
  it('is false for a PRJ that is not newConstruction and has no permit', () => {
    expect(isNewConstruction(proj({ anchors: [prj('A', { unitsProp: 5 })] }))).toBe(false);
  });

  it('is true for newConstruction with unitsProp 1', () => {
    const a = prj('A', { newConstruction: true, unitsProp: 1 });
    expect(isNewConstruction(proj({ anchors: [a] }))).toBe(true);
  });

  it('is false for newConstruction with zero or null units', () => {
    expect(isNewConstruction(proj({ anchors: [prj('A', { newConstruction: true })] }))).toBe(false);
    const z = prj('A', { newConstruction: true, unitsProp: 0 });
    expect(isNewConstruction(proj({ anchors: [z] }))).toBe(false);
  });

  it('is true when the project has any permit', () => {
    expect(isNewConstruction(proj({ permits: [permit('1', null)] }))).toBe(true);
  });
});
