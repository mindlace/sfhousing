// writeProjectRecords (spec 4.9): the mini records against stub DuckDB tables that mirror the stub
// callbacks of miniProjectInput(), so the step's outputs must equal deriveProjects on those stubs.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PROFILE } from '../config';
import { createTableFromRows, openDuck, type CellValue, type Duck } from '../lib/duck';
import type { Lock, LockEntry } from '../lib/lock';
import { PR_RULES } from '../lib/quality-rules/pr';
import { deriveProjects, serializeHistories, serializeProjects } from '../project-records/derive';
import { PROJECT_SOURCE_IDS } from '../project-records/types';
import { BuildError } from '../steps/build';
import { PERMITS_COLUMNS, writeProjectRecords } from '../steps/projects';
import {
  MINI_ASOF,
  MINI_PARCELS,
  PROJECT_RAW,
  miniProjectInput
} from './fixtures/mini/projects-raw';

const MULTIPHASE = 'pipeline/test/fixtures/mini/enrichment/multiphase.json';
/** Condo sub-lots (active) and the retired lot of scenario-data's mini lineage. */
const CONDO: Record<string, string> = {
  '3512101': '3512002',
  '3512102': '3512002',
  '3512103': '3512002'
};

let db: Duck;
let rawDir: string;
let lock: Lock;

/**
 * src_parcel_attrs as normalise.ts leaves the mini attrs CSV (blklot, mapblklot, active,
 * date_rec_add, date_rec_drop), which miniProjectInput's `descendants` stub reads.
 */
const MINI_ATTRS: CellValue[][] = [
  ...[...MINI_PARCELS]
    .filter((id) => id !== '3512002')
    .map((id): CellValue[] => [id, id, true, null, null]),
  ...Object.entries(CONDO).map(([b, m]): CellValue[] => [b, m, true, null, null]),
  ['3512099', '3512099', false, null, '2024-06-30'],
  ['3512098', '3512098', false, null, '2019-03-01'],
  ['3512097', null, true, null, null]
];

async function createAttrs(rows: CellValue[][]): Promise<void> {
  await createTableFromRows(
    db,
    'src_parcel_attrs',
    [
      ['blklot', 'VARCHAR'],
      ['mapblklot', 'VARCHAR'],
      ['active', 'BOOLEAN'],
      ['date_rec_add', 'DATE'],
      ['date_rec_drop', 'DATE']
    ],
    rows
  );
}

function entry(id: string): LockEntry {
  const name = `${id}.page-000.json`;
  return {
    id,
    files: [
      { url: `https://fixture.invalid/${name}`, sha256: 'x', bytes: 0, archiveKey: 'x', name }
    ],
    retrievedAt: '2026-10-10T00:00:00.000Z',
    upstreamVersion: 'fixture',
    rowCount: PROJECT_RAW[id as keyof typeof PROJECT_RAW].length,
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov'
  };
}

beforeAll(async () => {
  rawDir = mkdtempSync(join(tmpdir(), 'sfh-prj-raw-'));
  for (const id of PROJECT_SOURCE_IDS) {
    writeFileSync(join(rawDir, `${id}.page-000.json`), JSON.stringify(PROJECT_RAW[id]) + '\n');
  }
  lock = { sources: PROJECT_SOURCE_IDS.map(entry) };
  db = await openDuck();
  const ids = [...MINI_PARCELS].sort();
  await createTableFromRows(
    db,
    'parcel_out',
    [
      ['id', 'VARCHAR'],
      ['area_m2', 'DOUBLE']
    ],
    ids.map((id) => [id, 300])
  );
  await createTableFromRows(
    db,
    'src_parcels',
    [
      ['mapblklot', 'VARCHAR'],
      ['blklot', 'VARCHAR'],
      ['active', 'BOOLEAN']
    ],
    [
      ...ids.map((id): CellValue[] => [id, id, true]),
      ...Object.entries(CONDO).map(([b, m]): CellValue[] => [m, b, true]),
      // A retired row: never used by the active lookup.
      ['3512012', '3512099', false]
    ]
  );
  await createTableFromRows(
    db,
    'parcel_lineage',
    [
      ['blklot', 'VARCHAR'],
      ['retired_mapblklot', 'VARCHAR'],
      ['current_mapblklot', 'VARCHAR'],
      ['date_rec_drop', 'VARCHAR']
    ],
    [
      ['3512099', '3512099', '3512012', '2019-01-01'],
      ['3512098', '3512098', null, '2019-01-01']
    ]
  );
  await createAttrs(MINI_ATTRS);
  const stub = miniProjectInput();
  const panel: CellValue[][] = [];
  for (const id of ids) {
    for (const year of [2024, 2025]) {
      const u = stub.assessorUnits(id, year);
      if (u !== null) panel.push([id, year, u, null]);
    }
  }
  await createTableFromRows(
    db,
    'scenario_panel',
    [
      ['mapblklot', 'VARCHAR'],
      ['roll_year', 'INTEGER'],
      ['existing_units', 'INTEGER'],
      ['base_stories', 'INTEGER']
    ],
    panel
  );
});

afterAll(() => db?.close());

function dirs() {
  return {
    outDir: mkdtempSync(join(tmpdir(), 'sfh-prj-out-')),
    derivedDir: join(mkdtempSync(join(tmpdir(), 'sfh-prj-der-')), 'fixture-0')
  };
}

const run = (o: Partial<Parameters<typeof writeProjectRecords>[0]> = {}) => {
  const d = dirs();
  const counts: Record<string, number> = o.counts ?? {};
  return {
    ...d,
    counts,
    result: writeProjectRecords({
      db,
      lock,
      rawDir,
      byName: true,
      ...d,
      multiphasePath: MULTIPHASE,
      profile: FIXTURE_PROFILE,
      asOf: MINI_ASOF,
      ...o,
      counts
    })
  };
};

describe('writeProjectRecords', () => {
  it('writes projects.json and the histories equal to deriveProjects on the stub callbacks', async () => {
    const { outDir, derivedDir, counts, result } = run();
    const r = await result;
    expect(r).not.toHaveProperty('counts');
    const want = deriveProjects(miniProjectInput());
    const projects = readFileSync(join(outDir, 'scenarios/fzp/projects.json'), 'utf8');
    expect(projects).toBe(serializeProjects(want.file));
    expect(readFileSync(join(derivedDir, 'project-histories.json'), 'utf8')).toBe(
      serializeHistories({ schema: 1, asOf: MINI_ASOF, histories: want.histories })
    );
    expect(r.histories).toEqual(want.histories);
    expect(r.warnings).toEqual(want.warnings);
    for (const [k, v] of Object.entries(want.counts)) expect(counts[k], k).toBe(v);
    expect(counts['projects.asOf']).toBe(MINI_ASOF);
    expect(counts['projects.bytes']).toBe(Buffer.byteLength(projects));
    expect(counts['permits.rows']).toBe(want.permits.length);
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual([
      ['V21', true],
      ['V22', true],
      ['V23', true],
      ['V24', true]
    ]);
  });

  it('writes permits.parquet with the spec column types, rows in the derived order', async () => {
    const { derivedDir, result } = run();
    await result;
    const file = join(derivedDir, 'permits.parquet');
    expect(existsSync(file)).toBe(true);
    const cols = await db.all<{ column_name: string; column_type: string }>(
      `DESCRIBE SELECT * FROM read_parquet('${file}')`
    );
    expect(cols.map((c) => [c.column_name, c.column_type])).toEqual([
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
    ]);
    expect(PERMITS_COLUMNS.map(([n, t]) => [n, t])).toEqual(
      cols.map((c) => [c.column_name, c.column_type])
    );
    const rows = await db.all(`SELECT * FROM read_parquet('${file}')`);
    expect(rows).toEqual(deriveProjects(miniProjectInput()).permits);
    expect(rows.find((x) => x.permit_number === '201501150014')).toMatchObject({
      prx_case_no: '2010.0002PRX'
    });
  });

  it('throws BuildError when the lock has no entry for a project source', async () => {
    const partial = { sources: lock.sources.filter((s) => s.id !== 'datasf-dev-pipeline') };
    await expect(run({ lock: partial }).result).rejects.toThrow(BuildError);
    await expect(run({ lock: partial }).result).rejects.toThrow(
      'lock has no entry for datasf-dev-pipeline'
    );
  });

  it('throws BuildError on a page that is not a JSON array', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'sfh-prj-bad-'));
    for (const id of PROJECT_SOURCE_IDS) {
      writeFileSync(
        join(bad, `${id}.page-000.json`),
        id === 'datasf-planning-review' ? '{}' : '[]'
      );
    }
    await expect(run({ rawDir: bad }).result).rejects.toThrow(BuildError);
  });

  it('throws BuildError on a multiphase.json that does not parse or validate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-prj-mp-'));
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{"schema": 1, "projects": [');
    await expect(run({ multiphasePath: broken }).result).rejects.toThrow(BuildError);
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, JSON.stringify({ schema: 2, projects: [] }));
    await expect(run({ multiphasePath: invalid }).result).rejects.toThrow(BuildError);
  });

  it('rerun uses a fresh counts: the build counts hold each quality.pr.* key exactly once', async () => {
    const counts: Record<string, number> = { 'build.other': 1 };
    // A second recordQuality into the same object would throw; the rerun must not touch it.
    const r = await run({ counts }).result;
    expect(r.checks.find((c) => c.id === 'V23')?.ok).toBe(true);
    expect(counts['build.other']).toBe(1);
    const want = deriveProjects(miniProjectInput()).counts;
    const quality = (c: Record<string, number>) =>
      Object.keys(c)
        .filter((k) => k.startsWith('quality.pr.'))
        .sort();
    expect(quality(counts)).toEqual(quality(want));
    for (const id of PR_RULES.map((x) => x.id)) {
      expect(counts, id).toHaveProperty([`quality.${id}.fired`]);
      expect(counts, id).toHaveProperty([`quality.${id}.of`]);
    }
    // Values are those of one run, not two summed.
    for (const k of quality(want)) expect(counts[k], k).toBe(want[k]);
  });

  it('serves descendants from the src_parcel_attrs subdivision chain (Ruling D1, revised)', async () => {
    // M20's tracking lot 006 retired on 2020-01-01, when lot 013 (M2's) was added on its block.
    const chain = MINI_ATTRS.map((r): CellValue[] =>
      r[0] === '3512006'
        ? ['3512006', '3512006', false, null, '2020-01-01']
        : r[0] === '3512013'
          ? ['3512013', '3512013', true, '2020-01-01', null]
          : r
    );
    await createAttrs(chain);
    try {
      const { counts, result } = run();
      const r = await result;
      expect(counts['multiphase.descendants.2012-000020PRX']).toBe(2);
      expect(counts['multiphase.descendants.2010.0002PRX']).toBe(1);
      expect(r.warnings).toContain(
        '2012-000020PRX: descendant parcel 3512013 is held by PRJ:2026-000002PRJ, which is not a DA project'
      );
    } finally {
      await createAttrs(MINI_ATTRS);
    }
  });

  it('fails V21 when the coverage bound is above what the records give', async () => {
    const r = await run({ profile: { ...FIXTURE_PROFILE, pipelineCoverageMin: 1.01 } }).result;
    expect(r.checks.find((c) => c.id === 'V21')?.ok).toBe(false);
  });
});
