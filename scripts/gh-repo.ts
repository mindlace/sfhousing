import { execFileSync } from 'node:child_process';

export interface RepoInfo {
  owner: string;
  name: string;
}

export const DEFAULT_REPO: RepoInfo = { owner: 'mindlace', name: 'sfhousing' };

/** Parse an `owner/name` string. */
export function parseRepo(s: string): RepoInfo {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) throw new Error(`--repo must look like owner/name, got "${s}"`);
  return { owner: m[1], name: m[2] };
}

/** Value following `--repo` in argv, if given. */
export function repoFlag(args: string[]): string | undefined {
  const i = args.indexOf('--repo');
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v) throw new Error('--repo needs a value (owner/name)');
  return v;
}

/**
 * Resolve the target repo: `--repo` wins, then `gh repo view`. In dry-run mode a failing
 * `gh` (unauthenticated, offline) falls back to the default repo; otherwise it throws.
 */
export function resolveRepo(args: string[], dryRun: boolean): RepoInfo {
  const flag = repoFlag(args);
  if (flag) return parseRepo(flag);
  try {
    const json = execFileSync('gh', ['repo', 'view', '--json', 'owner,name'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const parsed = JSON.parse(json) as { owner: { login: string }; name: string };
    return { owner: parsed.owner.login, name: parsed.name };
  } catch (err) {
    if (!dryRun) throw err;
    console.error(
      `[dry-run] gh repo view failed; using ${DEFAULT_REPO.owner}/${DEFAULT_REPO.name}`
    );
    return DEFAULT_REPO;
  }
}
