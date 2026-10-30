// `npx tsx scripts/bench-levers.ts <datasetDir>` (sim-page plan Task 11): resolve three citywide
// brushes on a built dataset read from disk, then time the touched-lot yield recompute, the way
// the scenario host runs it (resolveEnvelopes -> allNeeds -> createYieldRecompute -> fillNeeds ->
// applyLevers). Not part of the bundle; prints a Markdown table.
import { readFileSync, statSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { readFrontage } from '../src/lib/data/frontage-codec';
import { parseManifest } from '../src/lib/data/manifest';
import type { ParcelId, ParcelRecord } from '../src/lib/data/parcel';
import { decodeParcelChunk } from '../src/lib/data/parcel-chunk';
import { scenarioRecordOf } from '../src/lib/data/scenario-codec';
import { scenarioYield } from '../src/lib/data/scenario-yield';
import { decodeTransit } from '../src/lib/data/transit-codec';
import { HORIZON } from '../src/lib/fzp/time';
import { defaultEffect } from '../src/lib/sim-page/policy';
import { applyLevers } from '../src/lib/sim/levers/apply';
import {
  brushCatalog,
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData,
  type BrushQuery
} from '../src/lib/sim/levers/brushes';
import { createYieldRecompute, type GrossCache } from '../src/lib/sim/levers/recompute';
import { allNeeds, fillNeeds, resolveEnvelopes } from '../src/lib/sim/levers/resolve';
import { CURRENT_LAW_SWITCH, DEFAULT_LEVERS, type SimLevers } from '../src/lib/sim/levers/types';
import { loadScenario, scenarioUrls } from '../src/lib/sim/scenario/load';

type Brush = { name: string; query: BrushQuery; mode: 'raise' | 'set'; stories: number };

const ms = (t: number) => Math.round(t).toLocaleString('en-US');

async function main(): Promise<number> {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: npx tsx scripts/bench-levers.ts <datasetDir>');
    return 2;
  }
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  const prefix = `/data/${manifest.datasetVersion}/`;
  /** A manifest URL's file in `dir`. */
  const pathOf = (url: string) => {
    if (!url.startsWith(prefix)) throw new Error(`${url} is not under ${prefix}`);
    return join(dir, url.slice(prefix.length));
  };
  const urls = scenarioUrls(manifest);
  if (!urls?.policy || !urls.frontage)
    throw new Error('manifest has no policy.bin or frontage.bin');
  const bytes = (url: string) => {
    const b = readFileSync(pathOf(url));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  const tLoad = performance.now();
  const loaded = await loadScenario(
    {
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(pathOf(url), 'utf8'))
      }),
      fetchBytes: async (url) => ({ ok: true, status: 200, arrayBuffer: async () => bytes(url) }),
      setTimeout: (fn, t) => setTimeout(fn, t),
      retryDelaysMs: [],
      warn: (msg) => console.warn(`[load] ${msg}`)
    },
    urls,
    () => false,
    { policy: true }
  );
  if (!('fzp' in loaded)) throw new Error(`load failed: ${loaded.code}: ${loaded.message}`);
  const parcels = loaded.fzp.parcels;
  const policy = loaded.policy!;
  const data: BrushData = {
    parcels,
    policy,
    frontage: await readFrontage(new Uint8Array(bytes(urls.frontage)), parcels),
    transit: decodeTransit(JSON.parse(readFileSync(pathOf(manifest.transit!), 'utf8'))),
    neighborhoods: parseNeighborhoods(
      JSON.parse(readFileSync(pathOf(manifest.neighborhoods), 'utf8'))
    )
  };
  console.log(`loaded ${manifest.datasetVersion} in ${ms(performance.now() - tLoad)} ms`);

  const chunkUrl = new Map(manifest.chunks.map((c) => [c.cellId, c.url]));
  const catalog = brushCatalog(data);
  const rh1 = catalog.districts.find((d) => d.family === 'RH-1');
  if (!rh1) throw new Error('no RH-1 family in the catalog');
  const brushes: Brush[] = [
    {
      name: '(a) every `RH-1` family lot, raise to 4, limits off',
      query: { kind: 'area', districts: rh1.codes.map((c) => c.code), neighborhoods: [] },
      mode: 'raise',
      stories: 4
    },
    {
      name: '(b) arterial frontage depth 1, set to 8 (limits on)',
      query: { kind: 'street', classes: ['arterial'], names: [], depth: 1, ncOnly: false },
      mode: 'set',
      stories: 8
    },
    {
      name: '(c) `regionalRail` within 805 m, raise to 8 (limits off)',
      query: { kind: 'transit', stopTypes: ['regionalRail'], maxM: 805 },
      mode: 'raise',
      stories: 8
    }
  ];

  const ctx = { parcels, policy };
  const window = {
    asOf: loaded.fzp.asOf,
    horizon: HORIZON,
    switchDay: CURRENT_LAW_SWITCH.day
  };
  /** One brush, measured: a fresh lot index and gross cache each time (cold data, not cold JIT). */
  const measure = (b: Brush): string[] => {
    // a fresh lot index each time (the host builds one per session)
    const t0 = performance.now();
    const index = createLotIndex(parcels);
    const lotRows = resolveBrushRows(data, index, b.query);
    const resolveMs = performance.now() - t0;

    const effect = defaultEffect(b.mode, b.stories);
    const levers: SimLevers = structuredClone(DEFAULT_LEVERS);
    levers.user.push({ lots: lotRows.map((r) => parcels.id[r] as ParcelId), ...effect });

    const t1 = performance.now();
    const resolution = resolveEnvelopes(ctx, levers, window);
    const needs = allNeeds(resolution);
    const envMs = performance.now() - t1;

    // the cells the recompute waits on, then their chunks as the loader would fetch them
    const records = new Map<ParcelId, ParcelRecord>();
    const loadedCells = new Set<string>();
    const deps = {
      record: (id: ParcelId) => records.get(id),
      cellLoaded: (c: string) => loadedCells.has(c),
      now: () => performance.now()
    };
    const gross: GrossCache = new Map();
    const recompute = createYieldRecompute(parcels, needs, deps, gross);
    const cells = recompute.cellsNeeded();
    let chunkBytes = 0;
    for (const c of cells) {
      const p = pathOf(chunkUrl.get(c)!);
      chunkBytes += statSync(p).size;
      for (const r of decodeParcelChunk(JSON.parse(readFileSync(p, 'utf8')))) records.set(r.id, r);
      loadedCells.add(c);
    }

    const t2 = performance.now();
    if (!recompute.step(Infinity)) throw new Error('recompute did not finish');
    const recomputeMs = performance.now() - t2;

    // The scenarioYield share, estimated: replay every gross the recompute computed (the cache
    // holds them). The replay runs on warmer code and caches but without the recompute's
    // interleaving, so "other" (recompute minus replay) can be off in either direction.
    const t3 = performance.now();
    for (const key of gross.keys()) {
      const [row, s] = key.split(':').map(Number);
      const rec = records.get(parcels.id[row] as ParcelId);
      if (rec) scenarioYield(scenarioRecordOf(parcels, row, rec), s, null);
    }
    const yieldMs = performance.now() - t3;

    const t4 = performance.now();
    const filled = fillNeeds(resolution, recompute.result());
    applyLevers(loaded.fzp, ctx, levers, filled, HORIZON);
    const applyMs = performance.now() - t4;

    return [
      b.name,
      lotRows.length.toLocaleString('en-US'),
      ms(resolveMs),
      ms(envMs),
      needs.length.toLocaleString('en-US'),
      cells.length.toLocaleString('en-US'),
      `${(chunkBytes / 1e6).toFixed(1)} MB`,
      ms(recomputeMs),
      ms(yieldMs),
      ms(Math.max(0, recomputeMs - yieldMs)),
      gross.size.toLocaleString('en-US'),
      recompute.missing.length.toLocaleString('en-US'),
      ms(applyMs)
    ];
  };
  // A warm-up pass over every brush first, so each measured brush runs on a warmed-up JIT.
  for (const b of brushes) measure(b);
  const rows = brushes.map(measure);

  const head = [
    'Brush',
    'Lots',
    'Resolve ms',
    'resolveEnvelopes ms',
    'Needs (unique)',
    'Cells',
    'Chunk bytes',
    'Recompute ms',
    'scenarioYield ms (est.)',
    'Other ms (est.)',
    'Gross computed',
    'Missing',
    'fillNeeds + applyLevers ms'
  ];
  console.log(`\n| ${head.join(' | ')} |`);
  console.log(`| ${head.map(() => '---').join(' | ')} |`);
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
  console.log(
    `\nNode ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'} (${cpus().length} cores), ` +
      `${Math.round(totalmem() / 2 ** 30)} GB, ${new Date().toISOString().slice(0, 10)}`
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
