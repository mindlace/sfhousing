// End-to-end host budgets (spec §6 host.bench, conductor ruling): the real generate, packCell and
// score accumulator over a synthetic 150,360-parcel city. Fails above budget.
import { describe, expect, it } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelRecord } from '$lib/data/parcel';
import { encodeParcelChunk } from '$lib/data/parcel-chunk';
import { synthParcels } from '$lib/generator/fixtures/synth';
import { quantize, type Plan, type PlanOp } from '$lib/plan';
import type { FetchLike } from './chunks';
import { createSimHost, type SimHost } from './host';
import type { DiffResponse, SimResponse } from './protocol';

// plan-model's resolve.bench grid: 420 × 358 label points over ≈13.2 km × 11.1 km, 16 × 16 cells.
const W = -122.51,
  E = -122.36,
  S = 37.71,
  N = 37.81;
const COLS = 420,
  ROWS = 358,
  CELLS = 16;
const VERSION = 'fixture-9';
const TIMEOUT = 120_000;

interface City {
  manifest: Manifest;
  bodies: Map<string, unknown>;
  eligible: number;
}

function buildCity(): City {
  const synth = synthParcels(COLS * ROWS, 42);
  const cells = new Map<string, ParcelRecord[]>();
  let eligible = 0;
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const n = j * COLS + i;
      const ok = n % 7 !== 0;
      if (ok) eligible++;
      const cellId = `${Math.floor((i * CELLS) / COLS)}_${Math.floor((j * CELLS) / ROWS)}`;
      const rec: ParcelRecord = {
        ...synth[n].parcel,
        labelPoint: [W + ((i + 0.5) * (E - W)) / COLS, S + ((j + 0.5) * (N - S)) / ROWS],
        eligible: ok
      };
      (cells.get(cellId) ?? cells.set(cellId, []).get(cellId)!).push(rec);
    }
  }
  const bodies = new Map<string, unknown>();
  const chunks: Manifest['chunks'] = [];
  for (const [cellId, recs] of cells) {
    const url = `/data/${VERSION}/parcels/${cellId}.json`;
    // Untimed setup: the wire format round trip, as the loader sees it.
    bodies.set(url, JSON.parse(encodeParcelChunk(VERSION, cellId, recs)));
    // Exact bbox of the cell's label points, after the wire format's 1e-7 rounding.
    const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of recs) {
      const [lng, lat] = [r7(r.labelPoint[0]), r7(r.labelPoint[1])];
      w = Math.min(w, lng);
      s = Math.min(s, lat);
      e = Math.max(e, lng);
      n = Math.max(n, lat);
    }
    chunks.push({ cellId, bbox: [w, s, e, n], url, parcelCount: recs.length });
  }
  const manifest = {
    datasetVersion: VERSION,
    builtAt: '2026-10-11T00:00:00.000Z',
    sources: [],
    chunks,
    buildingsTiles: `/data/${VERSION}/buildings/{z}/{x}/{y}.pbf`,
    basemapTiles: `/data/${VERSION}/basemap/{z}/{x}/{y}.pbf`,
    glyphs: `/data/${VERSION}/glyphs/{fontstack}/{range}.pbf`,
    neighborhoods: `/data/${VERSION}/neighborhoods.geojson`
  } as Manifest;
  return { manifest, bodies, eligible };
}

interface Posted {
  msg: SimResponse;
  at: number;
}

interface Rig {
  host: SimHost;
  posted: Posted[];
}

/** A host over the city with every chunk loaded (init, prefetch the whole bbox, await). */
async function loadedHost(city: City): Promise<Rig> {
  const posted: Posted[] = [];
  const fetch: FetchLike = (url) => {
    const body = city.bodies.get(url);
    return Promise.resolve(
      body === undefined
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => body }
    );
  };
  const host = createSimHost({
    fetch,
    post: (msg) => posted.push({ msg, at: performance.now() }),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>)
  });
  host.handle({ type: 'init', rev: 1, manifest: city.manifest, mode: 'max' });
  host.handle({ type: 'prefetch', bbox: [W, S, E, N] });
  const done = () =>
    posted.some(({ msg }) => msg.type === 'chunks' && msg.pending === 0 && msg.failed.length === 0);
  const deadline = performance.now() + 60_000;
  while (!done()) {
    if (performance.now() > deadline) throw new Error('chunks did not load');
    await new Promise((r) => globalThis.setTimeout(r, 5));
  }
  posted.length = 0;
  return { host, posted };
}

const diffsOf = (posted: Posted[]) =>
  posted.filter((p): p is { msg: DiffResponse; at: number } => p.msg.type === 'diff');

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

describe('host performance budgets (spec §6 host.bench)', () => {
  const city = buildCity();

  it('commit diff for a ≈500-parcel stamp in ≤ 100 ms', { timeout: TIMEOUT }, async () => {
    const { host, posted } = await loadedHost(city);
    // Disjoint stamps (≥ 1 km apart) near the city centre; the first is the warm-up. Radius 420,
    // not the brief's starting 390: at 390 only ≈420 eligible parcels are covered (1 in 7 is
    // ineligible), below the 450–550 range asserted on stats.covered.
    const centres: [number, number][] = [
      [-122.465, 37.76],
      [-122.435, 37.76],
      [-122.423, 37.76],
      [-122.435, 37.77]
    ];
    const times: number[] = [];
    const coveredCounts: number[] = [];
    let rev = 1;
    centres.forEach(([lng, lat], k) => {
      const op: PlanOp = {
        kind: 'paint',
        id: `stamp${k}`,
        stories: 6,
        radiusM: 420,
        path: [[quantize(lng), quantize(lat)]]
      };
      posted.length = 0;
      const t0 = performance.now();
      host.handle({ type: 'commit', rev: ++rev, op });
      const commits = diffsOf(posted).filter((p) => p.msg.phase === 'commit');
      expect(commits).toHaveLength(1);
      const covered = commits[0].msg.stats!.covered;
      expect(covered).toBeGreaterThanOrEqual(450);
      expect(covered).toBeLessThanOrEqual(550);
      coveredCounts.push(covered);
      if (k > 0) times.push(commits[0].at - t0);
    });
    const ms = median(times);
    console.log(
      `[perf] commit diff, ≈500-parcel stamp: median ${ms.toFixed(1)} ms ` +
        `(${times.map((t) => t.toFixed(1)).join(', ')}; covered ${coveredCounts.join(', ')})`
    );
    expect(ms).toBeLessThanOrEqual(100);
  });

  it('whole-city load produces its final batch in ≤ 5,000 ms', { timeout: TIMEOUT }, async () => {
    const { host, posted } = await loadedHost(city);
    // One radius-500 paint zigzagging across the bbox in 14 rows ≈793 m apart, so every label
    // point is within 500 m of the path.
    const ROWS_Z = 14;
    const path: [number, number][] = [];
    for (let k = 0; k < ROWS_Z; k++) {
      const lat = quantize(S + ((k + 0.5) * (N - S)) / ROWS_Z);
      const ends = k % 2 === 0 ? [W, E] : [E, W];
      for (const lng of ends) path.push([quantize(lng), lat]);
    }
    const plan: Plan = {
      schema: 1,
      datasetVersion: VERSION,
      ops: [{ kind: 'paint', id: 'city', stories: 6, radiusM: 500, path }]
    };
    const t0 = performance.now();
    host.handle({ type: 'load', rev: 2, plan });
    const loads = diffsOf(posted).filter((p) => p.msg.phase === 'load');
    expect(loads.length).toBeGreaterThan(1);
    const last = loads.at(-1)!;
    const ms = last.at - t0;
    const perDiff = loads.map((p) =>
      p.msg.render.cells.reduce(
        (m, c) => m + c.settled.parcelIds.length + (c.rising?.parcelIds.length ?? 0),
        0
      )
    );
    const parcels = perDiff.reduce((a, b) => a + b, 0);
    console.log(
      `[perf] whole-city load: final batch at ${ms.toFixed(0)} ms, ${loads.length} diffs, ` +
        `${parcels} generated of ${city.eligible} eligible`
    );
    expect(loads[0].msg.render.revision).toBe(0);
    expect(last.msg.complete).toBe(true);
    expect(Math.max(...perDiff)).toBeLessThanOrEqual(5000);
    expect(parcels).toBe(city.eligible); // every eligible synth lot builds at 6 stories
    expect(ms).toBeLessThanOrEqual(5000);
  });
});
