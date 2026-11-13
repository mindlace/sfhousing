/**
 * The policy compiler (policy-timeline spec, S6, S13, rules 16 to 21 and 23): a dated policy
 * document compiled into one `PolicyFrame` per model month of the window, in slices. Frame ids
 * and zoning views are interned by content for the worker's life (rule 17). Worker-safe.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { LayerCtx } from '$lib/sim/levers/layers';
import type { LeverCapacity } from '$lib/sim/levers/resolve';
import { routeSharesOp, type StageScale } from '$lib/sim/levers/timers';
import { LeverFormatError, type FinanceLevers } from '$lib/sim/levers/types';
import type { SimInput } from '$lib/sim/scenario/types';
import { canonicalJson, PolicyFormatError } from '$lib/sim-page/policy';
import { checkSpanDays } from '$lib/timeline/parse4';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { programmeTermGaps, reconcilePolicy4 } from '$lib/timeline/reconcile4';
import type { Day } from '$lib/timelapse/time';
import type { Calibration, Pathway } from '$lib/timelapse/types';
import { monthFirstDay } from '../months';
import {
  inForceAt,
  moneyLeversOf,
  permittingOf,
  zoningKeyOf,
  zoningLevers,
  type Active,
  type InForce,
  type Permitting
} from './combine';
import type { PolicyFrame, PolicyTimeline, ZoningView } from './frame';
import { digest128, frameIdOf, serialOf, VIEWS, type ViewInfo } from './intern';
import { createMoneyTrack } from './money';
import {
  createViewJob,
  touchedRows,
  viewDigest,
  type ViewJob,
  type YieldSource
} from './zoning-view';

export type { YieldSource } from './zoning-view';

/** The worker's loaded dataset (S13, amended 2026-11-13). */
export interface CompileCtx {
  input: SimInput;
  layers: LayerCtx;
  windowMonths: number;
  yields: YieldSource;
  /** The clock that bounds a slice; default `performance.now`. */
  now?: () => number;
}

export interface TimelineCompile {
  /**
   * At most about `budgetMs` plus one unit of work; true when every frame of the window exists.
   * Throws `LeverFormatError` when a month's policies cannot be compiled: a zoning policy in force
   * under `base: 'preFzp'`, or a brush query with no entry in `lots`.
   */
  step(budgetMs: number): boolean;
  /** Needs computed and needed over this compile's view jobs; failed cells those jobs need. */
  progress(): { done: number; total: number; failedCells: string[] };
  /** Once month 1's frame exists; its `readyThrough()` grows as `step` is called. */
  result(): PolicyTimeline;
  /** Of the view in force in the window's last month (rule 23); once `step` returned true. */
  capacity(): LeverCapacity;
  unknownLots(): number;
  /**
   * The lots whose zoning changed and that have no yield record (yield 0, as today); the runner
   * logs them. An S13 amendment approved by the conductor.
   */
  missingLots(): number;
}

/** The content digest of each view, computed once (it hashes every column). */
const DIGESTS = new WeakMap<ZoningView, string>();
function digestOf(v: ZoningView): string {
  let d = DIGESTS.get(v);
  if (d === undefined) DIGESTS.set(v, (d = viewDigest(v)));
  return d;
}

/**
 * A view's info per lever key: two zoning states with equal views can differ in what they
 * protect, so the info goes with the state, not the view (`VIEWS.info` keeps one per view).
 */
const INFOS = new WeakMap<ZoningView, Map<string, ViewInfo>>();
function setInfo(v: ZoningView, key: string, info: ViewInfo): void {
  let m = INFOS.get(v);
  if (m === undefined) INFOS.set(v, (m = new Map()));
  m.set(key, info);
}

const EMPTY = new Int32Array(0);

function fail(path: string, message: string): never {
  throw new LeverFormatError(path, message);
}

/** Rule 4's span checks: `parsePolicy4`'s own, with the dataset date `asOf`. */
function checkSpans(doc: SimPolicy4, asOf: Day): void {
  try {
    for (const kind of ['zoning', 'permitting', 'money'] as const)
      doc.kinds[kind].forEach((p, i) =>
        p.spans.forEach((s, j) =>
          checkSpanDays(s, `kinds.${kind}[${i}].spans[${j}]`, j > 0 ? p.spans[j - 1] : null, asOf)
        )
      );
  } catch (e) {
    if (e instanceof PolicyFormatError) fail(e.path, e.message.slice(e.path.length + 2));
    throw e;
  }
}

/** A scale without its 1 entries (absent means 1, S4), for the frame key. */
function scaleKey(s: StageScale): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [p, row] of Object.entries(s)) {
    out[p] = {};
    for (const [stage, x] of Object.entries(row)) if (x !== 1) out[p][stage] = x as number;
  }
  return out;
}

/** `(policy index, span index)` of each policy in force: in-force sets change only at spans. */
const activeKey = (as: readonly Active[]) =>
  as.map((a) => `${a.index}.${a.policy.spans.indexOf(a.span)}`).join(',');

/** What a distinct set of zoning and permitting spans in force gives. */
interface State {
  /** The view's key in `VIEWS` and in this compile: input, layers, base and zoning state. */
  leverKey: string;
  zoning: ReturnType<typeof zoningLevers>;
  permitting: Permitting;
  /** Canonical text of route shares, `speed` and `speedNew`. */
  permKey: string;
}

/** The objects frames of one id share. */
interface Shared {
  view: ZoningView;
  newCalibration: Calibration;
  speed: StageScale;
  speedNew: PolicyFrame['speedNew'];
}

/**
 * Compiles `doc` (reconciled with `ctx.input.calibration`) into a frame per month of the window.
 * The checks run here; all other work runs in `step`. `base: 'preFzp'` starts from the zoning
 * before the plan and takes no zoning policy (plan Q5); its `capacity()` is a new definition
 * (the base table's net capacity, nothing protected), not today's number, and is not meant to be
 * shown.
 */
export function compileTimeline(
  doc: SimPolicy4,
  lots: Record<string, ParcelId[]>,
  ctx: CompileCtx,
  base: 'plan' | 'preFzp'
): TimelineCompile {
  const { input, layers, yields } = ctx;
  const W = ctx.windowMonths;
  if (!Number.isInteger(W) || W < 1)
    throw new RangeError(`compileTimeline: windowMonths ${W} is not a whole number of months`);
  // Before the reconciled check: an unaligned span is named by its own path.
  checkSpans(doc, input.asOf);
  if (reconcilePolicy4(doc, input.calibration, input.asOf).doc !== doc)
    fail('policy', 'expected a reconciled document');
  // Implied by the check above (reconcile drops every gap it finds); kept so the guard is exactly
  // the set of programmes and stretches `programmeTermGaps` checks. `buildFinance` then checks
  // only the programmes in force in a month, with that month's terms: a subset of it.
  const gap = programmeTermGaps(doc)[0];
  if (gap !== undefined) fail(gap.path, `needs ${gap.term}, which is not sourced`);

  const now = ctx.now ?? (() => performance.now());
  const asOf = input.asOf;
  const serials = { i: serialOf(input), l: serialOf(layers) };
  const money = createMoneyTrack(doc, input);
  const market = input.market ?? [];

  const states = new Map<string, State>();
  const moneyLevers = new Map<string, FinanceLevers>();
  const newCals = new Map<string, Calibration>();
  const held = new Map<string, { view: ZoningView; info: ViewInfo }>();
  const jobs = new Map<string, ViewJob>();
  // Finished jobs are dropped (with their recompute maps); only their counts are kept.
  const finished = { done: 0, total: 0 };
  const missing = new Set<ParcelId>();
  const shared = new Map<number, Shared>();
  const touchedMemo = new Map<string, Int32Array>();

  const frames: PolicyFrame[] = [];
  const changes: number[] = [];
  const touched: Int32Array[] = [];
  let lastInfo: ViewInfo | null = null;

  function stateOf(f: InForce): State {
    const k = `${activeKey(f.zoning)}|${activeKey(f.permitting)}`;
    let st = states.get(k);
    if (st !== undefined) return st;
    if (base === 'preFzp' && f.zoning.length > 0) fail('base', "zoning policies need base 'plan'");
    const permitting = permittingOf(f);
    const zoning = zoningLevers(f, lots, permitting.localProgramStreamlined);
    // Under 'preFzp' the view is the pre-plan zoning whatever the Local Program switch says (the
    // twin's all-zero column); route shares still reach `newCalibration` (rule 14).
    const z = base === 'plan' ? digest128(zoningKeyOf(zoning)) : null;
    st = {
      leverKey: canonicalJson({ ...serials, b: base, z }),
      zoning,
      permitting,
      permKey: canonicalJson({
        r: permitting.routeShares,
        s: scaleKey(permitting.speed),
        n: permitting.speedNew.map((e) => ({ from: e.from, scale: scaleKey(e.scale) }))
      })
    };
    states.set(k, st);
    return st;
  }

  function newCalibrationOf(shares: Record<Pathway, number> | null): Calibration {
    const k = canonicalJson(shares);
    let cal = newCals.get(k);
    if (cal === undefined) {
      cal = routeSharesOp(shares)(input.calibration, input.parcels).cal;
      newCals.set(k, cal);
    }
    return cal;
  }

  /** The view of `st` from this compile, the worker's cache, or null with its job to step. */
  function viewOf(st: State): { view: ZoningView; info: ViewInfo } | ViewJob {
    const k = st.leverKey;
    const h = held.get(k);
    if (h !== undefined) return h;
    const cached = VIEWS.get(k);
    if (cached !== undefined) {
      const info = INFOS.get(cached)?.get(k) ?? VIEWS.info(cached)!;
      const v = { view: cached, info };
      held.set(k, v);
      return v;
    }
    let job = jobs.get(k);
    if (job === undefined) {
      job = createViewJob(input, layers, yields, now, st.zoning, base);
      jobs.set(k, job);
    }
    return job;
  }

  /** A finished job's view, interned by content so equal views are one object (rule 17). */
  function finish(st: State, job: ViewJob): void {
    const k = st.leverKey;
    const r = job.result();
    for (const id of job.missing()) missing.add(id);
    const contentKey = canonicalJson({ ...serials, v: digestOf(r.view) });
    let view = VIEWS.get(contentKey);
    if (view === undefined) {
      view = r.view;
      VIEWS.put(contentKey, view, r.info);
    }
    VIEWS.put(k, view, r.info);
    setInfo(view, k, r.info);
    held.set(k, { view, info: r.info });
    finished.done += job.done;
    finished.total += job.total;
    jobs.delete(k);
  }

  function marketAt(day: Day): number {
    let x = 0;
    for (const s of market) if (s.from <= day) x = s.logOdds;
    return x;
  }

  function moneyLeversAt(f: InForce): FinanceLevers {
    const k = activeKey(f.money);
    let l = moneyLevers.get(k);
    if (l === undefined) moneyLevers.set(k, (l = moneyLeversOf(f)));
    return l;
  }

  function touchedBetween(a: ZoningView, b: ZoningView): Int32Array {
    const k = `${digestOf(a)}>${digestOf(b)}`;
    let t = touchedMemo.get(k);
    if (t === undefined) touchedMemo.set(k, (t = touchedRows(a, b)));
    return t;
  }

  /** Month m's frame from its view (rules 16, 20, 21). */
  function assemble(m: number, f: InForce, st: State, v: { view: ZoningView; info: ViewInfo }) {
    const day = monthFirstDay(asOf, m);
    const fin = money.month(m, moneyLeversAt(f));
    const mk = marketAt(day);
    const id = frameIdOf(
      canonicalJson({ ...serials, v: digestOf(v.view), p: st.permKey, k: mk, f: fin?.key ?? null })
    );
    let sh = shared.get(id);
    if (sh === undefined) {
      sh = {
        view: v.view,
        newCalibration: newCalibrationOf(st.permitting.routeShares),
        speed: st.permitting.speed,
        speedNew: st.permitting.speedNew
      };
      shared.set(id, sh);
    }
    const frame: PolicyFrame = {
      id,
      view: sh.view,
      calibration: input.calibration,
      newCalibration: sh.newCalibration,
      speed: sh.speed,
      speedNew: sh.speedNew,
      market: mk,
      finance: fin?.frame ?? null
    };
    const prev = frames[m - 2];
    if (prev !== undefined && prev.id !== id) {
      changes.push(m);
      touched[m - 1] = prev.view === frame.view ? EMPTY : touchedBetween(prev.view, frame.view);
    }
    frames.push(frame);
    if (m === W) lastInfo = v.info;
  }

  /** One unit: month `ready + 1`'s assembly or a step of its view's job. False: no progress. */
  function advance(budgetMs: number): boolean {
    const m = frames.length + 1;
    const f = inForceAt(doc, monthFirstDay(asOf, m));
    const st = stateOf(f);
    const v = viewOf(st);
    if ('view' in v) {
      assemble(m, f, st, v);
      return true;
    }
    if (!v.step(budgetMs)) return false;
    finish(st, v);
    return true;
  }

  const ready = () => frames.length;
  const inRange = (m: number, what: string) => {
    if (!Number.isInteger(m) || m < 1 || m > ready())
      throw new RangeError(`${what}: month ${m} is outside 1..${ready()}`);
  };

  const timeline: PolicyTimeline = {
    frameAt(m) {
      inRange(m, 'frameAt');
      return frames[m - 1];
    },
    changes: () => [...changes],
    touched(m) {
      inRange(m, 'touched');
      if (m === 1) return null;
      return touched[m - 1] ?? EMPTY;
    },
    readyThrough: ready
  };

  const complete = () => {
    if (ready() < W) throw new Error('compileTimeline: the compile is not complete');
    return lastInfo!;
  };

  return {
    step(budgetMs) {
      const t0 = now();
      let first = true;
      while (ready() < W) {
        const left = budgetMs - (now() - t0);
        if (!first && left <= 0) return false;
        first = false;
        // A view job's step that returns false has spent the budget or waits on cells.
        if (!advance(Math.max(0, left))) return false;
      }
      return true;
    },
    progress() {
      let done = finished.done;
      let total = finished.total;
      const cells = new Set<string>();
      for (const j of jobs.values()) {
        done += j.done;
        total += j.total;
        for (const c of j.cellsNeeded()) cells.add(c);
      }
      return { done, total, failedCells: yields.failedCells().filter((c) => cells.has(c)) };
    },
    result() {
      if (ready() === 0) throw new Error('compileTimeline: result() before month 1 exists');
      return timeline;
    },
    capacity: () => complete().capacity,
    unknownLots: () => complete().unknownLots,
    missingLots: () => missing.size
  };
}
