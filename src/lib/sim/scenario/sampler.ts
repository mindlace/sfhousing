// T12 `sampleTransition` for the engine's hot path (spec §4.4.2, §4.11): the same result, bit for
// bit, with each transition's constants computed once. `sampleTransition` re-derives them on
// every call: the table sums C(k) of its binary search and slices, the tail rate rho, log(1 −
// rho) and the tail shares. A band run makes about 34,000 stage steps on the bench city, so this
// module evaluates exactly those expressions, in the same order, once per transition, and replays
// T12's `literalDraw` (`tableMonth`, `tableSlice`, `tailMonth`, `tailSlice`) and its day
// placement on them. The one case it does not replay, a draw relative to the tail (months
// already survived ≥ K, or a target no tail month reaches), calls `sampleTransition` itself, as
// does any argument `sampleTransition` would reject.
//
// The cache is keyed by `Transition` identity, so a transition must not be mutated after its
// first draw (a SimInput's calibration never is: the precompute already assumes it).
// sampler.spec.ts checks the equality with `sampleTransition` on every fixture calibration.
import { exp, log } from '$lib/timelapse/math';
import { sampleTransition } from '$lib/timelapse/model';
import { MONTH_DAYS } from '$lib/timelapse/time';
import { EXIT_ORDER, type ExitReason, type Transition } from '$lib/timelapse/types';

export type Kind = 'advance' | ExitReason;

/** T12's `MAX_EVENT_MONTH`: the last event month, with k × MONTH_DAYS ≤ 2^24. */
const MAX_EVENT_MONTH = Math.floor(16777216 / MONTH_DAYS);

interface Table {
  /** K, the table months */
  K: number;
  /** C(k) = T12 `tableSum(t, k)` at [k], k = 1..K; [0] is unused */
  C: Float64Array;
  /** advance, then the transition's reasons in `EXIT_ORDER` (T12 `reasonsOf`) */
  kinds: Kind[];
  /** month k's `tableSlice` boundaries at [k * n + j], n = kinds.length: the hi of slice j */
  hi: Float64Array;
  /** 1 − C(K) */
  S: number;
  /** log(1 − rho), rho = T12 `tailRate(t)` */
  L: number;
  /** T12 `tailShares`, in `kinds` order */
  share: Float64Array;
  /** the last kind with a positive tail share (T12 `tailSlice`'s `last`) */
  lastShare: number;
}

const tables = new WeakMap<Transition, Table>();

/** T12 `tableSum`: advance plus every exit at table month k, in `EXIT_ORDER`. */
function tableSum(t: Transition, k: number): number {
  let c = t.advance[k - 1];
  for (const r of EXIT_ORDER) c += t.exit[r]?.[k - 1] ?? 0;
  return c;
}

function tableOf(t: Transition): Table {
  const hit = tables.get(t);
  if (hit) return hit;
  const K = t.months;
  const C = new Float64Array(K + 1);
  for (let k = 1; k <= K; k++) C[k] = tableSum(t, k);
  const kinds: Kind[] = [
    'advance',
    ...EXIT_ORDER.filter((r) => t.exit[r] !== undefined || t.tail.exit[r] !== undefined)
  ];
  const n = kinds.length;
  const at = (kind: Kind, month: number) =>
    month === 0 ? 0 : kind === 'advance' ? t.advance[month - 1] : (t.exit[kind]?.[month - 1] ?? 0);
  const hi = new Float64Array((K + 1) * n);
  for (let k = 1; k <= K; k++) {
    // T12 `tableSlice`: boundary j sums F_i(k) for i <= j and F_i(k - 1) for i > j, in order
    for (let j = 0; j < n - 1; j++) {
      let h = 0;
      for (let i = 0; i < n; i++) h += at(kinds[i], i <= j ? k : k - 1);
      hi[k * n + j] = h;
    }
    hi[k * n + n - 1] = C[k];
  }
  let rho = t.tail.advance;
  for (const r of EXIT_ORDER) rho += t.tail.exit[r] ?? 0;
  const share = Float64Array.from(kinds, (kind) =>
    kind === 'advance' ? t.tail.advance / rho : (t.tail.exit[kind] ?? 0) / rho
  );
  let lastShare = n - 1;
  while (lastShare > 0 && !(share[lastShare] > 0)) lastShare--;
  const table: Table = {
    K,
    C,
    kinds,
    hi,
    S: 1 - (K >= 1 ? C[K] : 0),
    L: log(1 - rho),
    share,
    lastShare
  };
  tables.set(t, table);
  return table;
}

/** T12 `cumulativeTotal(t, k)`: C(k), in closed form beyond the table. */
function cumulative(tb: Table, k: number): number {
  if (k === 0) return 0;
  if (k <= tb.K) return tb.C[k];
  return 1 - tb.S * exp((k - tb.K) * tb.L);
}

/** T12 `tailMonth(t, c, false)`: the least tail month whose C(k) exceeds c, or null. */
function tailMonth(tb: Table, c: number): number | null {
  const K = tb.K;
  const q = log((1 - c) / tb.S) / tb.L;
  let k = Number.isFinite(q) ? K + Math.ceil(q) : MAX_EVENT_MONTH;
  k = Math.min(Math.max(k, K + 1), MAX_EVENT_MONTH);
  while (k - 1 > K && cumulative(tb, k - 1) > c) k--;
  while (k < MAX_EVENT_MONTH && !(cumulative(tb, k) > c)) k++;
  return cumulative(tb, k) > c ? k : null;
}

/** The outcome of the last `sample` call (scratch, so a step allocates nothing). */
export const drawn = { kind: 'advance' as Kind, days: 0 };

/** T12's day placement: month k, at position phi of the kind's slice. */
function place(kind: Kind, k: number, phi: number): void {
  const first = Math.ceil((k - 1) * MONTH_DAYS);
  const end = Math.ceil(k * MONTH_DAYS);
  drawn.kind = kind;
  drawn.days = Math.min(first + Math.floor(phi * (end - first)), end - 1);
}

/**
 * `sampleTransition(t, u, monthsElapsed)` into `drawn`: the same kind and days, from the cached
 * constants whenever T12 would take `literalDraw` (months elapsed below K) and find a month.
 */
export function sample(t: Transition, u: number, monthsElapsed: number): void {
  const m = monthsElapsed;
  if (Number.isInteger(m) && m >= 0 && u >= 0 && u < 1 && m < t.months) {
    const tb = tableOf(t);
    const { K, C, kinds, hi } = tb;
    const cm = m === 0 ? 0 : C[m];
    const c = cm + (1 - cm) * u;
    if (c < C[K]) {
      // T12 `tableMonth`, then `tableSlice`
      let below = m;
      let above = K;
      while (above - below > 1) {
        const mid = (below + above) >>> 1;
        if (C[mid] > c) above = mid;
        else below = mid;
      }
      const k = above;
      const n = kinds.length;
      let lo = k === 1 ? 0 : C[k - 1];
      let j = 0;
      let top = hi[k * n + n - 1];
      for (; j < n - 1; j++) {
        const h = hi[k * n + j];
        if (c < h) {
          top = h;
          break;
        }
        lo = h;
      }
      return place(kinds[j], k, (c - lo) / (top - lo));
    }
    const k = tailMonth(tb, c);
    if (k !== null) {
      // T12 `tailSlice` over [C(k − 1), C(k))
      const lo = cumulative(tb, k - 1);
      const top = cumulative(tb, k);
      const { share, lastShare } = tb;
      let acc = 0;
      let from = lo;
      for (let j = 0; j < lastShare; j++) {
        acc += share[j];
        const to = lo + (top - lo) * acc;
        if (c < to) return place(kinds[j], k, (c - from) / (to - from));
        from = to;
      }
      return place(kinds[lastShare], k, (c - from) / (top - from));
    }
  }
  const r = sampleTransition(t, u, monthsElapsed);
  drawn.kind = r.kind;
  drawn.days = r.days;
}
