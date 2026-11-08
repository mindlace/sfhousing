// Freed land (lesscars Task 6): carving removed right-of-way into sites, their neighbours and
// zoning, on the mini fixture's restored streets and the mini plan.
import { beforeAll, describe, expect, it } from 'vitest';
import { FILL_LEVELS } from '../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../src/lib/data/scenario-yield';
import { PROJECT_KINDS } from '../../src/lib/data/lesscars/plan';
import { checkPlan, schedulePlan } from '../../src/lib/data/lesscars/schedule';
import type { Day } from '../../src/lib/timelapse/time';
import { SQL_VARS } from '../config';
import { densityCap, fzpYieldCapOf } from '../lib/density-caps';
import type { Duck } from '../lib/duck';
import { chooseZoning, freedFzpRow, readFreedSites, type FreedSite } from '../lib/lesscars/sites';
import { LC } from '../lesscars-config';
import { readRoadLotRows } from '../lib/road-lots';
import { carveFreedLand, notNeighboursOf, removalsOf } from '../steps/lesscars-sql';
import { carveMini, lesscarsMini, miniLessCarsPlan } from './lesscars-helpers';

let db: Duck;
let capDay: Day;

beforeAll(async () => {
  ({ db, capDay } = await lesscarsMini());
});

/** Area shared by two tables' geometries (lc_site by its geojson7131). */
async function overlapM2(d: Duck, a: string, b: string): Promise<number> {
  const g = (t: string) => (t === 'lc_site' ? 'ST_GeomFromGeoJSON(geojson7131)' : 'geom');
  const [r] = await d.all<{ m2: number | null }>(
    `SELECT sum(ST_Area(ST_Intersection(x.g, y.g))) AS m2
     FROM (SELECT ${g(a)} AS g FROM ${a}) x JOIN (SELECT ${g(b)} AS g FROM ${b}) y
       ON ST_Intersects(x.g, y.g)`
  );
  return r.m2 ?? 0;
}

/** Freed area within `m` metres of the centreline `cnn`. */
async function areaNearCnn(d: Duck, cnn: string, m: number): Promise<number> {
  const [r] = await d.all<{ m2: number | null }>(
    `SELECT sum(ST_Area(ST_Intersection(ST_GeomFromGeoJSON(s.geojson7131), ST_Buffer(t.geom, ${m}))))
       AS m2
     FROM lc_site s, src_streets t WHERE t.cnn = '${cnn}'`
  );
  return r.m2 ?? 0;
}

/** Fixture-frame metres (make-fixture.ts) to [lng, lat]. */
async function lngLatOf(d: Duck, pts: [number, number][]): Promise<[number, number][]> {
  const out: [number, number][] = [];
  for (const [x, y] of pts) {
    const [r] = await d.all<{ lng: number; lat: number }>(
      `WITH o AS (
         SELECT ST_Transform(ST_Point(-122.4195, 37.76), 'EPSG:4326', 'EPSG:7131',
                             always_xy := true) AS p
       )
       SELECT ST_X(q) AS lng, ST_Y(q) AS lat FROM (
         SELECT ST_Transform(ST_Point(ST_X(p) + ${x}, ST_Y(p) + ${y}), 'EPSG:7131', 'EPSG:4326',
                             always_xy := true) AS q FROM o
       )`
    );
    out.push([r.lng, r.lat]);
  }
  return out;
}

// The I-80 centreline is horizontal in EPSG:7131 (make-fixture.ts), so a site's extent across
// the line is its y extent and along it its x extent (local frame, metres).
const extent = (s: FreedSite, axis: 0 | 1) => {
  const v = s.rec.polygon.flat().map((p) => p[axis]);
  return Math.max(...v) - Math.min(...v);
};
const spanAcrossLineM = (s: FreedSite) => extent(s, 1);
const spanAlongLineM = (s: FreedSite) => extent(s, 0);

const recarvePlan = () => carveMini(db);
const NONE: ReadonlySet<string> = new Set();
const LOT19 = '3512019';

/** Area of lc_site within parcel `id` (current outline). */
async function parcelOverlapM2(d: Duck, id: string): Promise<number> {
  const [r] = await d.all<{ m2: number | null }>(
    `SELECT sum(ST_Area(ST_Intersection(ST_GeomFromGeoJSON(s.geojson7131), p.geom))) AS m2
     FROM lc_site s, parcels p WHERE p.id = '${id}'`
  );
  return r.m2 ?? 0;
}

const totalSiteArea = (sites: FreedSite[], projectId: string) =>
  sites.filter((s) => s.projectId === projectId).reduce((t, s) => t + s.rec.areaM2, 0);

describe('the mini plan', () => {
  it('parses and passes the plan check', () => {
    const plan = miniLessCarsPlan();
    expect(checkPlan(plan, schedulePlan(plan))).toEqual([]);
    // Every kind but street-removal (the brief's list; I-80's truncation carves the freed land).
    expect(new Set(plan.projects.map((p) => p.kind))).toEqual(
      new Set(PROJECT_KINDS.filter((k) => k !== 'street-removal'))
    );
  });
});

describe('the mini plan against the mini data', () => {
  it('names existing stops, routes, streets and vacant lots, and serves lot 17', async () => {
    const plan = miniLessCarsPlan();
    const { transit } = await lesscarsMini();
    const stopIds = new Set(transit.stops.map((st) => st.id));
    const routes = new Map(transit.patterns.map((pt) => [pt.routeId, pt.mode]));
    const cnns = new Set(
      (await db.all<{ cnn: string }>('SELECT cnn FROM src_streets')).map((r) => r.cnn)
    );
    for (const p of plan.projects) {
      if (p.kind === 'bus-lane') for (const id of p.stopIds) expect(stopIds.has(id), id).toBe(true);
      if (p.kind === 'bus-lane' || p.kind === 'tram-priority')
        for (const r of p.routeIds) expect(routes.has(r), r).toBe(true);
      if ('segments' in p)
        for (const sg of p.segments)
          if ('cnn' in sg) for (const c of sg.cnn) expect(cnns).toContain(c);
    }
    expect(routes.get('N')).toBe('light-rail');
    // A subway stop lies within ½ mile of lot 17's outline (as pol_tod measures).
    const subway = plan.projects.find((p) => p.id === 'subway');
    if (subway?.kind !== 'transit-line') throw new Error('no subway');
    const pts = subway.stops.flatMap((st) => (st.lngLat ? [st.lngLat] : []));
    const [r] = await db.all<{ m: number }>(
      `SELECT min(ST_Distance(p.geom_orig, ST_Transform(ST_Point(s.lng, s.lat), 'EPSG:4326',
                  'EPSG:7131', always_xy := true))) AS m
       FROM parcels p,
            (SELECT unnest([${pts.map((q) => q[0]).join(', ')}]) AS lng,
                    unnest([${pts.map((q) => q[1]).join(', ')}]) AS lat) s
       WHERE p.id = '3512017'`
    );
    expect(r.m).toBeLessThan(SQL_VARS.tod_half_m);
  });
});

describe('carveFreedLand', () => {
  it('carves I-80 into pieces no wider than the ROW and overlapping no parcel', async () => {
    const sites = await readFreedSites(db, capDay);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.siteId.startsWith('lc:hwy:'))).toBe(true);
    // Only lot 19, the freed freeway land, lies under a site.
    expect(
      (await overlapM2(db, 'lc_site', 'parcels')) - (await parcelOverlapM2(db, LOT19))
    ).toBeLessThan(0.01);
    expect(Math.max(...sites.map(spanAcrossLineM))).toBeLessThanOrEqual(2 * 15 + 0.01);
  });

  it('no ROW piece is longer than lotMaxM along the line; no site is under minPieceM2', async () => {
    const sites = await readFreedSites(db, capDay);
    expect(sites.length).toBeGreaterThan(1);
    for (const s of sites) {
      // A site merged with a freed parcel takes the parcel's own extent.
      if (s.parcelM2 === 0)
        expect(spanAlongLineM(s), s.siteId).toBeLessThanOrEqual(LC.lotMaxM + 0.01);
      expect(s.rec.areaM2, s.siteId).toBeGreaterThanOrEqual(LC.minPieceM2);
    }
    // The 140 m truncation: about 140 x 30 m less the access strip round lot 18, plus the half of
    // lot 19 (x[-40, 0]) outside the band.
    const total = totalSiteArea(sites, 'hwy');
    expect(total).toBeGreaterThan(3600);
    expect(total).toBeLessThanOrEqual(140 * 30 + 400 + 0.5);
  });

  it('lot 19 becomes one site merged with the ROW piece it touches', async () => {
    const sites = await readFreedSites(db, capDay);
    const s = sites.filter((x) => x.parcels.includes(LOT19));
    expect(s).toHaveLength(1);
    expect(s[0].siteId).toBe('lc:hwy:1');
    expect(s[0].parcels).toEqual([LOT19]);
    expect(s[0].parcelM2).toBeCloseTo(800, 0);
    // 800 m² parcel + the 1,000 m² rest of the first 46.7 m stretch (x[0, 46.7] × y[60, 90]).
    expect(s[0].rec.areaM2).toBeCloseTo(1800, 0);
    expect(s[0].heldBy).toBeNull();
    for (const o of sites.filter((x) => x !== s[0])) {
      expect(o.parcels, o.siteId).toEqual([]);
      expect(o.parcelM2, o.siteId).toBe(0);
      expect(o.heldBy, o.siteId).toBeNull();
    }
  });

  it('no ROW piece overlaps a freed parcel and the sites cover the band once', async () => {
    const sites = await readFreedSites(db, capDay);
    expect(await parcelOverlapM2(db, LOT19)).toBeCloseTo(800, 0); // only site 1 overlaps it
    // v1's 4,084 m² band (lot 19 then had no row and no access strip), plus lot 19's 400 m²
    // outside it.
    expect(totalSiteArea(sites, 'hwy')).toBeCloseTo(4084 + 400, 0);
    const [r] = await db.all<{ shared: number }>(
      `WITH g AS (SELECT site_id, ST_GeomFromGeoJSON(geojson7131) AS g FROM lc_site)
       SELECT coalesce(sum(ST_Area(ST_Intersection(a.g, b.g))), 0) AS shared
       FROM g a JOIN g b ON a.site_id < b.site_id AND ST_Intersects(a.g, b.g)`
    );
    expect(r.shared).toBeLessThan(0.01);
  });

  it('a freed site never takes freeway land as its zoning neighbour', async () => {
    const sites = await readFreedSites(db, capDay);
    for (const s of sites) expect(s.zoning.parcelId, s.siteId).not.toBe(LOT19);
    const n = await db.all<{ parcel_id: string }>('SELECT parcel_id FROM lc_site_neighbour');
    expect(n.map((r) => r.parcel_id)).not.toContain(LOT19);
  });

  it('no freed site takes a road-like lot as its zoning neighbour', async () => {
    // Lots 20 and 22-24 lie within neighbourM of the hwy sites; lot 22 is 7 m below the band.
    await recarvePlan();
    const n = await db.all(
      `SELECT DISTINCT parcel_id FROM lc_site_neighbour
       WHERE parcel_id IN ('3512020', '3512021', '3512022', '3512023', '3512024')`
    );
    expect(n).toEqual([]);
    expect(
      await db.all(
        `SELECT site_id FROM lc_site s
         WHERE NOT EXISTS (SELECT 1 FROM lc_site_neighbour n WHERE n.site_id = s.site_id)`
      )
    ).toEqual([]);
  });

  it('notNeighboursOf adds the road-like ids', () => {
    expect(notNeighboursOf(null, [], ['3512022']).has('3512022')).toBe(true);
    expect(notNeighboursOf(null, []).size).toBe(0);
  });

  it('lot 19’s site takes its neighbours within neighbourM that are not freeway land', async () => {
    const [site1] = (await readFreedSites(db, capDay)).filter((x) => x.siteId === 'lc:hwy:1');
    const roadLike = await readRoadLotRows(db);
    const near = await db.all<{ id: string }>(
      `SELECT p.id FROM parcels p, lc_site s
       WHERE s.site_id = 'lc:hwy:1'
         AND ST_DWithin(ST_GeomFromGeoJSON(s.geojson7131), p.geom, ${LC.neighbourM})
       ORDER BY p.id`
    );
    expect(near.map((r) => r.id)).toContain(LOT19);
    const got = await db.all<{ parcel_id: string }>(
      `SELECT parcel_id FROM lc_site_neighbour WHERE site_id = 'lc:hwy:1' ORDER BY parcel_id`
    );
    // Nor road-like lots (lots 20, 22-24 lie within neighbourM).
    expect(near.some((r) => roadLike.has(r.id))).toBe(true);
    const want = near.map((r) => r.id).filter((id) => id !== LOT19 && !roadLike.has(id));
    expect(want.length).toBeGreaterThan(0);
    expect(got.map((r) => r.parcel_id)).toEqual(want);
    expect(want).toContain(site1.zoning.parcelId);
  });

  it('a two-part freed parcel becomes two sites', async () => {
    // A synthetic MultiPolygon parcel p2 (two 20 x 10 m parts) on a 100 m line far from the lots.
    const [o] = await db.all<{ x: number; y: number }>(
      `SELECT ST_X(p) AS x, ST_Y(p) AS y FROM (
         SELECT ST_Transform(ST_Point(-122.4195, 37.76), 'EPSG:4326', 'EPSG:7131',
                             always_xy := true) AS p)`
    );
    const sq = (x0: number, x1: number) =>
      `((${[
        [x0, 195],
        [x1, 195],
        [x1, 205],
        [x0, 205],
        [x0, 195]
      ]
        .map(([x, y]) => `${o.x + x} ${o.y + y}`)
        .join(', ')}))`;
    const wkt = `MULTIPOLYGON(${sq(310, 330)}, ${sq(360, 380)})`;
    try {
      await db.run(
        `INSERT INTO parcels (id, geom, geom_orig)
         VALUES ('p2', ST_GeomFromText('${wkt}'), ST_GeomFromText('${wkt}'))`
      );
      const line = await lngLatOf(db, [
        [300, 200],
        [400, 200]
      ]);
      await carveFreedLand(
        db,
        [
          {
            projectId: 'two',
            cnns: [],
            lines: [line],
            rowHalfWidthM: 10,
            parcels: [{ id: 'p2', heldBy: null }]
          }
        ],
        new Set(['p2'])
      );
      const twoPart = await readFreedSites(db, capDay);
      expect(twoPart.map((s) => s.siteId)).toEqual(['lc:two:1', 'lc:two:2']);
      expect(twoPart.map((s) => s.parcels)).toEqual([['p2'], ['p2']]);
      expect(twoPart[0].parcelM2 + twoPart[1].parcelM2).toBeCloseTo(400, 0);
      // Each part takes its stretch's ROW: the band is 100 x 20 m.
      expect(totalSiteArea(twoPart, 'two')).toBeCloseTo(2000, 0);
      for (const s of twoPart) expect(s.zoning.parcelId).not.toBe('p2');
    } finally {
      await db.run(`DELETE FROM parcels WHERE id = 'p2'`);
      await recarvePlan();
    }
  });

  it('a held parcel is a site of its own that no ROW piece joins', async () => {
    const removed = removalsOf(miniLessCarsPlan()).map((r) => ({
      ...r,
      parcels: r.parcels.map((p) => ({ ...p, heldBy: 'garage' }))
    }));
    try {
      await carveFreedLand(db, removed, new Set([LOT19]));
      const sites = await readFreedSites(db, capDay);
      const held = sites.filter((s) => s.heldBy !== null);
      expect(held.map((s) => [s.siteId, s.heldBy, s.parcels])).toEqual([
        ['lc:hwy:1', 'garage', [LOT19]]
      ]);
      expect(held[0].rec.areaM2).toBeCloseTo(800, 0);
      expect(held[0].parcelM2).toBeCloseTo(800, 0);
      // The ROW piece it touched stays a site; the band is covered as before.
      expect(totalSiteArea(sites, 'hwy')).toBeCloseTo(4084 + 400, 0);
    } finally {
      await recarvePlan();
    }
  });

  it('ids, records and the access strip', async () => {
    const sites = await readFreedSites(db, capDay);
    expect(sites.map((s) => s.siteId)).toEqual([...sites.map((s) => s.siteId)].sort());
    for (const s of sites) {
      expect(s.projectId).toBe('hwy');
      expect(s.rec.id).toBe(s.siteId);
      expect(s.rec.existingUnits).toBe(0);
      expect(s.rec.existingFloorAreaM2).toBe(0);
      expect(s.rec.existingHeightM).toBe(0);
      expect(s.rec.landUse).toBe('VACANT');
      expect(s.rec.eligible).toBe(true);
      expect(s.rec.neighborhood).toBe(s.zoning.neighborhood);
      expect(s.outline[0].length).toBeGreaterThanOrEqual(4);
    }
    // No freed land within accessM of a parcel, but the freed parcel's own (it gets no strip).
    const [r] = await db.all<{ m2: number | null }>(
      `SELECT sum(ST_Area(ST_Intersection(ST_GeomFromGeoJSON(s.geojson7131),
                                         ST_Buffer(p.geom_orig, ${LC.accessM - 0.01})))) AS m2
       FROM lc_site s, parcels p WHERE p.id <> '${LOT19}'`
    );
    expect(r.m2 ?? 0).toBeLessThan(0.01);
  });

  it('every site has a neighbour, and the chosen one is the most permissive', async () => {
    const sites = await readFreedSites(db, capDay);
    const n = await db.all<{ site_id: string; parcel_id: string; dist_m: number }>(
      'SELECT site_id, parcel_id, dist_m FROM lc_site_neighbour ORDER BY site_id, parcel_id'
    );
    for (const s of sites) {
      const mine = n.filter((r) => r.site_id === s.siteId);
      expect(mine.length, s.siteId).toBeGreaterThan(0);
      expect(mine.every((r) => r.dist_m <= LC.neighbourM)).toBe(true);
      expect(mine.map((r) => r.parcel_id)).toContain(s.zoning.parcelId);
    }
    // The east piece borders lot 18 (40 stories, 6 m away) but lot 14's Local Program envelope
    // (120/400//120/650-R-4: 650 ft, 65 stories) 30 m away is more permissive.
    const east = [...sites].sort((a, b) => b.rec.labelPoint[0] - a.rec.labelPoint[0])[0];
    const nearest = n.filter((r) => r.site_id === east.siteId).sort((a, b) => a.dist_m - b.dist_m);
    expect(nearest[0].parcel_id).toBe('3512018');
    expect(east.zoning).toMatchObject({
      parcelId: '3512014',
      zoningCode: 'C-3-G',
      localProgram: true,
      fzpStories: 65
    });
  });

  it('kept Fixture Ave keeps its keepHalfM corridor', async () => {
    expect(await areaNearCnn(db, '2000', LC.keepHalfM)).toBe(0);
    // A one-off removal across Fixture Ave: land on both sides is freed, its corridor is not.
    try {
      const line = await lngLatOf(db, [
        [120, -30],
        [180, -30]
      ]);
      await carveFreedLand(
        db,
        [{ projectId: 'x', cnns: [], lines: [line], rowHalfWidthM: 15, parcels: [] }],
        NONE
      );
      const sites = await readFreedSites(db, capDay);
      expect(sites.length).toBe(2);
      expect(await areaNearCnn(db, '2000', LC.keepHalfM - 0.01)).toBeLessThan(0.01);
      expect(await overlapM2(db, 'lc_site', 'parcels')).toBeLessThan(0.01);
    } finally {
      await recarvePlan();
    }
  });

  it('a piece with no parcel within neighbourM takes the nearest parcel', async () => {
    try {
      const line = await lngLatOf(db, [
        [300, 200],
        [400, 200]
      ]);
      await carveFreedLand(
        db,
        [{ projectId: 'far', cnns: [], lines: [line], rowHalfWidthM: 10, parcels: [] }],
        NONE
      );
      const sites = await readFreedSites(db, capDay);
      expect(sites.length).toBeGreaterThan(0);
      const n = await db.all<{ site_id: string; parcel_id: string; dist_m: number }>(
        'SELECT site_id, parcel_id, dist_m FROM lc_site_neighbour ORDER BY site_id'
      );
      expect(n.length).toBe(sites.length);
      const [nearest] = await db.all<{ id: string }>(
        `SELECT p.id FROM parcels p, lc_site s WHERE s.site_id = '${sites[0].siteId}'
         ORDER BY ST_Distance(p.geom, ST_GeomFromGeoJSON(s.geojson7131)), p.id LIMIT 1`
      );
      expect(n[0].dist_m).toBeGreaterThan(LC.neighbourM);
      expect(n[0].parcel_id).toBe(nearest.id);
      expect(sites[0].zoning.parcelId).toBe(nearest.id);
    } finally {
      await recarvePlan();
    }
  });

  it('cuts a bent line into disjoint pieces that cover the whole band', async () => {
    try {
      const line = await lngLatOf(db, [
        [250, 100],
        [370, 100],
        [442, 196]
      ]);
      // Two 120 m legs: the bend falls on a cut, so the wedge outside it is no stretch's own.
      await carveFreedLand(
        db,
        [{ projectId: 'bend', cnns: [], lines: [line], rowHalfWidthM: 10, parcels: [] }],
        NONE
      );
      const sites = await readFreedSites(db, capDay);
      expect(sites.length).toBe(4);
      const [w] = await db.all<{ n: number }>('SELECT count(*)::INTEGER AS n FROM lc_left');
      expect(w.n).toBeGreaterThan(0);
      const [r] = await db.all<{ pieces: number; band: number; shared: number }>(
        `WITH g AS (SELECT site_id, ST_GeomFromGeoJSON(geojson7131) AS g FROM lc_site)
         SELECT (SELECT sum(ST_Area(g)) FROM g) AS pieces,
                (SELECT ST_Area(ST_Buffer(ST_LineMerge(ST_Union_Agg(geom)), 10, 8, 'CAP_FLAT',
                                          'JOIN_ROUND', 5.0))
                 FROM lc_line) AS band,
                (SELECT coalesce(sum(ST_Area(ST_Intersection(a.g, b.g))), 0)
                 FROM g a JOIN g b ON a.site_id < b.site_id AND ST_Intersects(a.g, b.g)) AS shared`
      );
      expect(r.shared).toBeLessThan(0.01);
      expect(Math.abs(r.pieces - r.band)).toBeLessThan(0.5);
    } finally {
      await recarvePlan();
    }
  });

  it('rejects a CNN the street table does not have', async () => {
    await expect(
      carveFreedLand(
        db,
        [{ projectId: 'bad', cnns: ['999999'], lines: [], rowHalfWidthM: 10, parcels: [] }],
        NONE
      )
    ).rejects.toThrow(/999999/);
    await recarvePlan();
  });
});

const zone = (
  parcelId: string,
  fzpStories: number,
  localProgram: boolean,
  zoningCode = 'RH-2'
) => ({
  parcelId,
  distM: 0,
  zoningCode,
  r4: localProgram,
  baseFt: 40,
  lpFt: null,
  localProgram,
  fzpStories,
  neighborhood: 'Mission'
});

describe('chooseZoning', () => {
  it('chooseZoning prefers more stories, then no cap, then the smaller id', () => {
    expect(chooseZoning([zone('b', 4, false), zone('a', 6, false)]).parcelId).toBe('a');
    expect(chooseZoning([zone('a', 6, false), zone('b', 6, true)]).parcelId).toBe('b');
    expect(chooseZoning([zone('b', 6, false), zone('a', 6, false)]).parcelId).toBe('a');
    // An uncapped code (C-3-O has no density limit) beats a capped one off the Local Program.
    expect(chooseZoning([zone('a', 6, false), zone('b', 6, false, 'C-3-O')]).parcelId).toBe('b');
    expect(() => chooseZoning([])).toThrow();
  });
});

describe('freedFzpRow', () => {
  it('a sliver yields 0 homes and is still a site', async () => {
    try {
      // A 2 m wide, 60 m strip below lots 2 to 7, clear of Mission St's corridor: 120 m², one
      // piece (one stretch: its length is 60 m plus projection noise).
      const line = await lngLatOf(db, [
        [10, -25],
        [70, -25]
      ]);
      await carveFreedLand(
        db,
        [{ projectId: 'sliver', cnns: [], lines: [line], rowHalfWidthM: 1, parcels: [] }],
        NONE
      );
      const sites = await readFreedSites(db, capDay);
      expect(sites.map((x) => x.siteId)).toEqual(['lc:sliver:1']);
      const site = sites[0];
      expect(site.rec.areaM2).toBeGreaterThanOrEqual(LC.minPieceM2);
      expect(site.rec.areaM2).toBeLessThan(121);
      expect(site.zoning.fzpStories).toBeGreaterThan(0);
      const row = freedFzpRow(site, capDay, (st) => scenarioYield(site.rec, st, null));
      expect(row.stories).toBe(site.zoning.fzpStories);
      expect(row.yield).toEqual(FILL_LEVELS.map(() => 0));
      expect(row.hostable).toBe(false);
    } finally {
      await recarvePlan();
    }
  });

  it('caps a capped code on the piece’s own area', () => {
    const site = (areaM2: number): FreedSite => ({
      siteId: 'lc:hwy:1',
      projectId: 'hwy',
      rec: {
        id: 'lc:hwy:1',
        polygon: [
          [
            [0, 0],
            [areaM2 / 20, 0],
            [areaM2 / 20, 20],
            [0, 20]
          ]
        ],
        labelPoint: [-122.42, 37.76],
        areaM2,
        existingUnits: 0,
        existingFloorAreaM2: 0,
        existingHeightM: 0,
        landUse: 'VACANT',
        eligible: true,
        neighborhood: 'Mission'
      },
      outline: [],
      zoning: zone('3512006', 6, false, 'RM-1'),
      parcels: [],
      parcelM2: 0,
      heldBy: null
    });
    const caps = [400, 2000].map((a) => {
      const row = freedFzpRow(site(a), capDay, () => 1_000_000);
      const want = densityCap('RM-1', a, false, capDay);
      expect(want).not.toBeNull();
      expect(row.cap).toBe(want);
      expect(row.cap).toBe(fzpYieldCapOf('RM-1', a, false, false, capDay));
      expect(row.yield[row.yield.length - 1]).toBe(want);
      return row.cap;
    });
    expect(caps[1]).toBeGreaterThan(caps[0] as number);
  });

  it('caps a carved site as its chosen neighbour reads', async () => {
    const sites = await readFreedSites(db, capDay);
    for (const s of sites) {
      const row = freedFzpRow(s, capDay, () => 1_000_000);
      expect(row.stories).toBe(s.zoning.fzpStories);
      const z = s.zoning;
      expect(row.cap).toBe(fzpYieldCapOf(z.zoningCode, s.rec.areaM2, z.r4, z.localProgram, capDay));
    }
  });
});
