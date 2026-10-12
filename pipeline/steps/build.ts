import { archiveRoofDependencies } from '../roofs/archives';
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
import { roofToolVersions } from '../roofs/setup';
import { TOOL_VERSIONS, type InvariantProfile } from '../config';
import { run } from '../lib/exec';
import { openDuck, type Duck } from '../lib/duck';
import { lockSha256, rawPath, readLock, sortKeys, verifyRaw, type Lock } from '../lib/lock';
import { Report } from '../lib/report';
import { runSql, runSqlRange } from '../lib/sql';
import { prepareRoofJob } from '../roofs/inputs';
import { runRoofJob, usedRoofSourceIds } from '../roofs/run';
import { writeRoofArtifacts, type RoofBuildResult } from '../roofs/export';
import { codeTreeHash, computeDatasetVersion } from '../lib/version';
import { loadNormalised, normaliseAll } from '../sources/normalise';
import { checkDataset, type InvariantResult } from './check';
import { writeChunks, writeNeighborhoods, type ChunkOut } from './chunks';
import { buildManifest, writeManifest } from './manifest';
import { copyBasemap, installFonts, writeBuildingsTiles } from './tiles';

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
}

export class BuildError extends Error {}

const REPO_ROOT = resolve(import.meta.dirname, '../..');
/** SF housing stock (2023 Housing Inventory, Table 1); spec §4.9 V1. */
const HOUSING_STOCK = { end2022: 413208, end2023: 415803 };
const FIXTURE_RE = /^fixture-\d+$/;
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
 * Spec §4.2 `build`: verify the lock, normalise, SQL, chunks (+ in-run re-encode), neighborhoods,
 * tiles, basemap, fonts, manifest, invariants and report.json into `<outRoot>/<datasetVersion>/`.
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
      toolVersions: lock.sources.some((s) => s.id === 'roof-lidar')
        ? { ...TOOL_VERSIONS, ...roofToolVersions() }
        : TOOL_VERSIONS
    });
  const fixtureMode = FIXTURE_RE.test(datasetVersion);
  const builtAt =
    opts.builtAt ??
    (fixtureMode
      ? new Date(
          lock.sources
            .map((s) => s.retrievedAt)
            .sort()
            .at(-1)!
        ).toISOString()
      : new Date().toISOString());
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
    const roofsEnabled = lock.sources.some(
      (s) => s.id === 'roof-lidar' && s.spatial?.coverage.length
    );
    let roofs: RoofBuildResult | undefined;
    let usedRoofSources: string[] = [];
    if (roofsEnabled) {
      await report.time('sql10-40', () => runSql(db, '40_heights.sql'));
      const job = await prepareRoofJob(db, lock, {
        rawDir: opts.rawDir,
        rawByName: byName,
        datasetVersion,
        workDir: join(work, 'roof-job')
      });
      const processed = await report.time('roofs.reconstruct', () => runRoofJob(job));
      await report.time('sql50-70', () =>
        runSqlRange(db, { from: '50_clip.sql', to: '70_export.sql', resetCounts: false })
      );
      roofs = await report.time('roofs.export', () =>
        writeRoofArtifacts(db, processed.buildings, {
          outDir,
          datasetVersion,
          archiveDir: join(REPO_ROOT, 'pipeline/.cache/roof-artifacts')
        })
      );
      usedRoofSources = usedRoofSourceIds(processed.buildings);
      roofs.archives.push(...(await archiveRoofDependencies()));
      roofs.archives.sort((a, b) => a.archiveKey.localeCompare(b.archiveKey));
      roofs.counts['roofs.archives'] = roofs.archives.length;
      roofs.counts['roofs.archive_bytes'] = roofs.archives.reduce((n, a) => n + a.bytes, 0);
      const roofReportPath = join(outDir, 'roofs/report.json');
      const roofReport = JSON.parse(readFileSync(roofReportPath, 'utf8'));
      roofReport.builtAt = builtAt;
      roofReport.counts = roofs.counts;
      if (!fixtureMode)
        roofReport.timings = {
          reconstruction: report.timings['roofs.reconstruct'],
          export: report.timings['roofs.export']
        };
      writeFileSync(roofReportPath, JSON.stringify(sortKeys(roofReport)));
    } else {
      await report.time('sql', () => runSql(db));
    }
    const chunks = await report.time('chunks', () =>
      writeChunks(db, outDir, datasetVersion, report)
    );
    const reencodeIdentical = await report.time('reencode', async () => {
      await writeChunks(db, join(work, 'reencode'), datasetVersion, new Report());
      return sameFiles(join(outDir, 'parcels'), join(work, 'reencode', 'parcels'));
    });
    const neighborhoodsBytes = await writeNeighborhoods(db, outDir);
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
      buildingRoofs: roofs?.descriptor,
      usedRoofSources,
      warn: (w) => report.warnings.push(w)
    });
    const manifestBytes = writeManifest(outDir, manifest);
    const [totals] = await db.all<{ units: number; hmax: number }>(
      'SELECT coalesce(sum(units), 0)::BIGINT AS units, coalesce(max(height_m), 0) AS hmax FROM parcel_out'
    );
    const counts: Record<string, number> = {
      ...(await sqlCounts(db)),
      ...report.counts,
      ...roofs?.counts,
      ...chunkCounts(chunks),
      ...Object.fromEntries(overtureContrib.map((o) => [`overture.contrib.${o.dataset}`, o.n])),
      'units.total': totals.units,
      'parcels.height_max_m': totals.hmax,
      'manifest.bytes': manifestBytes,
      'neighborhoods.bytes': neighborhoodsBytes
    };
    const results = await report.time('check', () =>
      checkDataset(outDir, opts.profile, {
        counts,
        reencodeIdentical,
        skipTiles: opts.skipTiles ?? false,
        stableDetail: fixtureMode
      })
    );
    const body: Record<string, unknown> = {
      datasetVersion,
      counts,
      warnings: report.warnings,
      toolVersions: lock.sources.some((s) => s.id === 'roof-lidar')
        ? { ...TOOL_VERSIONS, ...roofToolVersions() }
        : TOOL_VERSIONS,
      housingStock: HOUSING_STOCK,
      license: roofs
        ? { ...DERIVED_LICENSE, artifacts: [...DERIVED_LICENSE.artifacts, 'roofs/*'] }
        : DERIVED_LICENSE,
      ...(roofs ? { roofArchives: roofs.archives } : {}),
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
