import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { E2E_RUN_MS_KEY, e2eRunMs } from './e2e-run';

const at = (v: string | null) => {
  const s = new MemoryStorage();
  if (v !== null) s.setItem(E2E_RUN_MS_KEY, v);
  return s;
};

describe('e2eRunMs', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_E2E', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('the key', () => expect(E2E_RUN_MS_KEY).toBe('sfhousing:e2e:run-ms'));

  it('a whole number from 100 to 20,000', () => {
    expect(e2eRunMs(at('100'))).toBe(100);
    expect(e2eRunMs(at('200'))).toBe(200);
    expect(e2eRunMs(at('20000'))).toBe(20_000);
  });

  it('anything else is null', () => {
    for (const v of ['99', '20001', '1e3', '', ' 200', '200.5', '-200', null])
      expect(e2eRunMs(at(v))).toBeNull();
    expect(e2eRunMs(null)).toBeNull();
  });

  it('null outside an e2e build', () => {
    vi.stubEnv('VITE_E2E', '');
    expect(e2eRunMs(at('200'))).toBeNull();
  });

  it('null when storage throws', () => {
    const s = at('200');
    vi.spyOn(s, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(e2eRunMs(s)).toBeNull();
  });
});
