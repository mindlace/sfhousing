// Fitting-window constants and the coverage guard (spec §4.4 "Fitting windows").
import { describe, expect, it } from 'vitest';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import { CalibrationError, type Spell } from '../../lib/fzp-cal/types';
import {
  COVERAGE,
  LOCAL_PROGRAM_START,
  PANEL_FIRST_MONTH,
  PANEL_LAST_MONTH,
  PERMIT_POOLED_START,
  PHASE_GAP_START,
  PLANNING_START,
  PPA_SERIES_END,
  coverageGuard,
  windowStart
} from '../../lib/fzp-cal/window';
import { isoToDay } from '../../project-records/multiphase';
import { buildSpells, cutSpells, normalise, preRollCount } from '../../lib/fzp-cal/spells';
import type { Day, ProjectHistory, Stage } from '../../../src/lib/timelapse/types';

const spell = (iso: string, stage: Spell['stage'] = 'filed'): Spell => ({
  pathway: 'discretionary',
  stage,
  a: 0,
  e: isoToDay(iso),
  x: 10,
  outcome: 'advance',
  projectId: iso
});

describe('window constants', () => {
  it('holds the ruled dates', () => {
    expect(PLANNING_START).toBe('2015-01-01');
    expect(PERMIT_POOLED_START).toBe('2007-01-01');
    expect(PHASE_GAP_START).toBe('1989-01-01');
    expect(PPA_SERIES_END).toBe('2023-07-07');
    expect(PANEL_FIRST_MONTH).toBe('2007-01');
    expect(PANEL_LAST_MONTH).toBe('2025-12');
    expect(LOCAL_PROGRAM_START).toBe('2026-01-12');
  });

  it('windowStart per stage and level', () => {
    expect(windowStart('permitIssued', 'pooled')).toBe(isoToDay('2007-01-01'));
    expect(windowStart('permitFiled', 'pooled')).toBe(isoToDay('2007-01-01'));
    expect(windowStart('construction', 'pathway')).toBe(isoToDay('2015-01-01'));
    expect(windowStart('filed', 'pooled')).toBe(isoToDay('2015-01-01'));
    expect(windowStart('preApplication', 'pooled')).toBe(isoToDay('2015-01-01'));
  });

  it('COVERAGE has the six table rows', () => {
    expect(COVERAGE.map((r) => r.stage)).toEqual([
      'preApplication',
      'filed',
      'entitled',
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
    const permit = COVERAGE.filter((r) => r.side === 'permit');
    expect(permit).toHaveLength(3);
    expect(permit.every((r) => r.pooledStart === '2007-01-01')).toBe(true);
    expect(COVERAGE.every((r) => r.pathwayStart === '2015-01-01')).toBe(true);
    expect(COVERAGE[0].entryEnd).toBe('2023-07-07');
    expect(COVERAGE.every((r) => r.evidence.length > 0)).toBe(true);
  });

  it('the coverage guard is on live and off in the fixture', () => {
    expect(LIVE_CAL.coverageGuard).toBe(true);
    expect(FIXTURE_CAL.coverageGuard).toBe(false);
  });

  it('the profiles carry the method-constant table', () => {
    expect(LIVE_CAL).toMatchObject({
      name: 'live',
      nSpellsMin: 30,
      initMinEvents: 100,
      phaseMinGaps: 10,
      fixtureInitiation: false,
      backcastGate: true
    });
    expect(FIXTURE_CAL).toMatchObject({
      name: 'fixture',
      nSpellsMin: 3,
      initMinEvents: null,
      phaseMinGaps: 1,
      fixtureInitiation: true,
      backcastGate: false
    });
  });
});

describe('coverageGuard', () => {
  const from = isoToDay('2015-01-01');
  const asOf = isoToDay('2017-06-30');
  const spells = [spell('2015-03-01'), spell('2015-09-01'), spell('2017-02-01')];

  it('throws on a year with no entries when on', () => {
    expect(() => coverageGuard(spells, 'filed', from, asOf, true)).toThrow(
      /coverage gap: filed 2016/
    );
    expect(() => coverageGuard(spells, 'filed', from, asOf, true)).toThrow(CalibrationError);
  });

  it('returns the per-year counts when off', () => {
    expect(coverageGuard(spells, 'filed', from, asOf, false).perYear).toEqual({
      2015: 2,
      2016: 0,
      2017: 1
    });
  });

  it('counts an earlier entry in the year of the window start', () => {
    const early = [spell('2012-05-01'), spell('2016-01-01'), spell('2017-01-01')];
    expect(coverageGuard(early, 'filed', from, asOf, true).perYear).toEqual({
      2015: 1,
      2016: 1,
      2017: 1
    });
  });

  it('counts only the named stage', () => {
    const other = [...spells, spell('2016-04-01', 'entitled')];
    expect(coverageGuard(other, 'entitled', from, asOf, false).perYear).toEqual({
      2015: 0,
      2016: 1,
      2017: 0
    });
  });
});

const d = isoToDay;
const AS_OF = d('2026-06-30');

function hist(
  id: string,
  pathway: ProjectHistory['pathway'],
  entered: Partial<Record<Stage, string>>,
  end: ProjectHistory['end']
): ProjectHistory {
  const e: Partial<Record<Stage, Day>> = {};
  for (const [s, iso] of Object.entries(entered)) e[s as Stage] = d(iso as string);
  return {
    id,
    pathway,
    parcelIds: [],
    entered: e,
    end,
    unitsAt: { filed: 10 },
    existingUnits: 0,
    storiesProposed: null,
    baseStoriesAtFiling: null,
    sources: []
  };
}

const open = (iso: string): ProjectHistory['end'] => ({ kind: 'open', lastObserved: d(iso) });

describe('cutSpells and preRollCount', () => {
  it('cuts Planning-side spells at 2015 and keeps permit-side ones at 2007', () => {
    const h = hist(
      'p1',
      'discretionary',
      {
        filed: '2011-01-01',
        entitled: '2012-01-01',
        permitFiled: '2013-01-01',
        permitIssued: '2014-01-01',
        construction: '2016-01-01'
      },
      open('2020-01-01')
    );
    const s = buildSpells(normalise([h], AS_OF).norm, AS_OF);
    expect(s.map((x) => x.stage)).toEqual(['permitFiled', 'permitIssued', 'construction']);
    const cut = cutSpells(s, d('2015-01-01'));
    expect(cut.map((x) => x.stage)).toEqual(['permitIssued', 'construction']);
  });

  it('keeps a Planning-side spell entering before 2015 by left truncation at 2015', () => {
    const h = hist('p1', 'discretionary', { filed: '2014-01-01' }, open('2020-01-01'));
    const s = buildSpells(normalise([h], AS_OF).norm, AS_OF);
    expect(s).toHaveLength(1);
    expect(s[0].a).toBe(d('2015-01-01') - d('2014-01-01'));
  });

  it('recomputes a for a left-truncated permit spell', () => {
    const h = hist(
      'p1',
      'permitOnly',
      { permitFiled: '2004-01-01', permitIssued: '2004-03-01' },
      open('2020-01-01')
    );
    const s = buildSpells(normalise([h], AS_OF).norm, AS_OF);
    expect(s[0].a).toBe(d('2007-01-01') - d('2004-03-01'));
    const cut = cutSpells(s, d('2015-01-01'));
    expect(cut[0].a).toBe(d('2015-01-01') - d('2004-03-01'));
    expect(cut[0].x).toBe(s[0].x);
    expect(cutSpells(s, d('2021-01-01'))).toEqual([]);
  });

  it('counts a history whose spells all end before 2007 once, and not one reaching 2007-01-01', () => {
    const pre = hist(
      'p1',
      'permitOnly',
      { permitFiled: '2003-01-01', permitIssued: '2004-01-01' },
      { kind: 'exit', stage: 'permitIssued', reason: 'expired', day: d('2005-06-01') }
    );
    const edge = hist(
      'p2',
      'permitOnly',
      { permitFiled: '2003-01-01', permitIssued: '2004-01-01' },
      { kind: 'exit', stage: 'permitIssued', reason: 'expired', day: d('2007-01-01') }
    );
    const later = hist('p3', 'permitOnly', { permitFiled: '2003-01-01' }, open('2012-01-01'));
    const n = normalise([pre, edge, later], AS_OF).norm;
    expect(preRollCount(n)).toBe(1);
    expect(buildSpells(n, AS_OF).map((s) => s.projectId)).toEqual(['p3', 'p2']);
  });
});
