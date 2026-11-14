import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PROFILE, SQL_VARS } from '../config';
import { BuildError } from '../lib/build-error';
import type { Duck } from '../lib/duck';
import { boxesFilesOf } from '../lib/lidar/artifact';
import { readLock, sha256File, writeLock } from '../lib/lock';
import { runSql } from '../lib/sql';
import { build } from '../steps/build';
import {
  BUILDING_ROOFS_PARQUET,
  RENDER_PIECES_PARQUET,
  writeRenderBoxes
} from '../steps/render-boxes';
import { MINI, openMiniDuck } from './helpers';

const RAW = join(MINI, 'raw');
const files = () => boxesFilesOf(readLock(join(MINI, 'sources.lock.json')), RAW, true);
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

/** md5 over every column of `table` (geometry as hex WKB, NULL as \N), rows in `order`. */
async function fingerprint(db: Duck, table: string, order: string): Promise<string> {
  const cols = await db.all<{ column_name: string; column_type: string }>(`DESCRIBE ${table}`);
  const parts = cols.map(({ column_name: c, column_type: t }) =>
    t.startsWith('GEOMETRY')
      ? `coalesce(ST_AsHEXWKB("${c}"), '\\N')`
      : `coalesce(CAST("${c}" AS VARCHAR), '\\N')`
  );
  const [r] = await db.all<{ h: string }>(
    `SELECT md5(string_agg(concat_ws('|', ${parts.join(', ')}), ';' ORDER BY ${order})) AS h
     FROM ${table}`
  );
  return r.h;
}

const MODEL = [
  ['pieces', 'bid, parcel_id NULLS LAST'],
  ['parcel_out', 'id'],
  ['buildings_export', 'parcel_id NULLS LAST, bid']
] as const;
const modelPrints = async (db: Duck) =>
  Object.fromEntries(
    await Promise.all(MODEL.map(async ([t, o]) => [t, await fingerprint(db, t, o)]))
  );
const exportPrint = (db: Duck) => fingerprint(db, 'render_export', 'parcel_id NULLS LAST, bid, k');

const tables = async (db: Duck): Promise<string[]> =>
  (await db.all<{ name: string }>('SELECT table_name AS name FROM duckdb_tables()')).map(
    (r) => r.name
  );

interface BoxRow {
  bid: string;
  k: number;
  src: string;
  base_m: number;
  height_m: number;
  hs: number;
  ground_m: number | null;
  ground_min_m: number | null;
}

describe('render boxes', () => {
  let db: Duck;
  let before: Record<string, string>;
  let after: Record<string, string>;
  let result: Awaited<ReturnType<typeof writeRenderBoxes>>;
  const derivedDir = tmp('sfh-render-derived-');

  beforeAll(async () => {
    db = await openMiniDuck();
    await runSql(db);
    before = await modelPrints(db);
    result = await writeRenderBoxes({ db, files: files(), derivedDir });
    after = await modelPrints(db);
  });
  afterAll(() => db?.close());

  it('model tables are untouched', () => {
    expect(result.written).toBe(true);
    expect(after).toEqual(before);
  });

  it('composition', async () => {
    const boxes = await db.all<BoxRow>('SELECT * EXCLUDE (geom) FROM render_boxes ORDER BY bid, k');
    const of = (bid: string) => boxes.filter((b) => b.bid === bid);
    const [b01] = await db.all<{ d: number }>(`
      SELECT abs(ST_Area(r.geom) - ST_Area(b.geom)) + ST_Area(ST_SymDifference(r.geom, b.geom)) AS d
      FROM render_boxes r JOIN buildings b USING (bid) WHERE r.bid = 'b01' AND r.src = 'base'`);
    expect(b01.d).toBeLessThanOrEqual(0.01);
    expect(of('bbay')).toEqual([
      expect.objectContaining({ k: 0, src: 'box', height_m: 6, ground_m: null, ground_min_m: null })
    ]);
    const [h03] = await db.all<{ h: number; base: number; hs: number }>(
      "SELECT height_m AS h, base_m AS base, hs FROM buildings WHERE bid = 'b03'"
    );
    expect(of('b03')).toEqual([
      expect.objectContaining({ k: 0, src: 'box', height_m: h03.h, base_m: h03.base, hs: h03.hs })
    ]);
    // A parts building is drawn as its parts only, never also as today's box.
    expect(of('b14').map((b) => b.src)).toEqual(Array(8).fill('part'));
    const leg = await db.all<{ parcel_id: string | null }>(
      "SELECT parcel_id FROM render_pieces WHERE bid = 'b14' AND k = 7"
    );
    expect(leg).toEqual([{ parcel_id: '3512014' }]);
    expect(result.counts['boxes.outside_footprint']).toBe(0);
    expect(result.counts['boxes.missing_buildings']).toBe(0);
    expect(result.counts['boxes.artifact_unknown_bids']).toBe(0);
    expect(result.counts['boxes.step.max_per_building']).toBeLessThanOrEqual(4);
    // F16: the single-box fallbacks are counted on the composed table, by src.
    const [{ n }] = await db.all<{ n: number }>(
      "SELECT count(*)::INTEGER AS n FROM render_boxes WHERE src = 'box'"
    );
    expect(n).toBe(4);
    expect(result.counts['boxes.src.box']).toBe(n);
    expect(result.counts['boxes.src.part']).toBe(9);
    const [{ p }] = await db.all<{ p: number }>('SELECT count(*)::INTEGER AS p FROM render_pieces');
    expect(result.counts['render.pieces']).toBe(p);
    expect(result.counts['render.outside_parcels']).toBeGreaterThanOrEqual(0);
  });

  it('draws besri at the render minimum, which pieces drops', async () => {
    expect(SQL_VARS.render_min_piece_m2).toBe(0.25);
    const rows = await db.all<{ a: number }>(
      "SELECT area_m2 AS a FROM render_pieces WHERE bid = 'besri'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBeCloseTo(1.44, 2);
    expect(await db.all("SELECT * FROM pieces WHERE bid = 'besri'")).toEqual([]);
  });

  it('agrees with 50_clip on whole-footprint boxes at min_piece_m2', async () => {
    // 76_render_boxes copies 50_clip's logic (F13). A box over the whole footprint (src box, a
    // base box stored without geometry, a podium part) is cut exactly as pieces cuts the
    // building; a src box also carries the building's heights, so its rows equal pieces' rows.
    await db.run(`
      CREATE OR REPLACE TEMP TABLE t_whole AS
      SELECT r.bid, r.k, r.src FROM render_boxes r JOIN buildings b USING (bid)
      WHERE ST_Equals(r.geom, b.geom)`);
    const compare = async (cols: string, where: string) => {
      const pick = `bid, parcel_id, ST_AsHEXWKB(geom) AS g, area_m2${cols}`;
      const keep = `area_m2 >= getvariable('min_piece_m2')`;
      const order = 'ORDER BY bid, parcel_id NULLS LAST';
      const render = await db.all(
        `SELECT ${pick} FROM render_pieces JOIN t_whole USING (bid, k, src)
         WHERE ${where} AND ${keep} ${order}`
      );
      const model = await db.all(
        `SELECT ${pick} FROM pieces
         WHERE bid IN (SELECT bid FROM t_whole WHERE ${where}) AND ${keep} ${order}`
      );
      expect(render.length).toBeGreaterThan(0);
      expect(render).toEqual(model);
    };
    await compare('', 'true');
    await compare(', height_m, base_m, hs', "src = 'box'");
  });

  it('derived files', async () => {
    const [roofs] = await db.all<{ n: number }>(
      `SELECT count(*)::INTEGER AS n FROM read_parquet('${join(derivedDir, BUILDING_ROOFS_PARQUET)}')`
    );
    expect(roofs.n).toBe(12);
    const [pieces] = await db.all<{ n: number; m: number }>(
      `SELECT (SELECT count(*) FROM read_parquet('${join(derivedDir, RENDER_PIECES_PARQUET)}'))::INTEGER AS n,
              (SELECT count(*) FROM render_pieces)::INTEGER AS m`
    );
    expect(pieces.n).toBe(pieces.m);
  });

  it('deterministic', async () => {
    const other = await openMiniDuck();
    try {
      await runSql(other);
      await writeRenderBoxes({ db: other, files: files(), derivedDir: tmp('sfh-render-d2-') });
      expect(await exportPrint(other)).toBe(await exportPrint(db));
      const [{ n }] = await db.all<{ n: number }>(
        'SELECT count(*)::INTEGER AS n FROM render_export'
      );
      expect(n).toBe(result.counts['render.pieces']);
    } finally {
      other.close();
    }
  });
});

describe('render boxes without the artifact or with a parts fallback', () => {
  let db: Duck;
  beforeAll(async () => {
    db = await openMiniDuck();
    await runSql(db);
  });
  afterAll(() => db?.close());

  it('without an artifact nothing is created', async () => {
    const derivedDir = tmp('sfh-render-none-');
    const r = await writeRenderBoxes({ db, files: null, derivedDir });
    expect(r).toEqual({ written: false, counts: {} });
    const names = await tables(db);
    for (const t of ['render_boxes', 'render_pieces', 'render_export', 'bx_boxes', 'bx_roofs'])
      expect(names).not.toContain(t);
    expect(readdirSync(derivedDir)).toEqual([]);
  });

  it('draws no box for a parts building whose uncovered area fell back', async () => {
    // b14 marked as a fallback (as when its uncovered area had no usable LiDAR): it keeps its
    // part rows, so row absence, not the fallback column, decides today's box.
    const f = files()!;
    const roofs = join(tmp('sfh-render-fb-'), 'roofs.parquet');
    await db.run(
      `COPY (SELECT * REPLACE (CASE WHEN bid = 'b14' THEN 'no_lidar' ELSE fallback END AS fallback)
             FROM read_parquet('${f.roofs}') ORDER BY bid) TO '${roofs}' (FORMAT parquet)`
    );
    const r = await writeRenderBoxes({
      db,
      files: { boxes: f.boxes, roofs },
      derivedDir: tmp('sfh-render-fbd-')
    });
    expect(r.written).toBe(true);
    const b14 = await db.all<{ src: string }>(
      "SELECT src FROM render_boxes WHERE bid = 'b14' ORDER BY k"
    );
    expect(b14.map((b) => b.src)).toEqual(Array(8).fill('part'));
    expect(r.counts['boxes.src.box']).toBe(4);
  });
});

describe('a stale artifact stops the build', () => {
  it('throws BuildError naming the boxes command before normalising', async () => {
    const root = tmp('sfh-render-stale-');
    cpSync(MINI, root, { recursive: true });
    const lockPath = join(root, 'sources.lock.json');
    const name = 'overture-buildings.page-000.geojson';
    const raw = join(root, 'raw', name);
    const fc = JSON.parse(readFileSync(raw, 'utf8')) as { features: unknown[] };
    fc.features.push({
      type: 'Feature',
      properties: { id: 'bnew', height: 5, sources: [{ dataset: 'OpenStreetMap' }] },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.42, 37.76],
            [-122.4199, 37.76],
            [-122.4199, 37.7601],
            [-122.42, 37.76]
          ]
        ]
      }
    });
    writeFileSync(raw, JSON.stringify(fc));
    const lock = readLock(lockPath);
    const file = lock.sources.find((s) => s.id === 'overture-buildings')!.files[0];
    file.sha256 = await sha256File(raw);
    file.bytes = readFileSync(raw).length;
    writeLock(lockPath, lock);

    const outRoot = tmp('sfh-render-stale-out-');
    const run = build({
      lockPath,
      rawDir: join(root, 'raw'),
      rawByName: true,
      outRoot,
      derivedRoot: tmp('sfh-render-stale-derived-'),
      datasetVersion: 'fixture-0',
      builtAt: '2026-10-10T00:00:00.000Z',
      profile: FIXTURE_PROFILE,
      skipTiles: true
    });
    await expect(run).rejects.toBeInstanceOf(BuildError);
    await expect(run).rejects.toThrow(/npm run pipeline -- boxes/);
    expect(existsSync(join(outRoot, 'fixture-0'))).toBe(false);
  });
});
