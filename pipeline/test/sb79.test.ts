// SB 79 as written (pipeline/lib/sb79.ts): stop tiers, bands, zone classes, the tallest standard
// and the per-lot row, with the statute density cap and the 5-unit minimum.
import { describe, expect, it } from 'vitest';
import type { ModeId, Pattern, Stop, TransitNetwork } from '../../src/lib/data/transit';
import { bandOf, bestStandard, sb79Row, stopTiers, unitsFor, zoneClassOf } from '../lib/sb79';

const stop = (id: string, stationId: string | null = null): Stop => ({
  id,
  name: id,
  lngLat: [-122.42, 37.76],
  stationId,
  placeId: stationId ?? id
});
const pattern = (id: string, mode: ModeId, stops: [number, number][]): Pattern => ({
  id,
  operatorId: id.split(':')[0],
  routeId: id,
  routeName: id,
  mode,
  direction: 0,
  vehicle: 'v',
  cars: 1,
  stops: stops.map(([s, tpd]) => ({ stop: s, tph: 1, tpd }))
});
const network = (stops: Stop[], patterns: Pattern[]): TransitNetwork => ({
  peak: { start: '07:00', end: '09:00' },
  operators: [],
  vehicles: { v: { label: 'v', seats: null, capacity: 1 } },
  stops,
  patterns
});

describe('stopTiers', () => {
  const platformA = 0;
  const platformB = 1;
  const lonely60 = 2;
  const lonely40 = 3;
  const net = network(
    [
      stop('ct:A', 'ct:S'),
      stop('ct:B', 'ct:S'),
      stop('ct:L60'),
      stop('ct:L40'),
      stop('bart:H'),
      stop('muni:LR'),
      stop('muni:SC'),
      stop('muni:bus'),
      stop('muni:3092'),
      stop('muni:cable')
    ],
    [
      pattern('ct:0', 'commuter-rail', [
        [platformA, 40],
        [lonely60, 60],
        [lonely40, 40]
      ]),
      pattern('ct:1', 'commuter-rail', [[platformB, 40]]),
      pattern('bart:0', 'heavy-rail', [[4, 1]]),
      pattern('muni:N', 'light-rail', [[5, 100]]),
      pattern('muni:F', 'streetcar', [[6, 100]]),
      // A bus that also calls at the light rail stop: the lowest tier wins.
      pattern('muni:22', 'bus', [
        [7, 200],
        [8, 200],
        [5, 200]
      ]),
      pattern('muni:C', 'cable-car', [[9, 100]]),
      // A listed tier-2 bus stop also on heavy rail: tier 1 wins.
      pattern('bart:1', 'heavy-rail', [[8, 1]])
    ]
  );
  const tiers = stopTiers(net);

  it('sums commuter-rail trains over the station, not the platform', () => {
    // two platforms of one station at 40 tpd each → 80 ≥ 72 → tier 1; one platform alone at 60 →
    // tier 2; 40 → none
    expect(tiers.get(platformA)).toBe(1);
    expect(tiers.get(platformB)).toBe(1);
    expect(tiers.get(lonely60)).toBe(2);
    expect(tiers.has(lonely40)).toBe(false);
  });

  it('heavy rail is tier 1, light rail and streetcar tier 2, plain bus none, a listed BRT stop tier 2', () => {
    expect(tiers.get(4)).toBe(1);
    expect(tiers.get(5)).toBe(2);
    expect(tiers.get(6)).toBe(2);
    expect(tiers.has(7)).toBe(false);
    expect(tiers.has(9)).toBe(false);
    // muni:3092 is in MUNI_TIER2_STOP_IDS but also on heavy rail here.
    expect(tiers.get(8)).toBe(1);
    const listed = stopTiers(network([stop('muni:3092')], [pattern('muni:49', 'bus', [[0, 100]])]));
    expect(listed.get(0)).toBe(2);
  });
});

describe('bands, zones and standards', () => {
  it('bands are inclusive at 200 ft, ¼ mi and ½ mi', () => {
    expect([
      bandOf(60.96),
      bandOf(60.97),
      bandOf(402.336),
      bandOf(804.672),
      bandOf(804.673)
    ]).toEqual([1, 2, 2, 3, 0]);
    expect(bandOf(0)).toBe(1);
  });

  it('takes the tallest standard across tiers; a tie goes to tier 1', () => {
    expect(bestStandard({ 1: 500, 2: 50 })).toEqual({ tier: 2, band: 1 });
    expect(bestStandard({ 1: 50, 2: 50 })).toEqual({ tier: 1, band: 1 });
    expect(bestStandard({ 1: 700, 2: 300 })).toEqual({ tier: 1, band: 3 });
    expect(bestStandard({ 2: 900 })).toBeNull();
    expect(bestStandard({})).toBeNull();
  });

  it('classifies split and unlisted zoning codes', () => {
    expect(zoneClassOf('RH-1|PDR-1-G').zoneClass).toBe('residential');
    expect(zoneClassOf('PDR-1-G').zoneClass).toBe('excluded');
    expect(zoneClassOf('XYZ').zoneClass).toBe('unlisted');
    expect(zoneClassOf(null).zoneClass).toBe('unlisted');
    expect(zoneClassOf('').zoneClass).toBe('unlisted');
    expect(zoneClassOf('XYZ|M-1').zoneClass).toBe('excluded');
    expect(zoneClassOf('C-2|NCT-3')).toEqual({ zoneClass: 'mixed', principallyResidential: true });
    expect(zoneClassOf('WMUO').principallyResidential).toBe(false);
  });

  it('unitsFor rounds up by default and takes a rounding', () => {
    expect(unitsFor(120, 100)).toBe(3);
    expect(unitsFor(120, 100, 1, 'floor')).toBe(2);
    expect(unitsFor(120, 100, 1, 'round')).toBe(3);
    expect(unitsFor(100, 4046.8564224, 0.5, 'round')).toBe(50);
    expect(unitsFor(1, 0.5 * 4046.8564224, 1, 'round')).toBe(1); // half up
    expect(unitsFor(160, 4046.8564224)).toBe(160);
  });
});

describe('sb79Row', () => {
  it('sb79Row caps at the statute density and applies the 5-unit minimum per fill level', () => {
    const base = {
      best: { tier: 1, band: 2 },
      eligible: true,
      zone: 'residential',
      rentControlLikely: false,
      existingUnits: 0
    } as const;
    // 4046.8564224 m² = 1 acre → tier 1 quarter cap 120; grossAt = 20 per story
    expect(sb79Row({ ...base, lotAreaM2: 4046.8564224, grossAt: (s) => 20 * s })).toMatchObject({
      status: 'applies',
      stories: 7,
      cap: 120,
      yield: [40, 80, 100, 120, 120],
      uncappedTop: 140
    });
    expect(sb79Row({ ...base, lotAreaM2: 100, grossAt: (s) => s }).status).toBe('min-units'); // cap ≤ 3
    // §65912.157(h): more than two rent-controlled units. A 2-unit pre-1979 lot is not excluded,
    // a 3-unit one is.
    const old = {
      ...base,
      rentControlLikely: true,
      lotAreaM2: 4046.8564224,
      grossAt: (s: number) => 20 * s
    };
    expect(sb79Row({ ...old, existingUnits: 2 }).status).toBe('applies');
    expect(sb79Row({ ...old, existingUnits: 3 }).status).toBe('rent-control');
    expect(sb79Row({ ...old, rentControlLikely: false, existingUnits: 3 }).status).toBe('applies');
    expect(
      sb79Row({
        ...base,
        eligible: false,
        rentControlLikely: true,
        lotAreaM2: 1,
        grossAt: (s) => s
      }).status
    ).toBe('not-eligible');
  });

  it('zeroes fill levels below 5 units, and gives the other statuses no stories, cap or yield', () => {
    const base = {
      best: { tier: 2, band: 3 },
      eligible: true,
      zone: 'mixed',
      rentControlLikely: false,
      existingUnits: 0,
      lotAreaM2: 4046.8564224
    } as const;
    // Tier 2 half: 55 ft → 5 stories, fill [1, 3, 4, 5, 5] × 2 = [2, 6, 8, 10, 10].
    expect(sb79Row({ ...base, grossAt: (s) => 2 * s })).toMatchObject({
      status: 'applies',
      stories: 5,
      cap: 80,
      yield: [0, 6, 8, 10, 10],
      uncappedTop: 10
    });
    const empty = { stories: 0, cap: null, yield: [0, 0, 0, 0, 0] };
    expect(sb79Row({ ...base, best: null, grossAt: (s) => s })).toMatchObject({
      status: 'outside',
      ...empty
    });
    expect(sb79Row({ ...base, zone: 'excluded', grossAt: (s) => 9 * s })).toMatchObject({
      status: 'zone',
      ...empty
    });
    expect(sb79Row({ ...base, zone: 'unlisted', grossAt: (s) => 9 * s }).status).toBe('zone');
    expect(sb79Row({ ...base, grossAt: () => 4 })).toMatchObject({ status: 'min-units', ...empty });
    // The cap at or below the existing homes gives 0 (capScenarioYield), so min-units.
    expect(
      sb79Row({ ...base, lotAreaM2: 202, existingUnits: 4, grossAt: (s) => 9 * s }).status
    ).toBe('min-units');
  });
});
