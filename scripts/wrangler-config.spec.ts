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

  type EnvConfig = {
    migrations: Record<string, unknown>[];
    ratelimits: { name: string }[];
  };
  const envs = {
    production: config as unknown as EnvConfig,
    staging: config.env.staging as unknown as EnvConfig
  };
  const names = ['production', 'staging'] as const;

  it.each(names)('%s has no durable_objects', (name) => {
    expect(envs[name]).not.toHaveProperty('durable_objects');
  });

  it.each(names)(
    '%s keeps v1-sim-object first and ends with v2-delete-sim-object deleting SimObject',
    (name) => {
      const migrations = envs[name].migrations;
      expect(migrations[0]).toEqual({ tag: 'v1-sim-object', new_sqlite_classes: ['SimObject'] });
      expect(migrations.at(-1)).toEqual({
        tag: 'v2-delete-sim-object',
        deleted_classes: ['SimObject']
      });
    }
  );

  it.each(names)('%s rate-limit names are exactly the six', (name) => {
    expect(envs[name].ratelimits.map((r) => r.name).sort()).toEqual([
      'ACCOUNT_EDIT_RL',
      'AUTH_LINK_RL',
      'AUTH_PASSWORD_RL',
      'MUTATION_REGISTERED_RL',
      'PSEUDO_MINT_RL',
      'PUBLISH_RL'
    ]);
  });

  it('has no top-level alias', () => {
    expect(config).not.toHaveProperty('alias');
  });
});
