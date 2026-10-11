import { describe, expect, it } from 'vitest';
import { doctor } from '../steps/doctor';

const fakeRun = (outputs: Record<string, string>) => async (cmd: string, args: string[]) => {
  const key = [cmd, ...args].join(' ');
  if (!(key in outputs)) return { stdout: '', stderr: 'not found', code: 127 };
  return { stdout: outputs[key], stderr: '', code: 0 };
};

describe('doctor', () => {
  it('passes with pinned tools, accepting brew version when pmtiles prints dev', async () => {
    const checks = await doctor({
      nodeVersion: 'v24.2.0',
      which: async (c) => `/opt/homebrew/bin/${c}`,
      run: fakeRun({
        'tippecanoe --version': 'tippecanoe v2.79.0\n',
        'pmtiles version': 'pmtiles dev, commit none, built at unknown\n',
        'brew list --versions pmtiles': 'pmtiles 1.31.2\n',
        'npx wrangler --version': '4.114.0\n'
      })
    });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('fails with an install hint when tippecanoe is missing or the wrong version', async () => {
    const checks = await doctor({
      nodeVersion: 'v20.1.0',
      which: async (c) => (c === 'tippecanoe' ? null : `/bin/${c}`),
      run: fakeRun({ 'pmtiles version': 'pmtiles 1.30.0', 'npx wrangler --version': '4' })
    });
    const failed = Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.name, c.hint]));
    expect(failed.node).toMatch(/22/);
    expect(failed.tippecanoe).toMatch(/brew install tippecanoe/);
    expect(failed.pmtiles).toMatch(/brew install pmtiles/);
  });
});
