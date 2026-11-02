import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureCollection, Geometry } from 'geojson';
import { describe, expect, it } from 'vitest';
import { parsePlanFile, parseSitesFile, type LessCarsPlanFile } from '$lib/data/lesscars/codec';
import type { PlanProject } from '$lib/data/lesscars/plan';
import { LESSCARS_HORIZON } from '$lib/data/lesscars/schedule';
import { OPEN_DAY, type Day } from '$lib/timelapse/time';
import {
  STREET_STATES,
  epochOf,
  eventDays,
  garageFeatures,
  laneState,
  lineFeatures,
  siteFeatures,
  stopFeatures,
  streetFeatures,
  type Span,
  type StreetProps
} from './features';

const DIR = join(process.cwd(), 'e2e/fixtures/data/fixture-0/scenarios/lesscars');
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const planFile = parsePlanFile(read('plan.json'));
const sitesFile = parseSitesFile(read('sites.json'));

const T = (id: string) => planFile.times.find((t) => t.id === id)!;
const live = <G extends Geometry, P extends Span>(
  fc: FeatureCollection<G, P>,
  key: (p: P) => boolean,
  d: Day
) => fc.features.filter((x) => key(x.properties) && x.properties.from <= d && d < x.properties.to);
const stateAt = (
  fc: FeatureCollection<Geometry, StreetProps>,
  key: (p: StreetProps) => boolean,
  d: Day
) => live(fc, key, d).map((x) => x.properties.state);

/** A copy of the fixture plan file with `edit` applied to its plan. */
function withPlan(edit: (f: LessCarsPlanFile) => void): LessCarsPlanFile {
  const f = structuredClone(planFile);
  edit(f);
  return f;
}

describe('laneState', () => {
  it('follows the priority rule', () => {
    expect(laneState(['bus', 'bike', 'sidewalk'])).toBe('transit');
    expect(laneState(['pedestrian', 'bus'])).toBe('pedestrian');
    expect(laneState(['bike', 'sidewalk'])).toBe('bike');
    expect(laneState(['sidewalk', 'service'])).toBe('pedestrian');
    expect(laneState(['car', 'bike', 'sidewalk'])).toBe('bike');
    expect(laneState(['car', 'sidewalk'])).toBeNull();
    expect(laneState(['car', 'tram'])).toBe('transit');
    expect(laneState(['tram', 'sidewalk'])).toBe('transit');
  });
});

describe('streetFeatures', () => {
  it('lists the six states in map-key order', () => {
    expect(STREET_STATES).toEqual(['works', 'transit', 'bike', 'pedestrian', 'removed', 'grade']);
  });

  it('a removal is works from its start and removed from its open, nothing before', () => {
    const fc = streetFeatures(planFile);
    const hwy = (p: StreetProps) => p.project === 'hwy';
    expect(stateAt(fc, hwy, T('hwy').startDay - 1)).toEqual([]);
    expect(new Set(stateAt(fc, hwy, T('hwy').startDay))).toEqual(new Set(['works']));
    expect(new Set(stateAt(fc, hwy, T('hwy').openDay - 1))).toEqual(new Set(['works']));
    expect(new Set(stateAt(fc, hwy, T('hwy').openDay))).toEqual(new Set(['removed']));
    expect(new Set(stateAt(fc, hwy, LESSCARS_HORIZON))).toEqual(new Set(['removed']));
  });

  it('a later project on the same CNN replaces the earlier state (1001: buslane, then ped)', () => {
    const fc = streetFeatures(planFile);
    const at1001 = (d: Day) =>
      live(fc, (p) => p.segment === 'cnn:1001', d).map(
        (x) => `${x.properties.project}:${x.properties.state}`
      );
    expect(at1001(T('buslane').startDay - 1)).toEqual([]);
    expect(new Set(at1001(T('buslane').startDay))).toEqual(new Set(['buslane:works']));
    expect(new Set(at1001(T('buslane').openDay))).toEqual(new Set(['buslane:transit']));
    expect(new Set(at1001(T('ped').startDay))).toEqual(new Set(['ped:works']));
    expect(new Set(at1001(T('ped').openDay))).toEqual(new Set(['ped:transit']));
    // 1000 is untouched by ped: still the bus lane
    const at1000 = live(fc, (p) => p.segment === 'cnn:1000', T('ped').openDay);
    expect(at1000.map((x) => x.properties.project)).toEqual(['buslane']);
    expect(fc.features.every((x) => x.properties.from < x.properties.to)).toBe(true);
  });

  it('draws one feature per CNN line, with that line as its geometry', () => {
    const fc = streetFeatures(planFile);
    const removed = live(fc, (p) => p.segment === 'cnn:4000', T('hwy').openDay);
    expect(removed.map((x) => x.geometry.coordinates)).toEqual(planFile.segments['4000']);
  });

  it('a drawn segment (tram priority) is keyed by project and index', () => {
    const fc = streetFeatures(planFile);
    const tram = fc.features.filter((x) => x.properties.segment === 'line:tram:0');
    expect(tram.map((x) => [x.properties.state, x.properties.from, x.properties.to])).toEqual([
      ['works', T('tram').startDay, T('tram').openDay],
      ['transit', T('tram').openDay, OPEN_DAY]
    ]);
    const p = planFile.plan.projects.find((x) => x.id === 'tram') as PlanProject & {
      kind: 'tram-priority';
    };
    const seg = p.segments[0];
    expect(tram[0].geometry.coordinates).toEqual('line' in seg ? seg.line : null);
  });

  it('the display is grade from its project opening, with no works stage', () => {
    const fc = streetFeatures(planFile);
    const g = fc.features.filter((x) => x.properties.state === 'grade');
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((x) => x.properties.from === T('subway').openDay)).toBe(true);
    expect(g.every((x) => x.properties.to === OPEN_DAY)).toBe(true);
    expect(fc.features.filter((x) => x.properties.segment === 'cnn:2000')).toHaveLength(g.length);
  });

  it('a street change keeping cars ends the drawing at its open', () => {
    const f = withPlan((x) => {
      const ped = x.plan.projects.find((p) => p.id === 'ped');
      if (ped?.kind === 'street-change') ped.lanes = ['car', 'sidewalk'];
    });
    const fc = streetFeatures(f);
    const at1001 = (d: Day) => stateAt(fc, (p) => p.segment === 'cnn:1001', d);
    expect(at1001(T('ped').startDay)).toEqual(['works']);
    expect(at1001(T('ped').openDay)).toEqual([]);
  });

  it('skips a CNN missing from segments without throwing', () => {
    const f = withPlan((x) => {
      delete x.segments['4000'];
    });
    expect(streetFeatures(f).features.some((x) => x.properties.segment === 'cnn:4000')).toBe(false);
  });
});

describe('lineFeatures and stopFeatures', () => {
  it('lines are building until open; stops only from open', () => {
    const l = lineFeatures(planFile).features.filter((x) => x.properties.project === 'subway');
    expect(l.map((x) => [x.properties.building, x.properties.from, x.properties.to])).toEqual([
      [1, T('subway').startDay, T('subway').openDay],
      [0, T('subway').openDay, OPEN_DAY]
    ]);
    expect(l.every((x) => x.properties.mode === 'subway')).toBe(true);
    const stops = stopFeatures(planFile).features;
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((x) => x.properties.from === T(x.properties.project).openDay)).toBe(true);
    expect(stops.every((x) => x.properties.to === OPEN_DAY)).toBe(true);
    const shuttle = lineFeatures(planFile).features.filter((x) => x.properties.mode === 'shuttle');
    expect(shuttle.map((x) => x.properties.project)).toEqual(['shuttle', 'shuttle']);
  });

  it('a stop shared by two lines appears once, from the earlier opening', () => {
    const f = withPlan((x) => {
      const subway = x.plan.projects.find((p) => p.id === 'subway');
      if (subway?.kind !== 'transit-line') return;
      const late = structuredClone(subway);
      late.id = 'subway2';
      late.mode = 'tram';
      x.plan.projects.unshift(late);
      x.times.push({ ...T('subway'), id: 'subway2', openDay: T('subway').openDay + 100 });
    });
    const stops = stopFeatures(f).features;
    const ids = stops.map((x) => x.properties.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stops.every((x) => x.properties.project === 'subway')).toBe(true);
    expect(stops.every((x) => x.properties.mode === 'subway')).toBe(true);
  });
});

describe('siteFeatures', () => {
  it('sites appear on their project availableDay', () => {
    expect(siteFeatures(planFile, sitesFile).features.map((x) => x.properties.from)).toEqual([
      T('hwy').availableDay,
      T('hwy').availableDay,
      T('hwy').availableDay
    ]);
    const fc = siteFeatures(planFile, sitesFile);
    expect(fc.features.map((x) => x.properties.siteId)).toEqual(
      sitesFile.sites.map((s) => s.siteId)
    );
    expect(fc.features[0].geometry.coordinates).toEqual(sitesFile.sites[0].outline);
  });

  it('carries no homes', () => {
    const keys = new Set(
      siteFeatures(planFile, sitesFile).features.flatMap((x) => Object.keys(x.properties))
    );
    expect([...keys].sort()).toEqual(['from', 'project', 'siteId', 'to']);
  });
});

describe('garageFeatures', () => {
  const places = { '3512015': [-122.418, 37.76] as [number, number] };

  it('a garage on a parcel is drawn only when its reservation was kept', () => {
    const kept = garageFeatures(planFile, sitesFile, places, [{ parcelId: '3512015', kept: true }]);
    expect(kept.features).toHaveLength(2);
    expect(
      kept.features.map((x) => [x.properties.building, x.properties.from, x.properties.to])
    ).toEqual([
      [1, T('garage').startDay, T('garage').openDay],
      [0, T('garage').openDay, OPEN_DAY]
    ]);
    expect(kept.features[0].geometry.coordinates).toEqual(places['3512015']);
    expect(kept.features[0].properties.spaces).toBeGreaterThan(0);
    expect(
      garageFeatures(planFile, sitesFile, places, [{ parcelId: '3512015', kept: false }]).features
    ).toHaveLength(0);
    expect(garageFeatures(planFile, sitesFile, places, []).features).toHaveLength(0);
    expect(
      garageFeatures(planFile, sitesFile, {}, [{ parcelId: '3512015', kept: true }]).features
    ).toHaveLength(0);
  });

  it('a garage on a project site stands at the centre of its outlines, none when uncarved', () => {
    const onHwy = withPlan((x) => {
      const g = x.plan.projects.find((p) => p.id === 'garage');
      if (g?.kind === 'edge-garage') g.site = { project: 'hwy' };
    });
    const fc = garageFeatures(onHwy, sitesFile, {}, []);
    expect(fc.features).toHaveLength(2);
    const pts = sitesFile.sites.flatMap((s) => s.outline.flat());
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [lng, lat] = fc.features[0].geometry.coordinates;
    expect(lng).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 9);
    expect(lat).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 9);
    expect(garageFeatures(onHwy, { ...sitesFile, sites: [] }, {}, []).features).toHaveLength(0);
  });
});

describe('eventDays and epochOf', () => {
  it('eventDays is the sorted unique from/to days without OPEN_DAY', () => {
    const days = eventDays(lineFeatures(planFile), stopFeatures(planFile));
    expect(days).toEqual(
      [
        ...new Set([
          T('subway').startDay,
          T('subway').openDay,
          T('shuttle').startDay,
          T('shuttle').openDay
        ])
      ].sort((a, b) => a - b)
    );
    expect(days).not.toContain(OPEN_DAY);
  });

  it('epochOf counts event days at or before the day', () => {
    const days = [10, 20, 30];
    expect([9, 10, 19, 20, 31].map((d) => epochOf(days, d))).toEqual([0, 1, 1, 2, 3]);
    expect(epochOf([], 5)).toBe(0);
  });
});
