import { expect, it, vi } from 'vitest';
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

it('E2E observations retain reservation and retired ownership peaks after release', () => {
  vi.stubEnv('VITE_E2E', '1');
  try {
    const cache = new RoofCache({ onEvict: () => {} });
    cache.setIndexBytes(100);
    cache.reserve('a', 200, 300);
    cache.install('a', roofFixture().chunk);
    cache.evict('a');
    cache.release('a');
    const observed = cache.snapshot().observation;
    expect(observed).toMatchObject({
      maxTotalBytes: 600,
      maxReservedBytes: 500,
      maxOwnedBytes: 500,
      maxRetired: 1,
      invalidComponents: 0
    });
    expect(cache.snapshot().totalBytes).toBe(100);
  } finally {
    vi.unstubAllEnvs();
  }
});
