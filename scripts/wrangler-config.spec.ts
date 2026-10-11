import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from '../src/lib/data/dataset-version';

/** Strips // and block comments outside strings, then trailing commas. */
type Vars = { vars: { PUBLIC_DATASET_VERSION: string } };
type Config = Vars & { env: { staging: Vars } };

function parseJsonc(text: string): Config {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

describe('wrangler.jsonc PUBLIC_DATASET_VERSION', () => {
  const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

  it('is a valid dataset version for production', () => {
    expect(config.vars.PUBLIC_DATASET_VERSION).toMatch(DATASET_VERSION_RE);
  });

  it('is a valid dataset version for staging', () => {
    expect(config.env.staging.vars.PUBLIC_DATASET_VERSION).toMatch(DATASET_VERSION_RE);
  });
});
