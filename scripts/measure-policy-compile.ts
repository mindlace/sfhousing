// `npx tsx scripts/measure-policy-compile.ts <datasetDir>` or `... --bench`: times compileTimeline
// (policy-timeline rule 24) on a local copy of a published dataset or on the bench city, for two
// edits from month 1: A, one transit rule with two bands; B, 500 lots painted to 8 stories. Per
// edit: time until `result()` is callable, time until `step` returns true, and the longest
// `step(20)` call; median of 5 after one warm-up. Not part of the bundle.
import { readFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseManifest } from '../src/lib/data/manifest';
import type { ParcelId, ParcelRecord } from '../src/lib/data/parcel';
import { decodeParcelChunk } from '../src/lib/data/parcel-chunk';
import { decodeTransit } from '../src/lib/data/transit-codec';
import {
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData
} from '../src/lib/sim/levers/brushes';
import { createYieldRecompute, type GrossCache } from '../src/lib/sim/levers/recompute';
import { synthCity, synthPolicy } from '../src/lib/sim/scenario/fixtures/synth-city';
import { buildSimInput } from '../src/lib/sim/scenario/input';
import { loadScenario, scenarioUrls } from '../src/lib/sim/scenario/load';
import type { SimInput } from '../src/lib/sim/scenario/types';
import { customQuery, queryKey, type CustomBrush } from '../src/lib/sim-page/policy';
import {
  queriesOf4,
  type Effect,
  type Policy,
  type Selector,
  type SimPolicy4
} from '../src/lib/timeline/policy4';
import { reconcilePolicy4 } from '../src/lib/timeline/reconcile4';
import { parseCalibration } from '../src/lib/timelapse/model';
import { parseProjectsFile } from '../src/lib/timelapse/projects';
import { monthFirstDay } from '../src/lib/sim/world/months';
import { compileTimeline, type CompileCtx } from '../src/lib/sim/world/policy/compile';

const WINDOW = 480;
const RUNS = 5;
const now = () => performance.now();
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const f1 = (x: number) => x.toFixed(1);

const policyOf = (id: string, where: Selector, asOf: number, what: Effect): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans: [{ from: monthFirstDay(asOf, 1), to: null, what }]
});
const docOf = (p: Policy): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning: [p], permitting: [], money: [] }
});

interface World {
  input: SimInput;
  layers: CompileCtx['layers'];
  records: Map<ParcelId, ParcelRecord>;
  /** Lots for scenario A's two bands, by query key (resolved: ms spent doing it). */
  bandLots(doc: SimPolicy4): { lots: Record<string, ParcelId[]>; ms: number };
  label: string;
}

async function live(dir: string): Promise<World> {
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  const prefix = `/data/${manifest.datasetVersion}/`;
  const pathOf = (url: string) => join(dir, url.slice(prefix.length));
  const urls = scenarioUrls(manifest);
  if (!urls?.policy) throw new Error('manifest has no policy.bin');
  const loaded = await loadScenario(
    {
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(pathOf(url), 'utf8'))
      }),
      fetchBytes: async (url) => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          const b = readFileSync(pathOf(url));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        }
      }),
      setTimeout: (fn, t) => setTimeout(fn, t),
      retryDelaysMs: [],
      warn: () => {}
    },
    urls,
    () => false,
    { policy: true }
  );
  if (!('fzp' in loaded)) throw new Error(`load failed: ${loaded.code}: ${loaded.message}`);
  const input = loaded.fzp;
  const policy = loaded.policy!;
  const records = new Map<ParcelId, ParcelRecord>();
  for (const c of manifest.chunks)
    for (const r of decodeParcelChunk(JSON.parse(readFileSync(pathOf(c.url), 'utf8'))))
      records.set(r.id, r);
  const data: BrushData = {
    parcels: input.parcels,
    policy,
    transit: decodeTransit(JSON.parse(readFileSync(pathOf(manifest.transit!), 'utf8'))),
    neighborhoods: parseNeighborhoods(
      JSON.parse(readFileSync(pathOf(manifest.neighborhoods), 'utf8'))
    )
  };
  return {
    input,
    layers: { parcels: input.parcels, policy },
    records,
    label: `dataset ${manifest.datasetVersion}, gross table: ${loaded.gross ? 'yes' : 'no'}`,
    bandLots(doc) {
      const s = now();
      const index = createLotIndex(input.parcels);
      const lots: Record<string, ParcelId[]> = {};
      for (const { key, query } of queriesOf4(doc)) {
        const rows = resolveBrushRows(data, index, query);
        lots[key] = [...new Set(rows.map((r) => input.parcels.id[r] as ParcelId))].sort();
      }
      return { lots, ms: now() - s };
    }
  };
}

function bench(): World {
  const city = synthCity();
  const records = new Map<ParcelId, ParcelRecord>();
  for (const chunk of city.chunks.values())
    for (const r of decodeParcelChunk(chunk as never)) records.set(r.id, r);
  const input = buildSimInput({
    parcels: city.parcels,
    projects: parseProjectsFile(structuredClone(city.projects)),
    calibration: parseCalibration(structuredClone(city.calibration))
  });
  const p = city.parcels;
  const hostable = [...p.id.keys()]
    .filter((i) => p.hostable[i] === 1)
    .map((i) => p.id[i] as ParcelId)
    .sort();
  return {
    input,
    layers: { parcels: p, policy: synthPolicy(city) },
    records,
    label: 'bench city (synthCity, no funding)',
    bandLots(doc) {
      // The bench city has no transit stops: two nested bands over the first 20,000 / 40,000 lots.
      const keys = queriesOf4(doc).map((q) => q.key);
      const lots: Record<string, ParcelId[]> = {};
      keys.forEach((k, i) => (lots[k] = hostable.slice(0, i === 0 ? 40000 : 20000)));
      return { lots, ms: 0 };
    }
  };
}

async function main(): Promise<number> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npx tsx scripts/measure-policy-compile.ts <datasetDir> | --bench');
    return 2;
  }
  const w = arg === '--bench' ? bench() : await live(arg);
  const { input, layers, records } = w;
  console.log(`${w.label}: ${input.parcels.count} parcels`);
  console.log(
    `load before: ${loadavg()
      .map((x) => x.toFixed(2))
      .join(' ')}`
  );
  const yields: CompileCtx['yields'] = {
    recompute: (parcels, needs) => {
      const gross: GrossCache = new Map();
      return createYieldRecompute(
        parcels,
        needs,
        { record: (id) => records.get(id), cellLoaded: () => true, now },
        gross
      );
    },
    failedCells: () => []
  };
  const hostableIds = [...input.parcels.id.keys()]
    .filter((i) => input.parcels.hostable[i] === 1)
    .map((i) => input.parcels.id[i] as ParcelId)
    .sort()
    .slice(0, 500);
  const brush: CustomBrush = {
    id: 'b8',
    kind: 'paint',
    strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }],
    stories: 8
  };
  const scenarios: Record<
    string,
    () => { doc: SimPolicy4; lots: Record<string, ParcelId[]>; pre: number }
  > = {
    A: () => {
      const doc0 = docOf(
        policyOf('metro', { tag: 'transit', stopTypes: ['metro'] }, input.asOf, {
          tag: 'bands',
          bands: [
            { maxM: 402, stories: 6 },
            { maxM: 805, stories: 4 }
          ]
        })
      );
      const doc = reconcilePolicy4(doc0, input.calibration, input.asOf).doc;
      const { lots, ms } = w.bandLots(doc);
      return { doc, lots, pre: ms };
    },
    B: () => {
      const doc0 = docOf(
        policyOf('painted', { tag: 'painted' }, input.asOf, { tag: 'brushes', brushes: [brush] })
      );
      const doc = reconcilePolicy4(doc0, input.calibration, input.asOf).doc;
      return { doc, lots: { [queryKey(customQuery(brush))]: hostableIds }, pre: 0 };
    }
  };

  for (const [name, make] of Object.entries(scenarios)) {
    const one = () => {
      // a fresh input object: nothing memoised on the previous run can hit
      const ctx: CompileCtx = {
        input: { ...input, parcels: { ...input.parcels } },
        layers: { ...layers },
        windowMonths: WINDOW,
        yields,
        now
      };
      ctx.layers = { parcels: ctx.input.parcels, policy: layers.policy };
      const { doc, lots, pre } = make();
      const t0 = now();
      const c = compileTimeline(doc, lots, ctx, 'plan');
      let first = -1;
      let max = 0;
      for (let done = false; !done;) {
        const s = now();
        done = c.step(20);
        max = Math.max(max, now() - s);
        if (first < 0) {
          try {
            c.result();
            first = now() - t0;
          } catch {
            // month 1 not built yet
          }
        }
      }
      return { first: first + pre, all: now() - t0 + pre, max, pre };
    };
    one();
    const runs = Array.from({ length: RUNS }, one);
    console.log(
      `\nScenario ${name} (edit from month 1; lot resolution ${f1(runs[0].pre)} ms included):`
    );
    for (const k of ['first', 'all', 'max'] as const)
      console.log(
        `  ${k.padEnd(6)} ${f1(median(runs.map((r) => r[k]))).padStart(9)} ms   runs: ${runs.map((r) => f1(r[k])).join(', ')}`
      );
  }
  console.log(
    `\nNode ${process.version}, ${cpus()[0]?.model} (${cpus().length} cores), ${Math.round(totalmem() / 2 ** 30)} GB`
  );
  console.log(
    `load after: ${loadavg()
      .map((x) => x.toFixed(2))
      .join(' ')}`
  );
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
