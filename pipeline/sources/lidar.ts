// The USGS 3DEP San Francisco LiDAR point cloud, rasterized to sfhl/1 tiles (spec: building steps
// design). Fetch time only: the pinned Python rasterizer (pipeline/lidar-raster) does the work, and
// the tiles are locked in pipeline/lidar.lock.json, never in sources.lock.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOXES } from '../boxes-config';
import { BBOX } from '../config';
import { openDuck, type Duck } from '../lib/duck';
import { run as realRun } from '../lib/exec';
import { encodeLidarTile, lidarTileName, tilesForBbox } from '../lib/lidar/tile';
import { uvRun } from '../lib/lidar/python';
import {
  rawPath,
  readLock,
  writeLock,
  type Lock,
  type LockEntry,
  type LockFile
} from '../lib/lock';
import { storeFile } from '../lib/raw';
import { lidarSyncHint } from '../steps/doctor';

const ROOT = resolve(import.meta.dirname, '../..');

export const LIDAR_ID = 'usgs-lidar-sf';
export const EPT_URL =
  'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/ept.json';
const DATASET = 'CA_SanFrancisco_1_B23';

export const LIDAR_LOCK = {
  live: join(ROOT, 'pipeline/lidar.lock.json'),
  fixture: join(ROOT, 'pipeline/test/fixtures/mini/lidar.lock.json')
};

const CACHE = join(ROOT, 'pipeline/.cache');
export const EPT_CACHE = join(CACHE, 'ept');

/** 'CA_SanFrancisco_1_B23 sfhl/1 res=0.25 ground=1 tile=500 pad=20 veg=0.35' from BOXES. */
export function lidarUpstreamVersion(): string {
  return `${DATASET} sfhl/1 res=${BOXES.rasterResM} ground=${BOXES.groundResM} tile=${BOXES.tileSizeM} pad=${BOXES.tilePadM} veg=${BOXES.vegFracMin}`;
}

/** Tiles covering BBOX (pipeline/config.ts) in EPSG:7131. */
export async function cityTiles(db: Duck): Promise<[number, number][]> {
  const corners = [
    [BBOX.w, BBOX.s],
    [BBOX.w, BBOX.n],
    [BBOX.e, BBOX.s],
    [BBOX.e, BBOX.n]
  ]
    .map(
      ([x, y]) =>
        `SELECT ST_Transform(ST_Point(${x}, ${y}), 'EPSG:4326', 'EPSG:7131', always_xy := true) AS g`
    )
    .join(' UNION ALL ');
  const [r] = await db.all<{ x0: number; y0: number; x1: number; y1: number }>(
    `SELECT MIN(ST_X(g)) AS x0, MIN(ST_Y(g)) AS y0, MAX(ST_X(g)) AS x1, MAX(ST_Y(g)) AS y1
     FROM (${corners})`
  );
  return tilesForBbox(r);
}

/** `0_0,1_-2` -> [[0, 0], [1, -2]]; throws on anything else. */
export function parseTiles(s: string): [number, number][] {
  return s.split(',').map((t) => {
    const m = /^(-?\d+)_(-?\d+)$/.exec(t.trim());
    if (!m) throw new Error(`bad tile '${t}' (want tx_ty, e.g. 101_50)`);
    return [Number(m[1]), Number(m[2])];
  });
}

/** The LiDAR lock, or null when the file is absent. */
export function readLidarLock(path: string): Lock | null {
  return existsSync(path) ? readLock(path) : null;
}

/** "tx_ty" -> raw file path of each locked tile; empty for a null lock or one without LIDAR_ID. */
export function lidarTilesOf(
  lidarLock: Lock | null,
  rawDir: string,
  byName: boolean
): Map<string, string> {
  const out = new Map<string, string>();
  const entry = lidarLock?.sources.find((s) => s.id === LIDAR_ID);
  for (const f of entry?.files ?? []) {
    const m = /^usgs-lidar-sf\/(-?\d+_-?\d+)\.sfhl$/.exec(f.name);
    if (m) out.set(m[1], rawPath(rawDir, f, byName));
  }
  return out;
}

interface TileMeta {
  points: number;
  sizeM?: number;
  res?: number;
  groundRes?: number;
}

function i16(file: string): Int16Array {
  const b = readFileSync(file);
  const out = new Int16Array(b.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2);
  return out;
}

export interface LidarOpts {
  tiles?: [number, number][];
  jobs?: number;
  dryRun?: boolean;
  workDir?: string;
}

/**
 * Rasterize the tiles (default: the city's), encode those with points as sfhl/1 and lock them.
 * Returns null on `dryRun` (the rasterizer only reports node and point counts). The work dir
 * is resumable: finished tile directories are skipped on a rerun. Retries: the rasterizer's EPT
 * downloads retry inside Python; this adds no retry loop around the run, since a rerun resumes.
 */
export async function fetchLidar(
  rawDir: string,
  opts: LidarOpts = {},
  deps: { run: typeof realRun; db?: Duck } = { run: realRun }
): Promise<LockEntry | null> {
  const upstream = lidarUpstreamVersion();
  let tiles = opts.tiles;
  if (!tiles) {
    const db = deps.db ?? (await openDuck());
    try {
      tiles = await cityTiles(db);
    } finally {
      if (!deps.db) db.close();
    }
  }
  const hash8 = createHash('sha256').update(upstream).digest('hex').slice(0, 8);
  const workDir = opts.workDir ?? join(CACHE, 'lidar-work', hash8);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(EPT_CACHE, { recursive: true });
  const args = [
    'python',
    '-m',
    'sfh_lidar.rasterize',
    '--out',
    workDir,
    '--tiles',
    tiles.map(([x, y]) => `${x}_${y}`).join(','),
    '--size',
    String(BOXES.tileSizeM),
    '--res',
    String(BOXES.rasterResM),
    '--ground-res',
    String(BOXES.groundResM),
    '--pad',
    String(BOXES.tilePadM),
    '--veg-frac',
    String(BOXES.vegFracMin),
    '--ept',
    EPT_URL,
    '--cache',
    EPT_CACHE,
    '--jobs',
    String(opts.jobs ?? 1)
  ];
  if (opts.dryRun) args.push('--dry-run');
  const r = await uvRun(args, {}, { run: deps.run });
  if (r.code !== 0) {
    const hint = r.code === 127 ? `\n${lidarSyncHint()}` : '';
    throw new Error(`rasterize failed (exit ${r.code}): ${r.stderr.trim()}${hint}`);
  }
  if (opts.dryRun) {
    if (r.stdout.trim()) console.log(r.stdout.trim());
    return null;
  }
  const files: LockFile[] = [];
  for (const [tx, ty] of tiles) {
    const dir = join(workDir, `${tx}_${ty}`);
    const metaFile = join(dir, 'tile.json');
    if (!existsSync(metaFile)) {
      throw new Error(`rasterize wrote no tile ${tx}_${ty} under ${workDir}`);
    }
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as TileMeta;
    if (!(meta.points > 0)) continue;
    const bytes = encodeLidarTile({
      tx,
      ty,
      sizeM: meta.sizeM ?? BOXES.tileSizeM,
      res: meta.res ?? BOXES.rasterResM,
      groundRes: meta.groundRes ?? BOXES.groundResM,
      hagCm: i16(join(dir, 'hag.i16')),
      groundCm: i16(join(dir, 'ground.i16')),
      veg: new Uint8Array(readFileSync(join(dir, 'veg.u8')))
    });
    const tmp = join(workDir, `.${tx}_${ty}.sfhl.tmp`);
    writeFileSync(tmp, bytes);
    try {
      files.push(await storeFile(rawDir, lidarTileName(tx, ty), EPT_URL, tmp));
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    id: LIDAR_ID,
    files,
    retrievedAt: new Date().toISOString(),
    upstreamVersion: upstream,
    rowCount: files.length,
    license: 'public-domain',
    label: 'USGS 3DEP LiDAR, San Francisco 2023',
    homepage: 'https://www.usgs.gov/3d-elevation-program'
  };
}

/** Write the LiDAR lock: this entry alone; sources.lock.json is never touched. */
export function writeLidarLock(path: string, entry: LockEntry): void {
  writeLock(path, { sources: [entry] });
}
