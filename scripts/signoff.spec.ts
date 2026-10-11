import { describe, expect, it } from 'vitest';
import { buildStatusArgs, planSteps } from './signoff';

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
  it('verify-only runs just the four checks in order', () => {
    expect(planSteps({ verifyOnly: true })).toEqual(['check', 'lint', 'test:unit', 'test:e2e']);
  });

  it('full plan orders preconditions, merge, checks, push, status', () => {
    expect(planSteps({ verifyOnly: false })).toEqual([
      'preconditions',
      'merge',
      'check',
      'lint',
      'test:unit',
      'test:e2e',
      'push',
      'status'
    ]);
  });
});
