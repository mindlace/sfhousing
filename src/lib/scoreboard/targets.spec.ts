import { describe, expect, it } from 'vitest';
import { RHNA_TIER_TARGETS as fromIndex } from '.';
import { M1_TARGETS, RHNA_TIER_TARGETS } from './targets';

const PRIMER =
  'https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/RHNA-Primer.pdf';

describe('M1_TARGETS', () => {
  it('registers rhna then rhna-buffer, in that order', () => {
    expect(M1_TARGETS.map((t) => t.id)).toEqual(['rhna', 'rhna-buffer']);
  });

  it('has the spec §4.2 labels, units and sources', () => {
    expect(M1_TARGETS[0]).toEqual({
      id: 'rhna',
      label: 'RHNA 2023–2031',
      units: 82069,
      source: { label: 'SF Planning, RHNA Primer', url: PRIMER }
    });
    expect(M1_TARGETS[1]).toEqual({
      id: 'rhna-buffer',
      label: 'RHNA + 15% buffer',
      units: 94379,
      source: { label: 'SF Planning, RHNA Primer', url: PRIMER }
    });
  });

  it('buffer units equal floor(82069 × 1.15)', () => {
    expect(M1_TARGETS[1].units).toBe(Math.floor(82069 * 1.15));
  });

  it('never sets range in M1', () => {
    for (const t of M1_TARGETS) expect(t.range).toBeUndefined();
  });

  it('is deep-frozen so no consumer can mutate the registry', () => {
    expect(Object.isFrozen(M1_TARGETS)).toBe(true);
    for (const t of M1_TARGETS) {
      expect(Object.isFrozen(t)).toBe(true);
      expect(Object.isFrozen(t.source)).toBe(true);
    }
  });
});

describe('RHNA_TIER_TARGETS', () => {
  const ABAG = {
    label: 'ABAG, Final RHNA Plan 2023–2031, Table 4',
    url: 'https://abag.ca.gov/sites/default/files/documents/2021-12/Final_RHNA_Allocation_Report_2023-2031-approved_0.pdf'
  };

  it('holds the four ABAG tier targets in order', () => {
    expect(RHNA_TIER_TARGETS).toEqual([
      {
        id: 'rhna-very-low',
        label: 'Very low income (under 50% of area median)',
        units: 20867,
        tier: 'veryLow',
        source: ABAG
      },
      {
        id: 'rhna-low',
        label: 'Low income (50% to 80% of area median)',
        units: 12014,
        tier: 'low',
        source: ABAG
      },
      {
        id: 'rhna-moderate',
        label: 'Moderate income (80% to 120% of area median)',
        units: 13717,
        tier: 'moderate',
        source: ABAG
      },
      {
        id: 'rhna-above-moderate',
        label: 'Above moderate income (over 120% of area median)',
        units: 35471,
        tier: 'aboveModerate',
        source: ABAG
      }
    ]);
  });

  it('sums to the rhna total of M1_TARGETS (82,069)', () => {
    const sum = RHNA_TIER_TARGETS.reduce((s, t) => s + t.units, 0);
    expect(sum).toBe(82069);
    expect(sum).toBe(M1_TARGETS.find((t) => t.id === 'rhna')!.units);
  });

  it('leaves M1_TARGETS at 82,069 and 94,379', () => {
    expect(M1_TARGETS.map((t) => t.units)).toEqual([82069, 94379]);
  });

  it('is deep-frozen like M1_TARGETS', () => {
    expect(Object.isFrozen(RHNA_TIER_TARGETS)).toBe(true);
    for (const t of RHNA_TIER_TARGETS) {
      expect(Object.isFrozen(t)).toBe(true);
      expect(Object.isFrozen(t.source)).toBe(true);
    }
  });

  it('is exported from $lib/scoreboard', () => {
    expect(fromIndex).toBe(RHNA_TIER_TARGETS);
  });
});
