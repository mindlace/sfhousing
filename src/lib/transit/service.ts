// Per-stop derivations (transit spec §5.2). Pure functions of a TransitNetwork: an edited network
// gives new answers, nothing is stored.
import type { ModeId, Pattern, TransitNetwork } from './types';

export interface StopServiceEntry {
  routeKey: string;
  operatorId: string;
  routeName: string;
  mode: ModeId;
  /** Peak trips per hour. */
  tph: number;
  /** Trips per day. */
  tpd: number;
  /** Peak riders per hour: tph × vehicle capacity × cars. */
  cap: number;
}
export type StopService = StopServiceEntry[][];
export type StopClass = 'regional-rail' | 'rail' | 'bus';

export function routeKey(p: Pick<Pattern, 'operatorId' | 'routeId' | 'direction'>): string {
  return `${p.operatorId}:${p.routeId}:${p.direction}`;
}

export function stopService(net: TransitNetwork): StopService {
  const out: StopService = net.stops.map(() => []);
  for (const p of net.patterns) {
    const key = routeKey(p);
    const perTrip = net.vehicles[p.vehicle].capacity * p.cars;
    for (const s of p.stops) {
      const list = out[s.stop];
      const e = list.find((x) => x.routeKey === key);
      if (e) {
        e.tph += s.tph;
        e.tpd += s.tpd;
        e.cap += s.tph * perTrip;
      } else {
        list.push({
          routeKey: key,
          operatorId: p.operatorId,
          routeName: p.routeName,
          mode: p.mode,
          tph: s.tph,
          tpd: s.tpd,
          cap: s.tph * perTrip
        });
      }
    }
  }
  return out;
}

export function stopCapacity(net: TransitNetwork, service = stopService(net)): Float64Array {
  const out = new Float64Array(net.stops.length);
  service.forEach((list, i) => {
    for (const e of list) out[i] += e.cap;
  });
  return out;
}

const REGIONAL = new Set<ModeId>(['heavy-rail', 'commuter-rail']);
const RAIL = new Set<ModeId>(['light-rail', 'streetcar']);

export function stopClass(entries: readonly { mode: ModeId }[]): StopClass {
  if (entries.some((e) => REGIONAL.has(e.mode))) return 'regional-rail';
  if (entries.some((e) => RAIL.has(e.mode))) return 'rail';
  return 'bus';
}

/**
 * SB 79 tier, estimated (spec §5.2). Commuter trains/day are counted over the whole station
 * (every stop sharing the stop's stationId), because Caltrain splits directions by platform.
 */
export function sb79Tier(
  net: TransitNetwork,
  stop: number,
  service = stopService(net)
): 1 | 2 | null {
  const station = net.stops[stop].stationId;
  const members =
    station === null ? [stop] : net.stops.flatMap((s, i) => (s.stationId === station ? [i] : []));
  const entries = members.flatMap((i) => service[i]);
  if (entries.some((e) => e.mode === 'heavy-rail')) return 1;
  const commuterPerDay = entries
    .filter((e) => e.mode === 'commuter-rail')
    .reduce((n, e) => n + e.tpd, 0);
  if (commuterPerDay >= 72) return 1;
  if (entries.some((e) => RAIL.has(e.mode)) || commuterPerDay >= 48) return 2;
  return null;
}
