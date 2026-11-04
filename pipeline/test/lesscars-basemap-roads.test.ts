import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LESSCARS_BASEMAP_IDS_JSON, LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import {
  BASEMAP_ZOOMS,
  basemapIdsMissing,
  idVerdict,
  roadsNear,
  type RoadPiece
} from '../lib/lesscars/basemap-roads';
import { parseBasemapIds, readBasemapIds } from '../lib/lesscars/basemap-ids';
import { splitPhasesOf, type SplitPhase } from '../lib/lesscars/basemap-split';
import { openDuck } from '../lib/duck';
import { lesscarsBasemap, splitReport } from '../steps/lesscars-basemap';
import { MINI } from './helpers';

const MINI_BASEMAP = path.join(MINI, 'raw/protomaps-basemap.pmtiles');
// the mini I-80 (src_streets 4000) runs y = 75 m from O = (-122.4195, 37.7600), x 0..140 m east
const M_PER_DEG = 111_320;
const KX = M_PER_DEG * Math.cos((37.76 * Math.PI) / 180);
const MINI_I80_LNGLAT: [number, number][] = [0, 140].map((x) => [
  -122.4195 + x / KX,
  37.76 + 75 / M_PER_DEG
]);

function piece(p: Partial<RoadPiece>): RoadPiece {
  return {
    id: 1,
    z: 11,
    kind: 'highway',
    isLink: false,
    ref: null,
    name: null,
    lengthM: 100,
    inBandM: 0,
    ...p
  };
}

describe('idVerdict', () => {
  it('a merged line across the cut is mixed; a line wholly inside or outside is not', () => {
    const v = idVerdict([
      piece({ id: 1, z: 11, kind: 'highway', lengthM: 6000, inBandM: 3000 }),
      piece({ id: 2, z: 14, kind: 'highway', lengthM: 800, inBandM: 800 }),
      piece({ id: 3, z: 14, kind: 'highway', lengthM: 500, inBandM: 10 })
    ]);
    expect(v.find((x) => x.z === 11)).toMatchObject({
      ok: false,
      mixed: [expect.objectContaining({ id: 1 })]
    });
    expect(v.find((x) => x.z === 14)?.ok).toBe(true);
  });
  it('a mixed street does not fail the verdict; only highways do', () => {
    expect(
      idVerdict([piece({ z: 12, kind: 'major_road', lengthM: 100, inBandM: 50 })]).find(
        (v) => v.z === 12
      )?.ok
    ).toBe(true);
  });
  it('the verdict covers every zoom the page shows, pieces or not', () => {
    expect(idVerdict([]).map((v) => v.z)).toEqual([...BASEMAP_ZOOMS]);
    expect(idVerdict([]).every((v) => v.ok)).toBe(true);
  });
});

describe('roadsNear', () => {
  it('finds the fixture street under the mini I-80', async () => {
    const pieces = await roadsNear({ pmtiles: MINI_BASEMAP, lines: [MINI_I80_LNGLAT], bandM: 15 });
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(p.inBandM).toBeLessThanOrEqual(p.lengthM + 1e-6);
      expect(Number.isSafeInteger(p.id)).toBe(true);
    }
  });
});

// roadsNear on the mini basemap at z15: the street crossing the mini I-80 (the fixture id list)
const FIXTURE_IDS = [35184564641330];
const MINI_BBOX: [number, number, number, number] = [
  MINI_I80_LNGLAT[0][0] - 0.001,
  37.76 - 0.001,
  MINI_I80_LNGLAT[1][0] + 0.001,
  37.76 + 0.002
];

describe('basemapIdsMissing', () => {
  it('finds the fixture ids and reports an unknown one', async () => {
    expect(await basemapIdsMissing(MINI_BASEMAP, FIXTURE_IDS, MINI_BBOX)).toEqual([]);
    expect(await basemapIdsMissing(MINI_BASEMAP, [...FIXTURE_IDS, 1], MINI_BBOX)).toEqual([1]);
  });
});

describe('basemap id list format', () => {
  const ok = {
    schema: 1,
    source: { sha256: 'ab' },
    phases: [{ project: 'p', ref: null, ids: [1] }]
  };
  it('parses, and reads the fixture list', () => {
    expect(parseBasemapIds(ok).phases[0].ids).toEqual([1]);
    expect(readBasemapIds(LESSCARS_BASEMAP_IDS_JSON.fixture)?.phases[0].ids).toEqual(FIXTURE_IDS);
    expect(readBasemapIds(path.join(MINI, 'no-such.json'))).toBeNull();
  });
  it('rejects unsorted, duplicate and non-integer ids and unknown keys', () => {
    const bad = (ids: unknown[]) => ({ ...ok, phases: [{ project: 'p', ref: null, ids }] });
    expect(() => parseBasemapIds(bad([2, 1]))).toThrow(/sorted/);
    expect(() => parseBasemapIds(bad([1, 1]))).toThrow(/unique/);
    expect(() => parseBasemapIds(bad([1.5]))).toThrow(/integer/);
    expect(() => parseBasemapIds({ ...ok, extra: 1 })).toThrow(/unknown key/);
    expect(() => parseBasemapIds({ ...ok, schema: 2 })).toThrow(/schema/);
  });
});

describe('splitReport', () => {
  it('lists the listed street the mini split moves, by phase and zoom, and nothing left', async () => {
    const db = await openDuck();
    let phases: SplitPhase[];
    try {
      phases = await splitPhasesOf(
        db,
        [{ project: 'hwy', ref: null, ids: FIXTURE_IDS, lines: [MINI_I80_LNGLAT] }],
        25
      );
    } finally {
      db.close();
    }
    const r = await splitReport({ pmtiles: MINI_BASEMAP, phases, kept: [] });
    const row = r.rows.find((x) => x.id === FIXTURE_IDS[0]);
    expect(row).toMatchObject({ project: 'hwy' });
    expect(Object.keys(row!.movedM).map(Number)).toEqual([14, 15]);
    expect(row!.movedM[15]).toBeGreaterThan(10);
    expect(r.keptLostM).toEqual([]);
  });
});

describe('lesscarsBasemap candidates', () => {
  it('writes the pieces in band, grouped by removedBy into phases', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sfh-bm-cand-'));
    const outPath = path.join(dir, 'candidates.json');
    const code = await lesscarsBasemap({
      mode: 'candidates',
      pmtiles: MINI_BASEMAP,
      lockPath: path.join(MINI, 'sources.lock.json'),
      rawDir: path.join(MINI, 'raw'),
      byName: true,
      catalogPath: LESSCARS_FREEWAY_LAND_JSON.fixture,
      outPath,
      minShare: 0.01
    });
    expect(code).toBe(0);
    const out = parseBasemapIds(JSON.parse(readFileSync(outPath, 'utf8')));
    expect(out.source.sha256).toBe(
      'c0d004aa02fa457ea1d8ca31101baa1b882217bb8dde168f6813259c7ca29ec3'
    );
    expect(out.phases.map((p) => p.project)).toEqual(['hwy']);
    expect(out.phases[0].ids).toContain(FIXTURE_IDS[0]);
  });
});
