// Tagged `tools`: the tippecanoe/pmtiles tests skip with a message when the tool is absent.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BBOX, FIXTURE_PROFILE, LIVE_PROFILE } from '../config';
import { which, run } from '../lib/exec';
import { runSql } from '../lib/sql';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PMTiles } from 'pmtiles';
import type { Duck } from '../lib/duck';
import { BOXES_ID, boxesFilesOf } from '../lib/lidar/artifact';
import { readLock, writeLock } from '../lib/lock';
import { NodeFileSource } from '../lib/pmtiles-file';
import { build } from '../steps/build';
import { writeRenderBoxes } from '../steps/render-boxes';
import {
  installFonts,
  SPLIT_MAX_TILE_BYTES,
  tileDropReports,
  writeBasemap,
  writeBuildingsTiles,
  z12TileBytes
} from '../steps/tiles';
import { MINI, miniDuck, openMiniDuck } from './helpers';

const lngX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const latY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const hasTippecanoe = !!(await which('tippecanoe'));
const hasPmtiles = !!(await which('pmtiles'));
if (!hasTippecanoe) console.warn('[tools] tippecanoe not found: skipping buildings tiles test');
if (!hasPmtiles) console.warn('[tools] pmtiles not found: skipping pmtiles-based tests');

describe.skipIf(!hasTippecanoe || !hasPmtiles)('tiles [tools]', () => {
  it('writes buildings.pmtiles whose features carry typed parcelId/heightM/baseM/hs', async () => {
    const db = await miniDuck();
    await runSql(db);
    const out = mkdtempSync(join(tmpdir(), 'sfh-tiles-'));
    await writeBuildingsTiles(db, out, out);
    const meta = JSON.parse(
      (await run('pmtiles', ['show', join(out, 'buildings.pmtiles'), '--metadata'])).stdout
    );
    const layer = meta.vector_layers.find((l: { id: string }) => l.id === 'buildings');
    expect(layer.minzoom).toBeLessThanOrEqual(12);
    expect(layer.fields).toMatchObject({
      parcelId: 'String',
      heightM: 'Number',
      baseM: 'Number',
      hs: 'Number'
    });
    const stats = meta.tilestats.layers.find((l: { layer: string }) => l.layer === 'buildings');
    const parcelAttr = stats.attributes.find(
      (a: { attribute: string }) => a.attribute === 'parcelId'
    );
    expect(parcelAttr.type).toBe('string');
    expect(parcelAttr.values).toContain('0026T001A');
    const seq = readFileSync(join(out, 'buildings.geojsonseq'), 'utf8').trim().split('\n');
    const props = seq.map((l) => JSON.parse(l).properties);
    expect(props.some((p: Record<string, unknown>) => !('parcelId' in p))).toBe(true); // pier
    for (const p of props) {
      expect(Object.keys(p).every((k) => ['parcelId', 'heightM', 'baseM', 'hs'].includes(k))).toBe(
        true
      );
    }
  });
});

/** Main's buildings tiles from before the boxes work (fixtures/mini/README.md): never regenerated. */
const NO_BOXES = join(MINI, 'tiles-no-boxes');
/** tippecanoe's argv on main (tiles.ts before the zoom split). */
const MAIN_ARGS = [
  '-o',
  'buildings.pmtiles',
  '-l',
  'buildings',
  '-Z',
  '12',
  '-z',
  '15',
  '-y',
  'parcelId',
  '-y',
  'heightM',
  '-y',
  'baseM',
  '-y',
  'hs',
  '-T',
  'parcelId:string',
  '-T',
  'heightM:float',
  '-T',
  'baseM:float',
  '-T',
  'hs:int',
  '--drop-smallest-as-needed',
  '--maximum-tile-bytes=400000',
  '--no-simplification-of-shared-nodes',
  '--force',
  'buildings.geojsonseq'
];
const TODAY_FIELDS = ['parcelId', 'heightM', 'baseM', 'hs'];
const SPLIT_FIELDS = [...TODAY_FIELDS, 'src', 'groundM', 'groundMinM'];
/** Label points of the mini lots the checks below look at. */
const LOT: Record<string, [number, number]> = {
  '3512001': [-122.4194432, 37.7601351],
  '3512010': [-122.4184219, 37.7601349],
  '3512011': [-122.4183084, 37.7601349],
  '3512014': [-122.4179679, 37.7601348],
  '3512015': [-122.4098382, 37.7601323]
};

interface TileFeature {
  props: Record<string, string | number | boolean>;
  /** The feature's geometry as GeoJSON (lng/lat). */
  geometry: string;
}

/** The `buildings` features of the z tile holding `at`, or [] when the tile is absent. */
async function tileFeatures(file: string, z: number, at: [number, number]): Promise<TileFeature[]> {
  const [x, y] = [lngX(at[0], z), latY(at[1], z)];
  const t = await new PMTiles(new NodeFileSource(file)).getZxy(z, x, y);
  if (!t) return [];
  const layer = new VectorTile(new Pbf(new Uint8Array(t.data))).layers.buildings;
  return [...Array(layer?.length ?? 0).keys()].map((i) => {
    const f = layer.feature(i);
    return { props: f.properties, geometry: JSON.stringify(f.toGeoJSON(x, y, z).geometry) };
  });
}

/**
 * The parcel holding a point inside the feature (ST_PointOnSurface), or null. F14: never by
 * intersection, since a box of lot 11 shares its edge with lot 10.
 */
async function parcelOf(db: Duck, f: TileFeature): Promise<string | null> {
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM parcels
     WHERE ST_Contains(ST_Transform(geom, 'EPSG:7131', 'EPSG:4326', always_xy := true),
                       ST_PointOnSurface(ST_GeomFromGeoJSON('${f.geometry}')))
     ORDER BY id`
  );
  expect(rows.length, f.geometry).toBeLessThanOrEqual(1);
  return rows[0]?.id ?? null;
}

const sortedFeatures = (fs: TileFeature[]) => fs.map((f) => JSON.stringify(f)).sort();

describe.skipIf(!hasTippecanoe || !hasPmtiles)('buildings tiles zoom split [tools]', () => {
  let db: Duck;
  const plainOut = mkdtempSync(join(tmpdir(), 'sfh-tiles-plain-'));
  const splitOut = mkdtempSync(join(tmpdir(), 'sfh-tiles-split-'));
  const calls: { cmd: string; args: string[] }[] = [];
  let plain: { dropsAtSplit: number };
  let split: { dropsAtSplit: number };
  const plainFile = join(plainOut, 'buildings.pmtiles');
  const splitFile = join(splitOut, 'buildings.pmtiles');

  beforeAll(async () => {
    db = await openMiniDuck();
    await runSql(db);
    // Before writeRenderBoxes: the db of a lock without the artifact.
    plain = await writeBuildingsTiles(db, plainOut, plainOut, undefined, {
      run: (cmd, args, opts) => {
        calls.push({ cmd, args });
        return run(cmd, args, opts);
      }
    });
    const files = boxesFilesOf(readLock(join(MINI, 'sources.lock.json')), join(MINI, 'raw'), true);
    expect((await writeRenderBoxes({ db, files, derivedDir: splitOut })).written).toBe(true);
    split = await writeBuildingsTiles(db, splitOut, splitOut, { split: true });
  });
  afterAll(() => db?.close());

  it("without an artifact the tiles input, argv and archive are main's, byte for byte", () => {
    expect(plain).toEqual({ dropsAtSplit: 0 });
    expect(
      readFileSync(join(plainOut, 'buildings.geojsonseq')).equals(
        readFileSync(join(NO_BOXES, 'buildings.geojsonseq'))
      )
    ).toBe(true);
    expect(calls).toEqual([{ cmd: 'tippecanoe', args: MAIN_ARGS }]);
    expect(readFileSync(plainFile).equals(readFileSync(join(NO_BOXES, 'buildings.pmtiles')))).toBe(
      true
    );
  });

  it("a build whose lock has no building-boxes entry writes main's archive", async () => {
    const root = mkdtempSync(join(tmpdir(), 'sfh-tiles-nobox-'));
    cpSync(MINI, root, { recursive: true });
    const lockPath = join(root, 'sources.lock.json');
    const lock = readLock(lockPath);
    lock.sources = lock.sources.filter((s) => s.id !== BOXES_ID);
    writeLock(lockPath, lock);
    const outRoot = mkdtempSync(join(tmpdir(), 'sfh-tiles-nobox-out-'));
    const { outDir, results } = await build({
      lockPath,
      rawDir: join(root, 'raw'),
      rawByName: true,
      outRoot,
      derivedRoot: mkdtempSync(join(tmpdir(), 'sfh-tiles-nobox-derived-')),
      datasetVersion: 'fixture-0',
      builtAt: '2026-10-10T00:00:00.000Z',
      profile: FIXTURE_PROFILE
    });
    expect(
      readFileSync(join(outDir, 'buildings.pmtiles')).equals(
        readFileSync(join(NO_BOXES, 'buildings.pmtiles'))
      )
    ).toBe(true);
    const counts = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).counts;
    expect(
      Object.keys(counts).filter((k) => /^(boxes|render)\.|^tiles\.buildings/.test(k))
    ).toEqual([]);
    expect(results.find((r) => r.id === 'V37')).toEqual({
      id: 'V37',
      ok: true,
      detail: 'no boxes artifact'
    });
  }, 300_000);

  it("z12-13 keep today's boxes", async () => {
    const z13 = await tileFeatures(splitFile, 13, LOT['3512014']);
    expect(z13.length).toBeGreaterThan(0);
    for (const f of z13)
      expect(Object.keys(f.props).filter((k) => !TODAY_FIELDS.includes(k))).toEqual([]);
    const heights = z13.filter((f) => f.props.parcelId === '3512014').map((f) => f.props.heightM);
    expect(new Set(heights)).toEqual(new Set([60]));
    // The same features as the archive without the artifact, at both zooms.
    for (const z of [12, 13]) {
      for (const at of Object.values(LOT)) {
        expect(sortedFeatures(await tileFeatures(splitFile, z, at)), `z${z}`).toEqual(
          sortedFeatures(await tileFeatures(plainFile, z, at))
        );
      }
    }
  });

  it('z14+ carry the new boxes', async () => {
    for (const z of [14, 15]) {
      for (const at of Object.values(LOT)) {
        const fs = await tileFeatures(splitFile, z, at);
        expect(fs.length, `z${z}`).toBeGreaterThan(0);
        for (const f of fs) {
          expect(Object.keys(f.props).filter((k) => !SPLIT_FIELDS.includes(k))).toEqual([]);
          expect(['box', 'base', 'front', 'step', 'part']).toContain(f.props.src);
        }
      }
    }
    const z15 = await tileFeatures(splitFile, 15, LOT['3512014']);
    const of = (id: string) => z15.filter((f) => f.props.parcelId === id).map((f) => f.props);
    const b14 = of('3512014');
    expect(new Set(b14.map((p) => p.src))).toEqual(new Set(['part']));
    expect(new Set(b14.map((p) => `${p.heightM}/${p.baseM}`)).size).toBe(8);
    const b01 = of('3512001');
    expect(b01.length).toBeGreaterThan(0);
    for (const p of b01) {
      expect(p.src).toBe('base');
      expect(p.groundM as number).toBeCloseTo(20, 1);
      expect(p.groundMinM as number).toBeCloseTo(20, 1);
    }
    const bbay = (await tileFeatures(splitFile, 15, LOT['3512015']))
      .filter((f) => f.props.parcelId === '3512015')
      .map((f) => f.props);
    expect(bbay.length).toBeGreaterThan(0);
    for (const p of bbay) {
      expect(p.src).toBe('box');
      // bbay has no ground (null): the key is left out, never written as null.
      expect('groundM' in p || 'groundMinM' in p).toBe(false);
    }
  });

  it('every z14+ feature of a parcel carries its parcelId (Review Focus 5)', async () => {
    const perLot = new Map<string, number>();
    for (const z of [14, 15]) {
      const seen = new Set<string>();
      for (const at of Object.values(LOT)) {
        const key = `${lngX(at[0], z)}/${latY(at[1], z)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const f of await tileFeatures(splitFile, z, at)) {
          const lot = await parcelOf(db, f);
          expect(f.props.parcelId, `z${z} ${f.geometry}`).toBe(lot ?? undefined);
          if (z === 15 && lot) perLot.set(lot, (perLot.get(lot) ?? 0) + 1);
        }
      }
    }
    // Every box of a parcel shares its parcelId, so the `replaced` feature-state (keyed by
    // promoteId) hides them all: lot 10's part, lot 11's base and step, lot 14's 8 parts.
    expect(perLot.get('3512010')).toBe(1);
    expect(perLot.get('3512011')).toBe(2);
    expect(perLot.get('3512014')).toBe(8);
  });

  it('tiles z12-13 at 400000 B and the z14+ boxes at SPLIT_MAX_TILE_BYTES, then joins them', async () => {
    // Live 2026-11-14: 13 of 52 z14 tiles were over 400 KB (max 680 KB), while main's z12 tiles
    // already fill 400 KB, so one shared limit either drops boxes or doubles the z12 bytes.
    expect(SPLIT_MAX_TILE_BYTES).toBe(1_000_000);
    const dir = mkdtempSync(join(tmpdir(), 'sfh-tiles-limit-'));
    const seen: { cmd: string; args: string[] }[] = [];
    const fake = {
      run: async (cmd: string, args: string[]) => {
        seen.push({ cmd, args });
        return { code: 0, stdout: '', stderr: '' };
      }
    };
    await writeBuildingsTiles(db, dir, dir, { split: true }, fake);
    expect(seen.map((c) => c.cmd)).toEqual(['tippecanoe', 'tippecanoe', 'tile-join']);
    const [low, high, join2] = seen.map((c) => c.args);
    expect(low).toContain('--maximum-tile-bytes=400000');
    expect(low.at(-1)).toBe('buildings.geojsonseq');
    expect(high).toContain(`--maximum-tile-bytes=${SPLIT_MAX_TILE_BYTES}`);
    expect(high.at(-1)).toBe('boxes.geojsonseq');
    expect(join2).toEqual([
      '-pk',
      '-f',
      '-o',
      'buildings.pmtiles',
      'buildings-low.pmtiles',
      'buildings-high.pmtiles'
    ]);
    // z12-13 features only in the first input, the z14+ boxes only in the second.
    const zooms = (f: string) =>
      new Set(
        readFileSync(join(dir, f), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.stringify(JSON.parse(l).tippecanoe))
      );
    expect(zooms('buildings.geojsonseq')).toEqual(new Set(['{"minzoom":12,"maxzoom":13}']));
    expect(zooms('boxes.geojsonseq')).toEqual(new Set(['{"minzoom":14,"maxzoom":15}']));
    // Without the artifact: one run at 400000, as on main.
    expect(calls[0].args).toContain('--maximum-tile-bytes=400000');
  });

  it('drop detection works (Review Focus 3)', async () => {
    expect(split).toEqual({ dropsAtSplit: 0 });
    const tiny = mkdtempSync(join(tmpdir(), 'sfh-tiles-tiny-'));
    const r = await writeBuildingsTiles(db, tiny, tiny, { split: true, maxTileBytes: 200 });
    expect(r.dropsAtSplit).toBeGreaterThan(0);
  });

  it('counts only z14+ tile reports', () => {
    const stderr = [
      '  81.2%  12/655/1583  \rtile 12/655/1583 size is 360 with detail 12, >200    ',
      'Going to try keeping the biggest 41.67% of the features to make it fit',
      '  87.4%  13/1310/3166  \rtile 13/1310/3166 has 250000 features, >200000    ',
      '  93.6%  14/2620/6333  \rtile 14/2620/6333 size is 631 with detail 12, >200    ',
      'Going to try keeping the biggest 23.77% of the features to make it fit',
      '  99.9%  15/5241/12667  \rtile 15/5241/12667 has 250000 features, >200000    ',
      '  100.0%  15/5241/12667  \r'
    ].join('\n');
    expect(tileDropReports(stderr, 14)).toBe(2);
    expect(tileDropReports(stderr, 12)).toBe(4);
    expect(tileDropReports('  100.0%  15/5241/12667  \r', 14)).toBe(0);
  });
});

describe.skipIf(!hasPmtiles)('basemap [tools]', () => {
  const raw = join(MINI, 'raw/protomaps-basemap.pmtiles');
  it('copies the basemap byte for byte, z12 bytes within the budget', async () => {
    const out = mkdtempSync(join(tmpdir(), 'sfh-basemap-'));
    writeBasemap(raw, out);
    expect(readFileSync(join(out, 'basemap.pmtiles')).equals(readFileSync(raw))).toBe(true);
    const bytes = await z12TileBytes(join(out, 'basemap.pmtiles'), BBOX);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(LIVE_PROFILE.z12BasemapMax);
  });
});

describe('fonts', () => {
  it('renames stacks without spaces and the glyphs template resolves to existing files', () => {
    const out = mkdtempSync(join(tmpdir(), 'sfh-fonts-'));
    const stacks = installFonts(join(MINI, 'raw/protomaps-fonts'), out);
    expect(stacks.sort()).toEqual(['NotoSans-Italic', 'NotoSans-Medium', 'NotoSans-Regular']);
    for (const s of readdirSync(join(out, 'fonts'))) expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
    const template = 'fonts/{fontstack}/{range}.pbf';
    expect(
      existsSync(
        join(out, template.replace('{fontstack}', 'NotoSans-Regular').replace('{range}', '0-255'))
      )
    ).toBe(true);
    // OFL-1.1 redistribution condition: the licence travels with the glyphs (ruling R7).
    expect(readFileSync(join(out, 'fonts/OFL.txt'), 'utf8')).toBe(
      readFileSync(join(MINI, 'raw/protomaps-fonts/OFL.txt'), 'utf8')
    );
  });
});
