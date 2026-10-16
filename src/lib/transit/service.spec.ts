import { describe, expect, it } from 'vitest';
import { routeKey, sb79Tier, stopCapacity, stopClass, stopService } from './service';
import { net } from './test/test-network';

describe('stopService / stopCapacity', () => {
  it('sums patterns of one route-direction at a stop, cap = tph × capacity × cars', () => {
    const s = stopService(net());
    expect(s[0]).toEqual([
      {
        routeKey: 'muni:22:0',
        operatorId: 'muni',
        routeName: '22',
        mode: 'bus',
        tph: 8,
        tpd: 80,
        cap: 8 * 44
      }
    ]);
    expect(stopCapacity(net())[1]).toBe(2 * 44 + 5 * 139 * 2);
    expect(stopCapacity(net())[4]).toBe(4 * 107 * 10);
  });

  it('recomputes from an edited network (nothing is baked)', () => {
    const n = net();
    n.patterns[2] = { ...n.patterns[2], cars: 1 };
    expect(stopCapacity(n)[1]).toBe(2 * 44 + 5 * 139);
  });

  it('builds route keys from operator, route and direction', () => {
    expect(routeKey({ operatorId: 'bart', routeId: '7', direction: 1 })).toBe('bart:7:1');
  });
});

describe('stopClass', () => {
  it('classes by the highest mode served', () => {
    const s = stopService(net());
    expect(stopClass(s[0])).toBe('bus');
    expect(stopClass(s[1])).toBe('rail');
    expect(stopClass(s[2])).toBe('regional-rail');
    expect(stopClass(s[4])).toBe('regional-rail');
    expect(stopClass([])).toBe('bus');
  });
});

describe('sb79Tier', () => {
  it('heavy rail is tier 1, light rail tier 2, bus-only null', () => {
    expect(sb79Tier(net(), 4)).toBe(1);
    expect(sb79Tier(net(), 1)).toBe(2);
    expect(sb79Tier(net(), 0)).toBeNull();
  });

  it('counts commuter trains across the whole station (both direction platforms)', () => {
    // 40 + 40 = 80 trains/day at station "ct" ≥ 72: tier 1, on either platform.
    expect(sb79Tier(net(), 2)).toBe(1);
    expect(sb79Tier(net(), 3)).toBe(1);
    const n = net();
    n.patterns[3] = { ...n.patterns[3], stops: [{ stop: 2, tph: 2.5, tpd: 20 }] };
    expect(sb79Tier(n, 3)).toBe(2); // 60/day: ≥ 48
    n.patterns[4] = { ...n.patterns[4], stops: [{ stop: 3, tph: 2.5, tpd: 20 }] };
    expect(sb79Tier(n, 3)).toBeNull(); // 40/day
  });

  it('a single 40/day platform with no station grouping is below tier 2', () => {
    const n = net();
    n.stops[2] = { ...n.stops[2], stationId: null };
    expect(sb79Tier(n, 2)).toBeNull();
  });
});
