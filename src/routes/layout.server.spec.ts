import { describe, expect, it, vi } from 'vitest';
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ dev: false }));

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
  it('serves the built version', async () => {
    const result = await load({} as never);
    expect(result).toEqual({ datasetVersion: __SFH_DATASET_VERSION__, appRelease: 'dev' });
    expect(__SFH_DATASET_VERSION__).toMatch(DATASET_VERSION_RE);
  });

  it('ignores the override outside development', async () => {
    const result = await load({
      platform: { env: { ENVIRONMENT: 'production', PUBLIC_DATASET_VERSION: 'fixture-0' } }
    } as never);
    expect(result).toEqual({ datasetVersion: __SFH_DATASET_VERSION__, appRelease: 'dev' });
  });

  it('honours the override when ENVIRONMENT is development', async () => {
    const result = await load({
      platform: { env: { ENVIRONMENT: 'development', PUBLIC_DATASET_VERSION: 'fixture-0' } }
    } as never);
    expect(result).toEqual({ datasetVersion: 'fixture-0', appRelease: 'dev' });
  });

  it('throws 500 on a malformed override in development', () => {
    expect(
      status(() =>
        load({
          platform: { env: { ENVIRONMENT: 'development', PUBLIC_DATASET_VERSION: 'bogus' } }
        } as never)
      )
    ).toBe(500);
  });
});
