import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { TOOL_VERSIONS, type InvariantProfile } from '../config';
import { BuildError } from '../lib/build-error';
import { run } from '../lib/exec';
import { openDuck, type Duck } from '../lib/duck';
import { lockSha256, rawPath, readLock, sortKeys, verifyRaw, type Lock } from '../lib/lock';
import { QUALITY_REPORT_MD, createQualityTables, writeQualityReport } from '../lib/quality';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { codeTreeHash, computeDatasetVersion } from '../lib/version';
import { asOfFromLock } from '../project-records/parse';
import { loadNormalised, normaliseAll } from '../sources/normalise';
import { checkDataset, type InvariantResult } from './check';
import { readParcelRecords, writeChunks, writeNeighborhoods, type ChunkOut } from './chunks';
import { buildManifest, writeManifest } from './manifest';
import { writeProjectRecords } from './projects';
import { writeScenario } from './scenario';
import { copyBasemap, installFonts, writeBuildingsTiles } from './tiles';
import { writeTransit } from './transit';

export interface BuildOpts {
  lockPath: string;
  rawDir: string;
  /** Raw files are `<rawDir>/<lock file name>` (fixture) instead of `<rawDir>/<sha256>`. */
  rawByName?: boolean;
  outRoot: string;
  datasetVersion?: string;
  builtAt?: string;
  profile: InvariantProfile;
  skipTiles?: boolean;
  /**
   * Pipeline-internal derived cache root (T13 parcel panel and lineage go to
   * `<derivedRoot>/<datasetVersion>/`). Default `<repo>/pipeline/.cache/derived`.
   */
  derivedRoot?: string;
}

export { BuildError };

const REPO_ROOT = resolve(import.meta.dirname, '../..');
/** SF housing stock (2023 Housing Inventory, Table 1); spec §4.9 V1. */
const HOUSING_STOCK = { end2022: 413208, end2023: 415803 };
const FIXTURE_RE = /^fixture-\d+$/;
const DERIVED_ROOT = join(REPO_ROOT, 'pipeline/.cache/derived');
/** Curated DA phasing (project-records spec §4.10.1): live, and the mini fixture's. */
const MULTIPHASE = {
  live: join(REPO_ROOT, 'pipeline/enrichment/multiphase.json'),
  fixture: join(REPO_ROOT, 'pipeline/test/fixtures/mini/enrichment/multiphase.json')
};
/** The three T11/T4 files whose presence puts `scenarios` in the manifest (spec §4.9). */
const SCENARIO_FILES = ['parcels.bin', 'projects.json', 'calibration.json'];
/** Spec §4.12: derivative databases of ODbL data are offered under ODbL-1.0 (share-alike). */
const DERIVED_LICENSE = {
  derivedData: 'ODbL-1.0',
  artifacts: ['basemap.pmtiles', 'buildings.pmtiles', 'parcels/*'],
  notice:
    'Derived data files under /data/ that incorporate OpenStreetMap or Overture data are made available under the ODbL 1.0.'
};

/** True when every file in dir a has a byte-identical twin in dir b and vice versa. */
function sameFiles(a: string, b: string): boolean {
  const la = readdirSync(a).sort();
  const lb = readdirSync(b).sort();
  if (la.join('\n') !== lb.join('\n')) return false;
  return la.every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
}

/**
 * Lay the font sources out as `<dir>/<Stack Name>/<range>.pbf` + `OFL.txt` for installFonts.
 * The fixture lists the files individually (`protomaps-fonts/<path>`); the live lock has one
 * `protomaps-fonts.tar.gz` (basemaps-assets at the pinned commit) whose `fonts/` is extracted.
 */
export async function materialiseFonts(
  lock: Lock,
  rawDir: string,
  byName: boolean,
  dir: string
): Promise<void> {
  const entry = lock.sources.find((s) => s.id === 'protomaps-fonts');
  if (!entry) throw new BuildError('lock has no protomaps-fonts entry');
  const tarball = entry.files.find((f) => f.name.endsWith('.tar.gz'));
  if (tarball) {
    const extract = join(dir, '.extract');
    mkdirSync(extract, { recursive: true });
    const r = await run('tar', ['-xzf', rawPath(rawDir, tarball, byName), '-C', extract]);
    if (r.code !== 0) throw new BuildError(`tar extraction of ${tarball.name} failed: ${r.stderr}`);
    const [root] = readdirSync(extract);
    const fonts = root ? join(extract, root, 'fonts') : '';
    if (!root || !existsSync(fonts))
      throw new BuildError(`${tarball.name} has no fonts/ directory`);
    cpSync(fonts, dir, { recursive: true });
    rmSync(extract, { recursive: true, force: true });
    return;
  }
  for (const f of entry.files) {
    const dst = join(dir, f.name.replace(/^protomaps-fonts\//, ''));
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(rawPath(rawDir, f, byName), dst);
  }
}

async function sqlCounts(db: Duck): Promise<Record<string, number>> {
  const rows = await db.all<{ key: string; value: number }>(
    'SELECT key, value FROM report_counts ORDER BY key'
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function chunkCounts(chunks: ChunkOut[]): Record<string, number> {
  return {
    'chunks.max_parcels': Math.max(0, ...chunks.map((c) => c.parcelCount)),
    'chunks.max_raw_bytes': Math.max(0, ...chunks.map((c) => c.rawBytes)),
    'chunks.total_raw_bytes': chunks.reduce((s, c) => s + c.rawBytes, 0)
  };
}

/**
 * Spec §4.2 `build`: verify the lock, normalise, SQL, chunks (+ in-run re-encode), the scenario
 * step (scenarios/fzp/parcels.bin; the T13 panel and lineage into the derived cache), the project
 * records (scenarios/fzp/projects.json; histories and permits.parquet into the derived cache),
 * the T14 quality report (quality-report.md into the derived cache), neighborhoods, tiles,
 * basemap, fonts, manifest, invariants and report.json into `<outRoot>/<datasetVersion>/`.
 * Throws BuildError when a raw file does not match the lock.
 */
export async function build(
  opts: BuildOpts
): Promise<{ outDir: string; datasetVersion: string; results: InvariantResult[] }> {
  const report = new Report();
  const lock = readLock(opts.lockPath);
  const byName = opts.rawByName ?? false;
  const mismatches = await report.time('verify', () => verifyRaw(lock, opts.rawDir, { byName }));
  if (mismatches.length > 0) {
    throw new BuildError(`raw files do not match the lock:\n  ${mismatches.join('\n  ')}`);
  }
  const datasetVersion =
    opts.datasetVersion ??
    computeDatasetVersion({
      lock,
      codeHash: await codeTreeHash(REPO_ROOT),
      toolVersions: TOOL_VERSIONS
    });
  const fixtureMode = FIXTURE_RE.test(datasetVersion);
  const builtAt = opts.builtAt ?? new Date().toISOString();
  const outDir = join(opts.outRoot, datasetVersion);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'sfh-build-'));

  const db = await openDuck();
  try {
    await report.time('normalise', async () => {
      await normaliseAll(db, lock, opts.rawDir, join(work, 'norm'), { byName });
      await loadNormalised(db, join(work, 'norm'));
    });
    // T14 (scenario-data spec §4.12): SQL rules insert into these, so they precede the first file.
    await createQualityTables(db);
    await report.time('sql', () => runSql(db));
    const chunks = await report.time('chunks', () =>
      writeChunks(db, outDir, datasetVersion, report)
    );
    const reencodeIdentical = await report.time('reencode', async () => {
      await writeChunks(db, join(work, 'reencode'), datasetVersion, new Report());
      return sameFiles(join(outDir, 'parcels'), join(work, 'reencode', 'parcels'));
    });
    // Transit spec §4.2 step 1: the service date is picked from the newest fetch date. Its UTC
    // day is the build's snapshot day: the scenario step's "today" for the FZP density cap and
    // the project records' `asOf` (project-records spec §4.9 Determinism).
    const newest = lock.sources.reduce((d, s) => (s.retrievedAt > d ? s.retrievedAt : d), '');
    const asOf = asOfFromLock(lock);
    const derivedDir = join(opts.derivedRoot ?? DERIVED_ROOT, datasetVersion);
    // The build's single report `counts` (T14): every owner records its `recordQuality` counts
    // into this object, and `writeQualityReport` and V30 read it. The project-records step writes
    // all its counts into it; the other counts join it below.
    const counts: Record<string, number> = {};
    const scenario = await report.time('scenario', async () =>
      writeScenario({
        db,
        outDir,
        derivedDir,
        datasetVersion,
        records: await readParcelRecords(db),
        capDay: asOf,
        report,
        buildCounts: counts
      })
    );
    report.warnings.push(...scenario.warnings);
    // Project-records spec §4.9: after the scenario step (it reads parcel_lineage and
    // scenario_panel), before the manifest and the invariants.
    const projects = await report.time('projects', () =>
      writeProjectRecords({
        db,
        lock,
        rawDir: opts.rawDir,
        byName,
        outDir,
        derivedDir,
        multiphasePath: fixtureMode ? MULTIPHASE.fixture : MULTIPHASE.live,
        profile: opts.profile,
        asOf,
        counts
      })
    );
    report.warnings.push(...projects.warnings);
    // After the last step that records T14 counts (spec §4.10), so the report covers every owner.
    writeQualityReport(join(derivedDir, QUALITY_REPORT_MD), datasetVersion, counts);
    const neighborhoodsBytes = await writeNeighborhoods(db, outDir);
    const transit = await report.time('transit', async () =>
      writeTransit({
        lock,
        rawDir: opts.rawDir,
        byName,
        outDir,
        targetDate: newest.slice(0, 10),
        // The mini fixture's feeds carry only a few lines; assignment checks are live-only.
        strict: !fixtureMode
      })
    );
    report.warnings.push(...transit.warnings);
    if (!opts.skipTiles) {
      await report.time('tiles', () => writeBuildingsTiles(db, outDir, work));
    }
    const basemap = lock.sources.find((s) => s.id === 'protomaps-basemap')?.files[0];
    if (!basemap) throw new BuildError('lock has no protomaps-basemap file');
    copyBasemap(rawPath(opts.rawDir, basemap, byName), outDir);
    await materialiseFonts(lock, opts.rawDir, byName, join(work, 'fonts'));
    installFonts(join(work, 'fonts'), outDir);

    const overtureContrib = await db.all<{ dataset: string; n: number }>(
      'SELECT dataset, n FROM overture_contrib ORDER BY dataset'
    );
    const manifest = buildManifest({
      datasetVersion,
      builtAt,
      lock,
      chunks,
      overtureContrib,
      transit: true,
      scenarios: SCENARIO_FILES.every((f) => existsSync(join(outDir, 'scenarios/fzp', f))),
      warn: (w) => report.warnings.push(w)
    });
    const manifestBytes = writeManifest(outDir, manifest);
    const [totals] = await db.all<{ units: number; hmax: number }>(
      'SELECT coalesce(sum(units), 0)::BIGINT AS units, coalesce(max(height_m), 0) AS hmax FROM parcel_out'
    );
    Object.assign(counts, {
      ...(await sqlCounts(db)),
      ...report.counts,
      ...chunkCounts(chunks),
      ...transit.counts,
      ...scenario.counts,
      ...Object.fromEntries(overtureContrib.map((o) => [`overture.contrib.${o.dataset}`, o.n])),
      'units.total': totals.units,
      'parcels.height_max_m': totals.hmax,
      'manifest.bytes': manifestBytes,
      'neighborhoods.bytes': neighborhoodsBytes
    });
    const results = await report.time('check', () =>
      checkDataset(outDir, opts.profile, {
        counts,
        reencodeIdentical,
        skipTiles: opts.skipTiles ?? false,
        stableDetail: fixtureMode,
        asOf,
        projectChecks: projects.checks
      })
    );
    const body: Record<string, unknown> = {
      datasetVersion,
      counts,
      warnings: report.warnings,
      toolVersions: TOOL_VERSIONS,
      housingStock: HOUSING_STOCK,
      license: DERIVED_LICENSE,
      invariants: results,
      // `upload` refuses unless the current lock hashes to this and tiles were built.
      lockSha256: lockSha256(lock),
      tilesSkipped: opts.skipTiles ?? false
    };
    // Fixture reports stay byte-stable: no wall-clock timings.
    if (!fixtureMode) body.timings = report.timings;
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(sortKeys(body), null, 2) + '\n');
    return { outDir, datasetVersion, results };
  } finally {
    db.close();
    rmSync(work, { recursive: true, force: true });
  }
}

/** Print invariant results; returns the exit code (1 on any failure). */
export function printResults(results: InvariantResult[]): number {
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id}  ${r.detail}`);
  return results.every((r) => r.ok) ? 0 : 1;
}
