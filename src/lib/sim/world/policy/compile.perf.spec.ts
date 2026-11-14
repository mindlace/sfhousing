// Policy-timeline Task 15: the 50 ms bound on a compile slice (spec rule 19) on the bench city, and
// the same slices measured on the live city when a local dataset is present. Wall-clock budgets:
// project perf (`npm run test:perf`), idle machine only, never in signoff.
//
// The live case reads the dataset directory named by `SFH_LIVE_DATASET` (a copy of a published
// version, for example one fetched with `npm run data:local`); without it the case skips and logs
// why. It reports the longest slice and asserts only that the compile completes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseManifest } from '$lib/data/manifest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { decodeParcelChunk } from '$lib/data/parcel-chunk';
import {
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData
} from '$lib/sim/levers/brushes';
import { createYieldRecompute, type GrossCache } from '$lib/sim/levers/recompute';
import {
  benchBaseline,
  benchBaselineFunding,
  benchFunding,
  benchMarket,
  benchRoutes
} from '$lib/sim/scenario/fixtures/bench-finance';
import { synthCity, synthPolicy, type SynthCity } from '$lib/sim/scenario/fixtures/synth-city';
import { buildSimInput } from '$lib/sim/scenario/input';
import { loadScenario, scenarioUrls } from '$lib/sim/scenario/load';
import type { SimInput } from '$lib/sim/scenario/types';
import { decodeTransit } from '$lib/data/transit-codec';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import {
  queriesOf4,
  type Effect,
  type Policy,
  type Selector,
  type SimPolicy4
} from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import {
  compileTimeline,
  type CompileCtx,
  type TimelineCompile,
  type YieldSource
} from './compile';
import { span } from './test/fixtures';

const TIMEOUT = 600_000;
const BAR_MS = 50;
const SLICE_MS = 20;
const WINDOW = 480;
const now = () => performance.now();
const f1 = (x: number) => x.toFixed(1);

/** A `YieldSource` over chunk records with today's `createYieldRecompute`. */
function chunkYields(records: Map<ParcelId, ParcelRecord>): YieldSource {
  return {
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
}

interface Run {
  compile: TimelineCompile;
  calls: number[];
  /** Until `result()` is callable, ms from the call to `compileTimeline`. */
  firstFrame: number;
  all: number;
  done: boolean;
}

/** Compiles to the end with `step(SLICE_MS)` calls, timing each. */
function drive(doc: SimPolicy4, lots: Record<string, ParcelId[]>, ctx: CompileCtx): Run {
  const t0 = now();
  const compile = compileTimeline(doc, lots, ctx, 'plan');
  const calls: number[] = [];
  let firstFrame = -1;
  let done = false;
  while (!done) {
    const s = now();
    done = compile.step(SLICE_MS);
    calls.push(now() - s);
    if (firstFrame < 0 && compile.progress().done >= 0) {
      try {
        compile.result();
        firstFrame = now() - t0;
      } catch {
        // month 1 is not built yet
      }
    }
  }
  return { compile, calls, firstFrame, all: now() - t0, done };
}

/** A policy in force from model month `from` of the dataset dated `asOf`, with no end. */
const policyOf = (asOf: Day, id: string, where: Selector, from: number, what: Effect): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans: [span(asOf, from, null, what)]
});

const docOf = (zoning: Policy[], money: Policy[] = []): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting: [], money }
});

const distinctViews = (c: TimelineCompile) => {
  const t = c.result();
  return new Set([1, ...t.changes()].map((m) => t.frameAt(m).view)).size;
};

describe('compile slice on the bench city', () => {
  let city: SynthCity;
  let ctx: CompileCtx;

  beforeAll(() => {
    city = synthCity();
    const records = new Map<ParcelId, ParcelRecord>();
    for (const chunk of city.chunks.values())
      for (const r of decodeParcelChunk(chunk as never)) records.set(r.id, r);
    const base = buildSimInput({
      parcels: city.parcels,
      projects: parseProjectsFile(structuredClone(city.projects)),
      calibration: parseCalibration(structuredClone(city.calibration))
    });
    const calibration = {
      ...base.calibration,
      affordableRoutes: benchRoutes(),
      baselineFunding: benchBaselineFunding(base.asOf),
      market: benchMarket()
    };
    const input: SimInput = {
      ...base,
      calibration,
      market: [],
      finance: benchBaseline(base.asOf)
    };
    ctx = {
      input,
      layers: { parcels: city.parcels, policy: synthPolicy(city) },
      windowMonths: WINDOW,
      yields: chunkYields(records),
      now
    };
  }, TIMEOUT);

  it(
    'step(20) stays within 50 ms over painted, transit and funding policies',
    { timeout: TIMEOUT },
    () => {
      const asOf = ctx.input.asOf;
      const p = city.parcels;
      const hostable: ParcelId[] = [];
      for (let i = 0; i < p.count; i++) if (p.hostable[i] === 1) hostable.push(p.id[i] as ParcelId);
      hostable.sort();
      const painted = hostable.slice(0, 500);
      const transit = hostable.slice(500, 2500);
      expect(transit).toHaveLength(2000);
      const brush: CustomBrush = {
        id: 'b8',
        kind: 'paint',
        strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }],
        stories: 8
      };
      const fund = benchFunding(asOf);
      const doc0 = docOf(
        [
          policyOf(asOf, 'painted', { tag: 'painted' }, 1, { tag: 'brushes', brushes: [brush] }),
          policyOf(asOf, 'transit', { tag: 'transit', stopTypes: ['metro'] }, 61, {
            tag: 'bands',
            bands: [{ maxM: 402, stories: 6 }]
          })
        ],
        fund.pools.map((pool) =>
          policyOf(asOf, `fund-${pool.id}`, { tag: 'fund', pool: pool.id }, 1, {
            tag: 'fund',
            pool,
            programmes: fund.programmes.filter((g) => g.pool === pool.id)
          })
        )
      );
      const doc = reconcilePolicy4(doc0, ctx.input.calibration, asOf).doc;
      const paintKey = queryKey(customQuery(brush));
      const lots: Record<string, ParcelId[]> = {};
      for (const { key } of queriesOf4(doc)) lots[key] = key === paintKey ? painted : transit;

      const r = drive(doc, lots, ctx);
      const max = Math.max(...r.calls);
      console.log(
        `[perf] bench city compile: ${r.calls.length} step(${SLICE_MS}) calls, longest ${f1(max)} ms, ` +
          `first frame ${f1(r.firstFrame)} ms, all frames ${f1(r.all)} ms ` +
          `(calls: ${r.calls.map(f1).join(' ')})`
      );
      expect(r.done).toBe(true);
      // fixture check: painted lots from month 1 and the transit rule from month 61 are two
      // zoning states beyond the default
      expect(distinctViews(r.compile)).toBeGreaterThan(1);
      expect(max).toBeLessThanOrEqual(BAR_MS);
    }
  );
});

const LIVE_DIR = process.env.SFH_LIVE_DATASET ?? '';
const LIVE = LIVE_DIR !== '' && existsSync(join(LIVE_DIR, 'manifest.json'));
if (!LIVE)
  console.log(
    '[perf] live-city compile case skipped: set SFH_LIVE_DATASET to a local dataset directory ' +
      '(a published version, for example from `npm run data:local`)'
  );

describe('compile slice on the live city', () => {
  it.skipIf(!LIVE)(
    'reports the longest slice of one added transit rule; asserts completion only',
    { timeout: TIMEOUT },
    async () => {
      const manifest = parseManifest(
        JSON.parse(readFileSync(join(LIVE_DIR, 'manifest.json'), 'utf8'))
      );
      const prefix = `/data/${manifest.datasetVersion}/`;
      const pathOf = (url: string) => join(LIVE_DIR, url.slice(prefix.length));
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
      if (!('fzp' in loaded)) throw new Error(`load failed: ${loaded.code}`);
      const input = loaded.fzp;
      const layers = { parcels: input.parcels, policy: loaded.policy! };
      const records = new Map<ParcelId, ParcelRecord>();
      for (const c of manifest.chunks)
        for (const r of decodeParcelChunk(JSON.parse(readFileSync(pathOf(c.url), 'utf8'))))
          records.set(r.id, r);
      const data: BrushData = {
        parcels: input.parcels,
        policy: loaded.policy!,
        transit: decodeTransit(JSON.parse(readFileSync(pathOf(manifest.transit!), 'utf8'))),
        neighborhoods: parseNeighborhoods(
          JSON.parse(readFileSync(pathOf(manifest.neighborhoods), 'utf8'))
        )
      };
      const doc0 = docOf([
        policyOf(input.asOf, 'metro', { tag: 'transit', stopTypes: ['metro'] }, 1, {
          tag: 'bands',
          bands: [
            { maxM: 402, stories: 6 },
            { maxM: 805, stories: 4 }
          ]
        })
      ]);
      const doc = reconcilePolicy4(doc0, input.calibration, input.asOf).doc;
      const index = createLotIndex(input.parcels);
      const lots: Record<string, ParcelId[]> = {};
      for (const { key, query } of queriesOf4(doc)) {
        const rows = resolveBrushRows(data, index, query);
        lots[key] = [...new Set(rows.map((r) => input.parcels.id[r] as ParcelId))].sort();
      }
      const r = drive(doc, lots, {
        input,
        layers,
        windowMonths: WINDOW,
        yields: chunkYields(records),
        now
      });
      const max = Math.max(...r.calls);
      console.log(
        `[perf] live city ${manifest.datasetVersion}, one metro rule from month 1: ` +
          `${r.calls.length} step(${SLICE_MS}) calls, longest ${f1(max)} ms (bar ${BAR_MS} ms, not asserted), ` +
          `first frame ${f1(r.firstFrame)} ms, all frames ${f1(r.all)} ms`
      );
      expect(r.done).toBe(true);
    }
  );
});
