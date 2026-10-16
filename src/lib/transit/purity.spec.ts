import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src/lib/transit');
const runtime = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

describe('src/lib/transit purity (spec §5)', () => {
  it('imports no zod, $app, svelte or DOM globals', () => {
    expect(runtime.length).toBeGreaterThan(0);
    for (const f of runtime) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, f).not.toMatch(/from ['"](zod|\$app\/|svelte)/);
      expect(src, f).not.toMatch(/\b(document|window|localStorage)\b/);
    }
  });
});
