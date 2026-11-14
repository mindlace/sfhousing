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
    expect(result).toEqual({
      datasetVersion: __SFH_DATASET_VERSION__,
      appRelease: 'dev',
      user: null
    });
    expect(__SFH_DATASET_VERSION__).toMatch(DATASET_VERSION_RE);
  });

  it('ignores the override outside development', async () => {
    const result = await load({
      platform: { env: { ENVIRONMENT: 'production', PUBLIC_DATASET_VERSION: 'fixture-0' } }
    } as never);
    expect(result).toEqual({
      datasetVersion: __SFH_DATASET_VERSION__,
      appRelease: 'dev',
      user: null
    });
  });

  it('honours the override when ENVIRONMENT is development', async () => {
    const result = await load({
      platform: { env: { ENVIRONMENT: 'development', PUBLIC_DATASET_VERSION: 'fixture-0' } }
    } as never);
    expect(result).toEqual({ datasetVersion: 'fixture-0', appRelease: 'dev', user: null });
  });

  it('passes the signed-in user through from locals', async () => {
    const user = { id: 'ident-1', email: 'alice@example.com', handle: 'alice' };
    const result = await load({ locals: { user } } as never);
    expect(result).toEqual({ datasetVersion: __SFH_DATASET_VERSION__, appRelease: 'dev', user });
  });

  it('serves user: null to a signed-out visitor', async () => {
    const result = await load({ locals: { user: null } } as never);
    expect(result).toMatchObject({ user: null });
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
