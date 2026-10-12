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
