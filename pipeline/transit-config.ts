// Transit feeds, vehicles and route assignments (transit spec §4.1, §4.2 step 7). Every vehicle and
// assignment row cites its source, with a URL and as-of date (null where the source names none;
// see Cite). These are seed values: the client may edit the network (spec §8).
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

/**
 * Where a row's numbers come from. `url` and `asOf` (YYYY or YYYY-MM) are null where the spec
 * records no URL or date for that source; they are never guessed.
 */
export interface Cite {
  source: string;
  url: string | null;
  asOf: string | null;
}

const SRTP: Cite = {
  source: 'SFMTA SRTP FY19–30 (Jan 2020), Tables 4-5/4-6',
  url: null,
  asOf: '2020-01'
};
const BART_JULY_2026 = { url: null, asOf: '2026-07' } as const;

export const VEHICLES: Record<VehicleId, Vehicle & Cite> = {
  'muni-bus-30': { label: 'Muni 30 ft bus', seats: 24, capacity: 33, ...SRTP },
  'muni-bus-40': { label: 'Muni 40 ft bus', seats: 30, capacity: 44, ...SRTP },
  'muni-bus-60': { label: 'Muni 60 ft articulated bus', seats: 45, capacity: 69, ...SRTP },
  'muni-lrv4': { label: 'Muni Metro LRV4 car', seats: 60, capacity: 139, ...SRTP },
  'muni-streetcar': { label: 'Muni historic streetcar', seats: 33, capacity: 69, ...SRTP },
  'muni-cable-powell': { label: 'Powell cable car', seats: 30, capacity: 52, ...SRTP },
  'muni-cable-california': { label: 'California cable car', seats: 35, capacity: 60, ...SRTP },
  'bart-car': {
    label: 'BART car (Fleet of the Future)',
    seats: 54,
    capacity: 107,
    source: 'BART planning standard: 60 seated + 47 standing per car',
    url: null,
    asOf: null
  },
  'caltrain-emu7': {
    label: 'Caltrain 7-car electric train',
    seats: 675,
    capacity: 810,
    source: 'Caltrain 2025 Title VI Program (peak load factor 1.2)',
    url: null,
    asOf: '2025'
  }
};

export interface Assignment extends Cite {
  operator: OperatorId;
  lines: string[];
  vehicle: VehicleId;
  cars: number;
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
      'Wikipedia "List of San Francisco Municipal Railway lines" (^ = 60 ft, July 2022); SFMTA confirms 38/38R, 49, 14R. The 9 is 60 ft on weekends only, so it keeps the 40 ft default.',
    url: null,
    asOf: '2022-07'
  },
  {
    operator: 'muni',
    lines: ['35', '36', '37', '39', '52', '56', '66', '67'],
    vehicle: 'muni-bus-30',
    cars: 1,
    source: 'Wikipedia "List of San Francisco Municipal Railway lines" (community routes)',
    url: null,
    asOf: null
  },
  {
    operator: 'muni',
    lines: ['N', 'K', 'T'],
    vehicle: 'muni-lrv4',
    cars: 2,
    source:
      'SFMTA two-car K/T trains; N Judah two-car. Simplification: K counts 2 cars on Ocean Ave, where the rear car is locked.',
    url: null,
    asOf: null
  },
  {
    operator: 'muni',
    lines: ['J', 'L', 'M'],
    vehicle: 'muni-lrv4',
    cars: 1,
    source:
      'J single car (short platforms). L and M low confidence: no current source on 2-car peaks.',
    url: null,
    asOf: null
  },
  { operator: 'muni', lines: ['F'], vehicle: 'muni-streetcar', cars: 1, ...SRTP },
  { operator: 'muni', lines: ['PM', 'PH'], vehicle: 'muni-cable-powell', cars: 1, ...SRTP },
  { operator: 'muni', lines: ['CA'], vehicle: 'muni-cable-california', cars: 1, ...SRTP },
  {
    operator: 'bart',
    lines: ['Red'],
    vehicle: 'bart-car',
    cars: 10,
    source: 'BART July 2026 schedule',
    ...BART_JULY_2026
  },
  {
    operator: 'bart',
    lines: ['Yellow'],
    vehicle: 'bart-car',
    cars: 9,
    source: 'BART July 2026 schedule',
    ...BART_JULY_2026
  },
  {
    operator: 'bart',
    lines: ['Green', 'Blue'],
    vehicle: 'bart-car',
    cars: 6,
    source: 'BART July 2026 schedule; 6-car base unconfirmed',
    ...BART_JULY_2026
  },
  {
    operator: 'bart',
    lines: ['Orange'],
    vehicle: 'bart-car',
    cars: 6,
    source: 'BART July 2026 schedule',
    ...BART_JULY_2026
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

/**
 * Archived copies of the three agencies' own GTFS feeds, for transit access in past years (the car
 * back-cast; docs/dev/cars-data.md, Archived Muni, BART, Caltrain GTFS). Keyless hosts only; each
 * copy is the agency's official feed, so its licence is the agency's. The ids are not in GTFS_IDS:
 * today's network and the transit target date never read them (ruling P10).
 */
export type GtfsArchiveHost = 'gtfs-data-exchange' | 'openmobilitydata' | 'wayback';

const OMD_FEED: Record<OperatorId, string> = {
  muni: 'sfmta/60',
  bart: 'bart/58',
  caltrain: 'caltrain/122'
};

export const GTFS_ARCHIVE_HOSTS: Record<
  GtfsArchiveHost,
  { label: string; homepage: string; url: (key: string, op: OperatorId) => string }
> = {
  // GTFS Data Exchange (2008-2016): the copies it took of each agency feed, in its S3 bucket.
  'gtfs-data-exchange': {
    label: 'GTFS Data Exchange',
    homepage: 'https://github.com/jehiah/gtfs-data-exchange',
    url: (key) => `http://gtfs.s3.amazonaws.com/${key}.zip`
  },
  // OpenMobilityData / TransitFeeds (2015-2023): versions by fetch date, in its S3 bucket.
  openmobilitydata: {
    label: 'OpenMobilityData (TransitFeeds)',
    homepage: 'https://transitfeeds.com',
    url: (key, op) =>
      `https://openmobilitydata-data.s3-us-west-1.amazonaws.com/public/feeds/${OMD_FEED[op]}/${key}/gtfs.zip`
  },
  // Internet Archive Wayback Machine: the raw snapshot (`id_`) of the agency's own zip URL; the
  // key is `<timestamp>/<original url>`.
  wayback: {
    label: 'Internet Archive Wayback Machine',
    homepage: 'https://web.archive.org',
    url: (key) => {
      const slash = key.indexOf('/');
      return `https://web.archive.org/web/${key.slice(0, slash)}id_/${key.slice(slash + 1)}`;
    }
  }
};

export interface GtfsArchiveSpec {
  /** `gtfs-archive-<operator>-<year>`. */
  lockId: string;
  operator: OperatorId;
  /** The back-cast year this feed stands for: the version in force on 1 April of it. */
  year: number;
  host: GtfsArchiveHost;
  /** The host's name for the copy (file stem, version date, or `<timestamp>/<url>`). */
  key: string;
  url: string;
  label: string;
  homepage: string;
  license: string;
}

export function gtfsArchive(
  operator: OperatorId,
  year: number,
  host: GtfsArchiveHost,
  key: string
): GtfsArchiveSpec {
  const live = GTFS_FEEDS[`gtfs-${operator}`];
  const h = GTFS_ARCHIVE_HOSTS[host];
  return {
    lockId: `gtfs-archive-${operator}-${year}`,
    operator,
    year,
    host,
    key,
    url: h.url(key, operator),
    label: `${live.label}, ${year} (archived: ${h.label})`,
    homepage: h.homepage,
    license: `${live.license} (archived copy of the agency's feed: ${h.label})`
  };
}

const gde = (op: OperatorId, year: number, file: string) =>
  gtfsArchive(op, year, 'gtfs-data-exchange', file);
const omd = (op: OperatorId, year: number, version: string) =>
  gtfsArchive(op, year, 'openmobilitydata', version);
const wb = (op: OperatorId, year: number, snapshot: string) =>
  gtfsArchive(op, year, 'wayback', snapshot);
const GDE_MUNI = 'san-francisco-municipal-transportation-agency';

/**
 * Per operator and year, the archived feed chosen: the version in force on 1 April of the year
 * (the latest one published before it whose calendar covers it, else the first after it whose
 * calendar does). Years with none found (Muni 2014, 2023-24; BART 2009, 2014, 2024; Caltrain
 * 2014) take the next year's feed (docs/dev/cars-data.md).
 */
export const GTFS_ARCHIVES: GtfsArchiveSpec[] = [
  gde('muni', 2009, `${GDE_MUNI}_20090401_0353`),
  gde('muni', 2010, `${GDE_MUNI}_20100204_0313`),
  gde('muni', 2011, `${GDE_MUNI}_20110420_0243`),
  gde('muni', 2012, `${GDE_MUNI}_20120319_0412`),
  gde('muni', 2013, `${GDE_MUNI}_20130324_0307`),
  omd('muni', 2015, '20150225'),
  omd('muni', 2016, '20160307'),
  omd('muni', 2017, '20170221'),
  omd('muni', 2018, '20180527'),
  omd('muni', 2019, '20190401'),
  omd('muni', 2020, '20200328'),
  omd('muni', 2021, '20210317'),
  omd('muni', 2022, '20220305'),
  wb('bart', 2008, '20080917141240/http://www.bart.gov/dev/schedules/20080627/google_transit.zip'),
  wb('bart', 2010, '20100528002023/http://www.bart.gov/dev/schedules/google_transit.zip'),
  wb('bart', 2011, '20101213073722/http://bart.gov/dev/schedules/google_transit.zip'),
  wb('bart', 2012, '20120531023532/http://bart.gov/dev/schedules/google_transit.zip'),
  wb('bart', 2013, '20121028141534/http://bart.gov/dev/schedules/google_transit.zip'),
  omd('bart', 2015, '20150120'),
  omd('bart', 2016, '20160310'),
  omd('bart', 2017, '20170330'),
  omd('bart', 2018, '20180222'),
  omd('bart', 2019, '20190123'),
  omd('bart', 2020, '20200401'),
  omd('bart', 2021, '20210315'),
  omd('bart', 2022, '20220212'),
  omd('bart', 2023, '20230401'),
  gde('caltrain', 2009, 'caltrain_20090308_1937'),
  gde('caltrain', 2010, 'caltrain_20090724_0212'),
  gde('caltrain', 2011, 'caltrain_20110217_0333'),
  gde('caltrain', 2012, 'caltrain_20120113_0421'),
  gde('caltrain', 2013, 'caltrain_20120824_0333'),
  omd('caltrain', 2015, '20150127'),
  omd('caltrain', 2016, '20160401'),
  omd('caltrain', 2017, '20170324'),
  omd('caltrain', 2018, '20180329'),
  omd('caltrain', 2019, '20190131'),
  omd('caltrain', 2020, '20200110'),
  omd('caltrain', 2021, '20210322'),
  omd('caltrain', 2022, '20220316'),
  omd('caltrain', 2023, '20230325'),
  omd('caltrain', 2024, '20231221')
];
export const GTFS_ARCHIVE_IDS: readonly string[] = GTFS_ARCHIVES.map((a) => a.lockId);
