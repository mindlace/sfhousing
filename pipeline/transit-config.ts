// Transit feeds, vehicles and route assignments (transit spec §4.1, §4.2 step 7). Every number has
// its source and as-of date. These are seed values: the client may edit the network (spec §8).
//
// Feed facts, verified 2026-10-14 against the live feeds:
// - Muni: route_id equals route_short_name (14, 14R, N, CA, PM, PH). Rail lines are F J K L M N T
//   (route_type 0); E and S are absent, so they have no assignment. The bus substitutions KBUS,
//   NBUS, TBUS and FBUS are route_type 3 and get the bus default. No parent_station column.
// - BART: one route per direction, route_short_name like "Yellow-S"; the line is the part before
//   "-". The route_type 3 bus-bridge routes (BB-A) are dropped. Stops have parent_station (EMBR,
//   POWL).
// - Caltrain: route_short_name is Local Weekday, Limited, Express or South County (route_type 2).
//   Platforms are per direction under a parent station (san_francisco, 22nd_street).
import type { ModeId, Vehicle, VehicleId } from '../src/lib/data/transit';

export type OperatorId = 'muni' | 'bart' | 'caltrain';
export type GtfsLockId = 'gtfs-muni' | 'gtfs-bart' | 'gtfs-caltrain';

export interface GtfsFeedSpec {
  lockId: GtfsLockId;
  operator: OperatorId;
  /** Short name shown in tooltips ("Muni 14, 49"). */
  operatorLabel: string;
  /** Lock / manifest source label (shown on /attribution). */
  label: string;
  url: string;
  homepage: string;
  license: string;
  /** GTFS route_type values kept from this feed. */
  routeTypes: number[];
}

export const GTFS_FEEDS: Record<GtfsLockId, GtfsFeedSpec> = {
  'gtfs-muni': {
    lockId: 'gtfs-muni',
    operator: 'muni',
    operatorLabel: 'Muni',
    label: 'SFMTA Muni GTFS',
    url: 'https://muni-gtfs.apps.sfmta.com/data/muni_gtfs-current.zip',
    homepage: 'https://www.sfmta.com/reports/gtfs-transit-data',
    license: 'SFMTA Transit Data License Agreement',
    routeTypes: [0, 3, 5]
  },
  'gtfs-bart': {
    lockId: 'gtfs-bart',
    operator: 'bart',
    operatorLabel: 'BART',
    label: 'BART GTFS',
    url: 'https://www.bart.gov/dev/schedules/google_transit.zip',
    homepage: 'https://www.bart.gov/schedules/developers/gtfs',
    license: 'BART Developer License Agreement',
    routeTypes: [1]
  },
  'gtfs-caltrain': {
    lockId: 'gtfs-caltrain',
    operator: 'caltrain',
    operatorLabel: 'Caltrain',
    label: 'Caltrain GTFS',
    url: 'https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip',
    homepage: 'https://www.caltrain.com/developer-resources',
    license: 'Caltrain (PCJPB) Developer License Agreement',
    routeTypes: [2]
  }
};
export const GTFS_IDS = Object.keys(GTFS_FEEDS) as GtfsLockId[];

export const PEAK = { start: '07:00', end: '09:00' } as const;
export const CLIP_BUFFER_M = 1000;
export const PLACE_RADIUS_M = 150;

const SRTP = 'SFMTA SRTP FY19–30 (Jan 2020), Tables 4-5/4-6';
export const VEHICLES: Record<VehicleId, Vehicle & { source: string }> = {
  'muni-bus-30': { label: 'Muni 30 ft bus', seats: 24, capacity: 33, source: SRTP },
  'muni-bus-40': { label: 'Muni 40 ft bus', seats: 30, capacity: 44, source: SRTP },
  'muni-bus-60': { label: 'Muni 60 ft articulated bus', seats: 45, capacity: 69, source: SRTP },
  'muni-lrv4': { label: 'Muni Metro LRV4 car', seats: 60, capacity: 139, source: SRTP },
  'muni-streetcar': { label: 'Muni historic streetcar', seats: 33, capacity: 69, source: SRTP },
  'muni-cable-powell': { label: 'Powell cable car', seats: 30, capacity: 52, source: SRTP },
  'muni-cable-california': { label: 'California cable car', seats: 35, capacity: 60, source: SRTP },
  'bart-car': {
    label: 'BART car (Fleet of the Future)',
    seats: 54,
    capacity: 107,
    source: 'BART planning standard: 60 seated + 47 standing per car'
  },
  'caltrain-emu7': {
    label: 'Caltrain 7-car electric train',
    seats: 675,
    capacity: 810,
    source: 'Caltrain 2025 Title VI Program (peak load factor 1.2)'
  }
};

export interface Assignment {
  operator: OperatorId;
  lines: string[];
  vehicle: VehicleId;
  cars: number;
  source: string;
}

/** Spec §4.2 step 7. Lines absent from the 2026-07-23 Muni feed (E, S) are omitted. */
export const ASSIGNMENTS: Assignment[] = [
  {
    operator: 'muni',
    lines: [
      '5',
      '5R',
      '7',
      '8',
      '9R',
      '14',
      '14R',
      '30',
      '38',
      '38R',
      '49',
      '1X',
      '8AX',
      '8BX',
      '30X'
    ],
    vehicle: 'muni-bus-60',
    cars: 1,
    source:
      'Wikipedia "List of San Francisco Municipal Railway lines" (^ = 60 ft, July 2022); SFMTA confirms 38/38R, 49, 14R. The 9 is 60 ft on weekends only, so it keeps the 40 ft default.'
  },
  {
    operator: 'muni',
    lines: ['35', '36', '37', '39', '52', '56', '66', '67'],
    vehicle: 'muni-bus-30',
    cars: 1,
    source: 'Wikipedia "List of San Francisco Municipal Railway lines" (community routes)'
  },
  {
    operator: 'muni',
    lines: ['N', 'K', 'T'],
    vehicle: 'muni-lrv4',
    cars: 2,
    source:
      'SFMTA two-car K/T trains; N Judah two-car. Simplification: K counts 2 cars on Ocean Ave, where the rear car is locked.'
  },
  {
    operator: 'muni',
    lines: ['J', 'L', 'M'],
    vehicle: 'muni-lrv4',
    cars: 1,
    source:
      'J single car (short platforms). L and M low confidence: no current source on 2-car peaks.'
  },
  { operator: 'muni', lines: ['F'], vehicle: 'muni-streetcar', cars: 1, source: SRTP },
  { operator: 'muni', lines: ['PM', 'PH'], vehicle: 'muni-cable-powell', cars: 1, source: SRTP },
  { operator: 'muni', lines: ['CA'], vehicle: 'muni-cable-california', cars: 1, source: SRTP },
  {
    operator: 'bart',
    lines: ['Red'],
    vehicle: 'bart-car',
    cars: 10,
    source: 'BART July 2026 schedule'
  },
  {
    operator: 'bart',
    lines: ['Yellow'],
    vehicle: 'bart-car',
    cars: 9,
    source: 'BART July 2026 schedule'
  },
  {
    operator: 'bart',
    lines: ['Green', 'Blue'],
    vehicle: 'bart-car',
    cars: 6,
    source: 'BART July 2026 schedule; 6-car base unconfirmed'
  },
  {
    operator: 'bart',
    lines: ['Orange'],
    vehicle: 'bart-car',
    cars: 6,
    source: 'BART July 2026 schedule'
  }
];

export const OPERATOR_DEFAULT: Record<OperatorId, { vehicle: VehicleId; cars: number }> = {
  muni: { vehicle: 'muni-bus-40', cars: 1 },
  bart: { vehicle: 'bart-car', cars: 6 },
  caltrain: { vehicle: 'caltrain-emu7', cars: 1 }
};

/** The line an assignment names: BART "Yellow-S" -> "Yellow"; Caltrain is one line. */
export function routeLine(op: OperatorId, routeId: string, shortName: string): string {
  if (op === 'bart') return (shortName || routeId).split('-')[0];
  if (op === 'caltrain') return 'Caltrain';
  return shortName || routeId;
}

export function routeName(
  op: OperatorId,
  routeId: string,
  shortName: string,
  longName: string
): string {
  if (op === 'bart') return routeLine(op, routeId, shortName);
  return shortName || longName || routeId;
}

export function routeMode(op: OperatorId, routeType: number, line: string): ModeId | null {
  if (op === 'bart') return routeType === 1 ? 'heavy-rail' : null;
  if (op === 'caltrain') return routeType === 2 ? 'commuter-rail' : null;
  if (routeType === 3) return 'bus';
  if (routeType === 5) return 'cable-car';
  if (routeType === 0) return line === 'F' || line === 'E' ? 'streetcar' : 'light-rail';
  return null;
}

export function assignmentFor(op: OperatorId, line: string): { vehicle: VehicleId; cars: number } {
  const a = ASSIGNMENTS.find((x) => x.operator === op && x.lines.includes(line));
  return a ? { vehicle: a.vehicle, cars: a.cars } : OPERATOR_DEFAULT[op];
}

const STOPWORDS = new Set([
  'st',
  'street',
  'ave',
  'avenue',
  'blvd',
  'station',
  'stn',
  'metro',
  'downtown',
  'downtn',
  'inbound',
  'outbound',
  'ib',
  'ob',
  'northbound',
  'southbound',
  'platform',
  'bart',
  'muni',
  'caltrain',
  'the',
  'and',
  'of',
  'plaza',
  'un',
  'stop'
]);

/** Spec §4.2 step 6: lower-cased name tokens, stopwords and 1-char tokens dropped. */
export function placeTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}
