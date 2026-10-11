import { describe, expect, it } from 'vitest';
import { REPO_URL } from './config';

describe('config', () => {
  it('points the source link at the public GitHub repo', () => {
    expect(REPO_URL).toBe('https://github.com/mindlace/sfhousing');
  });
});
