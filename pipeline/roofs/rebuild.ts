import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DATASET_VERSION_RE } from '../../src/lib/data/dataset-version';
import { sha256File } from '../lib/lock';
import type { R2Target } from '../lib/r2';
import { restoreRaw } from '../steps/fetch';
import { restoreRoofArtifacts, parseRoofArchives } from './archives';
import { doctorRoofs, roofToolVersions } from './setup';
import { runRoofJob } from './run';
import type { RoofArchive, RoofInputBuilding, RoofJob } from './job';

export async function rebuildRoofBuilding(opts: {
  datasetVersion: string;
  buildingId: string;
  rawDir: string;
  archiveDir: string;
  outDir: string;
  r2: R2Target;
}): Promise<void> {
  if (!DATASET_VERSION_RE.test(opts.datasetVersion) || !opts.buildingId)
    throw new Error('invalid roof rebuild identity');
  if (existsSync(opts.outDir) && readdirSync(opts.outDir).length)
    throw new Error('roof rebuild needs a separate empty output directory');
  const work = mkdtempSync(join(tmpdir(), 'sfh-roof-rebuild-'));
  try {
    const reportPath = join(work, 'report.json');
    if (!(await opts.r2.get(`data/${opts.datasetVersion}/report.json`, reportPath)))
      throw new Error('published roof report unavailable');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (report.datasetVersion !== opts.datasetVersion)
      throw new Error('roof report dataset version mismatch');
    const archives = parseRoofArchives(report);
    const checkout =
      'checkout the recorded processing revision and run npm run pipeline -- setup-roofs before rebuilding';
    if (
      archives
        .filter((a) => a.name === 'toolchain.json')
        .some((a) => a.sha256 !== roofToolVersions().roofToolchainHash)
    )
      throw new Error(`roof toolchain mismatch: ${checkout}`);
    const inputs = archives.filter((a) => a.name === `${opts.buildingId}-input.json`);
    if (inputs.length !== 1)
      throw new Error(`building ${opts.buildingId} has no unique archived portable input`);
    await restoreRoofArtifacts(report, opts.archiveDir, opts.r2);
    const read = <T>(ref: RoofArchive): T =>
      JSON.parse(readFileSync(join(opts.archiveDir, ref.sha256), 'utf8')) as T;
    const input = read<{
      schemaVersion: number;
      datasetVersion: string;
      building: RoofInputBuilding;
      sources: RoofArchive;
      config: RoofArchive;
      dependencies: RoofArchive[];
      toolchainHash: string;
    }>(inputs[0]);
    if (
      input.schemaVersion !== 1 ||
      input.datasetVersion !== opts.datasetVersion ||
      input.building.buildingId !== opts.buildingId
    )
      throw new Error('portable roof job identity mismatch');
    if (input.toolchainHash !== roofToolVersions().roofToolchainHash)
      throw new Error(`roof toolchain mismatch: ${checkout}`);
    const names = new Set([
      'toolchain.json',
      'requirements.txt',
      'config.json',
      'source-config.json',
      'job.ts',
      'inputs.ts',
      'run.ts',
      'setup.ts',
      'archives.ts',
      'types.py',
      'geometry.py',
      'filter.py',
      'fit.py',
      'quality.py',
      'process.py',
      'overrides/salesforce.json'
    ]);
    if (
      input.dependencies.length !== names.size ||
      new Set(input.dependencies.map((a) => a.name)).size !== names.size
    )
      throw new Error(`incomplete recorded dependencies: ${checkout}`);
    for (const ref of input.dependencies) {
      if (
        !names.has(ref.name) ||
        (await sha256File(resolve(import.meta.dirname, ref.name))) !== ref.sha256
      )
        throw new Error(`roof processing/config mismatch (${ref.name}): ${checkout}`);
    }
    if ((await sha256File(resolve(import.meta.dirname, 'config.json'))) !== input.config.sha256)
      throw new Error(`roof config mismatch: ${checkout}`);
    const checks = await doctorRoofs();
    if (checks.some((c) => !c.ok)) throw new Error(`roof tools unavailable: ${checkout}`);
    const source = read<Pick<RoofJob, 'sources' | 'sourceStatus' | 'sourceArchives'>>(
      input.sources
    );
    const files = source.sourceArchives ?? [];
    const { roofRawArchives } = await import('./archives');
    roofRawArchives(archives, opts.archiveDir);
    await restoreRaw(
      {
        sources: [
          {
            id: 'roof-restored',
            files,
            retrievedAt: '',
            upstreamVersion: '',
            rowCount: 0,
            license: '',
            homepage: ''
          }
        ]
      },
      opts.rawDir,
      opts.r2
    );
    const result = await runRoofJob({
      schemaVersion: 1,
      datasetVersion: opts.datasetVersion,
      buildings: [input.building],
      sources: source.sources.map((s) => ({ ...s, path: resolve(opts.rawDir, s.sha256) })),
      sourceStatus: source.sourceStatus,
      sourceArchives: files,
      toolchainHash: input.toolchainHash,
      configPath: join(opts.archiveDir, input.config.sha256),
      workDir: join(work, 'process')
    });
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(join(opts.outDir, 'result.json'), JSON.stringify(result) + '\n');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
