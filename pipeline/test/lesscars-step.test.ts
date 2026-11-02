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
import { LESSCARS_PLAN_JSON } from '../lesscars-config';
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

function args(planPath: string | null) {
  outDir = mkdtempSync(join(tmpdir(), 'sfh-lesscars-step-'));
  cpSync(m.outDir, outDir, { recursive: true });
  return {
    db: m.db,
    outDir,
    datasetVersion: 'fixture-0',
    records: m.records,
    planPath,
    profile: FIXTURE_PROFILE,
    capDay: m.capDay
  };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const project = (plan: Json, id: string): Json => plan.projects.find((p: Json) => p.id === id);

function withPlan(edit: (plan: Json) => void) {
  const plan = JSON.parse(readFileSync(LESSCARS_PLAN_JSON.fixture, 'utf8')) as Json;
  edit(plan);
  const dir = mkdtempSync(join(tmpdir(), 'sfh-lesscars-plan-'));
  const path = join(dir, 'plan.json');
  writeFileSync(path, JSON.stringify(plan));
  return args(path);
}

const unknownCnn = (p: Json) => (project(p, 'ped').segments = [{ cnn: ['99999'] }]);
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
      expect(r).toEqual({ written: false, counts: {}, warnings: [] });
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
    expect(Object.keys(plan.segments).sort()).toEqual(['1000', '1001', '4000']);
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

  it('zero_yield counts freed sites of a build project that no build uses', () => {
    const sites = [
      { siteId: 'lc:hwy:0', projectId: 'hwy' },
      { siteId: 'lc:hwy:1', projectId: 'hwy' },
      { siteId: 'lc:other:0', projectId: 'other' }
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
