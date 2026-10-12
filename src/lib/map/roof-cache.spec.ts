import { expect, it } from 'vitest';
import { RoofCache } from './roof-cache';
import { roofFixture } from './test-utils/roof-fixtures';
it('keeps retired buffers charged until release and pins visible chunks', () => {
  const retired: string[] = [];
  const cache = new RoofCache({ onEvict: (id) => retired.push(id) });
  cache.reserve('a', 32 * 1024 * 1024, 0);
  cache.install('a', roofFixture().chunk);
  cache.setVisible(['a']);
  expect(cache.reserve('b', 33 * 1024 * 1024, 0)).toBe(false);
  cache.setVisible([]);
  expect(cache.reserve('b', 33 * 1024 * 1024, 0)).toBe(false);
  expect(retired).toEqual(['a']);
  expect(cache.snapshot().ownedBytes).toBe(32 * 1024 * 1024);
  cache.release('a');
  expect(cache.reserve('b', 33 * 1024 * 1024, 0)).toBe(true);
  cache.evict('b');
  expect(cache.snapshot().totalBytes).toBe(0);
});
it('counts index storage and simultaneous reservations against the hard cap', () => {
  const cache = new RoofCache({ onEvict: () => {} });
  cache.setIndexBytes(8 * 1024 * 1024);
  expect(cache.reserve('a', 30 * 1024 * 1024, 10 * 1024 * 1024)).toBe(true);
  expect(cache.reserve('b', 17 * 1024 * 1024, 0)).toBe(false);
  expect(cache.snapshot().totalBytes).toBe(48 * 1024 * 1024);
  cache.destroy();
  expect(cache.snapshot().totalBytes).toBe(0);
});
