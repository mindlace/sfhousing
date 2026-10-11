import { describe, expect, it } from 'vitest';
import { run } from '../lib/exec';

describe('run', () => {
  it('closes stdin when no input is given, so stdin readers terminate', async () => {
    const r = await run('cat', []);
    expect(r).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('passes input through', async () => {
    expect((await run('cat', [], { input: 'hi' })).stdout).toBe('hi');
  });
});
