import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATASET_VERSION_RE } from '../../src/lib/data/dataset-version.js';
import { TOOL_VERSIONS } from '../config.js';
import { run } from './exec.js';
import { canonicalJson, readLock, type Lock } from './lock.js';

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/**
 * datasetVersion = `<UTC date of newest retrievedAt>-<first 8 hex of
 * sha256(canonicalJson(lock) \n codeHash \n canonicalJson(toolVersions))>`.
 */
export function computeDatasetVersion(input: {
  lock: Lock;
  codeHash: string;
  toolVersions: Record<string, string>;
}): string {
  const times = input.lock.sources.map((s) => Date.parse(s.retrievedAt));
  if (times.length === 0 || times.some(Number.isNaN)) {
    throw new Error('lock has no sources or an unparseable retrievedAt');
  }
  const date = new Date(Math.max(...times)).toISOString().slice(0, 10);
  const h8 = sha256(
    canonicalJson(input.lock) + '\n' + input.codeHash + '\n' + canonicalJson(input.toolVersions)
  ).slice(0, 8);
  const v = `${date}-${h8}`;
  if (!DATASET_VERSION_RE.test(v)) throw new Error(`computed datasetVersion is invalid: ${v}`);
  return v;
}

/**
 * Code whose bytes shape the published data: pipeline/ and every module it imports. The rule: a
 * module that pipeline/cli.ts reaches through its imports is under an entry here, and an entry
 * covers at least one reached module. An entry ending in `.ts` covers that file; any other entry
 * covers the directory and everything under it. pipeline/test/version-paths.test.ts walks the
 * imports and fails on any difference, so a new import from the pipeline into `src/` lands here
 * in the same change.
 */
export const PATHS: readonly string[] = [
  'pipeline',
  'src/lib/config.ts',
  'src/lib/data',
  'src/lib/generator',
  'src/lib/timelapse',
  'src/lib/plan/geometry.ts',
  'src/lib/plan/types.ts',
  'src/lib/sim/finance',
  'src/lib/sim/cars',
  'src/lib/sim/world/rules/rng.ts',
  'src/lib/transit'
];
/** Inputs and outputs under `pipeline`, not code: never part of the code hash. */
const EXCLUDE_PATHS = ['pipeline/sources.lock.json', 'pipeline/.cache', 'pipeline/out'];
const exclusions = (excludes: string[]): string[] => excludes.map((e) => `:(exclude)${e}`);
const EXCLUDES = exclusions(EXCLUDE_PATHS);

/**
 * The derivation code of the `boxes` command, recorded in the building-boxes artifact (its stale
 * check warns when this hash moves): every module steps/boxes.ts runs to turn footprints, parts
 * and LiDAR tiles into boxes. That is lib/lidar, the thresholds, the cluster union-find, the
 * block expression (road-lots.ts `SQL_BLOCK_OF`) and the polygon helpers. Not covered: the
 * inputs the artifact records by their own hashes (sources, tiles) and the model's shared code
 * (normalisation, the SQL through 50_clip, the DuckDB, lock and raw-cache helpers).
 */
export const BOXES_CODE_PATHS = [
  'pipeline/lib/lidar',
  'pipeline/steps/boxes.ts',
  'pipeline/boxes-config.ts',
  'pipeline/project-records/union-find.ts',
  'pipeline/lib/road-lots.ts',
  'pipeline/geom.ts'
];

async function git(root: string, args: string[]): Promise<string> {
  const r = await run('git', args, { cwd: root, input: '' });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

async function dirtyLines(
  repoRoot: string,
  paths: readonly string[],
  specs: string[]
): Promise<string[]> {
  const status = await git(repoRoot, ['status', '--porcelain', '--', ...paths, ...specs]);
  return status.split('\n').filter((l) => l.trim() !== '');
}

/** Porcelain status lines for the code paths (same excludes as the code hash); empty = clean. */
export async function codePathsDirty(repoRoot: string): Promise<string[]> {
  return dirtyLines(repoRoot, PATHS, EXCLUDES);
}

/**
 * sha256 of the `git ls-tree -r HEAD` listing (mode, type, blob hash, path) of `paths`, minus
 * `excludes` (each a path and everything under it). When those paths have uncommitted changes
 * (same excludes), the sha256 of `git diff HEAD` and of each untracked file is appended, so
 * uncommitted code hashes differently from the committed tree.
 */
export async function treeHash(
  repoRoot: string,
  paths: readonly string[],
  excludes: string[]
): Promise<string> {
  const notCode = (f: string): boolean => excludes.some((e) => f === e || f.startsWith(`${e}/`));
  const specs = exclusions(excludes);
  const listing = (await git(repoRoot, ['ls-tree', '-r', '-z', 'HEAD', '--', ...paths]))
    .split('\0')
    .filter((line) => line !== '' && !notCode(line.slice(line.indexOf('\t') + 1)))
    .sort();
  let out = sha256(listing.join('\n'));
  if ((await dirtyLines(repoRoot, paths, specs)).length === 0) return out;
  const diff = await git(repoRoot, ['diff', 'HEAD', '--', ...paths, ...specs]);
  out += sha256(diff);
  const untracked = (
    await git(repoRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...paths,
      ...specs
    ])
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const f of untracked) out += sha256(fs.readFileSync(path.join(repoRoot, f)));
  return out;
}

/**
 * Identifies the pipeline + data-schema code: the `treeHash` of PATHS minus
 * pipeline/sources.lock.json, .cache and out. The lock is hashed separately by
 * computeDatasetVersion, so committing it does not change the version (spec AC-5, AC-7).
 * Uncommitted code produces a different datasetVersion than the committed tree.
 */
export async function codeTreeHash(repoRoot: string): Promise<string> {
  return treeHash(repoRoot, PATHS, EXCLUDE_PATHS);
}

/**
 * The boxes derivation code: a full sha256 hex of the `treeHash` of BOXES_CODE_PATHS,
 * uncommitted changes included (ruling F5). Recorded in the building-boxes artifact.
 */
export async function boxesCodeHash(repoRoot: string): Promise<string> {
  return sha256(await treeHash(repoRoot, BOXES_CODE_PATHS, []));
}

/** The datasetVersion this tree computes: repo lock, code hash (dirty trees included), TOOL_VERSIONS. */
export async function treeDatasetVersion(repoRoot: string): Promise<string> {
  const lockPath = path.join(repoRoot, 'pipeline/sources.lock.json');
  if (!fs.existsSync(lockPath)) throw new Error(`no pipeline/sources.lock.json under ${repoRoot}`);
  return computeDatasetVersion({
    lock: readLock(lockPath),
    codeHash: await codeTreeHash(repoRoot),
    toolVersions: TOOL_VERSIONS
  });
}
