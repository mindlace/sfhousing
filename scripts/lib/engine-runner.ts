// The engine runner: one timeline host over a dataset directory or a published dataset version,
// filling the whole window for each policy document it is given, one document at a time.
// `scripts/money-monotone.ts` imports it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import type { ParcelId } from '../../src/lib/data/parcel';
import type { FetchLike } from '../../src/lib/sim/chunks';
import { canonicalJson } from '../../src/lib/sim-page/policy';
import { loadScenario, scenarioUrls, type FetchBytesLike } from '../../src/lib/sim/scenario/load';
import type { BrushLotsResult } from '../../src/lib/sim/scenario/types';
import { WINDOW_MONTHS } from '../../src/lib/sim/timeline-client';
import type {
  TimelineHostRequest,
  TimelineHostResponse
} from '../../src/lib/sim/timeline-protocol';
import { createTimelineHost } from '../../src/lib/sim/world/host';
import type { TimelineView } from '../../src/lib/sim/world/score/types';
import type { Day } from '../../src/lib/timelapse/time';
import type { Calibration } from '../../src/lib/timelapse/types';
import {
  EMPTY_LOG,
  logCompiled,
  logFilled,
  logRefill,
  nextMonth,
  viewOfLog,
  type ChunkLog
} from '../../src/lib/timeline/chunk-log';
import { DEFAULT_POLICY4, queriesOf4, type SimPolicy4 } from '../../src/lib/timeline/policy4';
import { reconcilePolicy4 } from '../../src/lib/timeline/reconcile4';

export type DataSource = { dir: string } | { version: string; origin: string };

export const DEFAULT_ORIGIN = 'https://sfhousing.mindlace.net';

export interface Engine {
  datasetVersion: string;
  asOf: Day;
  cal: Calibration;
  /** Wall-clock milliseconds from `openTimeline` to the last month of the opening fill. */
  fillMs: number;
  /** The whole window's view for `doc`, reconciled and with its lots resolved. */
  view(doc: SimPolicy4): Promise<TimelineView>;
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 600_000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Sources = { fetch: FetchLike; fetchBytes: FetchBytesLike };

/** Answers for one file's bytes: null serves a 404. */
function served(read: (url: string) => Promise<ArrayBuffer | null>): Sources {
  return {
    fetch: async (url) => {
      const b = await read(url);
      return b === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : {
            ok: true,
            status: 200,
            json: async () => JSON.parse(new TextDecoder().decode(b))
          };
    },
    fetchBytes: async (url) => {
      const b = await read(url);
      return b === null
        ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, status: 200, arrayBuffer: async () => b.slice(0) };
    }
  };
}

/** `<dir>/manifest.json`, parsed; rejects with `no dataset at {dir}`. */
function readManifest(dir: string): Manifest {
  try {
    return parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  } catch {
    throw new Error(`no dataset at ${dir}`);
  }
}

/** `/data/<datasetVersion>/<path>` served from `<dir>/<path>`; a missing file answers 404. */
function dirFetch(dir: string, manifest: Manifest): Sources {
  const prefix = `/data/${manifest.datasetVersion}/`;
  return served(async (url) => {
    if (!url.startsWith(prefix)) return null;
    try {
      const b = readFileSync(join(dir, url.slice(prefix.length)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  });
}

/**
 * `/data/<version>/<path>` fetched from `<origin>/data/<version>/<path>`, each file's bytes kept
 * for the life of the source; a failed fetch (a throw or an answer not ok) answers 404 and is not
 * kept.
 */
export function versionFetch(
  version: string,
  origin: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Sources {
  const base = origin.replace(/\/+$/, '');
  const prefix = `/data/${version}/`;
  const kept = new Map<string, Promise<ArrayBuffer | null>>();
  return served((url) => {
    if (!url.startsWith(prefix)) return Promise.resolve(null);
    let bytes = kept.get(url);
    if (bytes === undefined) {
      // A throw from the fetch or from reading the body is a failed fetch.
      bytes = fetchImpl(`${base}${url}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      kept.set(url, bytes);
      void bytes.then((b) => {
        if (b === null) kept.delete(url);
      });
    }
    return bytes;
  });
}

/** The manifest and the sources of a dataset source. */
async function openSource(src: DataSource): Promise<{ manifest: Manifest } & Sources> {
  if ('dir' in src) {
    const manifest = readManifest(src.dir);
    return { manifest, ...dirFetch(src.dir, manifest) };
  }
  const sources = versionFetch(src.version, src.origin);
  const missing = `no dataset ${src.version} at ${src.origin}`;
  const r = await sources.fetch(`/data/${src.version}/manifest.json`);
  if (!r.ok) throw new Error(missing);
  let manifest: Manifest;
  try {
    manifest = parseManifest(await r.json());
  } catch {
    throw new Error(missing);
  }
  if (manifest.datasetVersion !== src.version) {
    throw new Error(`the manifest of ${src.version} names ${manifest.datasetVersion}`);
  }
  return { manifest, ...sources };
}

/** Real timers whose live handles are tracked, so every one can be cleared; none after `close`. */
function trackedTimers() {
  const live = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  return {
    setTimeout(fn: () => void, ms: number): unknown {
      if (closed) return null;
      const h = setTimeout(() => {
        live.delete(h);
        fn();
      }, ms);
      live.add(h);
      return h;
    },
    clearTimeout(h: unknown): void {
      if (h === null) return;
      live.delete(h as ReturnType<typeof setTimeout>);
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
    close(): void {
      closed = true;
      for (const h of live) clearTimeout(h);
      live.clear();
    }
  };
}

/** The bbox covering every chunk of the manifest. */
function allBbox(m: Manifest): [number, number, number, number] {
  const b = m.chunks.map((c) => c.bbox);
  return [
    Math.min(...b.map((x) => x[0])),
    Math.min(...b.map((x) => x[1])),
    Math.max(...b.map((x) => x[2])),
    Math.max(...b.map((x) => x[3]))
  ];
}

/** The call being filled: its rev once sent (null while its lots resolve). */
interface Pending {
  rev: number | null;
  /** A `refill` at `rev` or later has come (the open owes none). */
  refilled: boolean;
  guard: ReturnType<typeof setTimeout>;
  resolve(view: TimelineView): void;
  reject(e: Error): void;
}

/**
 * Loads the dataset, opens one timeline host on the reconciled empty document at rev 1 and
 * resolves once its window is filled. Rejects with `no dataset at <dir>` (or
 * `no dataset <version> at <origin>`), `host error: <code>: <message>` or
 * `window not filled in <s> s`.
 */
export async function openEngine(
  src: DataSource,
  opts: {
    warn?: (msg: string) => void;
    timeoutMs?: number;
    /** Test seam: the host to drive (default `createTimelineHost`). */
    createHost?: typeof createTimelineHost;
    /** 'on' (default): the dataset's car system, when it has one; 'off': none. */
    cars?: 'on' | 'off';
  } = {}
): Promise<Engine> {
  const warn = opts.warn ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createHost = opts.createHost ?? createTimelineHost;
  const { manifest, fetch, fetchBytes } = await openSource(src);
  const timers = trackedTimers();

  const urls = scenarioUrls(manifest);
  if (urls === null) {
    timers.close();
    throw new Error(
      `host error: scenario-missing: dataset ${manifest.datasetVersion} has no fzp scenario`
    );
  }
  // The host loads again and passes its own warnings on; this load's are the same, dropped.
  const loaded = await loadScenario(
    { fetch, fetchBytes, setTimeout: timers.setTimeout, retryDelaysMs: [], warn: () => {} },
    urls,
    () => false
  );
  if (!('fzp' in loaded)) {
    timers.close();
    throw new Error(`host error: ${loaded.code}: ${loaded.message}`);
  }
  const { calibration: cal, asOf } = loaded.fzp;

  let log: ChunkLog = EMPTY_LOG;
  let pending: Pending | null = null;
  let closed = false;
  let rev = 0;
  let reqId = 0;
  const brushes = new Map<number, (r: BrushLotsResult) => void>();
  const views = new Map<string, TimelineView>();

  const settle = (p: Pending) => {
    clearTimeout(p.guard);
    brushes.clear();
    if (pending === p) pending = null;
  };
  const fail = (p: Pending | null, message: string) => {
    if (p === null || pending !== p) return;
    settle(p);
    p.reject(new Error(message));
  };
  const check = () => {
    const p = pending;
    if (p === null || p.rev === null || !p.refilled || log.statics === null) return;
    if (nextMonth(log) !== log.statics.lastIndex + 1) return;
    settle(p);
    try {
      p.resolve(viewOfLog(log)!);
    } catch (e) {
      p.reject(new Error(`host error: view: ${messageOf(e)}`));
    }
  };

  const post = (msg: TimelineHostResponse) => {
    if (closed) return;
    switch (msg.type) {
      case 'error': {
        // An error at a rev older than the pending call's is an abandoned call's (a timed-out
        // edit the pending one replaces): passed to `warn`, as is one with no call pending. While
        // the pending call resolves its lots it has no rev yet: every rev sent so far is older.
        const text = `host error: ${msg.code}: ${msg.message}`;
        const p = pending;
        if (p === null || msg.rev < (p.rev ?? rev + 1)) return warn(text);
        return fail(p, text);
      }
      case 'compiled':
        log = logCompiled(log, msg.statics);
        return check();
      case 'refill':
        log = logRefill(log, msg.from);
        if (pending !== null && pending.rev !== null && msg.rev >= pending.rev) {
          pending.refilled = true;
        }
        return check();
      case 'filled':
        log = logFilled(log, msg.series);
        return check();
      case 'brushLots': {
        const answer = brushes.get(msg.reqId);
        brushes.delete(msg.reqId);
        answer?.(msg.result);
        return;
      }
      default:
      // `cells`, `lookups`, `compiling` and everything else: dropped on arrival
    }
  };

  const host = createHost({
    fetch,
    fetchBytes,
    post,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => performance.now(),
    retryDelaysMs: [],
    warn,
    cars: opts.cars ?? 'on'
  });

  /** Sends `req`; a throw rejects the pending call. */
  const send = (req: TimelineHostRequest): boolean => {
    try {
      host.handle(req);
      return true;
    } catch (e) {
      fail(pending, `host error: handle: ${messageOf(e)}`);
      return false;
    }
  };

  /** A pending call with its guard running; the caller sends its requests. */
  const begin = (): Promise<TimelineView> =>
    new Promise<TimelineView>((resolve, reject) => {
      const p: Pending = {
        rev: null,
        refilled: false,
        resolve,
        reject,
        guard: setTimeout(
          () => fail(p, `window not filled in ${Math.round(timeoutMs / 1000)} s`),
          timeoutMs
        )
      };
      pending = p;
    });

  const close = () => {
    if (closed) return;
    const p = pending;
    if (p !== null) {
      settle(p);
      p.reject(new Error('engine closed'));
    }
    closed = true;
    host.dispose();
    timers.close();
  };

  const empty = reconcilePolicy4(DEFAULT_POLICY4, cal, asOf).doc;
  let fillMs: number;
  try {
    const opened = begin();
    const p = pending as Pending | null;
    rev = 1;
    p!.rev = rev;
    p!.refilled = true;
    const started = performance.now();
    if (
      send({ type: 'openTimeline', rev, manifest, policy: empty, lots: {}, months: WINDOW_MONTHS })
    ) {
      send({ type: 'prefetch', bbox: allBbox(manifest) });
    }
    views.set(canonicalJson(empty), await opened);
    fillMs = performance.now() - started;
  } catch (e) {
    close();
    throw e;
  }

  /** Resolves the document's lots, sends it at the next rev and waits for the window. */
  const fill = async (policy: SimPolicy4): Promise<TimelineView> => {
    if (closed) throw new Error('engine closed');
    const filled = begin();
    const p = pending as Pending | null;
    const lots: Record<string, ParcelId[]> = {};
    for (const { key, query } of queriesOf4(policy)) {
      const id = ++reqId;
      const answer = new Promise<BrushLotsResult>((resolve) => brushes.set(id, resolve));
      if (!send({ type: 'resolveBrush', reqId: id, query })) return filled;
      const result = await Promise.race([
        answer,
        filled.then(
          () => null,
          () => null
        )
      ]);
      if (result === null || pending !== p) return filled;
      lots[key] = result.ok ? result.lots : [];
    }
    rev += 1;
    p!.rev = rev;
    send({ type: 'setPolicy', rev, policy, lots });
    return filled;
  };

  let queue: Promise<unknown> = Promise.resolve();
  const view = (doc: SimPolicy4): Promise<TimelineView> => {
    const run = queue.then(async () => {
      const policy = reconcilePolicy4(doc, cal, asOf).doc;
      const key = canonicalJson(policy);
      const kept = views.get(key);
      if (kept !== undefined) return kept;
      const v = await fill(policy);
      views.set(key, v);
      return v;
    });
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return { datasetVersion: manifest.datasetVersion, asOf, cal, fillMs, view, close };
}

/**
 * One dataset directory, or `--version <v>` with an optional `--from <origin>`, and the flags
 * named in `flags` (keys without their `--`: `{ write: 'bool', amount: 'value' }` takes `--write`
 * and `--amount <v>`); the flags given are returned under the same keys, a bool one as `true`.
 */
export function parseSourceArgs(
  argv: string[],
  flags: Record<string, 'bool' | 'value'>
): { src: DataSource; flags: Record<string, string | true> } | { error: string } {
  const kinds: Record<string, 'bool' | 'value'> = { ...flags, version: 'value', from: 'value' };
  const given: Record<string, string | true> = {};
  let dir: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) {
      if (dir !== null) return { error: `unexpected argument ${a}` };
      dir = a;
      continue;
    }
    const name = a.startsWith('--') ? a.slice(2) : '';
    const kind = Object.hasOwn(kinds, name) ? kinds[name] : undefined;
    if (kind === undefined) return { error: `unknown flag ${a}` };
    if (Object.hasOwn(given, name)) return { error: `${a} given twice` };
    if (kind === 'bool') {
      given[name] = true;
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    given[name] = v;
    i += 1;
  }
  const { version, from, ...rest } = given;
  if (from !== undefined && version === undefined) return { error: '--from needs --version' };
  if (version !== undefined && dir !== null) {
    return { error: `--version and a dataset directory (${dir}) are both given` };
  }
  if (typeof version === 'string') {
    return {
      src: { version, origin: typeof from === 'string' ? from : DEFAULT_ORIGIN },
      flags: rest
    };
  }
  if (dir === null) return { error: 'give a dataset directory or --version <datasetVersion>' };
  return { src: { dir }, flags: rest };
}
