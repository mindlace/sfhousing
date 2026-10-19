// SFBC §106A.4.4 Table B by era (spec 4.6, Ruling E2): era choice, bracket boundaries, the
// site-permit +50% and the deadline.
import { describe, expect, it } from 'vitest';
import {
  E1_FROM,
  E2_FROM,
  E3_FILED_FROM,
  bracketOf,
  completionDays,
  eraOf,
  extensionDays,
  permitDeadline
} from '../../project-records/expiry';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

describe('eraOf (Ruling E2)', () => {
  it('chooses E0/E1/E2 by issued day', () => {
    expect(eraOf({ issuedDay: d('2005-01-01'), filedDay: d('2004-01-01') })).toBe('E0');
    expect(eraOf({ issuedDay: E1_FROM - 1, filedDay: null })).toBe('E0');
    expect(eraOf({ issuedDay: E1_FROM, filedDay: null })).toBe('E1');
    expect(eraOf({ issuedDay: E2_FROM - 1, filedDay: null })).toBe('E1');
    expect(eraOf({ issuedDay: E2_FROM, filedDay: null })).toBe('E2');
  });

  it('E3 needs a filed day on or after 2026-06-21; an earlier filing keeps E2 for life', () => {
    expect(E3_FILED_FROM).toBe(d('2026-06-21'));
    expect(eraOf({ issuedDay: d('2026-08-01'), filedDay: E3_FILED_FROM })).toBe('E3');
    expect(eraOf({ issuedDay: d('2026-08-01'), filedDay: E3_FILED_FROM - 1 })).toBe('E2');
    expect(eraOf({ issuedDay: d('2026-08-01'), filedDay: null })).toBe('E2');
  });

  it('is null without an issued day', () => {
    expect(eraOf({ issuedDay: null, filedDay: d('2020-01-01') })).toBeNull();
  });
});

describe('Table B brackets', () => {
  it('E0: $300,000 inclusive / $2,499,999 / above', () => {
    expect(
      [300_000, 300_001, 2_499_999, 2_500_000].map((v) => completionDays('E0', v, false))
    ).toEqual([360, 1080, 1080, 1440]);
    expect([300_000, 300_001, 2_499_999, 2_500_000].map((v) => extensionDays('E0', v))).toEqual([
      90, 180, 180, 360
    ]);
  });

  it('E1: $100,000 / $2,499,999 / above', () => {
    expect(
      [100_000, 100_001, 2_499_999, 2_500_000].map((v) => completionDays('E1', v, false))
    ).toEqual([360, 1080, 1080, 1440]);
    expect([100_000, 100_001, 2_499_999, 2_500_000].map((v) => extensionDays('E1', v))).toEqual([
      180, 180, 180, 360
    ]);
  });

  it('E2: $100,000 / $2,499,999 / above', () => {
    expect(
      [100_000, 100_001, 2_499_999, 2_500_000].map((v) => completionDays('E2', v, false))
    ).toEqual([360, 1080, 1080, 1440]);
    expect([100_000, 100_001, 2_499_999, 2_500_000].map((v) => extensionDays('E2', v))).toEqual([
      360, 720, 720, 720
    ]);
  });

  it('E3 has no completion maximum', () => {
    expect(completionDays('E3', 50_000, false)).toBeNull();
    expect(completionDays('E3', 9e9, true)).toBeNull();
  });

  it('a site permit valued $2.5M or more gets +50% (2,160 days); a full permit does not', () => {
    for (const era of ['E0', 'E1', 'E2'] as const) {
      expect(completionDays(era, 2_500_000, true)).toBe(2160);
      expect(completionDays(era, 2_499_999, true)).toBe(1080);
      expect(completionDays(era, 2_500_000, false)).toBe(1440);
    }
  });

  it('no valuation takes the middle bracket, without the site-permit +50%', () => {
    expect(bracketOf('E0', null)).toEqual(bracketOf('E0', 1_000_000));
    expect(bracketOf('E2', null)).toEqual(bracketOf('E2', 1_000_000));
    expect(completionDays('E2', null, true)).toBe(1080);
  });
});

describe('permitDeadline', () => {
  const p = (o: Partial<Parameters<typeof permitDeadline>[0]>) => ({
    issuedDay: d('2005-03-01'),
    filedDay: d('2004-06-01'),
    valuation: 200_000,
    sitePermit: true,
    ...o
  });

  it('is issued + completion + the one extension', () => {
    expect(permitDeadline(p({}))).toBe(d('2005-03-01') + 360 + 90);
    expect(permitDeadline(p({ issuedDay: d('2015-01-01'), valuation: 3e6 }))).toBe(
      d('2015-01-01') + 2160 + 720
    );
  });

  it('is null with no issued day, or in E3 (never expires under this rule)', () => {
    expect(permitDeadline(p({ issuedDay: null }))).toBeNull();
    expect(permitDeadline(p({ issuedDay: d('2026-07-01'), filedDay: d('2026-06-22') }))).toBeNull();
  });
});
