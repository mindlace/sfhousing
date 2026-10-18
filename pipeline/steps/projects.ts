// Project-records build step (project-records spec §4.9): reads the seven DataSF project sources
// from the lock and the curated multiphase.json and construction-verified.json, serves
// deriveProjects its callbacks from the build's DuckDB tables (parcel_out,
// active src_parcels, scenario-data's parcel_lineage, scenario_panel and src_parcel_attrs), runs
// it twice (V23 rerun identity) and writes `scenarios/fzp/projects.json` to the dataset, and
// `project-histories.json` and `permits.parquet` to the derived cache. Pure TS, like writeTransit.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';
import type { ProjectHistory } from '../../src/lib/timelapse/types';
import type { InvariantProfile } from '../config';
import {
  parseConstructionVerified,
  type ConstructionVerifiedFile
} from '../enrichment/construction-schema';
import { parseMultiphase, type MultiphaseFile } from '../enrichment/schema';
import { BuildError } from '../lib/build-error';
import { openDuck, type Duck } from '../lib/duck';
import { rawPath, type Lock } from '../lib/lock';
import {
  deriveProjects,
  serializeHistories,
  serializeProjects,
  type DeriveResult,
  type PermitOut
} from '../project-records/derive';
import { descendantsIndex, type ParcelAttrsRow } from '../project-records/descendants';
import { checkV21, checkV22, checkV23, checkV24 } from '../project-records/invariants';
import { PROJECT_SOURCE_IDS, type ProjectSourceId, type RawRow } from '../project-records/types';
import type { InvariantResult } from './check';

/** The T3 file, relative to the dataset's out dir. */
export const PROJECTS_JSON = 'scenarios/fzp/projects.json';
/** The T4d file and the permits table, relative to the derived dir. */
export const HISTORIES_JSON = 'project-histories.json';
export const PERMITS_PARQUET = 'permits.parquet';

/** `permits.parquet` columns and types (spec §4.9), in file order. */
export const PERMITS_COLUMNS: readonly [keyof PermitOut, string][] = [
  ['permit_number', 'VARCHAR'],
  ['project_id', 'VARCHAR'],
  ['prj_record_id', 'VARCHAR'],
  ['dva_record_id', 'VARCHAR'],
  ['prx_case_no', 'VARCHAR'],
  ['da', 'VARCHAR'],
  ['parcel_ids', 'VARCHAR[]'],
  ['proposed_units', 'INTEGER'],
  ['site_permit', 'BOOLEAN'],
  ['status', 'VARCHAR'],
  ['live', 'BOOLEAN'],
  ['superseded', 'BOOLEAN'],
  ['filed_day', 'INTEGER'],
  ['issued_day', 'INTEGER'],
  ['construction_day', 'INTEGER'],
  ['complete_day', 'INTEGER'],
  ['status_day', 'INTEGER']
];

const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Every page of a project source, concatenated in lock order; each page is a JSON row array. */
function readRows(lock: Lock, rawDir: string, byName: boolean, id: ProjectSourceId): RawRow[] {
  const entry = lock.sources.find((s) => s.id === id);
  if (!entry) throw new BuildError(`lock has no entry for ${id}`);
  const rows: RawRow[] = [];
  for (const f of entry.files) {
    const p = rawPath(rawDir, f, byName);
    let page: unknown;
    try {
      page = JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      throw new BuildError(`${id}: ${f.name} is not readable JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(page)) throw new BuildError(`${id}: ${f.name} is not a JSON array`);
    rows.push(...(page as RawRow[]));
  }
  return rows;
}

function readMultiphase(path: string): MultiphaseFile {
  try {
    return parseMultiphase(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    throw new BuildError(`${path}: ${(e as Error).message}`);
  }
}

function readConstructionVerified(path: string): ConstructionVerifiedFile {
  try {
    return parseConstructionVerified(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    throw new BuildError(`${path}: ${(e as Error).message}`);
  }
}

/** First value per key over rows already sorted by (key, value). */
function firstByKey(rows: { k: string; v: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.k)) m.set(r.k, r.v);
  return m;
}

/** Writes the permits rows, in the given order, with the spec's column types. */
async function writePermits(db: Duck, rows: PermitOut[], file: string): Promise<void> {
  const cols = PERMITS_COLUMNS.map(([n, t]) => `${n} ${t}`).join(', ');
  await db.run(`CREATE OR REPLACE TEMP TABLE prj_permits (ord INTEGER, ${cols})`);
  const tmp = mkdtempSync(join(tmpdir(), 'sfh-permits-'));
  try {
    if (rows.length > 0) {
      const ndjson = join(tmp, 'permits.ndjson');
      writeFileSync(ndjson, rows.map((r, ord) => JSON.stringify({ ord, ...r })).join('\n') + '\n');
      const spec = [['ord', 'INTEGER'], ...PERMITS_COLUMNS]
        .map(([n, t]) => `${sqlStr(n)}: ${sqlStr(t)}`)
        .join(', ');
      await db.run(
        `INSERT INTO prj_permits SELECT * FROM read_json(${sqlStr(ndjson)},
           format = 'newline_delimited', columns = {${spec}})`
      );
    }
    rmSync(file, { force: true });
    await db.run(
      `COPY (SELECT ${PERMITS_COLUMNS.map(([n]) => n).join(', ')} FROM prj_permits ORDER BY ord)
       TO ${sqlStr(file)} (FORMAT parquet)`
    );
  } finally {
    await db.run('DROP TABLE IF EXISTS prj_permits');
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The rows of a `permits.parquet` in file order as a JSON array (keys in column order, one row per
 * line): the golden form, compared by value (spec §4.9).
 */
export async function dumpPermits(file: string): Promise<string> {
  const db = await openDuck();
  try {
    const rows = await db.all(`SELECT * FROM read_parquet(${sqlStr(file)})`);
    return `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
  } finally {
    db.close();
  }
}

const bytesOf = (r: DeriveResult, asOf: Day) =>
  JSON.stringify([
    serializeProjects(r.file),
    serializeHistories({ schema: 1, asOf, histories: r.histories }),
    JSON.stringify(r.permits)
  ]);

/**
 * The project-records step. Needs runSql's parcel_out and src_parcels, the normalised
 * src_parcel_attrs and the scenario step's parcel_lineage and scenario_panel tables. `asOf` is the build's snapshot day. Writes every
 * report count, the `pr.*` T14 rows included, into `counts` (the build's single counts); the
 * determinism rerun records into a fresh object. Returns the warnings, the histories (for
 * stage-calibration) and V21-V24.
 * Throws BuildError for a missing lock entry, an unreadable page, or an invalid multiphase.json or
 * construction-verified.json.
 */
export async function writeProjectRecords(o: {
  db: Duck;
  lock: Lock;
  rawDir: string;
  byName: boolean;
  outDir: string;
  derivedDir: string;
  multiphasePath: string;
  constructionVerifiedPath: string;
  profile: InvariantProfile;
  asOf: Day;
  counts: Record<string, number>;
}): Promise<{
  warnings: string[];
  histories: ProjectHistory[];
  checks: InvariantResult[];
}> {
  const { db, asOf, profile } = o;
  const raw = Object.fromEntries(
    PROJECT_SOURCE_IDS.map((id) => [id, readRows(o.lock, o.rawDir, o.byName, id)])
  ) as Record<ProjectSourceId, RawRow[]>;
  const multiphase = readMultiphase(o.multiphasePath);
  const constructionVerified = readConstructionVerified(o.constructionVerifiedPath);

  const area = new Map(
    (await db.all<{ id: string; a: number }>('SELECT id, area_m2 AS a FROM parcel_out')).map(
      (r) => [r.id, r.a]
    )
  );
  const active = firstByKey(
    await db.all<{ k: string; v: string }>(
      `SELECT blklot AS k, mapblklot AS v FROM src_parcels
       WHERE active AND blklot IS NOT NULL AND mapblklot IS NOT NULL ORDER BY k, v`
    )
  );
  const retired = firstByKey(
    await db.all<{ k: string; v: string }>(
      `SELECT blklot AS k, current_mapblklot AS v FROM parcel_lineage
       WHERE blklot IS NOT NULL AND current_mapblklot IS NOT NULL ORDER BY k, v`
    )
  );
  const parcelIds = new Set<ParcelId>(area.keys());
  const lineage = (b: string): ParcelId | null => active.get(b) ?? retired.get(b) ?? null;
  // Main's ruling 3, Ruling D1 (revised): the subdivision chain of scenario-data's
  // src_parcel_attrs, read once and walked in TS (descendantsIndex).
  const descendants = descendantsIndex(
    await db.all<ParcelAttrsRow>(
      `SELECT blklot, mapblklot, active, CAST(date_rec_add AS VARCHAR) AS added,
         CAST(date_rec_drop AS VARCHAR) AS dropped
       FROM src_parcel_attrs WHERE blklot IS NOT NULL ORDER BY ALL`
    ),
    { parcelIds, lineage }
  );
  // The T13 panel, one roll year at a time into per-year columns over the parcel_out ids (NaN =
  // no panel row or a null value): the live panel has millions of (parcel, year) rows.
  const index = new Map([...area.keys()].map((id, i) => [id, i]));
  const lien = new Map(
    (
      await db.all<{ y: number; d: number | null }>(
        'SELECT roll_year AS y, min(lien_day) AS d FROM scenario_panel GROUP BY 1 ORDER BY 1'
      )
    ).map((r) => [r.y, r.d])
  );
  const years = [...lien.keys()];
  if (years.length === 0) throw new BuildError('scenario_panel is empty');
  const latestRollYear = years[years.length - 1];
  const units = new Map<number, Float64Array>();
  const stories = new Map<number, Float64Array>();
  const built = new Map<number, Float64Array>();
  for (const y of years) {
    const u = new Float64Array(index.size).fill(NaN);
    const s = new Float64Array(index.size).fill(NaN);
    const b = new Float64Array(index.size).fill(NaN);
    const rows = await db.all<{
      id: string;
      u: number | null;
      s: number | null;
      b: number | null;
    }>(
      `SELECT mapblklot AS id, existing_units AS u, base_stories AS s, year_built AS b
       FROM scenario_panel WHERE roll_year = ${y}`
    );
    for (const r of rows) {
      const i = index.get(r.id);
      if (i === undefined) continue;
      u[i] = r.u ?? NaN;
      s[i] = r.s ?? NaN;
      b[i] = r.b ?? NaN;
    }
    units.set(y, u);
    stories.set(y, s);
    built.set(y, b);
  }
  const at = (cols: Map<number, Float64Array>, id: ParcelId, y: number): number | null => {
    const i = index.get(id);
    const v = i === undefined ? undefined : cols.get(y)?.[i];
    return v === undefined || Number.isNaN(v) ? null : v;
  };

  const input = () => ({
    asOf,
    raw,
    parcelIds,
    lineage,
    descendants,
    assessorUnits: (id: ParcelId, y: number) => at(units, id, y),
    yearBuilt: (id: ParcelId, y: number) => at(built, id, y),
    lienDay: (y: number): Day | null => lien.get(y) ?? null,
    latestRollYear,
    baseStories: (id: ParcelId, y: number) => at(stories, id, y),
    hiNet: profile.hiNet,
    areaM2: (id: ParcelId) => area.get(id) ?? 0,
    multiphase,
    constructionVerified
  });
  const r = deriveProjects(input(), { counts: o.counts });
  // V23 rerun identity. T14 rows are keyed per counts object, so the rerun gets its own.
  const identical = bytesOf(r, asOf) === bytesOf(deriveProjects(input(), { counts: {} }), asOf);

  const projectsFile = join(o.outDir, PROJECTS_JSON);
  mkdirSync(dirname(projectsFile), { recursive: true });
  const projects = serializeProjects(r.file);
  writeFileSync(projectsFile, projects);
  mkdirSync(o.derivedDir, { recursive: true });
  writeFileSync(
    join(o.derivedDir, HISTORIES_JSON),
    serializeHistories({ schema: 1, asOf, histories: r.histories })
  );
  await writePermits(db, r.permits, join(o.derivedDir, PERMITS_PARQUET));

  o.counts['projects.asOf'] = asOf;
  o.counts['projects.bytes'] = Buffer.byteLength(projects);
  o.counts['permits.rows'] = r.permits.length;
  return {
    warnings: r.warnings,
    histories: r.histories,
    checks: [
      checkV21(r.checks, profile.pipelineCoverageMin),
      checkV22(r.checks, profile.hiNet, { year: profile.rhnaYearTol, total: profile.rhnaTotalTol }),
      checkV23(r.checks, identical),
      checkV24(r.checks)
    ]
  };
}
