// The timeline host's dataset (ensemble-runner Task 3) on fixture-0: the load, the chunk set and
// the compile context the compiler reads.
import { describe, expect, it } from 'vitest';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { createLru } from '$lib/sim/lru';
import type { ChunksResponse } from '$lib/sim/protocol';
import { simInputUrls } from '$lib/sim/world/input/load';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { compileTimeline } from '../policy/compile';
import { staticsOf } from '../statics';
import { createChunkSet, loadDataset, type Dataset, type DatasetDeps } from './dataset';
import { datasetFetch } from './test/harness';

const FIXTURE = 'e2e/fixtures/data/fixture-0';

function depsOf(over: Partial<DatasetDeps> = {}): DatasetDeps {
  const f = datasetFetch(FIXTURE);
  return {
    fetch: f.fetch,
    fetchBytes: f.fetchBytes,
    later: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => 0,
    warn: () => {},
    retryDelaysMs: [],
    maxConcurrent: 4,
    stopped: () => false,
    onChunk: () => {},
    onChunksReport: () => {},
    ...over
  };
}

const GEN = { gen: generate, genForUnits: generateForUnits, logOnce: () => {} };

async function fixture(over: Partial<DatasetDeps> = {}): Promise<Dataset> {
  const { manifest } = datasetFetch(FIXTURE);
  const deps = depsOf(over);
  const chunks = createChunkSet(manifest, deps);
  const ds = await loadDataset(
    manifest,
    simInputUrls(manifest)!,
    chunks,
    deps,
    createLru<string, GeneratedBuilding | null>(1000),
    GEN
  );
  if ('code' in ds) throw new Error(`load failed: ${ds.code} ${ds.message}`);
  return ds;
}

const until = async (pred: () => boolean) => {
  for (let k = 0; k < 1000 && !pred(); k++) await new Promise((r) => setImmediate(r));
  expect(pred()).toBe(true);
};

describe('loadDataset', () => {
  it('gives the CompileCtx a compile accepts', async () => {
    const ds = await fixture();
    const ctx = ds.ctx(24);
    expect(ctx.input).toBe(ds.loaded.fzp);
    expect(ctx.layers).toBe(ds.layers);
    expect(ds.layers).toEqual({
      parcels: ds.loaded.fzp.parcels,
      policy: ds.loaded.policy,
      options: ds.loaded.options
    });
    expect(ctx.windowMonths).toBe(24);
    expect(ds.statics).toEqual(staticsOf(ds.loaded.fzp));
    expect(ds.massing.input).toBe(ds.loaded.fzp);
    expect(compileTimeline(DEFAULT_POLICY4, {}, ctx, 'plan').step(Infinity)).toBe(true);
  });

  it('answers a load failure as the LoadFailure', async () => {
    const { manifest } = datasetFetch(FIXTURE);
    const deps = depsOf({ load: async () => ({ code: 'scenario-invalid', message: 'bad' }) });
    const r = await loadDataset(
      manifest,
      simInputUrls(manifest)!,
      createChunkSet(manifest, deps),
      deps,
      createLru(10),
      GEN
    );
    expect(r).toEqual({ code: 'scenario-invalid', message: 'bad' });
  });
});

describe('createChunkSet', () => {
  it('loads wanted cells into byCell and records, and reports', async () => {
    const { manifest } = datasetFetch(FIXTURE);
    const chunked: string[] = [];
    const reports: ChunksResponse[] = [];
    const set = createChunkSet(
      manifest,
      depsOf({ onChunk: (c) => chunked.push(c), onChunksReport: (r) => reports.push(r) })
    );
    const cell = manifest.chunks[0].cellId;
    set.want([cell]);
    expect(set.wanted).toEqual(new Set([cell]));
    await until(() => chunked.length === 1);
    expect(chunked).toEqual([cell]);
    const recs = set.byCell.get(cell)!;
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(set.records.get(r.id)).toBe(r);
    expect(reports.at(-1)).toMatchObject({ type: 'chunks', pending: 0, failed: [] });
    // `wantAlso` loads without joining `wanted` (the stream's cellsFor input)
    const other = manifest.chunks[1].cellId;
    set.wantAlso([other]);
    await until(() => chunked.length === 2);
    expect(chunked).toEqual([cell, other]);
    expect(set.wanted).toEqual(new Set([cell]));
    set.dispose();
  });

  it('a stopped set takes no chunk', async () => {
    const { manifest } = datasetFetch(FIXTURE);
    const reports: ChunksResponse[] = [];
    const set = createChunkSet(
      manifest,
      depsOf({ stopped: () => true, onChunksReport: (r) => reports.push(r) })
    );
    set.prefetch(manifest.chunks[0].bbox);
    for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r));
    expect(set.byCell.size).toBe(0);
    expect(reports).toEqual([]);
  });
});
