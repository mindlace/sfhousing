import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildAccessGrid } from '../../../src/lib/transit/grid';
import { accessByYear, zoneAccess } from '../../lib/cars/access';
import type { GtfsFiles } from '../../lib/gtfs';
import type { Lock } from '../../lib/lock';
import { AS_OF_SOURCE_IDS } from '../../project-records/parse';
import { GtfsArchiveError, fetchGtfsArchive } from '../../sources/gtfs-archive';
import { DEFAULT_FETCH_IDS, FETCH_IDS } from '../../steps/fetch';
import {
  TRANSIT_DATE_SOURCE_IDS,
  lockTransitYears,
  reduceTransit,
  transitByYear,
  transitTargetDate
} from '../../steps/transit';
import {
  GTFS_ARCHIVES,
  GTFS_ARCHIVE_IDS,
  GTFS_FEEDS,
  GTFS_IDS,
  gtfsArchive,
  type OperatorId
} from '../../transit-config';
import { every, tripTables } from '../gtfs-builder';

const cal = (start: string, end: string) =>
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  `WK,1,1,1,1,1,0,0,${start},${end}\n`;

/** A one-route feed: `stops` are [id, lat, lng]; peak trips every `headway` minutes. */
function feed(
  routes: string,
  route: string,
  stops: [string, number, number][],
  headway: number,
  year: number
): GtfsFiles {
  return new Map(
    Object.entries({
      'calendar.txt': cal(`${year}0101`, `${year}1231`),
      'routes.txt': routes,
      'stops.txt':
        'stop_id,stop_name,stop_lat,stop_lon\n' +
        stops.map(([id, lat, lng]) => `${id},Stop ${id},${lat},${lng}`).join('\n') +
        '\n',
      ...tripTables([
        { route, dir: 0, stops: stops.map((s) => s[0]), starts: every(7, 0, headway, 12) }
      ])
    })
  );
}

const MUNI_ROUTES = 'route_id,route_short_name,route_long_name,route_type\n22,22,FILLMORE,3\n';
const BART_ROUTES =
  'route_id,route_short_name,route_long_name,route_type\nYL-S,Yellow-S,Antioch to SFO,1\n';
const muni = (year: number, headway: number) =>
  feed(
    MUNI_ROUTES,
    '22',
    [
      ['a', 37.7596, -122.4195],
      ['b', 37.7556, -122.4195]
    ],
    headway,
    year
  );
const bart = (year: number) =>
  feed(
    BART_ROUTES,
    'YL-S',
    [
      ['16TH', 37.765, -122.4194],
      ['24TH', 37.7524, -122.4184]
    ],
    15,
    year
  );

const keep = () => true;
const zipOf = (g: GtfsFiles) =>
  zipSync(Object.fromEntries([...g].map(([k, v]) => [k, strToU8(v)])));

describe('fetchGtfsArchive', () => {
  const spec = gtfsArchive('bart', 2016, 'openmobilitydata', '20160310');
  const fake = (body: Uint8Array) => {
    const urls: string[] = [];
    return {
      urls,
      http: {
        get: async (url: string) => {
          urls.push(url);
          return { status: 200, headers: new Headers(), body };
        }
      }
    };
  };

  it("gives a lock entry with the archive's licence and the feed's dates as upstreamVersion", async () => {
    const { urls, http } = fake(zipOf(bart(2016)));
    const raw = mkdtempSync(join(tmpdir(), 'sfh-gtfs-archive-'));
    const e = await fetchGtfsArchive(spec, raw, http, new Date('2026-11-25T00:00:00Z'));
    expect(urls).toEqual([
      'https://openmobilitydata-data.s3-us-west-1.amazonaws.com/public/feeds/bart/58/20160310/gtfs.zip'
    ]);
    expect(e).toMatchObject({
      id: 'gtfs-archive-bart-2016',
      upstreamVersion: '20160101..20161231',
      retrievedAt: '2026-11-25T00:00:00.000Z',
      rowCount: 2,
      homepage: 'https://transitfeeds.com'
    });
    expect(e.license).toContain(GTFS_FEEDS['gtfs-bart'].license);
    expect(e.license).toContain('OpenMobilityData');
    expect(e.files).toHaveLength(1);
    expect(e.files[0]).toMatchObject({ name: 'gtfs-archive-bart-2016.zip', url: spec.url });
  });

  it('rejects a feed whose service dates do not cover 1 April of the year', async () => {
    const { http } = fake(zipOf(bart(2015)));
    const raw = mkdtempSync(join(tmpdir(), 'sfh-gtfs-archive-'));
    await expect(fetchGtfsArchive(spec, raw, http)).rejects.toThrow(GtfsArchiveError);
  });

  it('rejects a feed with no stop in San Francisco', async () => {
    const oakland = feed(BART_ROUTES, 'YL-S', [['MCAR', 37.829, -122.267]], 15, 2016);
    const { http } = fake(zipOf(oakland));
    const raw = mkdtempSync(join(tmpdir(), 'sfh-gtfs-archive-'));
    await expect(fetchGtfsArchive(spec, raw, http)).rejects.toThrow(/San Francisco/);
  });

  it("rejects another agency's feed filed under the operator (no route of its route types)", async () => {
    const buses = feed(MUNI_ROUTES, '22', [['a', 37.7596, -122.4195]], 15, 2016);
    const { http } = fake(zipOf(buses));
    const raw = mkdtempSync(join(tmpdir(), 'sfh-gtfs-archive-'));
    await expect(fetchGtfsArchive(spec, raw, http)).rejects.toThrow(/route_type/);
  });

  it('rejects a body that is not a GTFS zip', async () => {
    const { http } = fake(strToU8('<html>Temporarily Offline</html>'));
    const raw = mkdtempSync(join(tmpdir(), 'sfh-gtfs-archive-'));
    await expect(fetchGtfsArchive(spec, raw, http)).rejects.toThrow();
  });
});

describe('archive ids (ruling P10)', () => {
  it('are one per operator and year and stay out of today’s feeds and dates', () => {
    expect(new Set(GTFS_ARCHIVE_IDS).size).toBe(GTFS_ARCHIVES.length);
    for (const id of GTFS_ARCHIVE_IDS) {
      expect(GTFS_IDS as readonly string[]).not.toContain(id);
      expect(Object.keys(GTFS_FEEDS)).not.toContain(id);
      expect(TRANSIT_DATE_SOURCE_IDS as readonly string[]).not.toContain(id);
      expect(AS_OF_SOURCE_IDS as readonly string[]).not.toContain(id);
      expect(FETCH_IDS as readonly string[]).toContain(id);
      expect(DEFAULT_FETCH_IDS).not.toContain(id);
    }
  });

  it('a newer archive entry leaves the transit target date unchanged', () => {
    const e = (id: string, retrievedAt: string) => ({
      id,
      files: [],
      retrievedAt,
      upstreamVersion: 'v',
      rowCount: 0,
      license: 'L',
      homepage: 'h'
    });
    const lock: Lock = {
      sources: [
        e('gtfs-muni', '2026-10-16T17:04:17.239Z'),
        e('gtfs-archive-muni-2016', '2026-11-25T00:00:00.000Z')
      ]
    };
    expect(transitTargetDate(lock)).toBe('2026-10-16');
  });
});

describe('transitByYear', () => {
  const today = reduceTransit(
    [
      { spec: GTFS_FEEDS['gtfs-muni'], files: muni(2026, 5) },
      { spec: GTFS_FEEDS['gtfs-bart'], files: bart(2026) }
    ],
    { targetDate: '2026-10-01', keep, strict: false }
  ).network;
  const todayFeed = (op: OperatorId) => (op === 'muni' ? muni(2026, 5) : bart(2026));
  const archives = [
    { operator: 'muni' as const, year: 2016, feed: () => muni(2016, 20) },
    { operator: 'bart' as const, year: 2016, feed: () => bart(2016) },
    { operator: 'muni' as const, year: 2012, feed: () => muni(2012, 30) }
  ];
  const years = () =>
    transitByYear({
      today: { year: 2026, network: today, feed: todayFeed, operators: ['muni', 'bart'] },
      archives,
      keep
    });

  it("merges two operators' feeds of one year as today's build merges them", () => {
    const y = years().networkFor(2016);
    const expected = reduceTransit(
      [
        { spec: GTFS_FEEDS['gtfs-muni'], files: muni(2016, 20) },
        { spec: GTFS_FEEDS['gtfs-bart'], files: bart(2016) }
      ],
      { targetDate: '2016-04-01', keep, strict: false }
    ).network;
    expect(y.network).toEqual(expected);
    expect(y).toMatchObject({ sourceYear: 2016, sources: { muni: 2016, bart: 2016 } });
  });

  it('a year before the earliest feed uses the earliest, a later year without one the next', () => {
    const t = years();
    expect(t.networkFor(2009)).toMatchObject({
      sourceYear: 2016,
      sources: { muni: 2012, bart: 2016 }
    });
    expect(t.networkFor(2014)).toMatchObject({ sourceYear: 2016, sources: { muni: 2016 } });
  });

  it("a year after every archive is today's network itself", () => {
    const y = years().networkFor(2020);
    expect(y.network).toBe(today);
    expect(y).toMatchObject({ sourceYear: 2026, sources: { muni: 2026, bart: 2026 } });
  });
});

describe('accessByYear', () => {
  const today = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni(2026, 5) }], {
    targetDate: '2026-10-01',
    keep,
    strict: false
  }).network;
  // Two lots in zone 0 by the stops, one in zone 1 far away.
  const lotZone = Int32Array.from([0, 0, 1]);
  const homes = Int32Array.from([10, 30, 5]);
  const lngLat = Float64Array.from([-122.4195, 37.7596, -122.4195, 37.7556, -122.45, 37.79]);

  it('a year before the earliest feed takes the earliest feed’s access and reports it', () => {
    const db = transitByYear({
      today: { year: 2026, network: today, feed: () => muni(2026, 5), operators: ['muni'] },
      archives: [{ operator: 'muni', year: 2016, feed: () => muni(2016, 20) }],
      keep
    });
    const out = accessByYear(db, [2010, 2016, 2024], lotZone, homes, lngLat, 2);
    expect(out.map((r) => [r.year, r.sourceYear])).toEqual([
      [2010, 2016],
      [2016, 2016],
      [2024, 2026]
    ]);
    expect([...out[0].access]).toEqual([...out[1].access]);
    expect(out[0].access[0]).toBeGreaterThan(0);
    // Every 20 minutes then, every 5 today: less access in 2016.
    expect(out[1].access[0]).toBeLessThan(out[2].access[0]);
    expect([...out[2].access]).toEqual([
      ...zoneAccess(buildAccessGrid(today), lotZone, homes, lngLat, 2)
    ]);
  });

  it("a lock without archive entries (the mini fixture) gives today's network every year", () => {
    const out = mkdtempSync(join(tmpdir(), 'sfh-gtfs-years-'));
    writeFileSync(
      join(out, 'neighborhoods.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [] })
    );
    const db = lockTransitYears({
      lock: { sources: [] },
      rawDir: out,
      byName: false,
      outDir: out,
      targetDate: '2026-10-16',
      network: today
    });
    for (const y of [2000, 2012, 2026]) {
      expect(db.networkFor(y).network).toBe(today);
      expect(db.networkFor(y).sourceYear).toBe(2026);
    }
  });

  it("with no archives (the mini fixture) every year is today's access", () => {
    const db = transitByYear({
      today: { year: 2026, network: today, feed: () => muni(2026, 5), operators: ['muni'] },
      archives: [],
      keep
    });
    const now = zoneAccess(buildAccessGrid(today), lotZone, homes, lngLat, 2);
    for (const r of accessByYear(db, [2000, 2015, 2026], lotZone, homes, lngLat, 2)) {
      expect([...r.access]).toEqual([...now]);
      expect(r.sourceYear).toBe(2026);
    }
  });
});
