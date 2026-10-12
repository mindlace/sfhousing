import { describe, expect, it } from 'vitest';
import { buildStatusArgs, planSteps, preconditionError } from './signoff';

const base = { owner: 'o', name: 'n', sha: 'abc123', email: 'a@b.c' };

describe('buildStatusArgs', () => {
  it('posts a success local-ci/signoff status to the sha', () => {
    const args = buildStatusArgs(base);
    expect(args).toContain('repos/o/n/statuses/abc123');
    expect(args).toContain('state=success');
    expect(args).toContain('context=local-ci/signoff');
    expect(args.slice(0, 3)).toEqual(['api', '-X', 'POST']);
  });

  it('truncates the description to 140 characters', () => {
    const args = buildStatusArgs({ ...base, email: 'x'.repeat(300) });
    const desc = args.find((a) => a.startsWith('description='));
    expect(desc).toBeDefined();
    expect(desc!.slice('description='.length)).toHaveLength(140);
  });

  it('names the signer in the description', () => {
    expect(buildStatusArgs(base)).toContain('description=signed off by a@b.c');
  });
});

describe('planSteps', () => {
  it('verify-only runs software and required GPU checks in order', () => {
    expect(planSteps({ verifyOnly: true })).toEqual([
      'check',
      'lint',
      'test:unit',
      'test:e2e',
      'test:roofs:gpu'
    ]);
  });

  it('full plan orders preconditions, merge, checks, push, status', () => {
    expect(planSteps({ verifyOnly: false })).toEqual([
      'preconditions',
      'merge',
      'check',
      'lint',
      'test:unit',
      'test:e2e',
      'test:roofs:gpu',
      'clean-tree',
      'push',
      'status'
    ]);
  });
});

describe('preconditionError', () => {
  it('accepts a clean PR branch', () => {
    expect(preconditionError({ branch: 'feat/x', porcelain: '' })).toBeNull();
  });

  it('rejects a dirty tree', () => {
    expect(preconditionError({ branch: 'feat/x', porcelain: ' M a.ts' })).toMatch(/dirty/);
  });

  it('rejects main', () => {
    expect(preconditionError({ branch: 'main', porcelain: '' })).toMatch(/main/);
  });

  it('rejects a detached HEAD', () => {
    expect(preconditionError({ branch: null, porcelain: '' })).toMatch(/detached/);
    expect(preconditionError({ branch: 'HEAD', porcelain: '' })).toMatch(/detached/);
  });
});
