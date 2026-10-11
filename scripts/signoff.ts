/**
 * Local-CI signoff (planafoot pattern). "CI proven" is a `local-ci/signoff` commit status,
 * which branch protection requires on `main`. Run on a PR branch:
 *
 *   npm run signoff                 merge origin/main, run the full suite, push, post status
 *   npm run signoff -- --verify-only   just the four checks (no merge, push or status)
 *   npm run signoff -- --dry-run       print the plan, run nothing
 *   --repo owner/name                  override the repo detected by `gh repo view`
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveRepo } from './gh-repo';

export const SIGNOFF_CONTEXT = 'local-ci/signoff';
const DESCRIPTION_MAX = 140;
const CHECKS = ['check', 'lint', 'test:unit', 'test:e2e'] as const;

export type Step = 'preconditions' | 'merge' | (typeof CHECKS)[number] | 'push' | 'status';

export function planSteps(opts: { verifyOnly: boolean }): Step[] {
  if (opts.verifyOnly) return [...CHECKS];
  return ['preconditions', 'merge', ...CHECKS, 'push', 'status'];
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

function checkPreconditions(): void {
  if (out('git', ['status', '--porcelain']) !== '') {
    fail('working tree is dirty; commit or discard changes first');
  }
  if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) === 'main') {
    fail('HEAD is on main; signoff is for PR branches');
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
        run('npm', ['run', step]);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
