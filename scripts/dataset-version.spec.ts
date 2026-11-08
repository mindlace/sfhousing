import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { STAGING_ORIGIN } from '../pipeline/config';
import { treeDatasetVersion } from '../pipeline/lib/version';
import { parseVersionArgs } from './dataset-version';

const root = fileURLToPath(new URL('..', import.meta.url));

// Moved from scripts/wrangler-config.spec.ts. Versions are date-prefixed, so the date orders them.
/** The first dataset with policy.bin (plan 1); /sim needs it. */
const MIN_SIM_DATASET = '2026-10-29-0fd62c4d';

describe('parseVersionArgs', () => {
  it.each([
    [[], {}],
    [['--check'], { check: STAGING_ORIGIN }],
    [['--check', 'https://x'], { check: 'https://x' }]
  ])('parses %j', (argv, want) => {
    expect(parseVersionArgs(argv)).toEqual(want);
  });
  it('rejects unknown arguments', () => {
    expect(parseVersionArgs(['staging'])).toHaveProperty('usage');
  });
});

describe('this tree', () => {
  it('computes a dataset /sim can run', async () => {
    const v = await treeDatasetVersion(root);
    expect(v.slice(0, 10) >= MIN_SIM_DATASET.slice(0, 10)).toBe(true);
  });
});
