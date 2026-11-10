import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = dirname(fileURLToPath(import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []
  );
}

const FILES = tsFiles(DIR);

describe('worker-safe imports', () => {
  it('finds the module files', () => {
    const names = FILES.map((f) => f.slice(DIR.length + 1));
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('evidence.ts');
    expect(names).toContain('prototypes.ts');
  });
  it('imports only by relative path and no page, framework or DOM module', () => {
    for (const f of FILES) {
      const text = readFileSync(f, 'utf8');
      const specs = [
        ...[...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]),
        ...[...text.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1])
      ];
      for (const s of specs) {
        // spec files may import the test runner and node built-ins
        if (!f.endsWith('.spec.ts')) {
          expect(s.startsWith('./') || s.startsWith('../'), `${f}: ${s}`).toBe(true);
        }
        for (const bad of ['sim-page', '$lib', 'svelte', 'zod']) {
          expect(s.includes(bad), `${f}: ${s}`).toBe(false);
        }
      }
    }
  });
  it('uses no locale formatting or DOM globals', () => {
    for (const f of FILES) {
      if (f.endsWith('imports.spec.ts')) continue;
      const text = readFileSync(f, 'utf8');
      for (const bad of ['Intl.', 'toLocaleString', 'document.', 'window.']) {
        expect(text.includes(bad), `${f}: ${bad}`).toBe(false);
      }
    }
  });
});
