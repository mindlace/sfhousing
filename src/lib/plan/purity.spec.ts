import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src/lib/plan');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const all = walk(ROOT);
const runtime = all.filter(
  (p) => !p.endsWith('.spec.ts') && !relative(ROOT, p).startsWith('fixtures')
);

describe('src/lib/plan purity', () => {
  it('has no trig anywhere (spec §4.1, acceptance 7)', () => {
    const trig = new RegExp(['Math\\.co', 's|Math\\.si', 'n|Math\\.hyp', 'ot'].join(''));
    const self = join(ROOT, 'purity.spec.ts');
    const offenders = all.filter((p) => p !== self && trig.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('runtime code avoids nondeterministic APIs (spec §4.10)', () => {
    const bad = /Math\.random|\bDate\b|localeCompare/;
    expect(runtime.filter((p) => bad.test(readFileSync(p, 'utf8')))).toEqual([]);
  });

  it('runtime code imports only kdbush, siblings, I6 types and DATASET_VERSION_RE (acceptance 1)', () => {
    const problems: string[] = [];
    for (const p of runtime) {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)';/gms)) {
        const [, typeOnly, what, spec] = m;
        const ok =
          spec === 'kdbush' ||
          (spec.startsWith('./') && !spec.includes('fixtures')) ||
          (spec === '../data/parcel' && typeOnly) ||
          (spec === '../data/manifest' && what.trim() === '{ DATASET_VERSION_RE }');
        if (!ok) problems.push(`${relative(ROOT, p)}: ${m[0]}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
