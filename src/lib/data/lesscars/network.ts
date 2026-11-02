// The transit network as a /lesscars plan has built it by a day: transit.json plus the plan's
// transit projects that have opened. Pure; relative imports only, so the pipeline and the page
// rebuild any snapshot the same way.
//
// Builder's calls:
// - No snapshot is stored: transit.json plus plan.json rebuild any day's network through
//   networkAt, on the pipeline and the page alike.
// - A transit line runs one pattern per direction (direction 0 in plan stop order, 1 reversed) at
//   its peakTph at every stop, with tpd 0: plan lines are never commuter rail, so tpd counts for
//   nothing in SB 79 tiers. Its operator is 'lc', its route id the project id.
// - Vehicles reuse transit.json's Muni entries: a subway or tram runs 2-car LRV4 trains (Muni
//   Metro's subway consist), BRT 60 ft articulated buses. networkAt throws when the base network
//   lacks the vehicle.
// - Tram priority and bus lanes raise (never lower) tph to their peakTph on the patterns of their
//   route ids, matched on `routeId` within the mode family the project serves (tram priority:
//   light rail and streetcar; bus lanes: bus), so a bare route id cannot reach another
//   operator's rail line. tpd is unchanged, so no tier changes.
// - A stop id already in the network (an existing stop, or an lc: stop another opened line
//   added) is reused, not duplicated.
import type { Day } from '../../timelapse/time';
import type { ModeId, Pattern, Stop, TransitNetwork, VehicleId } from '../transit';
import { TRANSIT_KINDS, type LessCarsPlan, type TransitMode } from './plan';
import type { PlanSchedule } from './schedule';

export const PLAN_MODE: Record<TransitMode, ModeId> = {
  subway: 'heavy-rail',
  tram: 'light-rail',
  brt: 'bus'
};

const PLAN_VEHICLE: Record<TransitMode, { vehicle: VehicleId; cars: number }> = {
  subway: { vehicle: 'muni-lrv4', cars: 2 },
  tram: { vehicle: 'muni-lrv4', cars: 2 },
  brt: { vehicle: 'muni-bus-60', cars: 1 }
};

/** The modes whose patterns a tram priority or bus lane serves (and raises), by `routeId`. */
export const RAISE_MODES: Record<'tram-priority' | 'bus-lane', readonly ModeId[]> = {
  'tram-priority': ['light-rail', 'streetcar'],
  'bus-lane': ['bus']
};

function openBy(s: PlanSchedule, id: string, day: Day): boolean {
  const t = s.times.get(id);
  if (!t) throw new Error(`lesscars: project ${id} is not scheduled`);
  return t.openDay <= day;
}

/**
 * The network on `day`: `base` plus, for each transit line open by `day`, its new stops and one
 * pattern per direction at peakTph (tpd 0); tram priority and bus lanes open by `day` raise tph on
 * their routes. `tier2Ids` are the bus-lane stop ids and BRT stops open by `day` (the caller
 * unions MUNI_TIER2_STOP_IDS). `base` is not mutated. Throws on an unknown existing stop, a
 * missing vehicle or an unscheduled project.
 */
export function networkAt(
  base: TransitNetwork,
  plan: LessCarsPlan,
  s: PlanSchedule,
  day: Day
): { net: TransitNetwork; tier2Ids: Set<string> } {
  const stops: Stop[] = [...base.stops];
  const index = new Map(stops.map((st, i) => [st.id, i]));
  const patterns: Pattern[] = base.patterns.map((p) => ({ ...p }));
  const tier2Ids = new Set<string>();
  const added: Pattern[] = [];
  for (const p of plan.projects) {
    if (!TRANSIT_KINDS.includes(p.kind) || !openBy(s, p.id, day)) continue;
    if (p.kind === 'transit-line') {
      const { vehicle, cars } = PLAN_VEHICLE[p.mode];
      if (!(vehicle in base.vehicles))
        throw new Error(`lesscars: ${p.id} needs vehicle ${vehicle}, absent from the network`);
      const idx = p.stops.map((ps) => {
        let i = index.get(ps.id);
        if (i === undefined) {
          if (ps.lngLat === null) throw new Error(`lesscars: ${p.id} names unknown stop ${ps.id}`);
          i = stops.length;
          stops.push({
            id: ps.id,
            name: ps.name,
            lngLat: ps.lngLat,
            stationId: null,
            placeId: ps.id
          });
          index.set(ps.id, i);
        }
        return i;
      });
      if (p.mode === 'brt') for (const ps of p.stops) tier2Ids.add(ps.id);
      const tph = p.peakTph.value;
      for (const direction of [0, 1] as const) {
        const order = direction === 0 ? idx : [...idx].reverse();
        added.push({
          id: `lc:${p.id}:${direction}`,
          operatorId: 'lc',
          routeId: p.id,
          routeName: p.label,
          mode: PLAN_MODE[p.mode],
          direction,
          vehicle,
          cars,
          stops: order.map((stop) => ({ stop, tph, tpd: 0 }))
        });
      }
    } else if (p.kind === 'tram-priority' || p.kind === 'bus-lane') {
      if (p.kind === 'bus-lane') for (const id of p.stopIds) tier2Ids.add(id);
      const modes = RAISE_MODES[p.kind];
      const tph = p.peakTph.value;
      patterns.forEach((pt, k) => {
        if (!p.routeIds.includes(pt.routeId) || !modes.includes(pt.mode)) return;
        if (pt.stops.every((x) => x.tph >= tph)) return;
        patterns[k] = { ...pt, stops: pt.stops.map((x) => ({ ...x, tph: Math.max(x.tph, tph) })) };
      });
    }
  }
  return { net: { ...base, stops, patterns: [...patterns, ...added] }, tier2Ids };
}

/** The open days of the plan's transit projects, sorted and unique. */
export function transitOpenDays(plan: LessCarsPlan, s: PlanSchedule): Day[] {
  const days = new Set<Day>();
  for (const p of plan.projects) {
    if (!TRANSIT_KINDS.includes(p.kind)) continue;
    const t = s.times.get(p.id);
    if (!t) throw new Error(`lesscars: project ${p.id} is not scheduled`);
    days.add(t.openDay);
  }
  return [...days].sort((a, b) => a - b);
}
