// The /lesscars pipeline step (lesscars Task 9) on the mini fixture: the mini plan writes the four
// files, bad plan data and a Fillmore violation fail before anything is written, and no plan file
// writes nothing (the live build until the authored plan lands).
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeTimelinePayload,
  parsePlanFile,
  parseSitesFile,
  parseSummary
} from '../../src/lib/data/lesscars/codec';
import { FIXTURE_PROFILE } from '../config';
import {
  LESSCARS_BASEMAP_IDS_JSON,
  LESSCARS_FREEWAY_LAND_JSON,
  LESSCARS_PLAN_JSON
} from '../lesscars-config';
import { readBasemapIds, type BasemapIdsFile } from '../lib/lesscars/basemap-ids';
import { readFreewayLand, type FreewayLandFile } from '../lib/lesscars/freeway-land';
import { LESSCARS_FILES } from '../lib/scenario-files';
import { CALIBRATION_JSON } from '../steps/calibration';
import { writeLessCars, zeroYieldSites } from '../steps/lesscars';
import { PROJECTS_JSON } from '../steps/projects';
import { MINI } from './helpers';
import { lesscarsMini, type LessCarsMini } from './lesscars-helpers';

let m: LessCarsMini;
/** The out dir of the latest `args` call: a copy of the mini's outputs with no lesscars files. */
let outDir: string;

beforeAll(async () => {
  m = await lesscarsMini();
  // lesscarsMini runs neither the projects nor the calibration step; the golden's are the mini's.
  for (const f of [PROJECTS_JSON, CALIBRATION_JSON])
    cpSync(join(MINI, 'golden', f), join(m.outDir, f));
});

/** The fixture catalog (lot 19 under I-80), which the build passes for a fixture version. */
const FIXTURE_FREEWAY_LAND = readFreewayLand(LESSCARS_FREEWAY_LAND_JSON.fixture);

const MINI_BASEMAP = join(MINI, 'raw/protomaps-basemap.pmtiles');
const FIXTURE_BASEMAP_IDS = readBasemapIds(LESSCARS_BASEMAP_IDS_JSON.fixture)!;
const FIXTURE_IDS = FIXTURE_BASEMAP_IDS.phases[0].ids;
const idsOf = (project: string, ids: number[]): BasemapIdsFile => ({
  ...FIXTURE_BASEMAP_IDS,
  phases: [{ project, ref: null, ids }]
});

function args(
  planPath: string | null,
  freewayLand: FreewayLandFile | null = FIXTURE_FREEWAY_LAND,
  ids: BasemapIdsFile | null = FIXTURE_BASEMAP_IDS
) {
  outDir = mkdtempSync(join(tmpdir(), 'sfh-lesscars-step-'));
  cpSync(m.outDir, outDir, { recursive: true });
  return {
    basemap: { pmtiles: MINI_BASEMAP, ids, sha256: undefined as string | undefined },
    db: m.db,
    outDir,
    datasetVersion: 'fixture-0',
    records: m.records,
    planPath,
    profile: FIXTURE_PROFILE,
    capDay: m.capDay,
    freewayLand
  };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const project = (plan: Json, id: string): Json => plan.projects.find((p: Json) => p.id === id);

function withPlan(
  edit: (plan: Json) => void,
  freewayLand: FreewayLandFile | null = FIXTURE_FREEWAY_LAND
) {
  const plan = JSON.parse(readFileSync(LESSCARS_PLAN_JSON.fixture, 'utf8')) as Json;
  edit(plan);
  const dir = mkdtempSync(join(tmpdir(), 'sfh-lesscars-plan-'));
  const path = join(dir, 'plan.json');
  writeFileSync(path, JSON.stringify(plan));
  return args(path, freewayLand);
}

const unknownCnn = (p: Json) => (project(p, 'ped').segments = [{ cnn: ['99999'] }]);
const unknownDisplayCnn = (p: Json) => (p.displays[0].segments = [{ cnn: ['99999'] }]);
const unknownStop = (p: Json) => (project(p, 'buslane').stopIds = ['muni:nope']);
const parkingUnknown = (p: Json) => (project(p, 'parking').parcel = 'no-such-parcel');
const parkingWithHomes = (p: Json) => {
  const row = m.parcels.existingUnits.findIndex((u) => u > 0);
  project(p, 'parking').parcel = m.parcels.id[row];
};
/** The parking lot depends on a new line whose only stop is across the city. */
const parkingUnserved = (p: Json) => {
  const subway = project(p, 'subway');
  p.projects.push({
    ...structuredClone(subway),
    id: 'far',
    label: 'Far line',
    durationMonths: { ...subway.durationMonths, value: 6 },
    stops: [{ id: 'lc:far', name: 'Far', lngLat: [-122.5, 37.78] }],
    alignment: [
      [-122.5, 37.78],
      [-122.501, 37.781]
    ]
  });
  project(p, 'parking').dependsOn = ['far'];
};

describe('writeLessCars', () => {
  it('no plan file: nothing written, no manifest key', async () => {
    for (const planPath of [null, join(tmpdir(), 'sfh-no-such-plan.json')]) {
      const r = await writeLessCars(args(planPath));
      expect(r).toEqual({ written: false, counts: {}, warnings: [], basemapPhases: [] });
      expect(existsSync(join(outDir, 'scenarios/lesscars'))).toBe(false);
    }
  });

  it('the mini plan writes four files that decode and bind to parcels.bin', async () => {
    const r = await writeLessCars(args(LESSCARS_PLAN_JSON.fixture));
    expect(r.written).toBe(true);
    const read = (f: string) => JSON.parse(readFileSync(join(outDir, f), 'utf8')) as unknown;
    const plan = parsePlanFile(read(LESSCARS_FILES.plan));
    expect(plan.datasetVersion).toBe('fixture-0');
    expect(plan.times.map((t) => t.id)).toEqual(plan.plan.projects.map((p) => p.id));
    expect(plan.plan.displays?.map((d) => d.id)).toEqual(['underpass']);
    // 2000 is the display's street: display CNNs are drawn like project CNNs
    expect(Object.keys(plan.segments).sort()).toEqual(['1000', '1001', '2000', '4000']);
    const sites = parseSitesFile(read(LESSCARS_FILES.sites));
    expect(sites.sites.length).toBeGreaterThan(0);
    expect(sites.sites.every((s) => s.projectId === 'hwy')).toBe(true);
    const summary = parseSummary(read(LESSCARS_FILES.summary));
    expect(summary.seeds).toBe(FIXTURE_PROFILE.lesscarsSeeds);
    expect(summary.planId).toBe('mini');
    const bin = readFileSync(join(outDir, LESSCARS_FILES.timeline));
    const payload = inflateRawSync(bin);
    const t = decodeTimelinePayload(payload, m.parcels);
    expect(t.seed).toBe(summary.representativeSeed);
    expect(t.count).toBe(m.parcels.count);
    // Bound to this parcels.bin: another row order does not decode.
    expect(() =>
      decodeTimelinePayload(payload, { count: m.parcels.count, id: [...m.parcels.id].reverse() })
    ).toThrow();
    expect(r.counts).toMatchObject({
      'lesscars.projects': 8,
      'lesscars.sites': sites.sites.length,
      'lesscars.seeds': FIXTURE_PROFILE.lesscarsSeeds,
      'lesscars.regimes': summary.regimeDays.length,
      'lesscars.extra_2068.mean': Math.round(summary.extra.mean[summary.extra.mean.length - 1]),
      'lesscars.bytes.timeline_payload': payload.length
    });
    for (const k of ['lesscars.sites.zero_yield', 'lesscars.unlocked_lots'])
      expect(r.counts[k], k).toBeGreaterThanOrEqual(0);
    // Deflate bytes vary by zlib: fixture builds omit the file size, as policy.bin's.
    expect('lesscars.bytes.timeline' in r.counts).toBe(false);
  });

  it('publishes every freed-site coordinate at 7 decimals', async () => {
    await writeLessCars(args(LESSCARS_PLAN_JSON.fixture));
    const file = JSON.parse(readFileSync(join(outDir, LESSCARS_FILES.sites), 'utf8')) as {
      sites: { outline: [number, number][][] }[];
    };
    const coords = file.sites.flatMap((s) => s.outline.flat(2));
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) expect(c).toBe(Math.round(c * 1e7) / 1e7);
  });

  it('every published site polygon and outline is a valid, simple polygon', async () => {
    // rec.polygon rings are open (ParcelRecord); outline rings are closed (GeoJSON).
    const closed = (r: [number, number][]) => {
      const [a, z] = [r[0], r[r.length - 1]];
      return a[0] === z[0] && a[1] === z[1] ? r : [...r, a];
    };
    const wkt = (rings: [number, number][][]) =>
      `POLYGON(${rings
        .map(
          (r) =>
            `(${closed(r)
              .map(([x, y]) => `${x} ${y}`)
              .join(', ')})`
        )
        .join(', ')})`;
    const garageOn19 = (p: Json) => (project(p, 'garage').site = { parcel: '3512019' });
    // The mini plan, and its variant whose garage holds lot 19 (outDir is the latest args call's).
    for (const a of [() => args(LESSCARS_PLAN_JSON.fixture), () => withPlan(garageOn19)]) {
      await writeLessCars(a());
      const sites = parseSitesFile(
        JSON.parse(readFileSync(join(outDir, LESSCARS_FILES.sites), 'utf8'))
      ).sites;
      expect(sites.length).toBeGreaterThan(0);
      for (const s of sites)
        for (const [what, rings] of [
          ['rec.polygon', s.rec.polygon],
          ['outline', s.outline]
        ] as const) {
          const [r] = await m.db.all<{ valid: boolean; simple: boolean }>(
            `SELECT ST_IsValid(g) AS valid, ST_IsSimple(g) AS simple
             FROM (SELECT ST_GeomFromText('${wkt(rings)}') AS g)`
          );
          expect(r, `${s.siteId} ${what}`).toEqual({ valid: true, simple: true });
        }
    }
  });

  it('zero_yield counts freed sites of a build project that no build uses, held ones aside', () => {
    const sites = [
      { siteId: 'lc:hwy:0', projectId: 'hwy', heldBy: null },
      { siteId: 'lc:hwy:1', projectId: 'hwy', heldBy: null },
      { siteId: 'lc:hwy:2', projectId: 'hwy', heldBy: 'garage' },
      { siteId: 'lc:other:0', projectId: 'other', heldBy: null }
    ];
    const builds = [
      { siteId: 'lc:hwy:0', parcelRow: null },
      { siteId: 'lc:park', parcelRow: 4 }
    ];
    // hwy:1 is a sliver whose envelope holds no home; `other` has no build, so it is no failure.
    expect(zeroYieldSites(sites, new Set(['hwy']), builds).map((s) => s.siteId)).toEqual([
      'lc:hwy:1'
    ]);
    expect(zeroYieldSites(sites, new Set(['hwy']), [])).toHaveLength(2);
  });

  it('bad plan data fails the build', async () => {
    for (const [edit, needle] of [
      [unknownCnn, 'ped.segments'],
      [unknownDisplayCnn, 'underpass.segments'],
      [unknownStop, 'buslane.stopIds'],
      [parkingWithHomes, 'parking.parcel'],
      [parkingUnknown, 'parking.parcel'],
      [parkingUnserved, 'parking.dependsOn']
    ] as const) {
      await expect(writeLessCars(withPlan(edit))).rejects.toThrow(needle);
      expect(existsSync(join(outDir, 'scenarios/lesscars'))).toBe(false);
    }
  });

  it('an unknown route fails the build', async () => {
    await expect(
      writeLessCars(withPlan((p) => (project(p, 'tram').routeIds = ['NOPE'])))
    ).rejects.toThrow('tram.routeIds');
    expect(existsSync(join(outDir, 'scenarios/lesscars'))).toBe(false);
  });

  it('a Fillmore violation fails the build', async () => {
    // The truncation closes I-80 in 2030; the subway it depends on opens in 2033.
    await expect(
      writeLessCars(withPlan((p) => (project(p, 'hwy').startYear = 2030)))
    ).rejects.toThrow('fillmore');
    expect(existsSync(join(outDir, 'scenarios/lesscars'))).toBe(false);
  });

  it('a plan that does not parse fails the build', async () => {
    await expect(writeLessCars(withPlan((p) => (p.schema = 2)))).rejects.toThrow('schema');
    expect(existsSync(join(outDir, 'scenarios/lesscars'))).toBe(false);
  });
});

describe('basemap ids', () => {
  const run = (ids: BasemapIdsFile | null) =>
    writeLessCars(args(LESSCARS_PLAN_JSON.fixture, FIXTURE_FREEWAY_LAND, ids));
  it('an id missing from basemap.pmtiles fails the build', async () => {
    await expect(run(idsOf('hwy', [1, ...FIXTURE_IDS]))).rejects.toThrow(
      /ids 1 are not in basemap\.pmtiles/
    );
    expect(existsSync(join(outDir, 'scenarios/lesscars'))).toBe(false);
  });
  it('a phase naming a project that is not a truncation fails', async () => {
    await expect(run(idsOf('subway', FIXTURE_IDS))).rejects.toThrow(
      /subway is not a highway truncation/
    );
    await expect(run(idsOf('nope', FIXTURE_IDS))).rejects.toThrow(
      /nope is not a highway truncation/
    );
  });
  it('a different lock sha256 is a warning, not a failure', async () => {
    const a = args(LESSCARS_PLAN_JSON.fixture);
    const sha256 = FIXTURE_BASEMAP_IDS.source.sha256;
    a.basemap = {
      pmtiles: MINI_BASEMAP,
      ids: { ...FIXTURE_BASEMAP_IDS, source: { sha256: 'x' } },
      sha256
    };
    const r = await writeLessCars(a);
    expect(r.warnings.some((w) => /basemap-ids\.json: ids were read from/.test(w))).toBe(true);
    expect(r.basemapPhases).toHaveLength(1);
  });
  it('the step returns each phase with its lines', async () => {
    const r = await run(FIXTURE_BASEMAP_IDS);
    expect(r.basemapPhases).toEqual([
      expect.objectContaining({ project: 'hwy', ids: FIXTURE_IDS })
    ]);
    expect(r.basemapPhases[0].lines[0].length).toBeGreaterThanOrEqual(2);
  });
  it('plan.json names the split phases in basemapHide', async () => {
    await run(FIXTURE_BASEMAP_IDS);
    const plan = JSON.parse(readFileSync(join(outDir, LESSCARS_FILES.plan), 'utf8'));
    expect(plan.basemapHide).toEqual([{ projectId: 'hwy', ids: FIXTURE_IDS }]);
  });
  it('no id list, no phases, and no basemapHide', async () => {
    expect((await run(null)).basemapPhases).toEqual([]);
    const plan = JSON.parse(readFileSync(join(outDir, LESSCARS_FILES.plan), 'utf8'));
    expect(plan).not.toHaveProperty('basemapHide');
  });
});

describe('freewayLand checks', () => {
  const FIXTURE_CATALOG = readFreewayLand(LESSCARS_FREEWAY_LAND_JSON.fixture)!;
  /** The fixture catalog with its one segment changed. */
  const catalog = (change: { parcels?: string[]; removedBy?: string | null }): FreewayLandFile => ({
    schema: 1,
    segments: [{ ...FIXTURE_CATALOG.segments[0], ...change }]
  });
  const step = (edit: (p: Json) => void, o: { freewayLand: FreewayLandFile }) =>
    writeLessCars(withPlan(edit, o.freewayLand));
  const withFreed = (parcel: string) => (p: Json) =>
    (project(p, 'hwy').freewayLand = { parcels: [parcel], excluded: [] });
  const parkingOn = (parcel: string) => (p: Json) => (project(p, 'parking').parcel = parcel);
  const garageOn = (parcel: string) => (p: Json) => (project(p, 'garage').site = { parcel });

  it('a freewayLand parcel outside the catalog fails as counted twice', async () => {
    await expect(step(withFreed('3512017'), { freewayLand: FIXTURE_CATALOG })).rejects.toThrow(
      /hwy\.freewayLand: parcel 3512017 is not freeway land/
    );
  });

  it('a freewayLand parcel with homes, or not in parcels.bin, fails', async () => {
    await expect(
      step(withFreed('3512018'), { freewayLand: catalog({ parcels: ['3512018'] }) })
    ).rejects.toThrow(/parcel 3512018 has 2 existing homes/);
    await expect(step(withFreed('nope'), { freewayLand: FIXTURE_CATALOG })).rejects.toThrow(
      /hwy\.freewayLand: parcel nope is not in parcels.bin/
    );
  });

  it('an excluded parcel must be in parcels.bin', async () => {
    const edit = (p: Json) =>
      (project(p, 'hwy').freewayLand = {
        parcels: ['3512019'],
        excluded: [{ parcel: 'nope', reason: 'a park' }]
      });
    await expect(step(edit, { freewayLand: FIXTURE_CATALOG })).rejects.toThrow(
      /hwy\.freewayLand: parcel nope is not in parcels.bin/
    );
  });

  it('a phase may not free a kept freeway’s land, nor another phase’s', async () => {
    await expect(
      step(withFreed('3512019'), { freewayLand: catalog({ removedBy: null }) })
    ).rejects.toThrow(/parcel 3512019 is freeway land of fx-i80, removed by none/);
    await expect(
      step(withFreed('3512019'), { freewayLand: catalog({ removedBy: 'other' }) })
    ).rejects.toThrow(/removed by other/);
  });

  it('a parking conversion on freeway land fails; a garage there passes', async () => {
    await expect(step(parkingOn('3512019'), { freewayLand: FIXTURE_CATALOG })).rejects.toThrow(
      /parking\.parcel: parcel 3512019 is freeway land/
    );
    await expect(
      step(garageOn('3512019'), { freewayLand: FIXTURE_CATALOG })
    ).resolves.toMatchObject({ written: true });
  });
});

describe('freed parcels and held sites', () => {
  const read = (f: string) => JSON.parse(readFileSync(join(outDir, f), 'utf8')) as Json;
  const garageOn = (parcel: string) => (p: Json) => (project(p, 'garage').site = { parcel });

  it('lot 19 is freed into site 1; the counts split freed land by parcels and right-of-way', async () => {
    const r = await writeLessCars(args(LESSCARS_PLAN_JSON.fixture));
    const raw = read(LESSCARS_FILES.sites);
    const sites = parseSitesFile(raw).sites;
    const withParcels = sites.filter((s) => s.parcels !== undefined);
    expect(withParcels.map((s) => [s.siteId, s.parcels])).toEqual([['lc:hwy:1', ['3512019']]]);
    expect(withParcels[0].parcelM2).toBeCloseTo(800, 0);
    // The writer omits a key that is empty, 0 or null.
    for (const s of raw.sites as Json[]) expect('heldBy' in s, s.siteId).toBe(false);
    for (const s of (raw.sites as Json[]).filter((x) => x.siteId !== 'lc:hwy:1')) {
      expect('parcels' in s, s.siteId).toBe(false);
      expect('parcelM2' in s, s.siteId).toBe(false);
    }
    expect('garageCost' in read(LESSCARS_FILES.summary)).toBe(false);
    const area = sites.reduce((t, s) => t + s.rec.areaM2, 0);
    expect(r.counts).toMatchObject({
      'lesscars.sites.parcels': 1,
      'lesscars.sites.held': 0,
      'lesscars.freed_m2.parcels': 800
    });
    expect(r.counts['lesscars.freed_m2.parcels'] + r.counts['lesscars.freed_m2.row']).toBeCloseTo(
      area,
      -1
    );
  });

  it('a held site is not zero-yield and its garage cost is in summary.json', async () => {
    const r = await writeLessCars(withPlan(garageOn('3512019')));
    const sites = parseSitesFile(read(LESSCARS_FILES.sites)).sites;
    const held = sites.filter((s) => s.heldBy !== undefined);
    expect(held.map((s) => [s.siteId, s.heldBy, s.parcels])).toEqual([
      ['lc:hwy:1', 'garage', ['3512019']]
    ]);
    const t = decodeTimelinePayload(
      inflateRawSync(readFileSync(join(outDir, LESSCARS_FILES.timeline))),
      m.parcels
    );
    expect(t.builds.map((b) => b.siteId)).not.toContain('lc:hwy:1');
    const built = new Set(t.builds.map((b) => b.siteId));
    const zeroYieldWithoutHeld = sites.filter((s) => !s.heldBy && !built.has(s.siteId)).length;
    expect(r.counts['lesscars.sites.held']).toBe(1);
    expect(r.counts['lesscars.sites.zero_yield']).toBe(zeroYieldWithoutHeld);
    // Held land is neither freed parcel land nor right-of-way in the counts.
    expect(r.counts['lesscars.freed_m2.parcels']).toBe(0);
    const summary = parseSummary(read(LESSCARS_FILES.summary));
    expect(summary.garageCost).toEqual([{ projectId: 'garage', homes: expect.any(Number) }]);
    expect(summary.garageCost![0].homes).toBeGreaterThan(0);
  });
});
