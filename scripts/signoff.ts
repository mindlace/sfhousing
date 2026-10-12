/**
 * Local-CI signoff (planafoot pattern). "CI proven" is a `local-ci/signoff` commit status,
 * which branch protection requires on `main`. Run on a PR branch:
 *
 *   npm run signoff                 merge origin/main, run the full suite, push, post status
 *   npm run signoff -- --verify-only   just the required checks (no merge, push or status)
 *   npm run signoff -- --dry-run       print the plan, run nothing
 *   --repo owner/name                  override the repo detected by `gh repo view`
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveRepo } from './gh-repo';

export const SIGNOFF_CONTEXT = 'local-ci/signoff';
const DESCRIPTION_MAX = 140;
const CHECKS = ['check', 'lint', 'test:unit', 'test:e2e', 'test:roofs:gpu'] as const;

export type Step =
  'preconditions' | 'merge' | (typeof CHECKS)[number] | 'clean-tree' | 'push' | 'status';

export function planSteps(opts: { verifyOnly: boolean }): Step[] {
  if (opts.verifyOnly) return [...CHECKS];
  return ['preconditions', 'merge', ...CHECKS, 'clean-tree', 'push', 'status'];
}

/** Arguments for `gh` that post the success status to `sha`. */
export function buildStatusArgs(opts: {
  owner: string;
  name: string;
  sha: string;
  email: string;
}): string[] {
  const description = `signed off by ${opts.email}`.slice(0, DESCRIPTION_MAX);
  return [
    'api',
    '-X',
    'POST',
    `repos/${opts.owner}/${opts.name}/statuses/${opts.sha}`,
    '-f',
    'state=success',
    '-f',
    `context=${SIGNOFF_CONTEXT}`,
    '-f',
    `description=${description}`
  ];
}

function out(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function fail(msg: string): never {
  console.error(`signoff: ${msg}`);
  process.exit(1);
}

/** Error message if signoff must not proceed, else null. `branch` is null when detached. */
export function preconditionError(opts: {
  branch: string | null;
  porcelain: string;
}): string | null {
  if (opts.porcelain !== '') return 'working tree is dirty; commit or discard changes first';
  if (opts.branch === null || opts.branch === 'HEAD') {
    return 'HEAD is detached; check out a PR branch';
  }
  if (opts.branch === 'main') return 'HEAD is on main; signoff is for PR branches';
  return null;
}

function currentBranch(): string | null {
  try {
    return out('git', ['symbolic-ref', '-q', '--short', 'HEAD']);
  } catch {
    return null;
  }
}

function checkPreconditions(): void {
  const err = preconditionError({
    branch: currentBranch(),
    porcelain: out('git', ['status', '--porcelain'])
  });
  if (err) fail(err);
}

function checkCleanTree(): void {
  if (out('git', ['status', '--porcelain']) !== '') {
    fail(
      'working tree changed during signoff (lockfile or a check modified tracked files); commit it and re-run'
    );
  }
}

function mergeMain(): void {
  run('git', ['fetch', 'origin', 'main']);
  let upToDate = true;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], {
      stdio: 'ignore'
    });
  } catch {
    upToDate = false;
  }
  if (upToDate) return;
  const before = out('git', ['rev-parse', 'HEAD']);
  try {
    run('git', ['merge', '--no-edit', 'origin/main']);
  } catch {
    fail('merge of origin/main conflicted; resolve it, commit, and re-run');
  }
  const changed = out('git', ['diff', '--name-only', before, 'HEAD']).split('\n');
  if (changed.includes('package-lock.json')) run('npm', ['install']);
}

function describePlan(steps: Step[]): void {
  console.log('signoff plan:');
  for (const s of steps) {
    const detail = (CHECKS as readonly string[]).includes(s) ? `npm run ${s}` : s;
    console.log(`  - ${detail}`);
  }
}

function main(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const verifyOnly = args.includes('--verify-only');
  const steps = planSteps({ verifyOnly });
  if (dryRun) {
    describePlan(steps);
    if (!verifyOnly) {
      const { owner, name } = resolveRepo(args, true);
      console.log(`status target: ${owner}/${name} context=${SIGNOFF_CONTEXT}`);
    }
    return;
  }
  for (const step of steps) {
    switch (step) {
      case 'preconditions':
        checkPreconditions();
        break;
      case 'merge':
        mergeMain();
        break;
      case 'clean-tree':
        checkCleanTree();
        break;
      case 'push':
        run('git', ['push', '-u', 'origin', 'HEAD']);
        break;
      case 'status': {
        const sha = out('git', ['rev-parse', 'HEAD']);
        const email = out('git', ['config', 'user.email']);
        const { owner, name } = resolveRepo(args, false);
        run('gh', buildStatusArgs({ owner, name, sha, email }));
        console.log(
          `Posted ${SIGNOFF_CONTEXT} on ${sha}. Open or update the PR, then squash-merge.`
        );
        break;
      }
      default:
        try {
          run('npm', ['run', step]);
        } catch {
          fail(`npm run ${step} failed`);
        }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
