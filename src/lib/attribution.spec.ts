import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { SOFTWARE } from './attribution';

describe('SOFTWARE credits', () => {
  it('credits luma.gl, a direct runtime dependency at ~9.4.0', () => {
    expect(SOFTWARE).toContainEqual({ name: 'luma.gl', license: 'MIT', url: 'https://luma.gl' });
    expect((pkg.dependencies as Record<string, string>)['@luma.gl/engine']).toBe('~9.4.0');
  });
});
