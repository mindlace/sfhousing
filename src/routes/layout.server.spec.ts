import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { load } from './+layout.server';

function status(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    return (e as { status: number }).status;
  }
  throw new Error('expected load to throw');
}

describe('root layout load', () => {
  it('reads versions from platform env', async () => {
    const result = await load({
      platform: { env: { PUBLIC_DATASET_VERSION: 'fixture-0', PUBLIC_APP_RELEASE: 'dev' } }
    } as never);
    expect(result).toEqual({ datasetVersion: 'fixture-0', appRelease: 'dev' });
  });

  it('defaults only appRelease', async () => {
    const result = await load({
      platform: { env: { PUBLIC_DATASET_VERSION: '2026-10-10-3fa9c2d1' } }
    } as never);
    expect(result).toEqual({ datasetVersion: '2026-10-10-3fa9c2d1', appRelease: 'dev' });
  });

  it('throws 500 when no dataset version is configured', () => {
    expect(status(() => load({} as never))).toBe(500);
  });

  it('throws 500 on an invalid platform dataset version', () => {
    expect(
      status(() => load({ platform: { env: { PUBLIC_DATASET_VERSION: 'bogus' } } } as never))
    ).toBe(500);
  });
});
