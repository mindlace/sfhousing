import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this file, not process.cwd(), so the guard works under --root.
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const ALLOWED = new Set(['geo.ts', 'determinism.spec.ts']);
// Built from parts so this file never matches itself.
const BANNED = new RegExp('Math\\.' + '(sin|cos|atan2|pow|exp)\\b');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('numeric determinism guard (AC4)', () => {
  it('no Math.sin/cos/atan2/pow/exp outside geo.ts', () => {
    const offenders = walk(ROOT)
      .filter((p) => !ALLOWED.has(relative(ROOT, p)))
      .filter((p) => BANNED.test(readFileSync(p, 'utf8')))
      .map((p) => relative(ROOT, p));
    expect(offenders).toEqual([]);
  });
});
