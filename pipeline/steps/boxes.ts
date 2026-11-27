// `npm run pipeline -- boxes [--fixture]`: derive the per-building boxes from the locked footprints,
// building parts and LiDAR tiles, and lock them as the `building-boxes` artifact (plan Decisions:
// derivation in TypeScript, in the boxes command). `build` only reads the artifact.
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BOXES } from '../boxes-config.js';
import { area, fromGeoJson, toGeoJson, type MultiPoly, type Ring } from '../geom.js';
import { openDuck, type Duck } from '../lib/duck.js';
import {
  BOXES_FILES,
  BOXES_HOMEPAGE,
  BOXES_ID,
  BOXES_LABEL,
  BOXES_LICENSE,
  BX_BOXES_GEOM,
  boxesCounts,
  boxesInputsOf,
  boxesUpstreamVersion,
  outsideFootprint
} from '../lib/lidar/artifact.js';
import { clusterBuildings } from '../lib/lidar/clusters.js';
import { checkParts, type PartVerdict, type PartsCheck } from '../lib/lidar/dispute.js';
import { deriveBoxes, groundOf, type RenderBox, type RoofRecord } from '../lib/lidar/derive.js';
import { openLidarMosaic, type LidarMosaic, type RasterWindow } from '../lib/lidar/mosaic.js';
import {
  countedParts,
  partBoxes,
  partCoverage,
  uncoveredArea,
  type Part
} from '../lib/lidar/parts.js';
import {
  registerCluster,
  registrationBbox,
  type Footprint,
  type Shift
} from '../lib/lidar/register.js';
import { StreetIndex } from '../lib/lidar/streets.js';
import {
  archiveKeyFor,
  canonicalJson,
  rawPath,
  readLock,
  sha256File,
  verifyRaw,
  writeLock,
  type LockEntry,
  type LockFile
} from '../lib/lock.js';
import { storeFile } from '../lib/raw.js';
import { runSql } from '../lib/sql.js';
import { boxesCodeHash } from '../lib/version.js';
import { lidarTilesOf, readLidarLock } from '../sources/lidar.js';
import { loadNormalised, normaliseAll } from '../sources/normalise.js';
import { overtureReleaseProblem } from '../sources/overture.js';
import { SB79_EXEMPTIONS_CSV } from '../sources/sfbos.js';

/** The mini fixture's fixed retrieval date (make-fixture.ts); `boxes --fixture` stamps it (F1). */
const FIXTURE_RETRIEVED_AT = '2026-10-10T00:00:00.000Z';

/**
 * Public centrelines, the street-facing test's streets: the R2s layer exclusions of
 * 55_road_lots.sql (docs/dev/pipeline.md, Road-like lots).
 */
const PUBLIC_STREETS = `SELECT ST_AsGeoJSON(geom) AS g FROM src_streets
  WHERE geom IS NOT NULL
    AND coalesce(layer, '') NOT IN ('FREEWAYS', 'PRIVATE', 'PRIVATE_PARKING', 'PAPER_WATER')
    AND coalesce(layer, '') NOT LIKE 'PARKS%'
  ORDER BY cnn, ST_AsHEXWKB(geom)`;

const q = (s: string): string => `'${s.replaceAll("'", "''")}'`;
const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d + 0;
const roundOrNull = (v: number | null | undefined, d: number): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : round(v, d);

// Heights are clamped to heightRangeM and rounded to 0.1; baseM to [0, heightM) (ruling F6).
// derive.ts and parts.ts already do; this keeps the artifact's contract in one place.
const clampH = (v: number): number =>
  Math.min(Math.max(round(v, 1), BOXES.heightRangeM[0]), BOXES.heightRangeM[1]);
const clampBase = (base: number, h: number): number =>
  Math.max(0, Math.min(round(base, 1), round(h - 0.1, 1)));

function linesOf(g: string): Ring[] {
  const j = JSON.parse(g) as { type: string; coordinates: number[][] | number[][][] };
  const ring = (c: number[][]): Ring => c.map(([x, y]): [number, number] => [x, y]);
  if (j.type === 'LineString') return [ring(j.coordinates as number[][])];
  if (j.type === 'MultiLineString') return (j.coordinates as number[][][]).map(ring);
  return [];
}

/** Line-by-line NDJSON writer. */
class Ndjson {
  private fd: number;
  constructor(readonly path: string) {
    this.fd = openSync(path, 'w');
  }
  push(row: Record<string, unknown>): void {
    writeSync(this.fd, JSON.stringify(row) + '\n');
  }
  close(): void {
    closeSync(this.fd);
  }
}

const BOX_COLUMNS = `{bid: 'VARCHAR', k: 'INTEGER', src: 'VARCHAR', base_m: 'DOUBLE',
  height_m: 'DOUBLE', g: 'VARCHAR'}`;
const ROOF_COLUMNS = `{bid: 'VARCHAR', roof: 'VARCHAR', eave_m: 'DOUBLE', ridge_m: 'DOUBLE',
  ridge_deg: 'DOUBLE', ground_m: 'DOUBLE', ground_min_m: 'DOUBLE', shift_dx: 'DOUBLE',
  shift_dy: 'DOUBLE', shift_source: 'VARCHAR', reg_score: 'DOUBLE', reg_ratio: 'DOUBLE',
  reg_sharp_x: 'DOUBLE', reg_sharp_y: 'DOUBLE', reg_flagged: 'BOOLEAN', cluster_id: 'VARCHAR',
  fallback: 'VARCHAR', n_front: 'INTEGER', n_step: 'INTEGER', steps_capped: 'BOOLEAN',
  n_parts: 'INTEGER', parts_coverage: 'DOUBLE', uncovered_dropped: 'DOUBLE',
  parts_checked: 'INTEGER', parts_disputed: 'INTEGER', parts_rejected: 'BOOLEAN',
  sliced: 'BOOLEAN', step_cap: 'INTEGER'}`;

interface LoadedClusters {
  partsOf: Map<string, Part[]>;
  streets: StreetIndex;
  /** Cluster id to its member footprints, in bid order. */
  clusters: Map<string, Footprint[]>;
}

/** Buildings, their parts, the streets and the clusters of a db where 50_clip.sql ran. */
async function loadClusters(db: Duck): Promise<LoadedClusters> {
  const buildings = await db.all<{ bid: string; g: string; h: number; b: number; hs: number }>(
    `SELECT bid, ST_AsGeoJSON(geom) AS g, height_m AS h, base_m AS b, hs FROM buildings
     ORDER BY bid`
  );
  const partRows = await db.all<{
    id: string;
    building_id: string;
    height: number | null;
    min_height: number | null;
    roof_shape: string | null;
    roof_height: number | null;
    g: string;
  }>(`
    SELECT id, building_id, height, min_height, roof_shape, roof_height, ST_AsGeoJSON(g) AS g
    FROM (
      SELECT p.*, ST_CollectionExtract(ST_MakeValid(
               ST_Transform(p.geom::GEOMETRY, 'EPSG:4326', 'EPSG:7131', always_xy := true)), 3) AS g
      FROM src_overture_parts p
      WHERE p.building_id IN (SELECT bid FROM buildings)
    )
    WHERE NOT ST_IsEmpty(g)
    ORDER BY building_id, id`);
  const partsOf = new Map<string, Part[]>();
  for (const p of partRows) {
    const list = partsOf.get(p.building_id) ?? [];
    list.push({
      id: p.id,
      buildingId: p.building_id,
      shape: fromGeoJson(p.g),
      heightM: p.height,
      minHeightM: p.min_height,
      roofShape: p.roof_shape,
      roofHeightM: p.roof_height
    });
    partsOf.set(p.building_id, list);
  }
  const streets = new StreetIndex(
    (await db.all<{ g: string }>(PUBLIC_STREETS)).flatMap((r) => linesOf(r.g))
  );

  const fps = new Map<string, Footprint>();
  for (const r of buildings)
    fps.set(r.bid, { bid: r.bid, shape: fromGeoJson(r.g), heightM: r.h, baseM: r.b, hs: r.hs });
  const clusterOf = await clusterBuildings(db);
  const clusters = new Map<string, Footprint[]>();
  for (const r of buildings) {
    const cid = clusterOf.get(r.bid) ?? r.bid;
    const list = clusters.get(cid);
    if (list) list.push(fps.get(r.bid)!);
    else clusters.set(cid, [fps.get(r.bid)!]);
  }
  return { partsOf, streets, clusters };
}

/**
 * Reads buildings, pieces, src_overture_parts, src_streets of a db where
 * runSql(db, '50_clip.sql') ran; leaves bx_boxes and bx_roofs.
 *
 * - bx_boxes(bid, k, src, base_m, height_m, geom): geom is WKB in EPSG:7131, NULL for a base box
 *   over the whole footprint. Ordered by bid, k.
 * - bx_roofs: one row per `buildings` row (see roofRow), plus lng/lat, the EPSG:4326 point on
 *   surface of the footprint.
 *
 * Per building: with counted parts, the part boxes, then the LiDAR derivation of the area no
 * counted part covers. A fallback there drops that area (`uncovered_dropped`, m2, and the
 * fallback recorded) and emits nothing for it: it is never drawn at height_m. Without counted
 * parts, the LiDAR derivation; its fallback box is not stored (`build` draws today's box from its
 * own buildings table), so the artifact holds no fallback geometry and nothing to clamp there.
 * The ground reference is always the whole footprint's (F3), also where no derivation runs.
 */
export async function deriveBuildingBoxes(a: {
  db: Duck;
  lidar: LidarMosaic | null;
  workDir: string;
}): Promise<void> {
  const { db, lidar } = a;
  const { partsOf, streets, clusters } = await loadClusters(db);

  mkdirSync(a.workDir, { recursive: true });
  const boxOut = new Ndjson(join(a.workDir, 'bx_boxes.ndjson'));
  const roofOut = new Ndjson(join(a.workDir, 'bx_roofs.ndjson'));
  try {
    for (const cid of [...clusters.keys()].sort()) {
      const members = clusters.get(cid)!;
      const w = lidar ? lidar.window(registrationBbox(members)) : null;
      const shift = registerCluster(w, members);
      for (const fp of members) {
        const { boxes, roof, nParts, coverage, dropped, check } = buildingBoxes(
          w,
          fp,
          shift,
          streets,
          partsOf.get(fp.bid) ?? []
        );
        for (const b of boxes) {
          const heightM = clampH(b.heightM);
          boxOut.push({
            bid: b.bid,
            k: b.k,
            src: b.src,
            base_m: clampBase(b.baseM, heightM),
            height_m: heightM,
            g: b.src === 'base' && b.shape === fp.shape ? null : toGeoJson(b.shape)
          });
        }
        roofOut.push(roofRow(roof, shift, cid, nParts, coverage, dropped, check));
      }
    }
  } finally {
    boxOut.close();
    roofOut.close();
  }

  await loadBoxRows(db, boxOut.path, 'bx_boxes');
  await db.run(`
    CREATE OR REPLACE TABLE bx_roofs AS
    SELECT r.bid, roof, eave_m, ridge_m, ridge_deg, ground_m, ground_min_m, shift_dx, shift_dy,
           shift_source, reg_score, reg_ratio, reg_sharp_x, reg_sharp_y, reg_flagged, cluster_id,
           fallback, n_front, n_step, steps_capped, n_parts, parts_coverage, uncovered_dropped,
           parts_checked, parts_disputed, parts_rejected, sliced, step_cap,
           round(ST_X(p.pt), 7) AS lng, round(ST_Y(p.pt), 7) AS lat
    FROM read_json(${q(roofOut.path)}, format = 'newline_delimited', columns = ${ROOF_COLUMNS}) r
    JOIN (
      SELECT bid, ST_Transform(ST_PointOnSurface(geom), 'EPSG:7131', 'EPSG:4326',
                               always_xy := true) AS pt
      FROM buildings
    ) p USING (bid)
    ORDER BY r.bid`);
}

/**
 * Load the box NDJSON rows into `table` (bid, k, src, base_m, height_m, geom WKB or NULL), ordered
 * by bid, k. clipper's mm rounding can leave a spike whose edges cross (an OGC-invalid ring, on
 * which GEOS overlay throws); such a geometry is made valid (its polygons kept), a valid one is
 * stored untouched.
 */
export async function loadBoxRows(db: Duck, path: string, table: string): Promise<void> {
  await db.run(`
    CREATE OR REPLACE TABLE ${table} AS
    SELECT bid, k, src, base_m, height_m,
           CASE WHEN g IS NULL THEN NULL
                WHEN ST_IsValid(g) THEN ST_AsWKB(g)::BLOB
                ELSE ST_AsWKB(ST_CollectionExtract(ST_MakeValid(g), 3))::BLOB END AS geom
    FROM (
      SELECT bid, k, src, base_m, height_m,
             CASE WHEN g IS NULL THEN NULL ELSE ST_GeomFromGeoJSON(g) END AS g
      FROM read_json(${q(path)}, format = 'newline_delimited', columns = ${BOX_COLUMNS})
    )
    ORDER BY bid, k`);
}

/**
 * One building's boxes and roof record (see deriveBuildingBoxes). With counted parts the LiDAR
 * checks them first (`check`, null without any): a rejected building takes the plain LiDAR
 * derivation, no part boxes, and none at all when that falls back.
 */
export function buildingBoxes(
  w: RasterWindow | null,
  fp: Footprint,
  shift: Shift | null,
  streets: StreetIndex,
  parts: Part[]
): {
  boxes: RenderBox[];
  roof: RoofRecord;
  nParts: number;
  coverage: number | null;
  dropped: number;
  check: PartsCheck | null;
} {
  const counted = countedParts(parts);
  if (counted.length === 0) {
    const d = deriveBoxes(w, { fp, shift, streets });
    return {
      boxes: d.roof.fallback ? [] : d.boxes,
      roof: d.roof,
      nParts: 0,
      coverage: null,
      dropped: 0,
      check: null
    };
  }
  const check = checkParts(w, fp, shift, counted);
  if (check.rejected) {
    const d = deriveBoxes(w, { fp, shift, streets });
    return {
      boxes: d.roof.fallback ? [] : d.boxes,
      roof: d.roof,
      nParts: counted.length,
      coverage: partCoverage(fp.shape, counted),
      dropped: 0,
      check
    };
  }
  const boxes = partBoxes(fp.bid, counted, 0);
  const coverage = partCoverage(fp.shape, counted);
  const uncovered: MultiPoly = uncoveredArea(fp.shape, counted);
  if (!(area(uncovered) > 0)) {
    // Parts cover the footprint: no derivation (F3), but the ground is still recorded.
    const g = groundOf(w, fp, shift);
    const roof: RoofRecord = {
      bid: fp.bid,
      roof: 'unknown',
      eaveM: null,
      ridgeM: null,
      ridgeDeg: null,
      groundM: g?.groundM ?? null,
      groundMinM: g?.groundMinM ?? null,
      fallback: null,
      nFront: 0,
      nStep: 0,
      stepsCapped: false,
      sliced: false,
      stepCap: BOXES.stepCap
    };
    return { boxes, roof, nParts: counted.length, coverage, dropped: 0, check };
  }
  const d = deriveBoxes(w, { fp, shift, streets, area: uncovered, kStart: boxes.length });
  if (d.roof.fallback)
    return {
      boxes,
      roof: d.roof,
      nParts: counted.length,
      coverage,
      dropped: area(uncovered),
      check
    };
  return {
    boxes: [...boxes, ...d.boxes],
    roof: d.roof,
    nParts: counted.length,
    coverage,
    dropped: 0,
    check
  };
}

function roofRow(
  r: RoofRecord,
  shift: Shift | null,
  cid: string,
  nParts: number,
  coverage: number | null,
  dropped: number,
  check: PartsCheck | null
): Record<string, unknown> {
  return {
    bid: r.bid,
    roof: r.roof,
    eave_m: r.eaveM,
    ridge_m: r.ridgeM,
    ridge_deg: r.ridgeDeg,
    ground_m: r.groundM,
    ground_min_m: r.groundMinM,
    shift_dx: shift ? round(shift.dx, 3) : null,
    shift_dy: shift ? round(shift.dy, 3) : null,
    shift_source: shift?.source ?? null,
    reg_score: roundOrNull(shift?.score, 4),
    reg_ratio: roundOrNull(shift?.ratio, 4),
    reg_sharp_x: roundOrNull(shift?.sharpX, 3),
    reg_sharp_y: roundOrNull(shift?.sharpY, 3),
    reg_flagged: shift ? shift.flagged : null,
    cluster_id: cid,
    fallback: r.fallback,
    n_front: r.nFront,
    n_step: r.nStep,
    steps_capped: r.stepsCapped,
    n_parts: nParts,
    parts_coverage: roundOrNull(coverage, 3),
    uncovered_dropped: round(dropped, 1),
    parts_checked: check?.checked ?? 0,
    parts_disputed: check?.disputed ?? 0,
    parts_rejected: check?.rejected ?? false,
    sliced: r.sliced,
    step_cap: r.stepCap
  };
}

export interface ProbeRow {
  bid: string;
  fallback: string | null;
  nParts: number;
  partsChecked: number;
  partsDisputed: number;
  partsRejected: boolean;
  sliced: boolean;
  nStep: number;
  /** The tallest stored box (clamped); null without rows. */
  topM: number | null;
  /** [] without counted parts. */
  parts: PartVerdict[];
}

/** Derive only the clusters holding `bids` (unknown bids are skipped and named on stderr). */
export async function probeBoxes(a: {
  db: Duck;
  lidar: LidarMosaic | null;
  bids: string[];
  err?: (line: string) => void;
}): Promise<ProbeRow[]> {
  const err = a.err ?? ((l: string) => console.error(l));
  const { partsOf, streets, clusters } = await loadClusters(a.db);
  const clusterOfBid = new Map<string, string>();
  for (const [cid, members] of clusters) for (const m of members) clusterOfBid.set(m.bid, cid);
  const unknown = a.bids.filter((b) => !clusterOfBid.has(b));
  if (unknown.length > 0) err(`unknown building ids skipped: ${unknown.join(', ')}`);
  const rows = new Map<string, ProbeRow>();
  const cids = new Set(a.bids.flatMap((b) => clusterOfBid.get(b) ?? []));
  for (const cid of [...cids].sort()) {
    const members = clusters.get(cid)!;
    const w = a.lidar ? a.lidar.window(registrationBbox(members)) : null;
    const shift = registerCluster(w, members);
    for (const fp of members) {
      if (!a.bids.includes(fp.bid)) continue;
      const r = buildingBoxes(w, fp, shift, streets, partsOf.get(fp.bid) ?? []);
      rows.set(fp.bid, {
        bid: fp.bid,
        fallback: r.roof.fallback,
        nParts: r.nParts,
        partsChecked: r.check?.checked ?? 0,
        partsDisputed: r.check?.disputed ?? 0,
        partsRejected: r.check?.rejected ?? false,
        sliced: r.roof.sliced,
        nStep: r.roof.nStep,
        topM: r.boxes.length > 0 ? Math.max(...r.boxes.map((b) => clampH(b.heightM))) : null,
        parts: r.check?.parts ?? []
      });
    }
  }
  return a.bids.flatMap((b) => rows.get(b) ?? []);
}

/** `--probe` values: ids, or `@path` for a file of one id per line (blank lines ignored). */
export function probeBids(items: string[]): string[] {
  return items.flatMap((i) =>
    i.startsWith('@')
      ? readFileSync(i.slice(1), 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '')
      : [i.trim()]
  );
}

export interface BoxesCommandOpts {
  lockPath: string;
  lidarLockPath: string;
  rawDir: string;
  /** Raw files are `<rawDir>/<name>` (the mini fixture), and the artifact is stored by name. */
  byName: boolean;
  repoRoot: string;
  /** The lock entry's retrievedAt (default now; with `fixture`, the mini fixture's date). */
  now?: Date;
  /** The mini fixture: its SB 79 exemption transcription (F8) and fixed retrievedAt (F1). */
  fixture?: boolean;
  /** Probe mode: derive only these buildings, print one JSON line each, write nothing. */
  probe?: string[];
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/**
 * Verify the raw cache (main lock minus building-boxes, and the LiDAR lock), normalise, run the
 * SQL through 50_clip, derive the boxes, write boxes.parquet, roofs.parquet and inputs.json, store
 * them and replace the lock's building-boxes entry. Prints the boxes.* counts, the outside-footprint
 * count (must be 0, else nothing is written) and the artifact's bytes. Returns the exit code.
 */
export async function boxesCommand(o: BoxesCommandOpts): Promise<number> {
  const out = o.out ?? ((l: string) => console.log(l));
  const err = o.err ?? ((l: string) => console.error(l));
  const t0 = Date.now();
  if (!existsSync(o.lockPath)) {
    err(`no ${o.lockPath}: run npm run pipeline -- fetch first`);
    return 1;
  }
  const lock = readLock(o.lockPath);
  const lidarLock = readLidarLock(o.lidarLockPath);
  const main = { sources: lock.sources.filter((s) => s.id !== BOXES_ID) };
  const bad = await verifyRaw(main, o.rawDir, { byName: o.byName });
  const badLidar = lidarLock ? await verifyRaw(lidarLock, o.rawDir, { byName: o.byName }) : [];
  if (bad.length + badLidar.length > 0) {
    err(`raw files do not match the locks:\n  ${[...bad, ...badLidar].join('\n  ')}`);
    const missing = (m: string) => m.includes(': missing raw file ');
    if (bad.some(missing)) err('run npm run pipeline -- fetch --restore');
    if (badLidar.some(missing)) err('run npm run pipeline -- fetch --restore --lidar');
    return 1;
  }
  const release = overtureReleaseProblem(lock);
  if (release) {
    err(release);
    return 1;
  }
  if (!lidarLock)
    (o.probe ? err : out)(
      `no ${o.lidarLockPath}: every building without parts falls back (no_lidar)`
    );

  const work = mkdtempSync(join(tmpdir(), 'sfh-boxes-'));
  const db = await openDuck();
  try {
    const norm = join(work, 'norm');
    await normaliseAll(db, main, o.rawDir, norm, {
      byName: o.byName,
      exemptionsCsv: SB79_EXEMPTIONS_CSV[o.fixture ? 'fixture' : 'live']
    });
    await loadNormalised(db, norm);
    await runSql(db, '50_clip.sql');
    const lidar = openLidarMosaic(lidarTilesOf(lidarLock, o.rawDir, o.byName));
    if (o.probe) {
      for (const r of await probeBoxes({ db, lidar, bids: probeBids(o.probe), err }))
        out(JSON.stringify(r));
      return 0;
    }
    await deriveBuildingBoxes({ db, lidar, workDir: work });

    const counts = await boxesCounts(db);
    for (const k of Object.keys(counts).sort()) out(`${k} ${counts[k]}`);
    const outside = await outsideFootprint(db, BX_BOXES_GEOM);
    out(`boxes.outside_footprint ${outside}`);
    if (outside > 0) {
      err(`${outside} LiDAR boxes lie outside their footprint: ${BOXES_ID} not written`);
      return 1;
    }

    const inputs = boxesInputsOf(lock, lidarLock, await boxesCodeHash(o.repoRoot));
    const art = join(work, 'artifact');
    mkdirSync(art, { recursive: true });
    const local = {
      boxes: join(art, 'boxes.parquet'),
      roofs: join(art, 'roofs.parquet'),
      inputs: join(art, 'inputs.json')
    };
    // One thread and an ORDER BY: the same inputs give the same bytes.
    await db.run('SET threads = 1');
    await db.run(
      `COPY (SELECT * FROM bx_boxes ORDER BY bid, k) TO ${q(local.boxes)}
       (FORMAT parquet, COMPRESSION zstd)`
    );
    await db.run(
      `COPY (SELECT * FROM bx_roofs ORDER BY bid) TO ${q(local.roofs)}
       (FORMAT parquet, COMPRESSION zstd)`
    );
    writeFileSync(local.inputs, canonicalJson(inputs) + '\n');
    const [{ n }] = await db.all<{ n: number }>('SELECT count(*)::INTEGER AS n FROM bx_roofs');

    const files: LockFile[] = [];
    for (const key of ['boxes', 'roofs', 'inputs'] as const) {
      const name = BOXES_FILES[key];
      const url = `derived:${name}`;
      if (o.byName) {
        const sha256 = await sha256File(local[key]);
        const f: LockFile = {
          url,
          sha256,
          bytes: statSync(local[key]).size,
          archiveKey: archiveKeyFor(sha256, name),
          name
        };
        const dest = rawPath(o.rawDir, f, true);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(local[key], dest);
        files.push(f);
      } else files.push(await storeFile(o.rawDir, name, url, local[key]));
    }
    const retrievedAt = o.now ?? new Date(o.fixture ? FIXTURE_RETRIEVED_AT : Date.now());
    const entry: LockEntry = {
      id: BOXES_ID,
      files,
      retrievedAt: retrievedAt.toISOString(),
      upstreamVersion: boxesUpstreamVersion(inputs),
      rowCount: n,
      license: BOXES_LICENSE,
      label: BOXES_LABEL,
      homepage: BOXES_HOMEPAGE
    };
    writeLock(o.lockPath, { sources: [...main.sources, entry] });
    const bytes = files.reduce((s, f) => s + f.bytes, 0);
    out(
      `${BOXES_ID} ${bytes} B (${files.map((f) => `${f.name} ${f.bytes}`).join(', ')}), ` +
        `${((Date.now() - t0) / 1000).toFixed(1)} s`
    );
    out(`wrote the ${BOXES_ID} entry of ${o.lockPath}`);
    return 0;
  } finally {
    db.close();
    rmSync(work, { recursive: true, force: true });
  }
}
