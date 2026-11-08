import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATASET_VERSION_RE } from '../../src/lib/data/dataset-version';
import { TOOL_VERSIONS } from '../config';
import { run } from './exec';
import { canonicalJson, readLock, type Lock } from './lock';

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
 * Code whose bytes shape the published data. geometry.ts is the shared projection (transit);
 * generator, timelapse and plan/types.ts feed the scenario step (yields, the Day type and time
 * helpers, FeatureId). The lesscars step runs the simulation engine, so sim/scenario, sim/levers
 * and scoreboard shape the published data too (whole directories: over-hashing only costs a new
 * version on the next build).
 */
const PATHS = [
  'pipeline',
  'src/lib/data',
  'src/lib/generator',
  'src/lib/timelapse',
  'src/lib/plan/geometry.ts',
  'src/lib/plan/types.ts',
  'src/lib/sim/scenario',
  'src/lib/sim/levers',
  'src/lib/scoreboard'
];
const EXCLUDES = [
  ':(exclude)pipeline/sources.lock.json',
  ':(exclude)pipeline/.cache',
  ':(exclude)pipeline/out'
];

async function git(root: string, args: string[]): Promise<string> {
  const r = await run('git', args, { cwd: root, input: '' });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** Paths that are inputs or outputs, not code: never part of the code hash. */
const NOT_CODE = (f: string): boolean =>
  f === 'pipeline/sources.lock.json' ||
  f.startsWith('pipeline/.cache/') ||
  f.startsWith('pipeline/out/');

/** Porcelain status lines for the code paths (same excludes as the code hash); empty = clean. */
export async function codePathsDirty(repoRoot: string): Promise<string[]> {
  const status = await git(repoRoot, ['status', '--porcelain', '--', ...PATHS, ...EXCLUDES]);
  return status.split('\n').filter((l) => l.trim() !== '');
}

/**
 * Identifies the pipeline + data-schema code: sha256 of the `git ls-tree -r HEAD` listing
 * (mode, type, blob hash, path) of `pipeline`, `src/lib/data`, `src/lib/generator`,
 * `src/lib/timelapse`, `src/lib/plan/geometry.ts` and `src/lib/plan/types.ts`, minus pipeline/sources.lock.json, .cache and out. The lock is hashed separately by
 * computeDatasetVersion, so committing it does not change the version (spec AC-5, AC-7).
 * When those paths have uncommitted changes (same excludes), the sha256 of `git diff HEAD`
 * and of each untracked file is appended, so uncommitted code produces a different
 * datasetVersion than the committed tree.
 */
export async function codeTreeHash(repoRoot: string): Promise<string> {
  const listing = (await git(repoRoot, ['ls-tree', '-r', '-z', 'HEAD', '--', ...PATHS]))
    .split('\0')
    .filter((line) => line !== '' && !NOT_CODE(line.slice(line.indexOf('\t') + 1)))
    .sort();
  let out = sha256(listing.join('\n'));
  if ((await codePathsDirty(repoRoot)).length === 0) return out;
  const diff = await git(repoRoot, ['diff', 'HEAD', '--', ...PATHS, ...EXCLUDES]);
  out += sha256(diff);
  const untracked = (
    await git(repoRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...PATHS,
      ...EXCLUDES
    ])
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const f of untracked) out += sha256(fs.readFileSync(path.join(repoRoot, f)));
  return out;
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
