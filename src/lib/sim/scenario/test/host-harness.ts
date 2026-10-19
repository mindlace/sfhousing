// Test harness for the scenario host (spec §6 scenario-host.spec.ts), modelled on
// src/lib/sim/test/harness.ts. Test-only, Node-only (mini-bin.ts uses node:zlib).
//
// - A fake clock: `now()`, the host's `setTimeout`/`clearTimeout`, `advance(ms)`, `runAll()` and
//   `step()`. `tick(ms)` charges compute time (a test's stand-in for a slow simulation), and
//   `slices` records how much fake time each timer callback took.
//   Only the host's timers are fake. The one host step the harness does not drive is the
//   parcels.bin inflate (a real DecompressionStream on Node's thread pool), so the harness
//   injects `decodeParcels` as a tracked pass-through to `readScenarioParcels`: `flush()` waits
//   until no decode is in flight and the microtask queue is drained, so "settled" is observed,
//   never guessed. Decodes can also be held and released.
// - In-memory `fetch` (JSON) and `fetchBytes` (parcels.bin) serving the mini city's scenario
//   files and chunks, with per-URL failure injection and holds.
// - Every post (with its transfer list) and every warning, in order.
import { deflateRawSync } from 'node:zlib';
import type { Manifest } from '$lib/data/manifest';
import {
  encodeScenarioPayload,
  readScenarioParcels,
  type ScenarioParcels
} from '$lib/data/scenario-codec';
import type { Day } from '$lib/timelapse/time';
import type { Rev } from '../../protocol';
import { miniBin } from '../fixtures/mini-bin';
import { MINI_SCENARIO_URLS, miniCity } from '../fixtures/mini-parcels';
import { MINI_HORIZON, miniProjectsJson } from '../fixtures/mini-projects';
import miniCalibration from '../fixtures/mini-calibration.json';
import { createScenarioHost, type ScenarioHost, type ScenarioHostDeps } from '../scenario-host';
import type { ScenarioResponse } from '../types';

type ErrorPost = Extract<ScenarioResponse, { type: 'error' }>;

/** How an injected failure fails one fetch attempt. */
export type Failure =
  | { status: number } // the response arrives with ok false
  | 'reject' // the request itself rejects (no response)
  | 'body'; // ok 200, but reading the body (json() / arrayBuffer()) rejects

export interface FetchRecord {
  url: string;
  kind: 'json' | 'bytes';
  at: number; // fake-clock time of the request
  posts: number; // posts.length when the request was made
}

export interface ScenarioHarness {
  host: ScenarioHost;
  posts: ScenarioResponse[];
  transfers: ArrayBuffer[][];
  warnings: string[];
  fetches: FetchRecord[];
  /** Served bodies by URL: `unknown` JSON for `fetch`, `Uint8Array` for `fetchBytes`. */
  bodies: Map<string, unknown>;
  manifest(): Manifest; // a fresh copy of the mini manifest
  /** Sends `initScenario` with the mini manifest (or `over` fields) and returns its rev. */
  init(over?: Partial<Record<string, unknown>>): Rev;
  next(): Rev; // next rev, starting at 1
  /** The next `times` attempts at `url` fail as `how`. */
  fail(url: string, times: number, how: Failure): void;
  /** Default bodies again; no pending failures or holds (for a fresh init after an error). */
  restore(): void;
  /** Requests for `url` stay pending until `release(url)`. */
  hold(url: string): void;
  release(url: string): void;
  errors(): ErrorPost[];
  /** Fetches of one URL. */
  fetchesOf(url: string): FetchRecord[];
  // fake clock
  now(): number;
  pendingTimers(): number;
  /** Charges `ms` of compute time: the clock moves forward without firing any timer. */
  tick(ms: number): void;
  /** Fake-clock time each fired timer callback took (its `tick` charges), in firing order. */
  slices: number[];
  /** Fires the earliest due timer (then flushes); false when none is pending. */
  step(): Promise<boolean>;
  /** Decodes of parcels.bin started and settled so far. */
  decodes(): { started: number; settled: number };
  /** Decodes started from now on wait until `releaseDecodes()`. */
  holdDecodes(): void;
  releaseDecodes(): void;
  /**
   * Settles everything not waiting on the fake clock, a held fetch or a held decode: drains
   * microtasks and waits for every running decode, until neither has work.
   */
  flush(): Promise<void>;
  /** Moves the clock forward by `ms`, firing due timers in order and flushing after each. */
  advance(ms: number): Promise<void>;
  /** Fires timers until none is left (flushing after each); throws after 10,000. */
  runAll(): Promise<void>;
}

/** The mini parcels.bin for (optionally) modified T11 columns. */
export function binOf(edit?: (p: ScenarioParcels) => ScenarioParcels): Uint8Array {
  if (!edit) return miniBin();
  return new Uint8Array(deflateRawSync(encodeScenarioPayload(edit(miniCity().parcels))));
}

export function makeScenarioHarness(opts?: {
  retryDelaysMs?: readonly number[];
  /** Extra or replacement bodies by URL (`Uint8Array` for parcels.bin). */
  bodies?: Record<string, unknown>;
  horizon?: Day;
  deps?: Partial<ScenarioHostDeps>;
}): ScenarioHarness {
  const city = miniCity();
  const posts: ScenarioResponse[] = [];
  const transfers: ArrayBuffer[][] = [];
  const warnings: string[] = [];
  const fetches: FetchRecord[] = [];
  const bodies = new Map<string, unknown>();
  const defaults = () => {
    bodies.clear();
    for (const [url, body] of Object.entries(city.chunks)) bodies.set(url, body);
    bodies.set(MINI_SCENARIO_URLS.parcels, miniBin());
    bodies.set(MINI_SCENARIO_URLS.projects, miniProjectsJson());
    bodies.set(MINI_SCENARIO_URLS.calibration, miniCalibration);
  };
  defaults();
  for (const [url, body] of Object.entries(opts?.bodies ?? {})) bodies.set(url, body);

  const failures = new Map<string, Failure[]>();
  const held = new Map<string, (() => void)[]>();
  const holding = new Set<string>();

  // tracked decodes
  const decodeCount = { started: 0, settled: 0 };
  const running = new Set<Promise<void>>();
  const heldDecodes: (() => void)[] = [];
  let holdingDecodes = false;
  function decodeParcels(bytes: Uint8Array): Promise<ScenarioParcels> {
    decodeCount.started++;
    const go = () => {
      const p = readScenarioParcels(bytes);
      const done: Promise<void> = p.then(
        () => undefined,
        () => undefined
      );
      running.add(done);
      void done.then(() => {
        decodeCount.settled++;
        running.delete(done);
      });
      return p;
    };
    if (!holdingDecodes) return go();
    return new Promise((resolve, reject) => heldDecodes.push(() => go().then(resolve, reject)));
  }

  // fake clock
  let clock = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const slices: number[] = [];

  function respond<B>(
    url: string,
    kind: FetchRecord['kind'],
    read: (body: unknown) => B
  ): Promise<{ ok: boolean; status: number; body(): Promise<B> }> {
    fetches.push({ url, kind, at: clock, posts: posts.length });
    const queue = failures.get(url);
    const how = queue?.shift();
    let out: Promise<{ ok: boolean; status: number; body(): Promise<B> }>;
    if (how === 'reject') out = Promise.reject(new TypeError(`fetch failed: ${url}`));
    else if (how === 'body') {
      out = Promise.resolve({
        ok: true,
        status: 200,
        body: () => Promise.reject(new TypeError(`body read failed: ${url}`))
      });
    } else if (how !== undefined) {
      out = Promise.resolve({ ok: false, status: how.status, body: async () => read({}) });
    } else {
      const body = bodies.get(url);
      out = Promise.resolve(
        body === undefined
          ? { ok: false, status: 404, body: async () => read({}) }
          : { ok: true, status: 200, body: async () => read(body) }
      );
    }
    if (!holding.has(url)) return out;
    return new Promise((resolve, reject) => {
      const list = held.get(url) ?? [];
      list.push(() => out.then(resolve, reject));
      held.set(url, list);
    });
  }

  const deps: ScenarioHostDeps = {
    fetch: (url) =>
      respond(url, 'json', (b) => structuredClone(b)).then((r) => ({
        ok: r.ok,
        status: r.status,
        json: () => r.body()
      })),
    fetchBytes: (url) =>
      respond(url, 'bytes', (b) => {
        if (!(b instanceof Uint8Array)) return new ArrayBuffer(0);
        return b.slice().buffer; // a fresh ArrayBuffer per read
      }).then((r) => ({ ok: r.ok, status: r.status, arrayBuffer: () => r.body() })),
    post: (msg, transfer) => {
      posts.push(msg);
      transfers.push(transfer);
    },
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: clock + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
    now: () => clock,
    warn: (msg) => warnings.push(msg),
    decodeParcels,
    ...(opts?.retryDelaysMs ? { retryDelaysMs: opts.retryDelaysMs } : {}),
    ...opts?.deps
  };
  const host = createScenarioHost(deps);

  const turn = () => new Promise<void>((r) => setImmediate(r));

  async function flush(): Promise<void> {
    // Node drains the whole microtask queue after every macrotask, so after two turns every
    // promise chain has run to its next real wait. The only real wait the harness does not own
    // is a running decode: wait for those and go again until there is none.
    for (let round = 0; round < 10_000; round++) {
      await turn();
      await turn();
      if (running.size === 0) return;
      await Promise.all(running);
    }
    throw new Error('flush: decodes never settled');
  }

  /** The next due timer at or before `limit`, earliest first, ties in scheduling order. */
  function due(limit: number): [number, { at: number; fn: () => void }] | null {
    let best: [number, { at: number; fn: () => void }] | null = null;
    for (const e of timers) {
      if (e[1].at > limit) continue;
      if (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[0] < best[0])) best = e;
    }
    return best;
  }

  async function fire(entry: [number, { at: number; fn: () => void }]): Promise<void> {
    timers.delete(entry[0]);
    clock = Math.max(clock, entry[1].at);
    const from = clock;
    entry[1].fn();
    slices.push(clock - from);
    await flush();
  }

  let rev = 0;
  const next = () => ++rev;
  const manifest = () => miniCity().manifest;

  return {
    host,
    posts,
    transfers,
    warnings,
    fetches,
    bodies,
    manifest,
    init(over) {
      const r = next();
      host.handle({
        type: 'initScenario',
        rev: r,
        manifest: manifest(),
        scenario: 'fzp',
        seed: 1,
        horizon: opts?.horizon ?? MINI_HORIZON,
        ...over
      } as Parameters<ScenarioHost['handle']>[0]);
      return r;
    },
    next,
    fail(url, times, how) {
      const q = failures.get(url) ?? [];
      for (let i = 0; i < times; i++) q.push(how);
      failures.set(url, q);
    },
    restore() {
      defaults();
      failures.clear();
      holding.clear();
      holdingDecodes = false;
    },
    decodes: () => ({ ...decodeCount }),
    holdDecodes() {
      holdingDecodes = true;
    },
    releaseDecodes() {
      holdingDecodes = false;
      for (const go of heldDecodes.splice(0)) go();
    },
    hold(url) {
      holding.add(url);
    },
    release(url) {
      holding.delete(url);
      const list = held.get(url);
      if (!list?.length) throw new Error(`no held fetch for ${url}`);
      held.delete(url);
      for (const go of list) go();
    },
    errors: () => posts.filter((m): m is ErrorPost => m.type === 'error'),
    fetchesOf: (url) => fetches.filter((f) => f.url === url),
    now: () => clock,
    pendingTimers: () => timers.size,
    tick(ms) {
      clock += ms;
    },
    slices,
    async step() {
      await flush();
      const e = due(Infinity);
      if (!e) return false;
      await fire(e);
      return true;
    },
    flush,
    async advance(ms) {
      const target = clock + ms;
      await flush();
      for (let e = due(target); e; e = due(target)) await fire(e);
      clock = Math.max(clock, target); // a timer's tick charges may have passed the target
    },
    async runAll() {
      await flush();
      for (let k = 0; k < 10_000; k++) {
        const e = due(Infinity);
        if (!e) return;
        await fire(e);
      }
      throw new Error('runAll: timers never drained');
    }
  };
}
