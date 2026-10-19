import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { SOFTWARE } from './attribution';

describe('SOFTWARE credits', () => {
  it('credits luma.gl, a direct runtime dependency at ~9.4.0', () => {
    expect(SOFTWARE).toContainEqual({ name: 'luma.gl', license: 'MIT', url: 'https://luma.gl' });
    expect((pkg.dependencies as Record<string, string>)['@luma.gl/engine']).toBe('~9.4.0');
  });

  it('credits fdlibm', () => {
    expect(SOFTWARE).toContainEqual({
      name: 'fdlibm (exp, log)',
      license: 'Sun Microsystems permissive notice',
      url: 'https://www.netlib.org/fdlibm/'
    });
  });

  it('keeps the fdlibm notice through minification', () => {
    const src = readFileSync(new URL('./timelapse/math.ts', import.meta.url), 'utf8');
    expect(src.startsWith('/*!')).toBe(true);
    expect(src).toContain('Copyright (C) 1993 by Sun Microsystems');
  });
});
