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
