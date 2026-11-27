/**
 * One zoning state's `ZoningView`, built as a sliced job with today's code (policy-timeline spec,
 * rules 18 and 20): `resolveEnvelopes` and `applyLevers`, then `precomputeOf`, in the order the
 * lever step runs them. A lot's homes at any envelope are its options' (options.bin), so no unit
 * waits on parcel chunks. Each unit finishes before the budget is checked, so a call can run past
 * its budget by one whole unit: a whole `applyLevers` or `precomputeOf` (about 45 ms on the live
 * city before the option rows; accepted by conductor ruling Q7(a)). Today's `precomputeOf` sits
 * behind its own seam (`precomputeView`), so a finer-sliced version can replace it without
 * touching the compiler. Worker-safe.
 */
import { applyLevers, twinInput } from '$lib/sim/levers/apply';
import { stockTable, type LayerCtx } from '$lib/sim/levers/layers';
import { netCapacity, resolveEnvelopes, type Resolution } from '$lib/sim/levers/resolve';
import { DEFAULT_LEVERS, LeverFormatError, type SimLevers } from '$lib/sim/levers/types';
import { precomputeOf, type Precompute } from '$lib/sim/world/input/build';
import type { SimInput } from '$lib/sim/world/input/types';
import type { ZoningLevers } from './combine';
import type { ZoningView } from './frame';
import { murmur3x86_128, type ViewInfo } from './intern';

export interface ViewJob {
  /**
   * Runs at least one unit, then more while budget is left; true when the view is built. A unit
   * starts with any budget left and runs whole, so a call may overrun by one unit (see above).
   */
  step(budgetMs: number): boolean;
  /** After `step` returned true. */
  result(): { view: ZoningView; info: ViewInfo };
}

/** Seam: "precompute a view". Today's `precomputeOf`, whole. */
export function precomputeView(plan: SimInput): Precompute {
  return precomputeOf(plan);
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

type Unit = 'twin' | 'resolve' | 'apply' | 'precompute' | 'done';

/**
 * The job building the view of zoning `z` on `base`. `'plan'`: FZP with `z` resolved on it.
 * `'preFzp'`: the zoning before the plan (`twinInput(…, 'preFzp')`), only with no zoning lever
 * in force; any zoning lever throws `LeverFormatError` at `base` (plan Q5).
 */
export function createViewJob(
  input: SimInput,
  layers: LayerCtx,
  now: () => number,
  z: ZoningLevers,
  base: 'plan' | 'preFzp'
): ViewJob {
  if (base === 'preFzp' && !noZoning(z))
    throw new LeverFormatError('base', "zoning levers need base 'plan'");

  const levers: SimLevers = { ...DEFAULT_LEVERS, ...z, compare: 'preFzp' };
  let unit: Unit = base === 'preFzp' ? 'twin' : 'resolve';
  let resolution: Resolution | null = null;
  let plan: SimInput | null = null;
  let info: ViewInfo | null = null;
  let view: ZoningView | null = null;

  /** Runs the next unit. */
  function run(): void {
    switch (unit) {
      case 'twin': {
        plan = twinInput(input, layers, 'preFzp');
        // A new definition (today never computes a pre-plan capacity): the base table's net
        // capacity with nothing protected. Only a comparison compile reaches it, and it is not
        // today's number, so it is not meant to be shown.
        const c = netCapacity(stockTable(layers, 'base'), input.parcels, layers.options);
        info = { capacity: { plan: c, withoutProtections: c, protectedLots: 0 }, unknownLots: 0 };
        unit = 'precompute';
        return;
      }
      case 'resolve': {
        resolution = resolveEnvelopes(layers, levers, input.asOf);
        unit = 'apply';
        return;
      }
      case 'apply': {
        const li = applyLevers(input, layers, levers, resolution!);
        plan = li.plan;
        info = { capacity: li.capacity, unknownLots: li.unknownLots };
        resolution = null;
        unit = 'precompute';
        return;
      }
      case 'precompute': {
        view = { parcels: plan!.parcels, pre: precomputeView(plan!) };
        plan = null; // the plan SimInput is not kept
        unit = 'done';
        return;
      }
      case 'done':
        return;
    }
  }

  return {
    step(budgetMs) {
      const start = now();
      let ran = false;
      while (unit !== 'done') {
        if (ran && budgetMs - (now() - start) <= 0) return false;
        run();
        ran = true;
      }
      return true;
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
 * `envelopeStories`, `fzpCap`, `hostable`, `localProgram` and `pre.logit` (the start features
 * come from the envelope and cap through the option rows, so they are not compared apart).
 */
export function touchedRows(a: ZoningView, b: ZoningView): Int32Array {
  const p = a.parcels;
  const q = b.parcels;
  const n = p.count;
  if (q.count !== n) throw new Error(`touchedRows: ${n} rows against ${q.count}`);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const d =
      p.envelopeStories[i] !== q.envelopeStories[i] ||
      p.fzpCap[i] !== q.fzpCap[i] ||
      p.hostable[i] !== q.hostable[i] ||
      p.localProgram[i] !== q.localProgram[i] ||
      differs(a.pre.logit[i], b.pre.logit[i]);
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
    Uint32Array.of(p.count),
    p.envelopeStories,
    p.fzpCap,
    p.hostable,
    p.localProgram,
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
