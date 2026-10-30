import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from '../src/lib/data/dataset-version';
import { parseJsonc } from './lib/wrangler-config';

/** A version from a real dataset upload: date plus content hash, never `fixture-*`. */
const REAL_DATASET_VERSION_RE = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

/** The first dataset with policy.bin and frontage.bin (plan 1); /sim needs both. */
const MIN_SIM_DATASET = '2026-10-29-0fd62c4d';

describe('REAL_DATASET_VERSION_RE', () => {
  it('accepts a real version and rejects a fixture one', () => {
    expect(REAL_DATASET_VERSION_RE.test('2026-10-10-3fa9c2d1')).toBe(true);
    expect(REAL_DATASET_VERSION_RE.test('fixture-0')).toBe(false);
  });
});

describe('parseJsonc', () => {
  it('throws on an unterminated string instead of looping', () => {
    expect(() => parseJsonc('{"a": "oops')).toThrow(/Unterminated/);
  });
});

describe('wrangler.jsonc PUBLIC_DATASET_VERSION', () => {
  const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

  it('is a valid dataset version for production', () => {
    expect(config.vars.PUBLIC_DATASET_VERSION).toMatch(DATASET_VERSION_RE);
  });

  it('is a valid dataset version for staging', () => {
    expect(config.env.staging.vars.PUBLIC_DATASET_VERSION).toMatch(DATASET_VERSION_RE);
  });

  it('production uses a real (non-fixture) dataset version — enable after X1 real upload bumps wrangler vars', () => {
    expect(config.vars.PUBLIC_DATASET_VERSION).toMatch(REAL_DATASET_VERSION_RE);
  });

  it('staging uses a real (non-fixture) dataset version — enable after X1 real upload bumps wrangler vars', () => {
    expect(config.env.staging.vars.PUBLIC_DATASET_VERSION).toMatch(REAL_DATASET_VERSION_RE);
  });

  // Versions are date-prefixed (DATASET_VERSION_RE), so the date orders them.
  it('production serves a dataset /sim can run', () => {
    const v: string = config.vars.PUBLIC_DATASET_VERSION;
    expect(v.slice(0, 10) >= MIN_SIM_DATASET.slice(0, 10)).toBe(true);
  });

  it('staging serves a dataset /sim can run', () => {
    const v: string = config.env.staging.vars.PUBLIC_DATASET_VERSION;
    expect(v.slice(0, 10) >= MIN_SIM_DATASET.slice(0, 10)).toBe(true);
  });
});
