// The transit seed network (transit spec §5.1). Shared by the pipeline (writes it) and the client
// (reads it); lives in src/lib/data so it is part of the dataset version hash. Imports nothing.

export const MODE_IDS = [
  'bus',
  'cable-car',
  'streetcar',
  'light-rail',
  'heavy-rail',
  'commuter-rail'
] as const;
export type ModeId = (typeof MODE_IDS)[number];

/** Keys of `TransitNetwork.vehicles`; open so network edits can add vehicles. */
export type VehicleId = string;

export interface Vehicle {
  label: string;
  seats: number | null;
  /** Riders per vehicle (per car for multi-car consists) at the agency's planning load. */
  capacity: number;
}

export interface Operator {
  id: string;
  label: string;
  /** The weekday whose schedule was counted, YYYY-MM-DD. */
  serviceDate: string;
}

export interface Stop {
  /** `<operator>:<gtfs stop_id>`, unique across operators. */
  id: string;
  name: string;
  lngLat: [number, number];
  /** `<operator>:<gtfs parent_station>` or null. */
  stationId: string | null;
  /** Cross-operator place (spec §4.2 step 6); a stop's own id when ungrouped. */
  placeId: string;
}

export interface PatternStop {
  /** Index into `TransitNetwork.stops`. */
  stop: number;
  /** Peak trips per hour at this stop (0.1 precision). */
  tph: number;
  /** Trips per day at this stop, all hours of the service day. */
  tpd: number;
}

export interface Pattern {
  id: string;
  operatorId: string;
  routeId: string;
  routeName: string;
  mode: ModeId;
  direction: 0 | 1;
  vehicle: VehicleId;
  /** Cars per train (1 for buses). Capacity per trip = vehicles[vehicle].capacity × cars. */
  cars: number;
  stops: PatternStop[];
}

export interface TransitNetwork {
  peak: { start: string; end: string };
  operators: Operator[];
  vehicles: Record<VehicleId, Vehicle>;
  stops: Stop[];
  patterns: Pattern[];
}
