import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AMI_JSON, parseAmiFile } from '../../enrichment/ami-schema';
import { PARKING_JSON, parseParkingFile } from '../../enrichment/parking-schema';

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

const cite = {
  label: 'Strategic Economics, Hub memo, 2017-01-18',
  url: 'https://default.sfplanning.org/plans-and-programs/in-your-neighborhood/hub/x.pdf',
  page: 'p. 21, Figure 16',
  accessed: '2026-11-24'
};

const ratio = (value: number) => ({
  value,
  tier: 3,
  sources: [cite],
  method: 'King County Right Size Parking, supply 1.4 per unit used 1.0'
});

function withCost(over: Record<string, unknown>) {
  return {
    costPerSpace: {
      surface: null,
      podium: null,
      belowGrade: {
        value: 80000,
        dollarsYear: 2016,
        sources: [{ ...cite, sf: true }],
        method: 'Read from Figure 16',
        ...over
      }
    },
    supplyOverUse: ratio(1.4),
    searched: ['Controller 2026 pro formas']
  };
}

const nullCost = (searched: string[]) => ({
  costPerSpace: null,
  supplyOverUse: ratio(1.4),
  searched
});

const withRatio = (value: number) => ({ ...withCost({}), supplyOverUse: ratio(value) });

describe('parseParkingFile', () => {
  it('accepts a cited SF cost', () => {
    expect(parseParkingFile(withCost({})).costPerSpace?.belowGrade?.value).toBe(80000);
  });

  it('rejects a cost whose sources hold no SF source', () => {
    expect(() => parseParkingFile(withCost({ sources: [{ ...cite, sf: false }] }))).toThrow(/sf/);
  });

  it('rejects a cost with no sources', () => {
    expect(() => parseParkingFile(withCost({ sources: [] }))).toThrow(/sources/);
  });

  it('rejects a cost without a url or page', () => {
    expect(() =>
      parseParkingFile(withCost({ sources: [{ ...cite, url: '', sf: true }] }))
    ).toThrow();
    expect(() =>
      parseParkingFile(withCost({ sources: [{ ...cite, page: '', sf: true }] }))
    ).toThrow();
  });

  it('rejects an invented cost: a tier or invented flag is not part of the live schema', () => {
    expect(() => parseParkingFile(withCost({ tier: 4 }))).toThrow();
  });

  it('rejects a costPerSpace whose every type is null', () => {
    const v = {
      ...nullCost(['x']),
      costPerSpace: { surface: null, podium: null, belowGrade: null }
    };
    expect(() => parseParkingFile(v)).toThrow(/costPerSpace/);
  });

  it('accepts costPerSpace null with what was searched', () => {
    expect(parseParkingFile(nullCost(['Controller 2026 pro formas'])).costPerSpace).toBeNull();
  });

  it('rejects costPerSpace null with nothing searched', () => {
    expect(() => parseParkingFile(nullCost([]))).toThrow(/searched/);
  });

  it('rejects supplyOverUse below 1', () => {
    expect(() => parseParkingFile(withRatio(0.9))).toThrow();
  });

  it('parses the committed parking.json and ami.json', () => {
    expect(parseParkingFile(readJson(PARKING_JSON)).searched.length).toBeGreaterThan(0);
    expect(parseAmiFile(readJson(AMI_JSON)).years[0].bySize).toHaveLength(8);
  });
});
