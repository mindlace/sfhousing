import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { load } from './+layout.server';

describe('root layout load', () => {
  it('reads versions from platform env', async () => {
    const result = await load({
      platform: { env: { PUBLIC_DATASET_VERSION: 'fixture-0', PUBLIC_APP_RELEASE: 'dev' } }
    } as never);
    expect(result).toEqual({ datasetVersion: 'fixture-0', appRelease: 'dev' });
  });

  it('falls back to defaults when nothing is configured', async () => {
    const result = await load({} as never);
    expect(result).toEqual({ datasetVersion: 'fixture-0', appRelease: 'dev' });
  });
});
