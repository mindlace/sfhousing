import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunResult } from '../lib/exec';
import { sha256File, type Lock } from '../lib/lock';
import type { R2Target } from '../lib/r2';
import { DEFAULT_FETCH_IDS, FETCH_IDS, fetchAll } from '../steps/fetch';
import {
  LIDAR_ID,
  fetchLidar,
  lidarTilesOf,
  lidarUpstreamVersion,
  parseTiles,
  readLidarLock
} from '../sources/lidar';
import { decodeLidarTile } from '../lib/lidar/tile';

const tmp = () => mkdtempSync(join(tmpdir(), 'sfh-lidar-'));
/** Array sizes the fake writes: tiny, and declared in tile.json as the rasterizer does. */
const N = 4;
const GN = 2;
/** tile.json in the rasterizer's `_meta` shape (sfh_lidar/rasterize.py). */
const meta = (tx: number, ty: number, points: number, over: object = {}) => ({
  tx,
  ty,
  sizeM: 500,
  res: 0.25,
  groundRes: 1,
  nx: N,
  ny: N,
  gnx: GN,
  gny: GN,
  points,
  ...over
});

/** A fake rasterizer: tiles 0_0 (points 10) and 1_0 (points 0) under the --out dir it is given. */
function fakeRun(code = 0, over: object = {}) {
  const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]): Promise<RunResult> => {
    calls.push(args);
    if (code !== 0) return { stdout: '', stderr: 'boom in rasterize', code };
    const out = args[args.indexOf('--out') + 1];
    if (args.includes('--dry-run'))
      return { stdout: 'tile 0_0 nodes 1 points 10', stderr: '', code };
    const n = N * N;
    for (const [name, points] of [
      ['0_0', 10],
      ['1_0', 0]
    ] as const) {
      const d = join(out, name);
      mkdirSync(d, { recursive: true });
      if (points) {
        const hag = Buffer.alloc(n * 2);
        for (let i = 0; i < n; i++) hag.writeInt16LE(i * 10, i * 2);
        writeFileSync(join(d, 'hag.i16'), hag);
        writeFileSync(join(d, 'ground.i16'), Buffer.alloc(GN * GN * 2, 1));
        writeFileSync(join(d, 'veg.u8'), Buffer.alloc(n, 1));
      }
      const [tx, ty] = name.split('_').map(Number);
      writeFileSync(join(d, 'tile.json'), JSON.stringify(meta(tx, ty, points, over)));
    }
    return { stdout: '', stderr: '', code };
  };
  return { run, calls };
}

const TILES: [number, number][] = [
  [0, 0],
  [1, 0]
];

describe('fetchLidar', () => {
  it('a second fetch with the same settings waits for the first, then runs', async () => {
    const work = join(tmp(), 'abcd1234');
    const lock = `${work}.lock`;
    mkdirSync(join(work, '..'), { recursive: true });
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() })
    );
    const { run, calls } = fakeRun();
    const events: string[] = [];
    const waits: number[] = [];
    const entry = await fetchLidar(
      tmp(),
      { tiles: TILES, workDir: work },
      {
        run: async (c, a) => {
          events.push(`run:${existsSync(lock)}`);
          return run(c, a);
        },
        lock: {
          pollMs: 7,
          sleep: async (ms) => {
            waits.push(ms);
            events.push('sleep');
            rmSync(lock);
          },
          onWait: (h) => events.push(`wait:${h.pid}`)
        }
      }
    );
    expect(events).toEqual([`wait:${process.pid}`, 'sleep', 'run:true']);
    expect(waits).toEqual([7]);
    expect(calls).toHaveLength(1);
    expect(entry?.files).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
  });

  it('the .sfhl temp file is unique per call and left behind by none', async () => {
    const work = tmp();
    const { run } = fakeRun();
    await fetchLidar(tmp(), { tiles: TILES, workDir: work }, { run });
    expect(readdirSync(work).filter((n) => n.includes('.sfhl'))).toEqual([]);
    expect(readFileSync(join(import.meta.dirname, '../sources/lidar.ts'), 'utf8')).not.toContain(
      '.sfhl.tmp`'
    );
  });

  it('encodes tiles with points into lock files', async () => {
    const raw = tmp();
    const { run } = fakeRun();
    const entry = await fetchLidar(raw, { tiles: TILES, workDir: tmp() }, { run });
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(LIDAR_ID);
    expect(entry!.files.map((f) => f.name)).toEqual(['usgs-lidar-sf/0_0.sfhl']);
    const f = entry!.files[0];
    expect(f.sha256).toBe(await sha256File(join(raw, f.sha256)));
    const tile = decodeLidarTile(new Uint8Array(readFileSync(join(raw, f.sha256))));
    expect([tile.tx, tile.ty, tile.hagCm[3]]).toEqual([0, 0, 30]);
    expect(entry!.upstreamVersion).toBe(
      'CA_SanFrancisco_1_B23 sfhl/1 res=0.25 ground=1 tile=500 pad=20 veg=0.35'
    );
    expect(lidarUpstreamVersion()).toBe(entry!.upstreamVersion);
    expect(entry!.license).toBe('public-domain');
    expect(entry!.rowCount).toBe(1);
  });

  it.each([
    ['a missing key', { groundRes: undefined }, /missing numeric 'groundRes'/],
    ['a different resolution', { res: 0.5 }, /res 0.5 is not 0.25/],
    ['array sizes that disagree', { nx: 5 }, /array sizes do not match/]
  ])('rejects tile.json with %s', async (_n, over, re) => {
    const { run } = fakeRun(0, over);
    await expect(fetchLidar(tmp(), { tiles: TILES, workDir: tmp() }, { run })).rejects.toThrow(re);
  });

  it('passes the BOXES raster parameters', async () => {
    const { run, calls } = fakeRun();
    await fetchLidar(tmp(), { tiles: TILES, workDir: tmp(), jobs: 4 }, { run });
    const a = calls[0].join(' ');
    expect(a).toContain('--size 500 --res 0.25 --ground-res 1 --pad 20 --veg-frac 0.35');
    expect(a).toContain('--jobs 4');
    expect(a).toContain('--tiles 0_0,1_0');
    expect(calls[0]).toContain('--cache');
  });

  it("a nonzero exit throws with the rasterizer's stderr", async () => {
    const { run } = fakeRun(1);
    await expect(fetchLidar(tmp(), { tiles: TILES, workDir: tmp() }, { run })).rejects.toThrow(
      /rasterize/
    );
  });

  it('--dry-run returns null and writes nothing', async () => {
    const raw = tmp();
    const { run, calls } = fakeRun();
    const entry = await fetchLidar(raw, { tiles: TILES, workDir: tmp(), dryRun: true }, { run });
    expect(entry).toBeNull();
    expect(calls[0]).toContain('--dry-run');
    expect(existsSync(join(raw, 'x'))).toBe(false);
  });
});

describe('fetch wiring', () => {
  it('default fetch excludes the LiDAR', () => {
    expect(DEFAULT_FETCH_IDS).not.toContain(LIDAR_ID);
    expect(FETCH_IDS).toContain(LIDAR_ID);
    expect(new Set(DEFAULT_FETCH_IDS).size).toBe(DEFAULT_FETCH_IDS.length);
  });

  it('the LiDAR goes to its own lock', async () => {
    const dir = tmp();
    const lockPath = join(dir, 'sources.lock.json');
    const lidarLockPath = join(dir, 'lidar.lock.json');
    writeFileSync(lockPath, '{"sources":[]}\n');
    const { run } = fakeRun();
    const code = await fetchAll({
      only: LIDAR_ID,
      lockPath,
      lidarLockPath,
      rawDir: join(dir, 'raw'),
      tiles: TILES,
      lidarDeps: { run, workDir: join(dir, 'work') }
    });
    expect(code).toBe(0);
    expect(readFileSync(lockPath, 'utf8')).toBe('{"sources":[]}\n');
    const lock = readLidarLock(lidarLockPath);
    expect(lock!.sources.map((s) => s.id)).toEqual([LIDAR_ID]);
  });

  it('--dry-run writes no lock', async () => {
    const dir = tmp();
    const lidarLockPath = join(dir, 'lidar.lock.json');
    const { run } = fakeRun();
    const code = await fetchAll({
      only: LIDAR_ID,
      lockPath: join(dir, 'sources.lock.json'),
      lidarLockPath,
      rawDir: join(dir, 'raw'),
      tiles: TILES,
      dryRun: true,
      lidarDeps: { run, workDir: join(dir, 'work') }
    });
    expect(code).toBe(0);
    expect(existsSync(lidarLockPath)).toBe(false);
  });

  it('plain restore never touches the tiles; --lidar restores them', async () => {
    const dir = tmp();
    const bytes = new TextEncoder().encode('tile bytes');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const entry = (id: string, name: string) => ({
      id,
      files: [{ url: 'u', sha256: sha, bytes: bytes.length, archiveKey: `sources/${sha}.x`, name }],
      retrievedAt: 't',
      upstreamVersion: 'v',
      rowCount: 1,
      license: 'l',
      homepage: 'h'
    });
    const lockPath = join(dir, 'sources.lock.json');
    const lidarLockPath = join(dir, 'lidar.lock.json');
    const main: Lock = { sources: [entry('x', 'x.json')] };
    const lidar: Lock = { sources: [entry(LIDAR_ID, 'usgs-lidar-sf/0_0.sfhl')] };
    writeFileSync(lockPath, JSON.stringify(main));
    writeFileSync(lidarLockPath, JSON.stringify(lidar));
    const gets: string[] = [];
    const r2: R2Target = {
      exists: async () => true,
      put: async () => {},
      get: async (key, file) => {
        gets.push(key);
        writeFileSync(file, bytes);
        return true;
      }
    };
    const base = { lockPath, lidarLockPath, r2 };
    // The same sha is in both locks here; use separate raw dirs so each restore downloads.
    expect(await fetchAll({ ...base, rawDir: join(dir, 'a'), restore: true })).toBe(0);
    expect(gets).toEqual([`sources/${sha}.x`]);
    gets.length = 0;
    const lidarOnly: Lock = lidar;
    writeFileSync(lockPath, JSON.stringify({ sources: [] }));
    expect(await fetchAll({ ...base, rawDir: join(dir, 'b'), restore: true })).toBe(0);
    expect(gets).toEqual([]);
    expect(await fetchAll({ ...base, rawDir: join(dir, 'b'), restore: true, lidar: true })).toBe(0);
    expect(gets).toEqual([`sources/${lidarOnly.sources[0].files[0].sha256}.x`]);
    expect(existsSync(join(dir, 'b', sha))).toBe(true);
  });
});

describe('lidarTilesOf', () => {
  const lock: Lock = {
    sources: [
      {
        id: LIDAR_ID,
        files: [
          {
            url: 'u',
            sha256: 'aa',
            bytes: 1,
            archiveKey: 'sources/aa.sfhl',
            name: 'usgs-lidar-sf/-1_2.sfhl'
          },
          {
            url: 'u',
            sha256: 'bb',
            bytes: 1,
            archiveKey: 'sources/bb.sfhl',
            name: 'usgs-lidar-sf/3_4.sfhl'
          }
        ],
        retrievedAt: 't',
        upstreamVersion: 'v',
        rowCount: 2,
        license: 'l',
        homepage: 'h'
      }
    ]
  };
  it('maps tile keys to raw paths, by sha and by name', () => {
    expect([...lidarTilesOf(lock, '/raw', false)]).toEqual([
      ['-1_2', '/raw/aa'],
      ['3_4', '/raw/bb']
    ]);
    expect(lidarTilesOf(lock, '/raw', true).get('3_4')).toBe('/raw/usgs-lidar-sf/3_4.sfhl');
  });
  it('is empty for a null lock or one without the source', () => {
    expect(lidarTilesOf(null, '/raw', false).size).toBe(0);
    expect(lidarTilesOf({ sources: [] }, '/raw', false).size).toBe(0);
  });
  it('parseTiles reads tx_ty lists and rejects junk', () => {
    expect(parseTiles('0_0,1_-2')).toEqual([
      [0, 0],
      [1, -2]
    ]);
    expect(() => parseTiles('a_b')).toThrow(/bad tile/);
  });
});
