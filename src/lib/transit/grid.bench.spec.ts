// Budget (transit spec §5.3): buildAccessGrid ≤ 100 ms for an SF-sized network. Synthetic:
// 3,500 stops over 12 km × 12 km, 600 route-directions of 30 stops.
import { describe, expect, it } from 'vitest';
import type { TransitNetwork } from '$lib/data/transit';
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { buildAccessGrid } from './grid';
import { stopService } from './service';

function synth(): TransitNetwork {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const stops = Array.from({ length: 3500 }, (_, i) => ({
    id: `s${i}`,
    name: `s${i}`,
    lngLat: [
      LNG0 + (rnd() * 12000 - 6000) / M_PER_DEG_LNG,
      LAT0 + (rnd() * 12000 - 6000) / M_PER_DEG_LAT
    ] as [number, number],
    stationId: null,
    placeId: `s${i}`
  }));
  const patterns = Array.from({ length: 600 }, (_, k) => ({
    id: `p${k}`,
    operatorId: 'muni',
    routeId: `${k >> 1}`,
    routeName: `${k >> 1}`,
    mode: 'bus' as const,
    direction: (k & 1) as 0 | 1,
    vehicle: 'bus',
    cars: 1,
    stops: Array.from({ length: 30 }, () => ({ stop: Math.floor(rnd() * 3500), tph: 6, tpd: 100 }))
  }));
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }],
    vehicles: { bus: { label: 'b', seats: 30, capacity: 44 } },
    stops,
    patterns
  };
}

describe('buildAccessGrid budget', () => {
  it('builds an SF-sized grid in ≤ 100 ms (best of 3)', () => {
    const net = synth();
    const service = stopService(net);
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      buildAccessGrid(net, undefined, undefined, service);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThanOrEqual(100);
  });
});
