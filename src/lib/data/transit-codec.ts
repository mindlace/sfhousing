// Wire format "sfh-transit/1" (transit spec §4.3). Pure TS, no dependencies: the pipeline writes
// it and the map reads it.
import { MODE_IDS, type ModeId, type Pattern, type TransitNetwork } from './transit';

export const TRANSIT_FORMAT = 'sfh-transit/1';

export class TransitFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitFormatError';
  }
}

const e6 = (v: number) => Math.round(v * 1e6);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min;

export function encodeTransit(net: TransitNetwork): string {
  const opIx = new Map(net.operators.map((o, i) => [o.id, i]));
  const vehicleIds = Object.keys(net.vehicles).sort();
  return JSON.stringify({
    format: TRANSIT_FORMAT,
    peak: { start: net.peak.start, end: net.peak.end },
    operators: net.operators.map((o) => ({ id: o.id, label: o.label, serviceDate: o.serviceDate })),
    vehicles: Object.fromEntries(
      vehicleIds.map((k) => {
        const v = net.vehicles[k];
        return [k, { label: v.label, seats: v.seats, capacity: v.capacity }];
      })
    ),
    stops: {
      id: net.stops.map((s) => s.id),
      name: net.stops.map((s) => s.name),
      lng: net.stops.map((s) => e6(s.lngLat[0])),
      lat: net.stops.map((s) => e6(s.lngLat[1])),
      station: net.stops.map((s) => s.stationId),
      place: net.stops.map((s) => s.placeId)
    },
    patterns: net.patterns.map((p) => {
      const operator = opIx.get(p.operatorId);
      if (operator === undefined)
        throw new TransitFormatError(`pattern ${p.id}: unknown operator ${p.operatorId}`);
      return {
        id: p.id,
        operator,
        route: p.routeId,
        routeName: p.routeName,
        mode: p.mode,
        direction: p.direction,
        vehicle: p.vehicle,
        cars: p.cars,
        stops: p.stops.map((s) => s.stop),
        tph: p.stops.map((s) => Math.round(s.tph * 10)),
        tpd: p.stops.map((s) => Math.round(s.tpd))
      };
    })
  });
}

function column(o: Record<string, unknown>, key: string, len: number): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new TransitFormatError(`stops.${key} is not an array`);
  if (v.length !== len)
    throw new TransitFormatError(`stops.${key} has ${v.length} entries, want ${len}`);
  return v;
}

export function decodeTransit(json: unknown): TransitNetwork {
  let w: unknown = json;
  if (typeof w === 'string') {
    try {
      w = JSON.parse(w);
    } catch (e) {
      throw new TransitFormatError(`invalid JSON: ${(e as Error).message}`);
    }
  }
  if (!isObj(w)) throw new TransitFormatError('transit is not an object');
  if (w.format !== TRANSIT_FORMAT)
    throw new TransitFormatError(`unknown format ${String(w.format)}`);
  const peak = w.peak;
  if (!isObj(peak) || typeof peak.start !== 'string' || typeof peak.end !== 'string')
    throw new TransitFormatError('bad peak');
  if (!Array.isArray(w.operators)) throw new TransitFormatError('operators is not an array');
  const operators = w.operators.map((o, i) => {
    if (!isObj(o) || typeof o.id !== 'string' || typeof o.label !== 'string')
      throw new TransitFormatError(`operators.${i} is invalid`);
    if (typeof o.serviceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.serviceDate))
      throw new TransitFormatError(`operators.${i}.serviceDate is invalid`);
    return { id: o.id, label: o.label, serviceDate: o.serviceDate };
  });
  if (!isObj(w.vehicles)) throw new TransitFormatError('vehicles is not an object');
  // Null prototype: a `__proto__` key is an ordinary entry, and no inherited name is a vehicle.
  const vehicles: TransitNetwork['vehicles'] = Object.create(null);
  for (const [k, v] of Object.entries(w.vehicles)) {
    if (
      !isObj(v) ||
      typeof v.label !== 'string' ||
      !(v.seats === null || isInt(v.seats)) ||
      typeof v.capacity !== 'number' ||
      !(v.capacity > 0)
    )
      throw new TransitFormatError(`vehicles.${k} is invalid`);
    vehicles[k] = { label: v.label, seats: v.seats as number | null, capacity: v.capacity };
  }
  const s = w.stops;
  if (!isObj(s) || !Array.isArray(s.id)) throw new TransitFormatError('stops.id is not an array');
  const n = s.id.length;
  const [ids, names, lng, lat, station, place] = [
    'id',
    'name',
    'lng',
    'lat',
    'station',
    'place'
  ].map((k) => column(s, k, n));
  const stops = ids.map((id, i) => {
    if (typeof id !== 'string' || typeof names[i] !== 'string' || typeof place[i] !== 'string')
      throw new TransitFormatError(`stop ${i} has a non-string id, name or place`);
    if (!Number.isInteger(lng[i]) || !Number.isInteger(lat[i]))
      throw new TransitFormatError(`stop ${i} has non-integer coordinates`);
    if (!(station[i] === null || typeof station[i] === 'string'))
      throw new TransitFormatError(`stop ${i} has a bad station`);
    return {
      id,
      name: names[i] as string,
      lngLat: [(lng[i] as number) / 1e6, (lat[i] as number) / 1e6] as [number, number],
      stationId: station[i] as string | null,
      placeId: place[i] as string
    };
  });
  if (!Array.isArray(w.patterns)) throw new TransitFormatError('patterns is not an array');
  const patterns: Pattern[] = w.patterns.map((p, i) => {
    if (!isObj(p)) throw new TransitFormatError(`patterns.${i} is not an object`);
    const where = `patterns.${i}`;
    if (typeof p.id !== 'string' || typeof p.route !== 'string' || typeof p.routeName !== 'string')
      throw new TransitFormatError(`${where}: bad id, route or routeName`);
    if (!isInt(p.operator) || p.operator >= operators.length)
      throw new TransitFormatError(`${where}: operator index out of range`);
    if (!MODE_IDS.includes(p.mode as ModeId)) throw new TransitFormatError(`${where}: bad mode`);
    if (p.direction !== 0 && p.direction !== 1)
      throw new TransitFormatError(`${where}: bad direction`);
    if (typeof p.vehicle !== 'string' || !Object.hasOwn(vehicles, p.vehicle))
      throw new TransitFormatError(`${where}: unknown vehicle ${String(p.vehicle)}`);
    if (!isInt(p.cars, 1)) throw new TransitFormatError(`${where}: bad cars`);
    const st = p.stops,
      tph = p.tph,
      tpd = p.tpd;
    if (!Array.isArray(st) || !Array.isArray(tph) || !Array.isArray(tpd))
      throw new TransitFormatError(`${where}: stops, tph and tpd must be arrays`);
    if (tph.length !== st.length || tpd.length !== st.length)
      throw new TransitFormatError(`${where}: tph/tpd length differs from stops`);
    return {
      id: p.id,
      operatorId: operators[p.operator].id,
      routeId: p.route,
      routeName: p.routeName,
      mode: p.mode as ModeId,
      direction: p.direction,
      vehicle: p.vehicle,
      cars: p.cars,
      stops: st.map((ix, k) => {
        if (!isInt(ix) || ix >= n) throw new TransitFormatError(`${where}: stop index ${ix}`);
        if (!isInt(tph[k]))
          throw new TransitFormatError(`${where}: tph must be a non-negative int`);
        if (!isInt(tpd[k]))
          throw new TransitFormatError(`${where}: tpd must be a non-negative int`);
        return { stop: ix, tph: (tph[k] as number) / 10, tpd: tpd[k] as number };
      })
    };
  });
  return { peak: { start: peak.start, end: peak.end }, operators, vehicles, stops, patterns };
}
