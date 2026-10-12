import { expect, it } from 'vitest';
import { benchDataset } from './bench-map-config';
it('requires an explicit safe dataset version and keeps fixture default', () => {
  expect(benchDataset(undefined)).toBe('fixture-0');
  expect(benchDataset('2026-10-12-c9b71965')).toBe('2026-10-12-c9b71965');
  for (const value of ['', '../fixture-0', 'a;touch /tmp/x', 'a b', 'a\nb', 'x'.repeat(129)])
    expect(() => benchDataset(value)).toThrow();
});
