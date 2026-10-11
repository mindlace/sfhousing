import { describe, expect, it } from 'vitest';
import { wranglerTarget, type RunFn } from '../lib/r2';

function fakeRun(result: { code: number; stdout?: string; stderr?: string }) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const run: RunFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, input: opts?.input });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.code };
  };
  return { calls, run };
}

describe('wranglerTarget.get', () => {
  it('runs `r2 object get <bucket>/<key> --file <f> --remote` with stdin closed', async () => {
    const { calls, run } = fakeRun({ code: 0 });
    expect(await wranglerTarget({ local: false, run }).get('sources/ab.geojson', '/tmp/f')).toBe(
      true
    );
    expect(calls[0].args).toEqual([
      'r2',
      'object',
      'get',
      'sfhousing/sources/ab.geojson',
      '--file',
      '/tmp/f',
      '--remote'
    ]);
    expect(calls[0].input).toBe('');
  });

  it('uses --local and a custom bucket', async () => {
    const { calls, run } = fakeRun({ code: 0 });
    await wranglerTarget({ local: true, bucket: 'b', run }).get('k', '/tmp/f');
    expect(calls[0].args.slice(3)).toEqual(['b/k', '--file', '/tmp/f', '--local']);
  });

  it('maps the pinned not-found text (with ANSI codes) to false', async () => {
    const { run } = fakeRun({
      code: 1,
      stderr:
        '\u001b[31m✘ \u001b[41;31m[ERROR]\u001b[0m \u001b[1mThe specified key does not exist.\u001b[0m\n'
    });
    expect(await wranglerTarget({ local: true, run }).get('k', '/tmp/nonexistent-f')).toBe(false);
  });

  it('throws on any other failure, never treating an auth error as not-found', async () => {
    const { run } = fakeRun({ code: 1, stderr: 'Authentication error [code: 10000]' });
    await expect(wranglerTarget({ local: false, run }).get('k', '/tmp/f')).rejects.toThrow(
      /Authentication error/
    );
  });
});

describe('wranglerTarget.put/exists', () => {
  it('puts with content-type and cache-control', async () => {
    const { calls, run } = fakeRun({ code: 0 });
    await wranglerTarget({ local: false, run }).put(
      'data/v/m.json',
      '/tmp/m',
      'application/json',
      'cc'
    );
    expect(calls[0].args).toEqual([
      'r2',
      'object',
      'put',
      'sfhousing/data/v/m.json',
      '--file',
      '/tmp/m',
      '--content-type',
      'application/json',
      '--cache-control',
      'cc',
      '--remote'
    ]);
  });

  it('put throws on failure; exists is false only on not-found', async () => {
    await expect(
      wranglerTarget({ local: false, run: fakeRun({ code: 1, stderr: 'nope' }).run }).put(
        'k',
        'f',
        'a',
        'b'
      )
    ).rejects.toThrow(/nope/);
    const nf = fakeRun({ code: 1, stderr: 'The specified key does not exist.' });
    expect(await wranglerTarget({ local: true, run: nf.run }).exists('k')).toBe(false);
    expect(await wranglerTarget({ local: true, run: fakeRun({ code: 0 }).run }).exists('k')).toBe(
      true
    );
  });
});
