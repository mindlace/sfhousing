// `npx tsx scripts/bench-levers.ts <datasetDir>` (sim-page plan Task 11): resolve three citywide
// brushes on a built dataset read from disk, each as a zoning rule (max(FZP, N), uncapped where it
// raises), then time the steps the timeline host runs (resolveEnvelopes -> applyLevers ->
// precomputeOf). A lot's homes at any envelope are its options' (options.bin), so no step reads
// parcel chunks. Not part of the bundle; prints a Markdown table.
import { readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseManifest } from '../src/lib/data/manifest';
import type { ParcelId } from '../src/lib/data/parcel';
import { decodeTransit } from '../src/lib/data/transit-codec';
import { applyLevers } from '../src/lib/sim/levers/apply';
import {
  brushCatalog,
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData,
  type BrushQuery
} from '../src/lib/sim/levers/brushes';
import { resolveEnvelopes } from '../src/lib/sim/levers/resolve';
import { DEFAULT_LEVERS, type SimLevers } from '../src/lib/sim/levers/types';
import { precomputeOf } from '../src/lib/sim/world/input/build';
import { loadSimInput, simInputUrls } from '../src/lib/sim/world/input/load';

/** A brush compiled to one rule: every lot it resolves takes max(FZP, stories). */
type Brush = { name: string; query: BrushQuery; stories: number };

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
  const urls = simInputUrls(manifest);
  if (!urls?.policy || !urls.options) throw new Error('manifest has no policy.bin or options.bin');
  const bytes = (url: string) => {
    const b = readFileSync(pathOf(url));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  const tLoad = performance.now();
  const loaded = await loadSimInput(
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
    () => false
  );
  if (!('fzp' in loaded)) throw new Error(`load failed: ${loaded.code}: ${loaded.message}`);
  const parcels = loaded.fzp.parcels;
  const policy = loaded.policy;
  const data: BrushData = {
    parcels,
    policy,
    transit: decodeTransit(JSON.parse(readFileSync(pathOf(manifest.transit!), 'utf8'))),
    neighborhoods: parseNeighborhoods(
      JSON.parse(readFileSync(pathOf(manifest.neighborhoods), 'utf8'))
    )
  };
  console.log(`loaded ${manifest.datasetVersion} in ${ms(performance.now() - tLoad)} ms`);

  const catalog = brushCatalog(data);
  const rh1 = catalog.districts.find((d) => d.family === 'RH-1');
  if (!rh1) throw new Error('no RH-1 family in the catalog');
  const brushes: Brush[] = [
    {
      name: '(a) every `RH-1` family lot, rule to 4',
      query: { kind: 'area', districts: rh1.codes.map((c) => c.code), neighborhoods: [] },
      stories: 4
    },
    {
      name: '(b) `metro` and `rapidBus` within 1,609 m, rule to 8',
      query: { kind: 'transit', stopTypes: ['metro', 'rapidBus'], maxM: 1609 },
      stories: 8
    },
    {
      name: '(c) `regionalRail` within 805 m, rule to 8',
      query: { kind: 'transit', stopTypes: ['regionalRail'], maxM: 805 },
      stories: 8
    }
  ];

  const ctx = { parcels, policy, options: loaded.options };
  const asOf = loaded.fzp.asOf;
  /** One brush, measured: a fresh lot index each time (cold data, not cold JIT). */
  const measure = (b: Brush): string[] => {
    // a fresh lot index each time (the host builds one per session)
    const t0 = performance.now();
    const index = createLotIndex(parcels);
    const lotRows = resolveBrushRows(data, index, b.query);
    const resolveMs = performance.now() - t0;

    const levers: SimLevers = structuredClone(DEFAULT_LEVERS);
    levers.rules.push({ lots: lotRows.map((r) => parcels.id[r] as ParcelId), stories: b.stories });

    const t1 = performance.now();
    const resolution = resolveEnvelopes(ctx, levers, asOf);
    const envMs = performance.now() - t1;

    const t2 = performance.now();
    const li = applyLevers(loaded.fzp, ctx, levers, resolution);
    const applyMs = performance.now() - t2;

    const t3 = performance.now();
    precomputeOf(li.plan);
    const precomputeMs = performance.now() - t3;

    return [
      b.name,
      lotRows.length.toLocaleString('en-US'),
      ms(resolveMs),
      ms(envMs),
      ms(applyMs),
      ms(precomputeMs),
      li.capacity.plan.toLocaleString('en-US')
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
    'applyLevers ms',
    'precomputeOf ms',
    'Capacity'
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
