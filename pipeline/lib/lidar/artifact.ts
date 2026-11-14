// The locked `building-boxes` artifact (plan Decisions: two derived artifacts): boxes.parquet,
// roofs.parquet and inputs.json, written by `npm run pipeline -- boxes` and read by `build`. The
// lock entry's upstreamVersion carries 12-hex prefixes of every recorded input, so the stale
// checks need only the lock, never the raw cache.
import { createHash } from 'node:crypto';
import { BOXES } from '../../boxes-config.js';
import type { Duck } from '../duck.js';
import { canonicalJson, rawPath, type Lock, type LockEntry } from '../lock.js';

export const BOXES_ID = 'building-boxes';
export const BOXES_FILES = {
  boxes: 'building-boxes/boxes.parquet',
  roofs: 'building-boxes/roofs.parquet',
  inputs: 'building-boxes/inputs.json'
} as const;
/** Inputs a box sits on: a mismatch stops `build`. */
export const BOXES_GATED = ['overture-buildings', 'overture-building-parts'] as const;
/** Every recorded source; those not gated only warn. usgs-lidar-sf is read from the LiDAR lock. */
export const BOXES_RECORDED = [
  ...BOXES_GATED,
  'usgs-lidar-sf',
  'datasf-parcels',
  'datasf-streets',
  'datasf-neighborhoods'
] as const;
export const BOXES_LICENSE = 'ODbL-1.0';
export const BOXES_LABEL = 'Building boxes (USGS 3DEP LiDAR 2023 and Overture)';
export const BOXES_HOMEPAGE = 'https://www.usgs.gov/3d-elevation-program';

const LIDAR_SOURCE = 'usgs-lidar-sf';
const SCHEMA = 'boxes/1';
const HINT = 'run npm run pipeline -- boxes';

/** Full sha256 hex of every recorded input; '' = the source is absent from its lock. */
export interface BoxesInputs {
  schema: 1;
  code: string;
  config: string;
  sources: Record<string, string>;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** sha256 of the entry's file sha256s joined by ','; '' when absent. */
export function entryHash(e: LockEntry | undefined): string {
  return e ? sha256(e.files.map((f) => f.sha256).join(',')) : '';
}

/** sha256(canonicalJson(BOXES)). */
export function configHash(): string {
  return sha256(canonicalJson(BOXES));
}

const entryOf = (lock: Lock | null, id: string): LockEntry | undefined =>
  lock?.sources.find((s) => s.id === id);

export function boxesInputsOf(lock: Lock, lidarLock: Lock | null, code: string): BoxesInputs {
  const sources: Record<string, string> = {};
  for (const id of BOXES_RECORDED)
    sources[id] = entryHash(entryOf(id === LIDAR_SOURCE ? lidarLock : lock, id));
  return { schema: 1, code, config: configHash(), sources };
}

const prefix = (h: string): string => (h === '' ? '-' : h.slice(0, 12));

/**
 * 'boxes/1 code=<12> config=<12> overture-buildings=<12> overture-building-parts=<12>
 * usgs-lidar-sf=<12> datasf-parcels=<12> datasf-streets=<12> datasf-neighborhoods=<12>'
 * ('-' when absent).
 */
export function boxesUpstreamVersion(i: BoxesInputs): string {
  const parts = [`code=${prefix(i.code)}`, `config=${prefix(i.config)}`];
  for (const id of BOXES_RECORDED) parts.push(`${id}=${prefix(i.sources[id] ?? '')}`);
  return `${SCHEMA} ${parts.join(' ')}`;
}

/** The prefixes of boxesUpstreamVersion ('-' for an absent input); throws on another format. */
export function parseBoxesUpstreamVersion(s: string): {
  code: string;
  config: string;
  sources: Record<string, string>;
} {
  const [schema, ...fields] = s.split(' ');
  if (schema !== SCHEMA) throw new Error(`building-boxes upstreamVersion is not ${SCHEMA}: ${s}`);
  const kv = new Map<string, string>();
  for (const f of fields) {
    const m = /^([a-z0-9-]+)=([0-9a-f]{12}|-)$/.exec(f);
    if (!m) throw new Error(`building-boxes upstreamVersion has a bad field '${f}'`);
    kv.set(m[1], m[2]);
  }
  const need = ['code', 'config', ...BOXES_RECORDED];
  for (const k of need)
    if (!kv.has(k)) throw new Error(`building-boxes upstreamVersion lacks '${k}'`);
  const sources: Record<string, string> = {};
  for (const id of BOXES_RECORDED) sources[id] = kv.get(id)!;
  return { code: kv.get('code')!, config: kv.get('config')!, sources };
}

/**
 * null without a building-boxes entry or when every BOXES_GATED prefix matches the lock; else
 * `building-boxes were derived from overture-buildings <a>, the lock has <b>: run npm run
 * pipeline -- boxes` (one clause per gated source, joined by '; '). Lock-only: needs no raw files.
 */
export function boxesLockProblem(lock: Lock): string | null {
  const entry = entryOf(lock, BOXES_ID);
  if (!entry) return null;
  let rec: ReturnType<typeof parseBoxesUpstreamVersion>;
  try {
    rec = parseBoxesUpstreamVersion(entry.upstreamVersion);
  } catch (e) {
    return `${(e as Error).message}: ${HINT}`;
  }
  const clauses: string[] = [];
  for (const id of BOXES_GATED) {
    const now = prefix(entryHash(entryOf(lock, id)));
    if (rec.sources[id] !== now)
      clauses.push(
        `building-boxes were derived from ${id} ${rec.sources[id]}, the lock has ${now}`
      );
  }
  return clauses.length ? `${clauses.join('; ')}: ${HINT}` : null;
}

/**
 * One warning per differing non-gated source, code or config, each ending `: run npm run
 * pipeline -- boxes to refresh`. [] without a building-boxes entry; a malformed entry is
 * boxesLockProblem's to report.
 */
export function boxesStaleWarnings(lock: Lock, lidarLock: Lock | null, code: string): string[] {
  const entry = entryOf(lock, BOXES_ID);
  if (!entry) return [];
  let rec: ReturnType<typeof parseBoxesUpstreamVersion>;
  try {
    rec = parseBoxesUpstreamVersion(entry.upstreamVersion);
  } catch {
    return [];
  }
  const now = boxesInputsOf(lock, lidarLock, code);
  const out: string[] = [];
  const tail = `: ${HINT} to refresh`;
  for (const id of BOXES_RECORDED) {
    if ((BOXES_GATED as readonly string[]).includes(id)) continue;
    const is = prefix(now.sources[id]);
    if (rec.sources[id] !== is)
      out.push(
        `building-boxes were derived from ${id} ${rec.sources[id]}, ` +
          `the ${id === LIDAR_SOURCE ? 'LiDAR lock' : 'lock'} has ${is}${tail}`
      );
  }
  if (rec.code !== prefix(now.code))
    out.push(
      `building-boxes were derived from boxes code ${rec.code}, this tree has ${prefix(now.code)}${tail}`
    );
  if (rec.config !== prefix(now.config))
    out.push(
      `building-boxes were derived from BOXES config ${rec.config}, this tree has ${prefix(now.config)}${tail}`
    );
  return out;
}

/** The artifact's two parquet paths (see rawPath), or null without a building-boxes entry. */
export function boxesFilesOf(
  lock: Lock,
  rawDir: string,
  byName: boolean
): { boxes: string; roofs: string } | null {
  const entry = entryOf(lock, BOXES_ID);
  if (!entry) return null;
  const file = (name: string): string => {
    const f = entry.files.find((x) => x.name === name);
    if (!f) throw new Error(`the ${BOXES_ID} lock entry lists no ${name}`);
    return rawPath(rawDir, f, byName);
  };
  return { boxes: file(BOXES_FILES.boxes), roofs: file(BOXES_FILES.roofs) };
}

/**
 * The query counting non-`part` boxes of `boxes` (a table or subquery with bid, src and geom
 * GEOMETRY in EPSG:7131, NULL = the building's whole footprint) whose area outside
 * ST_Buffer(footprint, 0.01) exceeds 0.01 m2 (footprints from `buildings`). Must be 0: no
 * LiDAR-derived box pokes outside its footprint. Shared by `boxes` (bx_boxes) and `build`
 * (render_boxes), ruling F7.
 */
export function outsideFootprintSql(boxes: string): string {
  return `SELECT count(*)::INTEGER AS n
    FROM (${boxes}) x JOIN buildings b USING (bid)
    WHERE x.src <> 'part' AND x.geom IS NOT NULL
      AND ST_Area(ST_Difference(x.geom, ST_Buffer(b.geom, 0.01))) > 0.01`;
}

/** outsideFootprintSql's count. */
export async function outsideFootprint(db: Duck, boxes: string): Promise<number> {
  const [r] = await db.all<{ n: number }>(outsideFootprintSql(boxes));
  return r.n;
}

/** bx_boxes as outsideFootprintSql reads it. */
export const BX_BOXES_GEOM = 'SELECT bid, src, ST_GeomFromWKB(geom) AS geom FROM bx_boxes';

const FALLBACKS = ['no_lidar', 'new_building', 'unreliable', 'elevated'] as const;
const SRCS = ['base', 'front', 'step', 'part'] as const;
const ROOFS = ['flat', 'pitched', 'unknown'] as const;
const REG = ['fit', 'zero', 'frame-nad83', 'frame-wgs84', 'none'] as const;

/**
 * The boxes.* counts from tables bx_boxes and bx_roofs, every key present (0 when empty):
 * - `boxes.buildings` (bx_roofs rows); `.lidar` (with a base/front/step box), `.box` (no
 *   bx_boxes row: build draws today's box), `.parts` (with counted parts);
 *   `boxes.fallback.<kind>`;
 * - `boxes.src.box` (= `boxes.buildings.box`) and `boxes.src.<src>` rows;
 * - `boxes.roof.<roof>`; `boxes.front.buildings`, `boxes.step.buildings`, `boxes.step.capped`,
 *   `boxes.step.max_per_building`;
 * - per registration cluster with LiDAR (a NULL shift_source is no coverage: not counted, F16):
 *   `boxes.reg.clusters`, `boxes.reg.<source>` (frame_nad83, frame_wgs84; `zero` too),
 *   `boxes.reg.flagged`, `boxes.reg.ratio_p50`/`_p90`, `boxes.reg.shift_p50_m`/`_p90_m`;
 * - `boxes.parts.buildings`, `boxes.parts.count` (counted parts), `boxes.parts.coverage_p50`,
 *   `boxes.parts.uncovered_dropped` (buildings whose uncovered area had no usable LiDAR).
 * Shares and percentiles are rounded to 3 decimals.
 */
export async function boxesCounts(db: Duck): Promise<Record<string, number>> {
  const one = async (sql: string): Promise<number> => {
    const [r] = await db.all<{ n: number | null }>(sql);
    return r?.n === null || r?.n === undefined ? 0 : Math.round(Number(r.n) * 1000) / 1000 + 0;
  };
  const roofs = (where: string) => one(`SELECT count(*) AS n FROM bx_roofs WHERE ${where}`);
  const withBoxes = 'bid IN (SELECT bid FROM bx_boxes';
  const c: Record<string, number> = {};
  c['boxes.buildings'] = await one('SELECT count(*) AS n FROM bx_roofs');
  c['boxes.buildings.lidar'] = await roofs(`${withBoxes} WHERE src <> 'part')`);
  c['boxes.buildings.box'] = await roofs(`NOT ${withBoxes})`);
  c['boxes.buildings.parts'] = await roofs('n_parts > 0');
  for (const f of FALLBACKS) c[`boxes.fallback.${f}`] = await roofs(`fallback = '${f}'`);
  c['boxes.src.box'] = c['boxes.buildings.box'];
  for (const s of SRCS)
    c[`boxes.src.${s}`] = await one(`SELECT count(*) AS n FROM bx_boxes WHERE src = '${s}'`);
  for (const r of ROOFS) c[`boxes.roof.${r}`] = await roofs(`roof = '${r}'`);
  c['boxes.front.buildings'] = await roofs('n_front > 0');
  c['boxes.step.buildings'] = await roofs('n_step > 0');
  c['boxes.step.capped'] = await roofs('steps_capped');
  c['boxes.step.max_per_building'] = await one('SELECT max(n_step) AS n FROM bx_roofs');
  const clusters = `(SELECT DISTINCT cluster_id, shift_source, shift_dx, shift_dy, reg_ratio,
    reg_flagged FROM bx_roofs WHERE shift_source IS NOT NULL)`;
  c['boxes.reg.clusters'] = await one(`SELECT count(*) AS n FROM ${clusters}`);
  for (const s of REG)
    c[`boxes.reg.${s.replace('-', '_')}`] = await one(
      `SELECT count(*) AS n FROM ${clusters} WHERE shift_source = '${s}'`
    );
  c['boxes.reg.flagged'] = await one(`SELECT count(*) AS n FROM ${clusters} WHERE reg_flagged`);
  for (const [k, q] of [
    ['p50', 0.5],
    ['p90', 0.9]
  ] as const) {
    c[`boxes.reg.ratio_${k}`] = await one(
      `SELECT quantile_cont(reg_ratio, ${q}) AS n FROM ${clusters}`
    );
    c[`boxes.reg.shift_${k}_m`] = await one(
      `SELECT quantile_cont(sqrt(shift_dx * shift_dx + shift_dy * shift_dy), ${q}) AS n
       FROM ${clusters}`
    );
  }
  c['boxes.parts.buildings'] = c['boxes.buildings.parts'];
  c['boxes.parts.count'] = await one('SELECT sum(n_parts) AS n FROM bx_roofs');
  c['boxes.parts.coverage_p50'] = await one(
    'SELECT quantile_cont(parts_coverage, 0.5) AS n FROM bx_roofs WHERE n_parts > 0'
  );
  c['boxes.parts.uncovered_dropped'] = await roofs('uncovered_dropped > 0');
  return c;
}
