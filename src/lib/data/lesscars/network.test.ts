import { describe, expect, it } from 'vitest';
import type { ModeId, Pattern, Stop, TransitNetwork } from '../transit';
import { TINY_PLAN } from './fixtures/tiny-plan';
import { PLAN_MODE, networkAt, transitOpenDays } from './network';
import { schedulePlan } from './schedule';

const stop = (id: string): Stop => ({
  id,
  name: id,
  lngLat: [-122.42, 37.76],
  stationId: null,
  placeId: id
});
const pattern = (id: string, routeId: string, mode: ModeId, stops: number[]): Pattern => ({
  id,
  operatorId: 'muni',
  routeId,
  routeName: routeId,
  mode,
  direction: 0,
  vehicle: mode === 'bus' ? 'muni-bus-40' : 'muni-lrv4',
  cars: 1,
  stops: stops.map((s) => ({ stop: s, tph: 4, tpd: 60 }))
});
const BASE: TransitNetwork = {
  peak: { start: '07:00', end: '09:00' },
  operators: [],
  vehicles: {
    'muni-bus-40': { label: 'bus', seats: 30, capacity: 44 },
    'muni-bus-60': { label: 'bus', seats: 45, capacity: 69 },
    'muni-lrv4': { label: 'lrv', seats: 60, capacity: 139 }
  },
  stops: [stop('existing-1'), stop('muni:n1'), stop('muni:n2')],
  patterns: [pattern('muni:14:0', '14', 'bus', [0]), pattern('muni:N:0', 'N', 'light-rail', [1, 2])]
};
const S = schedulePlan(TINY_PLAN);
const times = (id: string) => S.times.get(id)!;

describe('networkAt', () => {
  it('a subway opens as heavy-rail patterns on its open day and not the day before', () => {
    const open = times('subway').openDay;
    const before = networkAt(BASE, TINY_PLAN, S, open - 1).net;
    expect(before.patterns.filter((p) => p.mode === 'heavy-rail')).toEqual([]);
    expect(before.stops.map((s) => s.id)).toEqual(BASE.stops.map((s) => s.id));
    const { net } = networkAt(BASE, TINY_PLAN, S, open);
    const heavy = net.patterns.filter((p) => p.mode === 'heavy-rail');
    expect(PLAN_MODE.subway).toBe('heavy-rail');
    expect(heavy.map((p) => p.direction)).toEqual([0, 1]);
    const ids = (p: Pattern) => p.stops.map((s) => net.stops[s.stop].id);
    expect(ids(heavy[0])).toEqual(['lc:a', 'lc:b', 'existing-1']);
    expect(ids(heavy[1])).toEqual(['existing-1', 'lc:b', 'lc:a']);
    expect(heavy[0].stops.every((s) => s.tph === 20 && s.tpd === 0)).toBe(true);
    // New stops are appended, so base stop indexes are unchanged.
    expect(net.stops.slice(0, BASE.stops.length)).toEqual(BASE.stops);
    expect(net.stops.find((s) => s.id === 'lc:a')!.lngLat).toEqual([-122.43, 37.77]);
    // The base network is not mutated.
    expect(BASE.patterns).toHaveLength(2);
    expect(BASE.stops).toHaveLength(3);
  });

  it('bus-lane stop ids join tier2Ids on the open day; tram-priority changes tph, not tier', () => {
    const bus = times('buslane').openDay;
    expect(networkAt(BASE, TINY_PLAN, S, bus - 1).tier2Ids.has('existing-1')).toBe(false);
    expect(networkAt(BASE, TINY_PLAN, S, bus).tier2Ids.has('existing-1')).toBe(true);
    const tram = times('tram').openDay;
    const nBefore = networkAt(BASE, TINY_PLAN, S, tram - 1).net.patterns.find(
      (p) => p.routeId === 'N'
    )!;
    const at = networkAt(BASE, TINY_PLAN, S, tram);
    const n = at.net.patterns.find((p) => p.routeId === 'N')!;
    expect(nBefore.stops.map((s) => s.tph)).toEqual([4, 4]);
    expect(n.stops.map((s) => s.tph)).toEqual([12, 12]);
    expect(n.mode).toBe('light-rail');
    expect(n.stops.map((s) => s.tpd)).toEqual([60, 60]);
    expect(at.tier2Ids.has('muni:n1')).toBe(false);
  });

  it('transitOpenDays is sorted and unique', () => {
    const days = transitOpenDays(TINY_PLAN, S);
    expect(days).toEqual([...new Set(days)].sort((a, b) => a - b));
    expect(new Set(days)).toEqual(
      new Set(['subway', 'tram', 'buslane'].map((id) => times(id).openDay))
    );
  });
});
