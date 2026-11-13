/**
 * One zoning state's `ZoningView`, built as a sliced job with today's code (policy-timeline spec,
 * rules 18 and 20): `resolveEnvelopes`, the yield recompute of its Needs, `fillNeeds` and
 * `applyLevers`, then `precomputeOf`, in the order `leverStep` runs them
 * (`scenario/scenario-host.ts`). Each unit finishes before the budget is checked. Today's
 * `precomputeOf` and recompute step sit behind their own seams (`precomputeView`,
 * `recomputeStep`), so a finer-sliced version can replace either without touching the compiler.
 * Worker-safe.
 */
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { applyLevers, twinInput } from '$lib/sim/levers/apply';
import { stockTable, type LayerCtx } from '$lib/sim/levers/layers';
import type { YieldRecompute } from '$lib/sim/levers/recompute';
import {
  allNeeds,
  fillNeeds,
  netCapacity,
  resolveEnvelopes,
  type Need,
  type Resolution
} from '$lib/sim/levers/resolve';
import { DEFAULT_LEVERS, LeverFormatError, type SimLevers } from '$lib/sim/levers/types';
import { precomputeOf, type Precompute } from '$lib/sim/scenario/input';
import type { SimInput } from '$lib/sim/scenario/types';
import type { ZoningLevers } from './combine';
import type { ZoningView } from './frame';
import { murmur3x86_128, type ViewInfo } from './intern';

/** Gives the compiler the lot yields a changed zoning needs (S13, amended 2026-11-13). */
export interface YieldSource {
  /** Today's `createTableRecompute` or `createYieldRecompute`, closed over the runner's table or chunks and clock. */
  recompute(parcels: ScenarioParcels, needs: readonly Need[]): YieldRecompute;
  /** Cells whose chunks failed to load. */
  failedCells(): readonly string[];
}

export interface ViewJob {
  /** At most about `budgetMs` plus one unit of work; true when the view is built. */
  step(budgetMs: number): boolean;
  /** Needs computed and needed, as `resolving` reports them (0 of 0 before the envelopes resolve). */
  readonly done: number;
  readonly total: number;
  /** Cells of pending needs that are not loaded yet. */
  cellsNeeded(): string[];
  /** After `step` returned true. */
  result(): { view: ZoningView; info: ViewInfo };
}

/** Seam: "precompute a view". Today's `precomputeOf`, whole. */
export function precomputeView(plan: SimInput): Precompute {
  return precomputeOf(plan);
}

/** Seam: "one recompute step". Today's `YieldRecompute.step`, whole. */
export function recomputeStep(job: YieldRecompute, budgetMs: number): boolean {
  return job.step(budgetMs);
}

/** True when `z` changes nothing in the envelopes (the Local Program switch apart). */
function noZoning(z: ZoningLevers): boolean {
  const p = z.protect;
  return (
    z.rules.length === 0 &&
    z.paint.length === 0 &&
    !p.rentControl &&
    !p.historic &&
    p.newerThanYears === null
  );
}

type Unit = 'resolve' | 'recompute' | 'apply' | 'precompute' | 'done';

/**
 * The job building the view of zoning `z` on `base`. `'plan'`: FZP with `z` resolved on it.
 * `'preFzp'`: the zoning before the plan (`twinInput(…, 'preFzp')`), only with no zoning lever
 * in force; any zoning lever throws `LeverFormatError` at `base` (plan Q5).
 */
export function createViewJob(
  input: SimInput,
  layers: LayerCtx,
  yields: YieldSource,
  now: () => number,
  z: ZoningLevers,
  base: 'plan' | 'preFzp'
): ViewJob {
  if (base === 'preFzp' && !noZoning(z))
    throw new LeverFormatError('base', "zoning levers need base 'plan'");

  const levers: SimLevers = { ...DEFAULT_LEVERS, ...z, compare: 'preFzp' };
  let unit: Unit = base === 'preFzp' ? 'precompute' : 'resolve';
  let resolution: Resolution | null = null;
  let recompute: YieldRecompute | null = null;
  let plan: SimInput | null = base === 'preFzp' ? twinInput(input, layers, 'preFzp') : null;
  let info: ViewInfo | null = null;
  if (base === 'preFzp') {
    const c = netCapacity(stockTable(layers, 'base'), input.parcels);
    info = { capacity: { plan: c, withoutProtections: c, protectedLots: 0 }, unknownLots: 0 };
  }
  let view: ZoningView | null = null;

  /** Runs the next unit; false when it could not finish (budget spent or waiting on cells). */
  function run(remaining: number): boolean {
    switch (unit) {
      case 'resolve': {
        resolution = resolveEnvelopes(layers, levers, input.asOf);
        recompute = yields.recompute(input.parcels, allNeeds(resolution));
        unit = recompute.total === 0 ? 'apply' : 'recompute';
        return true;
      }
      case 'recompute': {
        if (!recomputeStep(recompute!, remaining)) return false;
        unit = 'apply';
        return true;
      }
      case 'apply': {
        const filled = fillNeeds(resolution!, recompute!.result());
        const li = applyLevers(input, layers, levers, filled);
        plan = li.plan;
        info = { capacity: li.capacity, unknownLots: li.unknownLots };
        resolution = null;
        unit = 'precompute';
        return true;
      }
      case 'precompute': {
        view = { parcels: plan!.parcels, pre: precomputeView(plan!) };
        plan = null; // the plan SimInput is not kept
        unit = 'done';
        return true;
      }
      case 'done':
        return true;
    }
  }

  return {
    step(budgetMs) {
      const start = now();
      let ran = false;
      while (unit !== 'done') {
        const left = budgetMs - (now() - start);
        if (ran && left <= 0) return false;
        if (!run(Math.max(0, left))) return false;
        ran = true;
      }
      return true;
    },
    get done() {
      return recompute?.done ?? 0;
    },
    get total() {
      return recompute?.total ?? 0;
    },
    cellsNeeded() {
      return unit === 'recompute' ? recompute!.cellsNeeded() : [];
    },
    result() {
      if (view === null) throw new Error('createViewJob: result() before the view is built');
      return { view, info: info! };
    }
  };
}

const differs = (x: number, y: number) => x !== y && !(x !== x && y !== y);

/**
 * Rows (ascending) whose `parcels` row or start rate differs between two views of one dataset:
 * `envelopeStories`, `yield`, `hostable`, `localProgram`, `potentialRatio.fzp`, `storiesGap.fzp`
 * and `pre.logit`.
 */
export function touchedRows(a: ZoningView, b: ZoningView): Int32Array {
  const p = a.parcels;
  const q = b.parcels;
  const n = p.count;
  if (q.count !== n) throw new Error(`touchedRows: ${n} rows against ${q.count}`);
  const F = p.fillLevels.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let d =
      p.envelopeStories[i] !== q.envelopeStories[i] ||
      p.hostable[i] !== q.hostable[i] ||
      p.localProgram[i] !== q.localProgram[i] ||
      p.storiesGap.fzp[i] !== q.storiesGap.fzp[i] ||
      differs(p.potentialRatio.fzp[i], q.potentialRatio.fzp[i]) ||
      differs(a.pre.logit[i], b.pre.logit[i]);
    for (let f = 0; !d && f < F; f++) d = p.yield[i * F + f] !== q.yield[i * F + f];
    if (d) out.push(i);
  }
  return Int32Array.from(out);
}

const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/**
 * A content digest of a view over the columns `touchedRows` compares: within one dataset and
 * input, equal views give equal digests, and different digests mean different views. Values
 * are hashed as their bytes, so +0 and -0 (or two NaN payloads) count as different.
 */
export function viewDigest(view: ZoningView): string {
  const p = view.parcels;
  const parts: ArrayBufferView[] = [
    Uint32Array.of(p.count, p.fillLevels.length),
    p.envelopeStories,
    p.yield,
    p.hostable,
    p.localProgram,
    p.potentialRatio.fzp,
    p.storiesGap.fzp,
    view.pre.logit
  ];
  let len = 0;
  for (const x of parts) len += x.byteLength + 4;
  const bytes = new Uint8Array(len);
  let at = 0;
  for (const x of parts) {
    // Each part prefixed with its length, so moving bytes between parts changes the digest.
    bytes.set(bytesOf(Uint32Array.of(x.byteLength)), at);
    bytes.set(bytesOf(x), at + 4);
    at += x.byteLength + 4;
  }
  let out = '';
  for (const h of murmur3x86_128(bytes, 0)) out += h.toString(16).padStart(8, '0');
  return out;
}
