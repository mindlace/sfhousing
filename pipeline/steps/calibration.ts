// The stage-calibration build step (stage-calibration spec §4.3, §4.10): reads projects.json,
// parcels.bin, the histories, permits.parquet and the scenario_panel table, runs the pure core
// twice (V29), records the six sc.* T14 tallies and the calibration.* counts into the build's
// single counts object, and writes scenarios/fzp/calibration.json and calibration-report.md (the
// latter to the derived cache, not shipped). No network.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FILL_LEVELS } from '../../src/lib/data/scenario-codec';
import { parseProjectsFile } from '../../src/lib/timelapse/projects';
import type { Day, ProjectHistoriesFile } from '../../src/lib/timelapse/types';
import type { Duck } from '../lib/duck';
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
import { HISTORIES_JSON, PERMITS_PARQUET, PROJECTS_JSON } from './projects';
import { PARCELS_BIN, readParcelsBin } from './scenario';

export const CALIBRATION_JSON = 'scenarios/fzp/calibration.json';
export const CALIBRATION_REPORT_MD = 'calibration-report.md';

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
}): Promise<{ warnings: string[]; checks: InvariantResult[] }> {
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
    datasetVersion: o.datasetVersion
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
