import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dataKey, DATASET_VERSION_RE } from './key';

describe('dataKey', () => {
  it.each([
    ['fixture-0', 'parcels/48_24.json', 'data/fixture-0/parcels/48_24.json'],
    [
      '2026-10-10-3fa9c2d1',
      'fonts/NotoSans-Regular/0-255.pbf',
      'data/2026-10-10-3fa9c2d1/fonts/NotoSans-Regular/0-255.pbf'
    ]
  ])('accepts %s / %s', (v, rest, key) => {
    expect(dataKey(v, rest)).toBe(key);
  });

  it.each([
    ['fixture-0', '..'],
    ['fixture-0', 'a/../b'],
    ['fixture-0', '.'],
    ['fixture-0', 'a/./b'],
    ['fixture-0', 'a//b'],
    ['fixture-0', '/a'],
    ['fixture-0', 'a/'],
    ['fixture-0', ''],
    ['fixture-0', '%2e%2e'],
    ['fixture-0', 'a b.json'],
    ['fixture-0', 'x'.repeat(257)],
    ['20261010-3fa9c2d1', 'manifest.json'],
    ['test-v1', 'manifest.json'],
    ['fixture-', 'manifest.json'],
    ['2026-10-10-3FA9C2D1', 'manifest.json'],
    ['2026-10-10-3fa9c2d', 'manifest.json']
  ])('rejects %s / %s', (v, rest) => {
    expect(dataKey(v, rest)).toBeNull();
  });

  it('accepts exactly 256 chars of path', () => {
    expect(dataKey('fixture-0', 'x'.repeat(256))).toBe(`data/fixture-0/${'x'.repeat(256)}`);
  });

  it('every accepted key is under data/<version>/ with no dot segments', () => {
    // Wrapped in expect(...) because the server project sets expect.requireAssertions.
    expect(() =>
      fc.assert(
        fc.property(
          fc.oneof(fc.constantFrom('fixture-0', '2026-10-10-3fa9c2d1'), fc.string()),
          fc.array(fc.oneof(fc.constantFrom('..', '.', '', 'a', 'b.json', '%2e'), fc.string()), {
            minLength: 1,
            maxLength: 6
          }),
          (version, segs) => {
            const key = dataKey(version, segs.join('/'));
            if (key === null) return true;
            return (
              DATASET_VERSION_RE.test(version) &&
              key.startsWith(`data/${version}/`) &&
              !key.split('/').some((s) => s === '..' || s === '.' || s === '')
            );
          }
        )
      )
    ).not.toThrow();
  });
});
