import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { prepareRoofJob } from '../roofs/inputs';
import { storeBytes } from '../lib/raw';
import { openDuck } from '../lib/duck';

test('offline jobs read full buildings and reject corrupt locked bytes before processing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-inputs-'));
  const db = await openDuck();
  try {
    await db.run(`CREATE TABLE buildings AS SELECT 'full' bid,
      ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))') geom,
      12.0 height_m, 0.0 base_m, 0 hs`);
    await db.run(`CREATE TABLE nb7131 AS SELECT 'test' nhood,
      ST_GeomFromText('POLYGON((-1 -1,11 -1,11 11,-1 11,-1 -1))') geom`);
    const file = storeBytes(
      dir,
      'ept-data/0-0-0-0.laz',
      'https://example.test/node',
      new Uint8Array([1, 2])
    );
    const lock = {
      sources: [
        {
          id: 'roof-lidar',
          files: [file],
          retrievedAt: '2026-10-11',
          upstreamVersion: '2023',
          rowCount: 1,
          license: 'public-domain',
          homepage: 'https://example.test',
          spatial: {
            horizontalCrs: 'EPSG:3857',
            verticalCrs: null,
            horizontalUnits: 'm',
            verticalUnits: 'm',
            acquisitionStart: null,
            acquisitionEnd: null,
            coverage: [],
            supportBufferM: 50,
            permission: 'confirmed' as const,
            alignment: 'not-applicable' as const,
            objects: []
          }
        }
      ]
    };
    const opts = { rawDir: dir, rawByName: false, datasetVersion: 'fixture-0', workDir: dir };
    const job = await prepareRoofJob(db, lock, opts);
    expect(job.buildings.map((b) => b.buildingId)).toEqual(['full']);
    expect(job.buildings[0].bbox).toEqual([0, 0, 10, 10]);
    expect(job.sources[0].sha256).toBe(
      'a12871fee210fb8619291eaea194581cbd2531e4b23759d225f6806923f63222'
    );
    writeFileSync(join(dir, file.sha256), 'bad');
    await expect(prepareRoofJob(db, lock, opts)).rejects.toThrow('sha256 mismatch');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects missing cache override values before starting fetch or build', () => {
  for (const command of ['fetch', 'build']) {
    for (const flag of ['--raw-dir', '--lock-path']) {
      const result = spawnSync('node', ['--import', 'tsx', 'pipeline/cli.ts', command, flag], {
        encoding: 'utf8'
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('requires a nonempty path');
    }
  }
});

test('job source descriptors grow linearly and retain only their own object and raster transform', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-linear-'));
  const db = await openDuck();
  try {
    await db.run(
      'CREATE TABLE buildings(bid VARCHAR,geom GEOMETRY,height_m DOUBLE,base_m DOUBLE,hs INTEGER);CREATE TABLE nb7131(nhood VARCHAR,geom GEOMETRY)'
    );
    const make = async (n: number, kind: 'lidar' | 'aerial') => {
      const files = Array.from({ length: n }, (_, i) =>
        storeBytes(
          dir,
          kind === 'lidar' ? `ept-data/${i}.laz` : `aerial/${i}/0.png`,
          `https://example.test/${i}`,
          new Uint8Array([i, 3])
        )
      );
      const objects = files.map((f) => ({ name: f.name, url: f.url, sha256: f.sha256 }));
      const tiles =
        kind === 'aerial'
          ? files.map((_, i) => ({
              x: i,
              y: 0,
              zoom: 18,
              width: 256,
              height: 256,
              transform: [1, 0, i * 256, 0, -1, 256]
            }))
          : undefined;
      const lock = {
        sources: [
          {
            id: `roof-${kind}`,
            files,
            retrievedAt: '2026-01-01',
            upstreamVersion: 'test',
            rowCount: n,
            license: 'public-domain',
            homepage: 'https://example.test',
            spatial: {
              horizontalCrs: 'EPSG:7131',
              verticalCrs: null,
              horizontalUnits: 'm',
              verticalUnits: 'm',
              acquisitionStart: null,
              acquisitionEnd: null,
              coverage: [],
              supportBufferM: 50,
              permission: 'confirmed' as const,
              alignment: 'verified' as const,
              objects,
              tiles
            }
          }
        ]
      };
      return prepareRoofJob(db, lock, {
        rawDir: dir,
        rawByName: false,
        datasetVersion: 'fixture-4',
        workDir: dir
      });
    };
    const small = await make(20, 'lidar'),
      large = await make(40, 'lidar');
    expect(large.sources.every((s) => s.objects.length === 1 && s.objects[0].name === s.name)).toBe(
      true
    );
    expect(large.sourceStatus[0].spatial.objects).toHaveLength(40);
    expect(large.sourceArchives).toHaveLength(40);
    expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(small)) * 2.1
    );
    const aerial = await make(20, 'aerial');
    expect(
      aerial.sources.every(
        (s, i) => s.tiles?.length === 1 && s.tiles[0].x === i && s.objects.length === 1
      )
    ).toBe(true);
    expect(aerial.sourceStatus[0].spatial.tiles).toHaveLength(20);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
