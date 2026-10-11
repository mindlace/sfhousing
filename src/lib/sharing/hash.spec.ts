import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('hashes abc', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
  it('hashes UTF-8 bytes', async () => {
    expect(await sha256Hex('é')).toBe(createHash('sha256').update('é', 'utf8').digest('hex'));
  });
});
