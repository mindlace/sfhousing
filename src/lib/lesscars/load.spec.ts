import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadLessCars } from './load';

const ROOT = join(process.cwd(), 'e2e/fixtures/data');

type Opts = {
  dropLessCars?: boolean;
  dropFzp?: boolean;
  status?: Record<string, number>;
  patch?: Record<string, (json: Record<string, unknown>) => unknown>;
};

function fixtureFetch(opts: Opts = {}) {
  return async (url: string): Promise<Response> => {
    const rel = url.replace(/^\/data\//, '');
    const base = rel.split('/').pop() as string;
    const status = opts.status?.[base];
    if (status) return new Response('', { status });
    let text: string;
    try {
      text = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      return new Response('', { status: 404 });
    }
    let json = JSON.parse(text);
    if (base === 'manifest.json') {
      if (opts.dropLessCars) delete json.scenarios.lesscars;
      // The schema requires fzp whenever scenarios exists, so no fzp means no scenarios at all.
      if (opts.dropFzp) delete json.scenarios;
    }
    const patch = opts.patch?.[base];
    if (patch) json = patch(json);
    return new Response(JSON.stringify(json), { status: 200 });
  };
}

describe('loadLessCars', () => {
  it('ready on fixture-0 with the parsed files', async () => {
    const r = await loadLessCars('fixture-0', fixtureFetch());
    expect(r.state).toBe('ready');
    if (r.state !== 'ready') return;
    expect(r.data.summary.planId).toBe(r.data.plan.plan.id);
    expect(r.data.sites.sites.map((s) => s.siteId)).toEqual(['lc:hwy:1', 'lc:hwy:2', 'lc:hwy:3']);
    expect(r.data.manifest.datasetVersion).toBe('fixture-0');
    expect(r.data.calibration).toBeTruthy();
  });

  it('no-scenario without scenarios.lesscars or scenarios.fzp', async () => {
    const a = await loadLessCars('fixture-0', fixtureFetch({ dropLessCars: true }));
    const b = await loadLessCars('fixture-0', fixtureFetch({ dropFzp: true }));
    expect(a).toEqual({ state: 'no-scenario', datasetVersion: 'fixture-0' });
    expect(b.state).toBe('no-scenario');
  });

  it('error on a 404, a bad file, or a datasetVersion mismatch', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const f of [
      fixtureFetch({ status: { 'summary.json': 404 } }),
      fixtureFetch({ patch: { 'plan.json': (j) => ({ ...j, format: 'x' }) } }),
      fixtureFetch({ patch: { 'sites.json': (j) => ({ ...j, datasetVersion: 'other' }) } })
    ]) {
      const r = await loadLessCars('fixture-0', f);
      expect(r.state).toBe('error');
      if (r.state === 'error') {
        expect(r.datasetVersion).toBe('fixture-0');
        expect(r.message.length).toBeGreaterThan(0);
      }
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('error, never a throw, when the manifest is missing or the fetch rejects', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await loadLessCars('fixture-0', fixtureFetch({ status: { 'manifest.json': 500 } }));
    const b = await loadLessCars('fixture-0', () => Promise.reject(new Error('offline')));
    expect(a.state).toBe('error');
    expect(b.state).toBe('error');
    spy.mockRestore();
  });
});
