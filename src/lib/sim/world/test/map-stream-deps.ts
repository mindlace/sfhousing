// Test support: a `MapStreamDeps` over a city's chunk records. Browser-safe.
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { createLru, type Lru } from '$lib/sim/lru';
import type { SimInput } from '$lib/sim/scenario/types';
import { createMapStream, type MapStreamDeps } from '../map-stream';
import type { PolicyTimeline } from '../policy/frame';
import type { Statics } from '../statics';
import { runWorld } from './run';

type GenMemo = Lru<string, GeneratedBuilding | null>;

const shared = new WeakMap<SimInput, GenMemo>();

/**
 * One generator memo per `input` for the life of the test file's module, as the host shares one
 * across seeds and inits within a dataset version (massing.ts:25). The memo is a pure cache of
 * `generate` by content, and the stream's own massing memo (the one rules 6 and 11 and budget
 * slicing turn on) stays per stream, so sharing it changes no result; it only spares later
 * streams of a file the generator's cold cost. Timing specs and scripts leave it out.
 */
export function sharedGenMemo(input: SimInput): GenMemo {
  let m = shared.get(input);
  if (!m) {
    m = createLru<string, GeneratedBuilding | null>(60_000);
    shared.set(input, m);
  }
  return m;
}

/**
 * Fills `sharedGenMemo(input)` with the massing of every revision a run of `timeline` and `seed`
 * holds at month `through`: one fresh stream's `snapshot` of that world (revisions are never
 * dropped from a schedule, so that is every revision a fill of the same run sends). For a spec's
 * `beforeAll`, so the generator's cold cost is paid once in the hook, not by whichever test runs
 * the file's first long fill.
 */
export function warmGenMemo(
  input: SimInput,
  records: Iterable<ParcelRecord>,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number
): void {
  const world = runWorld(statics, timeline, seed, through);
  const stream = createMapStream(
    streamDeps(input, records, { genMemo: sharedGenMemo(input) }),
    through
  );
  stream.snapshot(world, statics);
}

/**
 * Deps whose records answer for every record given, and whose cells are all ready unless `ready`
 * says otherwise. `massingCalls` counts `massing.memo.get` calls: one per `massingFor` call that
 * reaches the generator memo (massing.ts:119-129), hit or miss. `warnings` holds every `warnOnce`
 * and `logOnce` message, once per key. The generator memo is a fresh one unless `genMemo` gives
 * one (`sharedGenMemo`).
 */
export function streamDeps(
  input: SimInput,
  records: Iterable<ParcelRecord>,
  o: {
    ready?: (cellId: string) => boolean;
    now?: () => number;
    massingCap?: number;
    genMemo?: GenMemo;
  } = {}
): MapStreamDeps & { massingCalls(): number; warnings: string[] } {
  const byId = new Map<ParcelId, ParcelRecord>();
  for (const r of records) byId.set(r.id, r);
  const inner = o.genMemo ?? createLru<string, GeneratedBuilding | null>(60_000);
  let calls = 0;
  const memo: Lru<string, GeneratedBuilding | null> = {
    get(key) {
      calls++;
      return inner.get(key);
    },
    set: (key, value) => inner.set(key, value),
    clear: () => inner.clear(),
    get size() {
      return inner.size;
    },
    cap: inner.cap
  };
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warnOnce = (key: string, msg: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(msg);
  };
  const deps: MapStreamDeps & { massingCalls(): number; warnings: string[] } = {
    massing: {
      input,
      records: (id) => byId.get(id),
      memo,
      gen: generate,
      genForUnits: generateForUnits,
      logOnce: (projectId, msg) => warnOnce(`massing:${projectId}`, msg)
    },
    cellReady: o.ready ?? (() => true),
    warnOnce,
    massingCalls: () => calls,
    warnings
  };
  if (o.now) deps.now = o.now;
  if (o.massingCap !== undefined) deps.massingCap = o.massingCap;
  return deps;
}
