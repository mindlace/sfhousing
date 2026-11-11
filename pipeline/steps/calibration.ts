// The stage-calibration build step (stage-calibration spec §4.3, §4.10): reads projects.json,
// parcels.bin, the histories, permits.parquet, the scenario_panel table, the market enrichment
// (pipeline/enrichment/market.json), the funding enrichment (pipeline/enrichment/funding.json or
// the mini fixture's) and the locked MOHCD pipeline rows, runs the pure core twice (V29), records
// the eight sc.* T14 tallies and the calibration.* counts into the build's single counts object,
// and writes scenarios/fzp/calibration.json and calibration-report.md (the latter to the derived
// cache, not shipped). No network.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FILL_LEVELS } from '../../src/lib/data/scenario-codec';
import { parseProjectsFile } from '../../src/lib/timelapse/projects';
import type { Day, ProjectHistoriesFile } from '../../src/lib/timelapse/types';
import { parseFundingFile, type FundingFile } from '../enrichment/funding-schema';
import { parseMarketFile } from '../enrichment/market-schema';
import { BuildError } from '../lib/build-error';
import type { Duck } from '../lib/duck';
import type { Lock } from '../lib/lock';
import { calibrate, type CalOutput } from '../lib/fzp-cal/calibrate';
import { duckPanelSource } from '../lib/fzp-cal/panel';
import {
  CalibrationError,
  SC_RULE_IDS,
  type CalProfile,
  type PermitRow
} from '../lib/fzp-cal/types';
import { recordQuality } from '../lib/quality';
import type { InvariantResult } from './check';
import { HISTORIES_JSON, PERMITS_PARQUET, PROJECTS_JSON, readRows } from './projects';
import { PARCELS_BIN, readParcelsBin } from './scenario';

export const CALIBRATION_JSON = 'scenarios/fzp/calibration.json';
export const CALIBRATION_REPORT_MD = 'calibration-report.md';
/** The Controller market enrichment (market-baseline spec §4.6): live and fixture builds read it. */
export const MARKET_JSON = resolve(import.meta.dirname, '../enrichment/market.json');

/** The `permits.parquet` columns, in `PermitRow` order. */
export const PERMIT_ROW_COLUMNS: readonly (keyof PermitRow)[] = [
  'permit_number',
  'project_id',
  'prj_record_id',
  'dva_record_id',
  'prx_case_no',
  'da',
  'parcel_ids',
  'proposed_units',
  'site_permit',
  'status',
  'live',
  'superseded',
  'filed_day',
  'issued_day',
  'construction_day',
  'complete_day',
  'status_day'
];

const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Every `permits.parquet` row as a `PermitRow`, ordered by permit number. */
export async function readPermits(db: Duck, file: string): Promise<PermitRow[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${PERMIT_ROW_COLUMNS.join(', ')} FROM read_parquet(${sqlStr(file)}) ` +
      'ORDER BY permit_number'
  );
  return rows.map((r) => {
    const o = {} as Record<string, unknown>;
    for (const k of PERMIT_ROW_COLUMNS) o[k] = r[k] ?? null;
    o.parcel_ids = Array.isArray(r.parcel_ids) ? r.parcel_ids.map(String) : [];
    return o as unknown as PermitRow;
  });
}

const stableCounts = (c: Record<string, number>): string =>
  JSON.stringify(
    Object.keys(c)
      .sort()
      .map((k) => [k, c[k]])
  );

/** V29: the names of the outputs that differ between two in-run computations; [] if none. */
export function sameRuns(a: CalOutput, b: CalOutput): string[] {
  const diffs: string[] = [];
  if (a.json !== b.json) diffs.push('json');
  if (a.reportMd !== b.reportMd) diffs.push('reportMd');
  if (stableCounts(a.counts) !== stableCounts(b.counts)) diffs.push('counts');
  if (JSON.stringify(a.tallies) !== JSON.stringify(b.tallies)) diffs.push('tallies');
  return diffs;
}

/** The MOHCD affordable pipeline source (finance-data spec 4.1): read as rows, not normalised. */
const MOHCD_SOURCE = 'datasf-mohcd-pipeline';

/**
 * `funding.json` at `path`, parsed: a JSON syntax error is a `BuildError` naming the path, as the
 * schema's own failures are (finance-data spec 4.5).
 */
export function readFundingFile(path: string): FundingFile {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new BuildError(`${path}: ${(e as Error).message}`);
  }
  return parseFundingFile(json, path);
}

async function ensurePanelTable(db: Duck, derivedDir: string): Promise<void> {
  const [t] = await db.all<{ n: number }>(
    "SELECT count(*)::INTEGER AS n FROM information_schema.tables WHERE table_name = 'scenario_panel'"
  );
  if (t.n > 0) return;
  const file = join(derivedDir, 'parcel-panel.parquet');
  await db.run(`CREATE TABLE scenario_panel AS SELECT * FROM read_parquet(${sqlStr(file)})`);
}

/**
 * The calibration step. `histories` may be passed in memory (the build does); otherwise they are
 * read from `<derivedDir>/project-histories.json`. Throws `CalibrationError` on an `asOf`
 * mismatch and on any core failure (§4.13). Returns the core's warnings and V28, V29.
 */
export async function writeCalibration(o: {
  db: Duck;
  outDir: string;
  derivedDir: string;
  datasetVersion: string;
  asOf: Day;
  histories?: ProjectHistoriesFile;
  cal: CalProfile;
  counts: Record<string, number>;
  /** defaults to MARKET_JSON */
  marketPath?: string;
  /** `pipeline/enrichment/funding.json`, or the mini fixture's on a fixture build */
  fundingPath: string;
  /** the build's lock and raw pages, for the MOHCD pipeline rows */
  lock: Lock;
  rawDir: string;
  byName: boolean;
}): Promise<{ warnings: string[]; checks: InvariantResult[] }> {
  const marketPath = o.marketPath ?? MARKET_JSON;
  const market = {
    file: parseMarketFile(JSON.parse(readFileSync(marketPath, 'utf8')), marketPath),
    path: marketPath
  };
  if (!o.lock.sources.some((s) => s.id === MOHCD_SOURCE)) {
    throw new BuildError(`lock has no ${MOHCD_SOURCE} entry (run fetch --only ${MOHCD_SOURCE})`);
  }
  const mohcd = readRows(o.lock, o.rawDir, o.byName, MOHCD_SOURCE);
  const funding = readFundingFile(o.fundingPath);
  const projects = parseProjectsFile(
    JSON.parse(readFileSync(join(o.outDir, PROJECTS_JSON), 'utf8'))
  );
  const parcels = readParcelsBin(join(o.outDir, PARCELS_BIN));
  const histories =
    o.histories ??
    (JSON.parse(readFileSync(join(o.derivedDir, HISTORIES_JSON), 'utf8')) as ProjectHistoriesFile);
  if (histories.asOf !== o.asOf || projects.asOf !== o.asOf) {
    throw new CalibrationError(
      `asOf mismatch: build ${o.asOf}, projects.json ${projects.asOf}, histories ${histories.asOf}`
    );
  }
  const permits = await readPermits(o.db, join(o.derivedDir, PERMITS_PARQUET));
  await ensurePanelTable(o.db, o.derivedDir);
  const input = {
    asOf: o.asOf,
    histories: histories.histories,
    permits,
    panel: await duckPanelSource(o.db),
    parcels,
    inFlight: projects.projects,
    fillLevels: FILL_LEVELS,
    datasetVersion: o.datasetVersion,
    market,
    funding,
    mohcd
  };
  const a = await calibrate(input, o.cal);
  const b = await calibrate(input, o.cal);
  const diffs = sameRuns(a, b);

  // Counts from the first computation (spec §4.4a), straight into the build's counts.
  for (const id of SC_RULE_IDS) recordQuality(o.counts, id, a.tallies[id]);
  for (const [k, v] of Object.entries(a.counts)) o.counts[k] = v;
  o.counts['calibration.bytes'] = Buffer.byteLength(a.json);

  const jsonPath = join(o.outDir, CALIBRATION_JSON);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, a.json);
  mkdirSync(o.derivedDir, { recursive: true });
  writeFileSync(join(o.derivedDir, CALIBRATION_REPORT_MD), a.reportMd);

  const v28: InvariantResult = o.cal.backcastGate
    ? { id: 'V28', ...a.backcast }
    : { id: 'V28', ok: true, detail: 'fixture: back-cast gate is live-only' };
  const v29: InvariantResult = {
    id: 'V29',
    ok: diffs.length === 0,
    detail:
      diffs.length === 0
        ? 'two in-run computations are byte-identical'
        : `two in-run computations differ in ${diffs.join(', ')}`
  };
  return { warnings: a.warnings, checks: [v28, v29] };
}
