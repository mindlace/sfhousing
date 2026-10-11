import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

describe('docs index', () => {
  it('links every docs/dev/*.md file from CLAUDE.md', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    const docs = readdirSync(join(root, 'docs/dev')).filter((f) => f.endsWith('.md'));
    expect(docs.length).toBeGreaterThan(0);
    const missing = docs.filter((f) => !claude.includes(`](docs/dev/${f})`));
    expect(missing).toEqual([]);
  });
});
