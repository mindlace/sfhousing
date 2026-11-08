import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJsonc } from './lib/wrangler-config';

describe('parseJsonc', () => {
  it('throws on an unterminated string instead of looping', () => {
    expect(() => parseJsonc('{"a": "oops')).toThrow(/Unterminated/);
  });
});

describe('wrangler.jsonc', () => {
  const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  it('sets no PUBLIC_DATASET_VERSION for production (the build computes it)', () =>
    expect(config.vars).not.toHaveProperty('PUBLIC_DATASET_VERSION'));
  it('sets no PUBLIC_DATASET_VERSION for staging', () =>
    expect(config.env.staging.vars).not.toHaveProperty('PUBLIC_DATASET_VERSION'));
});
