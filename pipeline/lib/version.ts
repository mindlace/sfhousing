import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATASET_VERSION_RE } from '../../src/lib/data/manifest';
import { run } from './exec';
import { canonicalJson, type Lock } from './lock';

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

const PATHS = ['pipeline', 'src/lib/data'];
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

/**
 * Identifies the pipeline + data-schema code: the git tree hashes of `pipeline` and
 * `src/lib/data` at HEAD, concatenated. When those paths have uncommitted changes
 * (excluding pipeline/sources.lock.json, .cache and out), the sha256 of
 * `git diff HEAD` and of each untracked file is appended, so uncommitted code
 * produces a different datasetVersion than the committed tree.
 */
export async function codeTreeHash(repoRoot: string): Promise<string> {
  const trees = await Promise.all(
    PATHS.map(async (p) => (await git(repoRoot, ['rev-parse', `HEAD:${p}`])).trim())
  );
  let out = trees.join('');
  const status = await git(repoRoot, ['status', '--porcelain', '--', ...PATHS, ...EXCLUDES]);
  if (status.trim() === '') return out;
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
