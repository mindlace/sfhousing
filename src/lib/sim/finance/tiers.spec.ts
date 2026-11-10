import { describe, expect, it } from 'vitest';
import {
  AMI_TIER_BOUNDS,
  ASSUMED_TENURE,
  DISPLACEMENT_RANGE,
  INCLUSIONARY,
  inclusionaryUnits,
  tierOfAmi
} from './tiers';

const ZERO = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0 };

describe('tierOfAmi', () => {
  it('maps shares of area median income to tiers', () => {
    expect(tierOfAmi(0.5)).toBe('veryLow');
    expect(tierOfAmi(0.55)).toBe('low');
    expect(tierOfAmi(0.8)).toBe('low');
    expect(tierOfAmi(0.81)).toBe('moderate');
    expect(tierOfAmi(1.1)).toBe('moderate');
    expect(tierOfAmi(1.2)).toBe('moderate');
    expect(tierOfAmi(1.3)).toBe('aboveModerate');
  });
  it('throws RangeError for negative or non-finite shares', () => {
    expect(() => tierOfAmi(-0.1)).toThrow(RangeError);
    expect(() => tierOfAmi(NaN)).toThrow(RangeError);
    expect(() => tierOfAmi(Infinity)).toThrow(RangeError);
  });
  it('has tier 1 bounds', () => {
    expect(AMI_TIER_BOUNDS.value).toEqual({ veryLow: 0.5, low: 0.8, moderate: 1.2 });
    expect(AMI_TIER_BOUNDS.provenance.tier).toBe(1);
  });
});

describe('INCLUSIONARY', () => {
  it('equals the table of spec 4.6', () => {
    expect(INCLUSIONARY.value).toEqual({
      rental: [
        { minHomes: 10, maxHomes: 24, ami: [0.55], basisPoints: [1500] },
        { minHomes: 25, maxHomes: null, ami: [0.55, 0.8, 1.1], basisPoints: [1000, 400, 400] }
      ],
      ownership: [
        { minHomes: 10, maxHomes: 24, ami: [0.8], basisPoints: [1500] },
        { minHomes: 25, maxHomes: null, ami: [0.8, 1.05, 1.3], basisPoints: [1000, 500, 500] }
      ]
    });
    expect(INCLUSIONARY.provenance.tier).toBe(1);
  });
  it('states the rounding rule as tier 4 and that the 2028 rise is not applied', () => {
    const m = INCLUSIONARY.provenance.method;
    expect(m).toMatch(/rounding/i);
    expect(m).toMatch(/tier 4/);
    expect(m).toMatch(/2028/);
    expect(m).toMatch(/not applied/);
  });
  it('assumes rental tenure at tier 2', () => {
    expect(ASSUMED_TENURE.value).toBe('rental');
    expect(ASSUMED_TENURE.provenance.tier).toBe(2);
  });
});

describe('inclusionaryUnits', () => {
  it('gives zeros below 10 homes', () => {
    expect(inclusionaryUnits(9)).toEqual(ZERO);
    expect(inclusionaryUnits(0)).toEqual(ZERO);
  });
  it('rounds at the band edges', () => {
    expect(inclusionaryUnits(10)).toEqual({ ...ZERO, low: 2 });
    expect(inclusionaryUnits(13)).toEqual({ ...ZERO, low: 2 });
    expect(inclusionaryUnits(24)).toEqual({ ...ZERO, low: 4 });
    expect(inclusionaryUnits(25)).toEqual({ ...ZERO, low: 4, moderate: 1 });
  });
  it('splits 130 homes', () => {
    expect(inclusionaryUnits(130)).toEqual({ ...ZERO, low: 18, moderate: 5 });
    expect(inclusionaryUnits(130)).toEqual(inclusionaryUnits(130, 'rental'));
  });
  it('sends an ownership tie to the lower-income tier', () => {
    expect(inclusionaryUnits(130, 'ownership')).toEqual({
      veryLow: 0,
      low: 13,
      moderate: 7,
      aboveModerate: 6
    });
  });
  it('throws for non-integers and negatives', () => {
    expect(() => inclusionaryUnits(1.5)).toThrow(RangeError);
    expect(() => inclusionaryUnits(-1)).toThrow(RangeError);
    expect(() => inclusionaryUnits(NaN)).toThrow(RangeError);
  });
});

describe('DISPLACEMENT_RANGE', () => {
  it('is 0.115 to 0.8 at tier 3 with both studies', () => {
    expect(DISPLACEMENT_RANGE.value).toEqual({ low: 0.115, high: 0.8 });
    expect(DISPLACEMENT_RANGE.provenance.tier).toBe(3);
    const urls = DISPLACEMENT_RANGE.provenance.sources.map((s) => s.url);
    expect(urls).toContain('https://conference.nber.org/conf_papers/f240610/f240610.slides.pdf');
    expect(urls).toContain(
      'https://economics.sas.upenn.edu/system/files/2024-08/Empirical%20Micro%2010312024.pdf'
    );
  });
});
