/**
 * Idempotent: applies branch protection on `main` plus repo merge settings.
 * Usage: tsx scripts/branch-protection.ts [--dry-run] [--repo owner/name]
 * Mirrors planafoot: PRs may merge only with the `local-ci/signoff` commit status.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRepo } from './gh-repo';

export const protectionPayload = {
  required_status_checks: {
    strict: true,
    contexts: ['local-ci/signoff']
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 0
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
  required_linear_history: true,
  required_conversation_resolution: false
};

export const repoSettings = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'PR_BODY',
  delete_branch_on_merge: true
};

function ghApi(method: 'PUT' | 'PATCH', path: string, body: unknown, dryRun: boolean): void {
  if (dryRun) {
    console.log(`[dry-run] ${method} ${path}`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'branch-protection-'));
  const file = join(dir, 'payload.json');
  writeFileSync(file, JSON.stringify(body));
  try {
    execFileSync('gh', ['api', '-X', method, path, '--input', file], { stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runBranchProtection(opts: { dryRun: boolean; args: string[] }): void {
  const { owner, name } = resolveRepo(opts.args, opts.dryRun);
  console.log(`Applying to ${owner}/${name} (dry-run=${opts.dryRun})`);
  ghApi('PUT', `repos/${owner}/${name}/branches/main/protection`, protectionPayload, opts.dryRun);
  ghApi('PATCH', `repos/${owner}/${name}`, repoSettings, opts.dryRun);
  console.log('Done.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  runBranchProtection({ dryRun: args.includes('--dry-run'), args });
}
