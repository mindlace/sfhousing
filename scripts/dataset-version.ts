import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseJsonc, type WranglerConfig } from './lib/wrangler-config';

export type DeployEnv = 'production' | 'staging';

/** The PUBLIC_DATASET_VERSION a deploy of `env` ships (staging: env.staging.vars, production: vars). */
export function datasetVersionFor(config: WranglerConfig, env: DeployEnv): string {
  return env === 'staging'
    ? config.env.staging.vars.PUBLIC_DATASET_VERSION
    : config.vars.PUBLIC_DATASET_VERSION;
}

function main(arg: string | undefined): void {
  if (arg !== 'production' && arg !== 'staging') {
    throw new Error('usage: dataset-version.ts <production|staging>');
  }
  const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  process.stdout.write(`${datasetVersionFor(config, arg)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]);
