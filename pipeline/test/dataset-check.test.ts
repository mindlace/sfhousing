import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  datasetServed,
  manifestUrl,
  missingDatasetHelp,
  versionCommand
} from '../lib/dataset-check';
import { treeDatasetVersion } from '../lib/version';
import { tempRepo, writeLock } from './helpers/temp-repo';

const V = '2026-10-10-3fa9c2d1';
const O = 'https://h';

function fakeFetch(statuses: (number | 'throw')[]) {
  const calls: { method?: string }[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (s === 'throw') throw new Error('network');
    return new Response(null, { status: s });
  }) as typeof fetch;
  return { f, calls };
}

describe('datasetServed', () => {
  it('manifestUrl adds a cache-busting query and tolerates a trailing slash', () => {
    expect(manifestUrl('https://h/', V, 5)).toBe(`https://h/data/${V}/manifest.json?check=5`);
  });
  it('200 is served, with one HEAD request', async () => {
    const { f, calls } = fakeFetch([200]);
    expect(await datasetServed(V, O, { fetch: f, delayMs: 0 })).toBe('served');
    expect(calls).toEqual([{ method: 'HEAD' }]);
  });
  it('404 is missing without retrying', async () => {
    const { f, calls } = fakeFetch([404]);
    expect(await datasetServed(V, O, { fetch: f, delayMs: 0 })).toBe('missing');
    expect(calls.length).toBe(1);
  });
  it('5xx then 200 retries and is served', async () => {
    const { f, calls } = fakeFetch([503, 200]);
    expect(await datasetServed(V, O, { fetch: f, delayMs: 0 })).toBe('served');
    expect(calls.length).toBe(2);
  });
  it('network errors on every attempt are unreachable', async () => {
    const { f, calls } = fakeFetch(['throw']);
    expect(await datasetServed(V, O, { fetch: f, delayMs: 0, attempts: 3 })).toBe('unreachable');
    expect(calls.length).toBe(3);
  });
  it('passes an abort signal and treats a hanging host as unreachable after retrying', async () => {
    let calls = 0;
    const hang = ((_u: string | URL | Request, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('timeout')));
      });
    }) as typeof fetch;
    expect(await datasetServed(V, O, { fetch: hang, delayMs: 0, attempts: 2, timeoutMs: 10 })).toBe(
      'unreachable'
    );
    expect(calls).toBe(2);
  });
  it('missingDatasetHelp names build, upload <v> and verify <v> --origin <origin> in order', () => {
    const t = missingDatasetHelp(V, O);
    expect(t.indexOf('pipeline -- build')).toBeGreaterThanOrEqual(0);
    expect(t.indexOf('pipeline -- build')).toBeLessThan(t.indexOf(`upload ${V}`));
    expect(t.indexOf(`upload ${V}`)).toBeLessThan(t.indexOf(`verify ${V} --origin ${O}`));
    expect(t).toContain('npm run signoff');
    expect(t).toContain('Finishing a branch that changes the dataset');
  });
});

describe('versionCommand', () => {
  function setup() {
    const { dir } = tempRepo();
    writeLock(dir);
    const out: string[] = [];
    const err: string[] = [];
    return {
      dir,
      out,
      err,
      io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }
    };
  }

  it('prints the version and returns 0 without --check', async () => {
    const { dir, out, io } = setup();
    expect(await versionCommand({ repoRoot: dir, ...io })).toBe(0);
    expect(out).toEqual([await treeDatasetVersion(dir)]);
  });
  it('--check returns 0 when served', async () => {
    const { dir, io } = setup();
    const { f } = fakeFetch([200]);
    expect(await versionCommand({ repoRoot: dir, check: O, fetch: f, delayMs: 0, ...io })).toBe(0);
  });
  it('--check prints the recipe and returns 1 when missing', async () => {
    const { dir, err, io } = setup();
    const v = await treeDatasetVersion(dir);
    const { f } = fakeFetch([404]);
    expect(await versionCommand({ repoRoot: dir, check: O, fetch: f, delayMs: 0, ...io })).toBe(1);
    expect(err.join('\n')).toContain(`upload ${v}`);
  });
  it('--check returns 1 on a dirty tree without requesting', async () => {
    const { dir, err, io } = setup();
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 99;\n');
    const { f, calls } = fakeFetch([200]);
    expect(await versionCommand({ repoRoot: dir, check: O, fetch: f, delayMs: 0, ...io })).toBe(1);
    expect(calls.length).toBe(0);
    expect(err.join('\n')).toContain('pipeline/a.ts');
  });
  it('--check reports unreachable without the recipe', async () => {
    const { dir, err, io } = setup();
    const { f } = fakeFetch(['throw']);
    expect(await versionCommand({ repoRoot: dir, check: O, fetch: f, delayMs: 0, ...io })).toBe(1);
    expect(err.join('\n')).toContain('could not reach');
    expect(err.join('\n')).not.toContain('upload');
  });
});
