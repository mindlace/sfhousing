import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENTRY_MARK, entrySource, wrapWorker } from './worker-entry';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function fakeBuild(): string {
  const root = mkdtempSync(join(tmpdir(), 'worker-entry-'));
  roots.push(root);
  mkdirSync(join(root, '.svelte-kit/cloudflare'), { recursive: true });
  writeFileSync(
    join(root, '.svelte-kit/cloudflare/_worker.js'),
    'import { Server } from "./../output/server/index.js";\nexport default {};\n'
  );
  return root;
}

describe('wrapWorker', () => {
  it('moves the adapter output beside its directory and writes the entry', () => {
    const root = fakeBuild();
    wrapWorker(root);
    expect(readFileSync(join(root, '.svelte-kit/cloudflare-adapter/_worker.js'), 'utf8')).toContain(
      './../output/server/index.js'
    );
    expect(readFileSync(join(root, '.svelte-kit/cloudflare/_worker.js'), 'utf8')).toBe(
      entrySource()
    );
  });

  it('exports the default worker and the SimObject class', () => {
    expect(entrySource().startsWith(ENTRY_MARK)).toBe(true);
    expect(entrySource()).toContain("export { default } from '../cloudflare-adapter/_worker.js';");
    expect(entrySource()).toContain(
      "export { SimObject } from '../../src/lib/server/sim-object/sim-object.ts';"
    );
  });

  it('refuses to wrap twice or without a build', () => {
    const root = fakeBuild();
    wrapWorker(root);
    expect(() => wrapWorker(root)).toThrow(/already wrapped/);
    const empty = mkdtempSync(join(tmpdir(), 'worker-entry-'));
    roots.push(empty);
    expect(() => wrapWorker(empty)).toThrow(/vite build/);
  });
});
