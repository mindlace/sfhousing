import { join } from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const ROOT = process.cwd();

it('rejects Math.exp, Math.log and ** under src/lib/sim/world', async () => {
  const [r] = await new ESLint({ cwd: ROOT }).lintText(
    'export const a = Math.exp(1) + Math.log(2) + 2 ** 3;\n',
    { filePath: join(ROOT, 'src/lib/sim/world/probe.ts') }
  );
  const ids = r.messages.map((m) => m.ruleId);
  expect(ids.filter((x) => x === 'no-restricted-properties')).toHaveLength(2);
  expect(ids).toContain('no-restricted-syntax');
});
