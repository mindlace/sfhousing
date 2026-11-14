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

  it('credits bs58 and uuid', () => {
    expect(SOFTWARE).toContainEqual({
      name: 'bs58',
      license: 'MIT',
      url: 'https://github.com/cryptocoinjs/bs58'
    });
    expect(SOFTWARE).toContainEqual({
      name: 'uuid',
      license: 'MIT',
      url: 'https://github.com/uuidjs/uuid'
    });
  });

  it('credits unique-names-generator and the Unicode confusables data', () => {
    expect(SOFTWARE).toContainEqual({
      name: 'unique-names-generator',
      license: 'MIT',
      url: 'https://github.com/andreasonny83/unique-names-generator'
    });
    expect(SOFTWARE).toContainEqual({
      name: 'Unicode confusables data (UTS #39)',
      license: 'Unicode License v3',
      url: 'https://www.unicode.org/license.txt'
    });
  });

  it('credits better-svelte-email and aws4fetch', () => {
    expect(SOFTWARE).toContainEqual({
      name: 'better-svelte-email',
      license: 'MIT',
      url: 'https://github.com/Konixy/better-svelte-email'
    });
    expect(SOFTWARE).toContainEqual({
      name: 'aws4fetch',
      license: 'MIT',
      url: 'https://github.com/mhart/aws4fetch'
    });
  });

  it('keeps the fdlibm notice through minification', () => {
    const src = readFileSync(new URL('./timelapse/math.ts', import.meta.url), 'utf8');
    expect(src.startsWith('/*!')).toBe(true);
    expect(src).toContain('Copyright (C) 1993 by Sun Microsystems');
  });
});
