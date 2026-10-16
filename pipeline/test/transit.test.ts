import { describe, expect, it } from 'vitest';
import { encodeTransit } from '../../src/lib/data/transit-codec';
import type { GtfsFiles } from '../lib/gtfs';
import { TransitBuildError, assignPlaces, clipFilter, reduceTransit } from '../steps/transit';
import { ASSIGNMENTS, GTFS_FEEDS, VEHICLES, placeTokens } from '../transit-config';
import { every, tripTables, type TripSpec } from './gtfs-builder';

const CAL =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'WK,1,1,1,1,1,0,0,20260901,20261231\n';

function feed(
  routes: string,
  stops: string,
  trips: TripSpec[],
  extra: Record<string, string> = {}
): GtfsFiles {
  return new Map(
    Object.entries({
      'calendar.txt': CAL,
      'routes.txt': routes,
      'stops.txt': stops,
      ...tripTables(trips),
      ...extra
    })
  );
}

/** The same table with its data rows in reverse order. */
const reverseRows = (text: string) => {
  const [head, ...rows] = text.trimEnd().split('\n');
  return [head, ...rows.reverse()].join('\n') + '\n';
};

const MUNI_ROUTES =
  'route_id,route_short_name,route_long_name,route_type\n22,22,FILLMORE,3\n14,14,MISSION,3\nN,N,JUDAH,0\n';
const MUNI_STOPS =
  'stop_id,stop_name,stop_lat,stop_lon\n' +
  'a,Mission St & 20th St,37.7596,-122.4195\nb,Mission St & 22nd St,37.7556,-122.4195\n' +
  'c,Metro Powell Station/Downtown,37.784653,-122.407086\nfar,Far St,37.9,-122.4195\n' +
  'd,Mission St & 24th St,37.7522,-122.4184\n';
const keepAll = () => true;
const opts = { targetDate: '2026-10-10', keep: keepAll, strict: false };

describe('reduceTransit', () => {
  const muniTrips = (): TripSpec[] => [
    { route: '22', dir: 0, stops: ['a', 'b'], starts: [...every(7, 0, 10, 12), 12 * 3600] },
    { route: '14', dir: 0, stops: ['b', 'a', 'far'], starts: every(7, 0, 15, 8) },
    { route: 'N', dir: 1, stops: ['c', 'd'], starts: every(5, 0, 30, 4) }, // 05:00-06:30: no peak
    // Evening only: no peak trips, but a and b are kept by the peak pattern above and d is not.
    { route: '22', dir: 0, stops: ['a', 'b', 'd'], starts: every(20, 0, 30, 3) }
  ];
  const muni = () => feed(MUNI_ROUTES, MUNI_STOPS, muniTrips());

  it('counts peak trips per hour and trips per day per stop, by pattern', () => {
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts);
    const p22 = network.patterns.find((p) => p.id === 'muni:22:0:0')!;
    expect(p22).toMatchObject({ mode: 'bus', vehicle: 'muni-bus-40', cars: 1 });
    // A trip's last stop is an arrival, not a departure.
    expect(p22.stops.map((s) => [network.stops[s.stop].id, s.tph, s.tpd])).toEqual([
      ['muni:a', 6, 13],
      ['muni:b', 0, 0]
    ]);
    expect(network.patterns.find((p) => p.routeId === '14')).toMatchObject({
      vehicle: 'muni-bus-60'
    });
    expect(network.operators).toEqual([{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }]);
  });

  it('drops patterns with no peak service and stops no kept pattern serves', () => {
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts);
    expect(network.patterns.some((p) => p.routeId === 'N')).toBe(false);
    expect(network.stops.map((s) => s.id)).not.toContain('muni:c');
  });

  it('counts daily trips of off-peak patterns at stops a peak pattern keeps (SB 79 counts all hours)', () => {
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts);
    const evening = network.patterns.filter((p) => p.routeId === '22' && p.direction === 0);
    expect(evening).toHaveLength(2);
    const off = evening.find((p) => p.stops.every((s) => s.tph === 0))!;
    expect(off.stops.map((s) => [network.stops[s.stop].id, s.tph, s.tpd])).toEqual([
      ['muni:a', 0, 3],
      ['muni:b', 0, 3]
    ]);
    // A zero-peak pattern never brings in a stop of its own.
    expect(network.stops.map((s) => s.id)).not.toContain('muni:d');
  });

  it('does not count a row with pickup_type 1 as a departure', () => {
    const files = muni();
    files.set(
      'stop_times.txt',
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type\n' +
        't1,07:10:00,07:10:00,a,1,0\nt1,07:11:00,07:11:00,b,2,1\nt1,07:12:00,07:12:00,d,3,0\n'
    );
    files.set('trips.txt', 'route_id,service_id,trip_id,direction_id\n22,WK,t1,0\n');
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files }], opts);
    expect(network.patterns[0].stops.map((s) => [network.stops[s.stop].id, s.tph, s.tpd])).toEqual([
      ['muni:a', 0.5, 1],
      ['muni:b', 0, 0],
      ['muni:d', 0, 0]
    ]);
  });

  it('clips stops, keeping the pattern for its kept stops', () => {
    const keep = ([, lat]: [number, number]) => lat < 37.8;
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], {
      ...opts,
      keep
    });
    const p14 = network.patterns.find((p) => p.routeId === '14')!;
    expect(p14.stops.map((s) => network.stops[s.stop].id)).toEqual(['muni:b', 'muni:a']);
    expect(network.stops.map((s) => s.id)).not.toContain('muni:far');
  });

  it('uses the departure time, falling back to arrival, and counts untimed rows', () => {
    const files = muni();
    files.set(
      'stop_times.txt',
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,07:10:00,,a,1\nt1,,,b,2\n'
    );
    files.set('trips.txt', 'route_id,service_id,trip_id,direction_id\n22,WK,t1,0\n');
    const r = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files }], opts);
    expect(r.network.patterns[0].stops[0].tph).toBe(0.5);
    expect(r.counts['transit.untimed_stop_times']).toBe(1);
  });

  it('keeps only BART heavy rail, names lines by colour, sizes trains by line', () => {
    const bart = feed(
      'route_id,route_short_name,route_long_name,route_type\n7,Red-S,Richmond to SFO,1\nBB-A,BridgeA,Bus Bridge,3\n',
      'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n' +
        'POWL,Powell Street,37.784606,-122.407331,1,\nM30-1,Powell Street,37.784645,-122.407387,0,POWL\n' +
        'M20-1,Montgomery Street,37.789256,-122.401407,0,\n',
      [
        { route: '7', dir: 0, stops: ['M30-1', 'M20-1'], starts: every(7, 0, 15, 8) },
        { route: 'BB-A', dir: 0, stops: ['M30-1', 'M20-1'], starts: every(7, 0, 5, 24) }
      ]
    );
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-bart'], files: bart }], opts);
    expect(network.patterns).toHaveLength(1);
    expect(network.patterns[0]).toMatchObject({ routeName: 'Red', mode: 'heavy-rail', cars: 10 });
    expect(network.stops.find((s) => s.id === 'bart:M30-1')).toMatchObject({
      stationId: 'bart:POWL'
    });
  });

  it('reports a feed whose calendar ended before the target date', () => {
    const files = muni();
    files.set(
      'calendar.txt',
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260723,20260828\n'
    );
    const r = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files }], {
      ...opts,
      targetDate: '2026-10-14'
    });
    expect(r.network.operators[0].serviceDate).toBe('2026-08-25');
    expect(r.network.patterns.length).toBeGreaterThan(0);
    expect(r.warnings.join('\n')).toMatch(/gtfs-muni: calendar ends 20260828/);
  });

  it('fails a strict build when an assigned line is missing; a fixture build skips the check', () => {
    expect(() =>
      reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], { ...opts, strict: true })
    ).toThrow(new TransitBuildError('assigned line 5 is not in gtfs-muni'));
    const r = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts);
    expect(r.warnings).toEqual([]);
  });

  it('warns on peak-serving Muni rail and BART routes with no vehicle assignment', () => {
    const muniRail = feed(MUNI_ROUTES + 'S,S,SHUTTLE,0\n', MUNI_STOPS, [
      ...muniTrips(),
      { route: 'S', dir: 0, stops: ['c', 'd'], starts: every(7, 0, 10, 12) }
    ]);
    const bart = feed(
      'route_id,route_short_name,route_long_name,route_type\n9,Purple-N,SFO to Millbrae,1\n',
      'stop_id,stop_name,stop_lat,stop_lon\nM30-1,Powell Street,37.784645,-122.407387\n' +
        'M20-1,Montgomery Street,37.789256,-122.401407\n',
      [{ route: '9', dir: 0, stops: ['M30-1', 'M20-1'], starts: every(7, 0, 15, 8) }]
    );
    const r = reduceTransit(
      [
        { spec: GTFS_FEEDS['gtfs-muni'], files: muniRail },
        { spec: GTFS_FEEDS['gtfs-bart'], files: bart }
      ],
      opts
    );
    expect(r.warnings).toEqual([
      'gtfs-muni: line S (light-rail) has peak service but no vehicle assignment; using muni-bus-40 × 1',
      'gtfs-bart: line Purple (heavy-rail) has peak service but no vehicle assignment; using bart-car × 6'
    ]);
  });

  it('sorts stops and patterns by id', () => {
    const a = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts).network;
    const ids = a.stops.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
    const pids = a.patterns.map((p) => p.id);
    expect(pids).toEqual([...pids].sort());
  });

  it('encodes identically whatever the row order of the feed', () => {
    const shuffled = muni();
    for (const t of ['stops.txt', 'trips.txt', 'stop_times.txt', 'routes.txt']) {
      shuffled.set(t, reverseRows(shuffled.get(t)!));
    }
    const a = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts).network;
    const b = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: shuffled }], opts).network;
    expect(encodeTransit(b)).toBe(encodeTransit(a));
  });
});

describe('places', () => {
  const stop = (
    id: string,
    name: string,
    lngLat: [number, number],
    stationId: string | null = null,
    stationName: string | null = null
  ) => ({ id, name, lngLat, stationId, stationName });

  it('tokenises names without stopwords', () => {
    expect([...placeTokens('Metro Powell Station/Downtown')]).toEqual(['powell']);
    expect([...placeTokens('Civic Center/UN Plaza')]).toEqual(['civic', 'center']);
  });

  it('groups nearby stops that share a name token, across operators', () => {
    const places = assignPlaces([
      stop('muni:5417', 'Metro Powell Station/Downtown', [-122.407086, 37.784653]),
      stop('bart:M30-1', 'Powell Street', [-122.407387, 37.784645], 'bart:POWL', 'Powell Street'),
      stop('bart:M30-2', 'Powell Street', [-122.407302, 37.784576], 'bart:POWL', 'Powell Street'),
      stop('muni:4757', 'Geary St & Powell St', [-122.408391, 37.787401]),
      stop('muni:x', 'Market St & 5th St', [-122.40709, 37.78466])
    ]);
    expect(places.get('muni:5417')).toBe('bart:POWL');
    expect(places.get('bart:M30-2')).toBe('bart:POWL');
    expect(places.get('muni:4757')).toBe('muni:4757'); // shares "powell" but 320 m away
    expect(places.get('muni:x')).toBe('muni:x'); // 1 m away but no shared token
  });

  it('does not group stops of one operator by name, only by station', () => {
    const places = assignPlaces([
      // Two Muni stops ~90 m apart along Mission St: both "mission", no station.
      stop('muni:1', 'Mission St & 20th St', [-122.4195, 37.7596]),
      stop('muni:2', 'Mission St & 21st St', [-122.4195, 37.7588]),
      // Two Caltrain platforms of one station.
      stop('caltrain:nb', '22nd Street NB', [-122.3925, 37.7575], 'caltrain:22nd', '22nd Street'),
      stop('caltrain:sb', '22nd Street SB', [-122.3927, 37.7577], 'caltrain:22nd', '22nd Street')
    ]);
    expect(places.get('muni:1')).toBe('muni:1');
    expect(places.get('muni:2')).toBe('muni:2');
    expect(places.get('caltrain:nb')).toBe('caltrain:22nd');
    expect(places.get('caltrain:sb')).toBe('caltrain:22nd');
  });
});

describe('clipFilter', () => {
  const square = {
    features: [
      {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.42, 37.76],
              [-122.41, 37.76],
              [-122.41, 37.77],
              [-122.42, 37.77],
              [-122.42, 37.76]
            ]
          ]
        }
      }
    ]
  };
  it('keeps points inside or within the buffer, drops the rest', () => {
    const keep = clipFilter(square, 1000);
    expect(keep([-122.415, 37.765])).toBe(true);
    expect(keep([-122.405, 37.765])).toBe(true); // ~440 m east of the edge
    expect(keep([-122.39, 37.765])).toBe(false); // ~1.8 km east
  });
});

describe('transit config', () => {
  it('cites a source, URL and as-of date (or null) on every vehicle and assignment row', () => {
    for (const row of [...Object.values(VEHICLES), ...ASSIGNMENTS]) {
      expect(row.source).not.toBe('');
      expect(row.url === null || /^https:\/\//.test(row.url)).toBe(true);
      expect(row.asOf === null || /^\d{4}(-\d{2})?$/.test(row.asOf)).toBe(true);
    }
  });
});
