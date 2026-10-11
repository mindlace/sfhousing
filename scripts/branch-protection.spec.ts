import { describe, expect, it } from 'vitest';
import { protectionPayload, repoSettings } from './branch-protection';

describe('branch protection payload', () => {
  it('requires the strict local-ci/signoff status', () => {
    expect(protectionPayload.required_status_checks.contexts).toEqual(['local-ci/signoff']);
    expect(protectionPayload.required_status_checks.strict).toBe(true);
  });

  it('enforces on admins and allows squash merges only', () => {
    expect(protectionPayload.enforce_admins).toBe(true);
    expect(repoSettings.allow_squash_merge).toBe(true);
    expect(repoSettings.allow_merge_commit).toBe(false);
    expect(repoSettings.allow_rebase_merge).toBe(false);
  });
});
