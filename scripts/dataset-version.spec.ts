import { describe, expect, it } from 'vitest';
import { datasetVersionFor } from './dataset-version';
import type { WranglerConfig } from './lib/wrangler-config';

const config: WranglerConfig = {
  vars: { PUBLIC_DATASET_VERSION: '2026-10-10-3fa9c2d1' },
  env: { staging: { vars: { PUBLIC_DATASET_VERSION: '2026-10-11-aaaaaaaa' } } }
};

describe('datasetVersionFor', () => {
  it('reads staging from env.staging.vars', () => {
    expect(datasetVersionFor(config, 'staging')).toBe('2026-10-11-aaaaaaaa');
  });

  it('reads production from the top-level vars', () => {
    expect(datasetVersionFor(config, 'production')).toBe('2026-10-10-3fa9c2d1');
  });
});
