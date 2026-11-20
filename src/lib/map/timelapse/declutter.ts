// Stage bar declutter (spec §4.4.4): per-project zoom gates so bars that coexist in time do not
// overlap on screen. CPU, run on each bar rebuild by the controller, never on `setTime`.
import type { BarMode } from '../types';
import { barGate, barSizePx } from './bars';
import { BAR_FAR_GAP_PX, DECLUTTER_MAX_ZOOM, DECLUTTER_STEP } from './constants';
import type { BarAttrs } from './types';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
/** `TILE_SIZE` (§4.0): the map's vector tiles are 512 px. */
const TILE_SIZE = 512;
/** Metres per degree of latitude (equirectangular). */
const M_PER_DEG = 111319.49079327357;
const DEG = Math.PI / 180;

/** Metres per screen pixel at zoom `z` and latitude `lat` (degrees). */
export function mpp(z: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG)) / (TILE_SIZE * 2 ** z);
}

/**
 * The screen px two bars' anchors must be apart at zoom `z` to show together. Street: the bar's
 * width (today's rule). Far: the diagonal of the 32 by 6 box grown by BAR_FAR_GAP_PX, so two
 * shown boxes never overlap and keep the gap across or up.
 */
export function declutterPx(z: number, mode: BarMode): number {
  if (mode === 'street') return barSizePx(z).w;
  const { w, h } = barSizePx(z, 'far');
  return Math.hypot(w + BAR_FAR_GAP_PX, h + BAR_FAR_GAP_PX);
}

interface Ladder {
  base: number;
  top: number;
  /** `declutterPx(z)·mpp(z, 0)` per rung, metres; latitude `lat` scales it by `cos(lat)`. */
  need: Float64Array;
}

/** The zoom ladder of a mode: barGate(mode), +STEP, … DECLUTTER_MAX_ZOOM. */
function ladder(mode: BarMode): Ladder {
  const base = barGate(mode);
  const rungs = Math.round((DECLUTTER_MAX_ZOOM - base) / DECLUTTER_STEP) + 1;
  const need = Float64Array.from({ length: rungs }, (_, r) => {
    const z = base + r * DECLUTTER_STEP;
    return (declutterPx(z, mode) * EARTH_CIRCUMFERENCE_M) / (TILE_SIZE * 2 ** z);
  });
  return { base, top: rungs - 1, need };
}
const LADDERS: Record<BarMode, Ladder> = { street: ladder('street'), far: ladder('far') };

/** Open-addressing slot for grid cell `(cx, cy)`: the slot holding it, or the empty slot to use. */
function slotOf(sx: Int32Array, sy: Int32Array, head: Int32Array, cx: number, cy: number): number {
  const mask = head.length - 1;
  let h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask;
  while (head[h] !== -1 && (sx[h] !== cx || sy[h] !== cy)) h = (h + 1) & mask;
  return h;
}

/**
 * Zoom gates for the bars (§4.4.4), returning the records to draw. Neither mode depends on the
 * camera or the clock: the controller runs this once per bar rebuild, never on a pan, a zoom or
 * `setTime`.
 *
 * Street (the default): sets `minZoom` on every bar in place and returns `bars` itself. A
 * project's bars (its revisions) share one `minZoom`, computed from its final revision's anchor
 * and its whole active interval `[min from, max to)`. Projects are visited policy first (a bar
 * with `policy`), then by final units descending, then `parcelId`, then `projectId` ascending (a
 * total order, so the gates are the same on every rebuild of the same bars); each takes the
 * smallest rung `z` of the ladder (BAR_MIN_ZOOM to DECLUTTER_MAX_ZOOM) at which every earlier
 * project `j` that overlaps in time, shown from `max(z, minZoom_j)`, is at least the bar's
 * width away (equirectangular metres at the project's latitude). A project that never clears
 * shows at the top rung. O(n log n): a uniform grid whose cell is the widest conflict distance,
 * 3×3 neighbourhood.
 *
 * Far: `declutterFar`, gates split in time (new records; `bars` is not changed).
 */
export function declutter(bars: BarAttrs[], mode: BarMode = 'street'): BarAttrs[] {
  if (mode === 'far') return declutterFar(bars);
  declutterStreet(bars);
  return bars;
}

function declutterStreet(bars: BarAttrs[]): void {
  const { base, top: TOP, need: NEED_EQUATOR } = LADDERS.street;
  const rungZoom = (r: number) => base + r * DECLUTTER_STEP;
  // One record per project, as parallel arrays.
  const index = new Map<string, number>();
  const barProject = new Int32Array(bars.length);
  const finalBar: number[] = [];
  const first: BarAttrs[] = [];
  const from: number[] = [];
  const to: number[] = [];
  const policy: boolean[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    let p = index.get(b.projectId);
    if (p === undefined) {
      p = first.length;
      index.set(b.projectId, p);
      first.push(b);
      finalBar.push(i);
      from.push(b.from);
      to.push(b.to);
      policy.push(b.policy === true);
    } else {
      if (b.from < from[p]) from[p] = b.from;
      if (b.to > to[p]) to[p] = b.to;
      if (b.policy === true) policy[p] = true;
      // The final revision is the latest one.
      const f = bars[finalBar[p]];
      if (b.from > f.from || (b.from === f.from && b.to > f.to)) finalBar[p] = i;
    }
    barProject[i] = p;
  }
  const n = first.length;
  if (n === 0) return;

  // Grid metric: x scaled at the highest latitude (smallest cosine), so grid distances never
  // exceed true distances; the cell is the widest conflict distance, at the lowest latitude.
  let minLat = Infinity;
  let maxLat = 0;
  const lat = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    lat[p] = Math.abs(bars[finalBar[p]].anchor[1]);
    if (lat[p] < minLat) minLat = lat[p];
    if (lat[p] > maxLat) maxLat = lat[p];
  }
  const gridCos = Math.cos(maxLat * DEG);
  const cell = NEED_EQUATOR[0] * Math.cos(minLat * DEG);
  const tx = new Float64Array(n); // longitude in metres, unscaled
  const ty = new Float64Array(n);
  const cosLat = new Float64Array(n);
  const cxs = new Int32Array(n);
  const cys = new Int32Array(n);
  for (let p = 0; p < n; p++) {
    const a = bars[finalBar[p]].anchor;
    tx[p] = a[0] * M_PER_DEG;
    ty[p] = a[1] * M_PER_DEG;
    cosLat[p] = Math.cos(a[1] * DEG);
    cxs[p] = Math.floor((tx[p] * gridCos) / cell);
    cys[p] = Math.floor(ty[p] / cell);
  }

  const units = Float64Array.from(first, (b) => b.units);
  const order = Array.from({ length: n }, (_, p) => p);
  order.sort((a, b) => {
    if (policy[a] !== policy[b]) return policy[a] ? -1 : 1;
    const d = units[b] - units[a];
    if (d !== 0) return d;
    const pa = first[a].parcelId;
    const pb = first[b].parcelId;
    if (pa !== pb) return pa < pb ? -1 : 1;
    const ia = first[a].projectId;
    const ib = first[b].projectId;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  // Visited projects, chained per grid cell: head[slot] → next[p] → … → -1.
  let size = 16;
  while (size < 2 * n) size *= 2;
  const head = new Int32Array(size).fill(-1);
  const slotX = new Int32Array(size);
  const slotY = new Int32Array(size);
  const next = new Int32Array(n);
  const rung = new Int8Array(n);
  for (let o = 0; o < n; o++) {
    const p = order[o];
    const cx = cxs[p];
    const cy = cys[p];
    const pc = cosLat[p];
    const pf = from[p];
    const pt = to[p];
    let r = 0;
    for (let ox = -1; ox <= 1 && r < TOP; ox++) {
      for (let oy = -1; oy <= 1 && r < TOP; oy++) {
        let q = head[slotOf(slotX, slotY, head, cx + ox, cy + oy)];
        for (; q >= 0; q = next[q]) {
          if (!(pf < to[q] && from[q] < pt)) continue;
          // Distance in metres at p's latitude.
          const dx = (tx[p] - tx[q]) * pc;
          const dy = ty[p] - ty[q];
          const d2 = dx * dx + dy * dy;
          // Shown together from the later of the two gates. If that clears q, so does every
          // higher zoom; otherwise take the first higher rung that does (the top if none).
          const start = r > rung[q] ? r : rung[q];
          const n0 = NEED_EQUATOR[start] * pc;
          if (d2 >= n0 * n0) continue;
          let c = start < TOP ? start + 1 : TOP;
          while (c < TOP) {
            const need = NEED_EQUATOR[c] * pc;
            if (d2 >= need * need) break;
            c++;
          }
          if (c > r) r = c;
          if (r >= TOP) break;
        }
      }
    }
    rung[p] = r;
    const slot = slotOf(slotX, slotY, head, cx, cy);
    next[p] = head[slot];
    head[slot] = p;
    slotX[slot] = cx;
    slotY[slot] = cy;
  }

  for (let i = 0; i < bars.length; i++) bars[i].minZoom = rungZoom(rung[barProject[i]]);
}

/** At most this many records per far bar (`declutterFar`). */
export const BAR_FAR_MAX_PIECES = 4;

/**
 * Far declutter: each bar is split in time into pieces, each with its own gate, so a bar is held
 * back by a higher-priority neighbour only while that neighbour's piece is in time. Bars (each
 * revision with its own anchor and window) are visited in the street order (policy, units
 * descending, `parcelId`, `projectId`), then by `from`, `to` and input index (a total order). A
 * visited piece `q` with gate rung `g` constrains bar `p` during their common window to rung
 * `k = clearRung(d)` (the first rung whose spacing `declutterPx` fits the anchors' distance `d`,
 * the top if none) when `g < k`; p's rung at a day is the largest constraint then in force, else
 * the ladder's base (BAR_FAR_MIN_ZOOM). p's window is cut where that changes. More than
 * BAR_FAR_MAX_PIECES pieces: the shortest is merged into its neighbour of higher gate (the
 * merged piece takes the larger gate, so a merge only hides, never shows) until it fits. Pieces
 * are `[from, to)` windows that tile the bar's window, as the bar's own did.
 */
function declutterFar(bars: BarAttrs[]): BarAttrs[] {
  const { base, top: TOP, need: NEED_EQUATOR } = LADDERS.far;
  const n = bars.length;
  if (n === 0) return [];
  let minLat = Infinity;
  let maxLat = 0;
  for (const b of bars) {
    const lat = Math.abs(b.anchor[1]);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const gridCos = Math.cos(maxLat * DEG);
  const cell = NEED_EQUATOR[0] * Math.cos(minLat * DEG);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const cosLat = new Float64Array(n);
  const cxs = new Int32Array(n);
  const cys = new Int32Array(n);
  const bFrom = new Float64Array(n);
  const bTo = new Float64Array(n);
  const project = new Int32Array(n);
  const projects = new Map<string, number>();
  for (let p = 0; p < n; p++) {
    const b = bars[p];
    const a = b.anchor;
    tx[p] = a[0] * M_PER_DEG;
    ty[p] = a[1] * M_PER_DEG;
    cosLat[p] = Math.cos(a[1] * DEG);
    cxs[p] = Math.floor((tx[p] * gridCos) / cell);
    cys[p] = Math.floor(ty[p] / cell);
    bFrom[p] = b.from;
    bTo[p] = b.to;
    let id = projects.get(b.projectId);
    if (id === undefined) projects.set(b.projectId, (id = projects.size));
    project[p] = id;
  }
  const order = Array.from({ length: n }, (_, p) => p);
  order.sort((a, b) => {
    const A = bars[a];
    const B = bars[b];
    if (A.policy !== B.policy) return A.policy ? -1 : 1;
    if (A.units !== B.units) return B.units - A.units;
    if (A.parcelId !== B.parcelId) return A.parcelId < B.parcelId ? -1 : 1;
    if (A.projectId !== B.projectId) return A.projectId < B.projectId ? -1 : 1;
    if (A.from !== B.from) return A.from - B.from;
    if (A.to !== B.to) return A.to - B.to;
    return a - b;
  });

  // Each visited bar's pieces, at most BAR_FAR_MAX_PIECES: from, to and rung, flat per bar.
  const M = BAR_FAR_MAX_PIECES;
  const pcFrom = new Float64Array(n * M);
  const pcTo = new Float64Array(n * M);
  const pcRung = new Int8Array(n * M);
  const pcCount = new Int8Array(n);
  let size = 16;
  while (size < 2 * n) size *= 2;
  const head = new Int32Array(size).fill(-1);
  const slotX = new Int32Array(size);
  const slotY = new Int32Array(size);
  const next = new Int32Array(n);
  const sweep = new Sweep(TOP);
  // need[k]·cos is NEED_EQUATOR[0]·cos·2^(−k·STEP): the first rung that fits d, from a log.
  const perRung = DECLUTTER_STEP;
  for (let o = 0; o < n; o++) {
    const p = order[o];
    const pf = bFrom[p];
    const pt = bTo[p];
    const pc = cosLat[p];
    const need0 = NEED_EQUATOR[0] * pc;
    const need0Sq = need0 * need0;
    sweep.reset(pf, pt);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        let q = head[slotOf(slotX, slotY, head, cxs[p] + ox, cys[p] + oy)];
        for (; q >= 0; q = next[q]) {
          if (!(pf < bTo[q] && bFrom[q] < pt) || project[q] === project[p]) continue;
          const dx = (tx[p] - tx[q]) * pc;
          const dy = ty[p] - ty[q];
          const d2 = dx * dx + dy * dy;
          if (d2 >= need0Sq) continue;
          // The first rung whose spacing fits d (the top if none); the log's guess is checked
          // against the ladder both ways.
          let k = d2 > 0 ? Math.ceil(Math.log2(need0Sq / d2) / (2 * perRung)) : TOP;
          if (k > TOP) k = TOP;
          if (k < 1) k = 1;
          while (k > 1 && d2 >= (NEED_EQUATOR[k - 1] * pc) ** 2) k--;
          while (k < TOP && d2 < (NEED_EQUATOR[k] * pc) ** 2) k++;
          if (k <= sweep.whole) continue;
          const o0 = q * M;
          for (let i = o0; i < o0 + pcCount[q]; i++) {
            if (pcRung[i] >= k) continue;
            sweep.add(Math.max(pcFrom[i], pf), Math.min(pcTo[i], pt), k);
          }
        }
      }
    }
    const ps = cap(sweep.run(), M);
    const o0 = p * M;
    pcCount[p] = ps.length / 3;
    for (let i = 0; i < ps.length; i += 3) {
      pcFrom[o0 + i / 3] = ps[i];
      pcTo[o0 + i / 3] = ps[i + 1];
      pcRung[o0 + i / 3] = ps[i + 2];
    }
    const slot = slotOf(slotX, slotY, head, cxs[p], cys[p]);
    next[p] = head[slot];
    head[slot] = p;
    slotX[slot] = cxs[p];
    slotY[slot] = cys[p];
  }

  const out: BarAttrs[] = [];
  for (let p = 0; p < n; p++) {
    for (let i = p * M; i < p * M + pcCount[p]; i++) {
      out.push({
        ...bars[p],
        from: pcFrom[i],
        to: pcTo[i],
        minZoom: base + pcRung[i] * DECLUTTER_STEP
      });
    }
  }
  return out;
}

/**
 * The largest rung in force over a bar's window `[from, to)` from constraints `[a, b, rung]`,
 * as pieces `[from, to, rung]` flat (0 where none; equal neighbours joined). A constraint over
 * the whole window raises `whole` and adds no event; one that starts at or before `from` counts
 * from the start; one that ends at or after `to` adds no end. Buffers are reused across bars.
 */
class Sweep {
  whole = 0;
  private from = 0;
  private to = 0;
  private cnt: Int32Array;
  private start: Int32Array;
  private day = new Float64Array(64);
  private code = new Int32Array(64); // +rung for a start, −rung for an end
  private idx = new Uint32Array(64);
  private m = 0;

  constructor(top: number) {
    this.cnt = new Int32Array(top + 1);
    this.start = new Int32Array(top + 1);
  }

  reset(from: number, to: number): void {
    this.whole = 0;
    this.from = from;
    this.to = to;
    this.m = 0;
    this.start.fill(0);
  }

  add(a: number, b: number, k: number): void {
    if (a >= b) return;
    const lead = a <= this.from;
    const tail = b >= this.to;
    if (lead && tail) {
      if (k > this.whole) this.whole = k;
      return;
    }
    if (lead) this.start[k]++;
    else this.push(a, k);
    if (!tail) this.push(b, -k);
  }

  private push(d: number, c: number): void {
    if (this.m === this.day.length) {
      const day = new Float64Array(2 * this.m);
      const code = new Int32Array(2 * this.m);
      day.set(this.day);
      code.set(this.code);
      this.day = day;
      this.code = code;
      this.idx = new Uint32Array(2 * this.m);
    }
    this.day[this.m] = d;
    this.code[this.m] = c;
    this.m++;
  }

  run(): number[] {
    const { m, day, code, cnt, whole } = this;
    const idx = this.idx.subarray(0, m);
    for (let i = 0; i < m; i++) idx[i] = i;
    idx.sort((x, y) => day[x] - day[y]);
    cnt.set(this.start);
    const top = (): number => {
      for (let k = cnt.length - 1; k > whole; k--) if (cnt[k] > 0) return k;
      return whole;
    };
    const out: number[] = [];
    let start = this.from;
    let rung = top();
    const close = (end: number) => {
      if (end <= start) return;
      const L = out.length;
      if (L > 0 && out[L - 1] === rung) out[L - 2] = end;
      else out.push(start, end, rung);
      start = end;
    };
    let i = 0;
    while (i < m) {
      const d = day[idx[i]];
      close(d);
      for (; i < m && day[idx[i]] === d; i++) {
        const c = code[idx[i]];
        cnt[c > 0 ? c : -c] += c > 0 ? 1 : -1;
      }
      rung = top();
    }
    close(this.to);
    return out;
  }
}

/** Pieces `[from, to, rung]` flat cut to at most `max`: the shortest merges into its higher neighbour. */
function cap(ps: number[], max: number): number[] {
  while (ps.length / 3 > max) {
    let s = 0;
    for (let i = 3; i < ps.length; i += 3) if (ps[i + 1] - ps[i] < ps[s + 1] - ps[s]) s = i;
    const left = s - 3;
    const right = s + 3 < ps.length ? s + 3 : -1;
    const into = left < 0 ? right : right < 0 ? left : ps[left + 2] >= ps[right + 2] ? left : right;
    const r = Math.max(ps[into + 2], ps[s + 2]);
    const a = Math.min(ps[into], ps[s]);
    const b = Math.max(ps[into + 1], ps[s + 1]);
    const lo = Math.min(into, s);
    ps.splice(lo, 6, a, b, r);
    // Join equal neighbours the merge may have made.
    for (let i = ps.length - 3; i >= 3; i -= 3)
      if (ps[i + 2] === ps[i - 1]) ps.splice(i - 3, 6, ps[i - 3], ps[i + 1], ps[i + 2]);
  }
  return ps;
}
