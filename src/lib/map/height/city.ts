/**
 * The staged city build (height-lids plan, Task 6): a 15 m label-point raster of the whole city,
 * its regions (components) with room to grow, and contour chains with labels. Pure and
 * worker-safe; the scenario worker steps it in slices at each lever revision.
 *
 * Each cell takes the nearest lot label point within that lot's reach. Components are 4-connected
 * cells of equal stories > 0. A lot takes its label-point cell's component when the stories match,
 * else that of a 4-adjacent cell with equal stories, else a singleton of its own (an exception).
 * Pieces split components by the winning source of each cell's nearest lot; contour chains are the
 * boundaries between pieces.
 */
import { SRC_NONE, type LimitSources } from '$lib/sim/levers/source';
import { project, type BBox } from '$lib/plan/geometry';
import { CONTOUR_ZOOMS, placeLabels, toLabelSet, type LabelCandidate } from './labels';
import { EMPTY, NearestField, frameFor, vertexToLngLat, type RasterFrame } from './raster';
import { contourLabelText, glazeStep } from './room';
import { CHAIN_LIMIT, CHAIN_SOURCE, type HeightCity } from './types';
import {
  chainsFromPoints,
  createChainTrace,
  simplifyChainRange,
  smoothChainRange,
  type Chains
} from './vectorize';

export const CITY_CELL_M = 15;
export const CITY_SIMPLIFY_M = 7.5;
export const CONTOUR_LABEL_MIN_M = 300;
/** = FOG_BOUNDS (= CONSTRAINTS.maxBounds, camera.ts); repeated so the worker need not import camera.ts. */
export const CITY_BOUNDS: [[number, number], [number, number]] = [
  [-122.56, 37.69],
  [-122.33, 37.84]
];
const CITY_BBOX: BBox = [
  CITY_BOUNDS[0][0],
  CITY_BOUNDS[0][1],
  CITY_BOUNDS[1][0],
  CITY_BOUNDS[1][1]
];
export const CITY_FRAME: RasterFrame = frameFor(CITY_BBOX, CITY_CELL_M, 0);
/** lotComponent of a lot with no limit (stories 0): it belongs to no region. */
export const NO_COMPONENT = 0xffffffff;

/** Lot reach (m): clamp(0.5·√area + 20, 30, 200). */
const REACH_MIN_M = 30;
const REACH_MAX_M = 200;
const SMOOTH_ITERATIONS = 2;

// Work units, sized to a few ms each on the full city raster so step(budget) overruns by little.
const NEAREST_ROWS = 16;
const CELL_ROWS = 48;
const TRACE_ROWS = 24;
const LOTS_PER_UNIT = 20000;
const VERTS_PER_UNIT = 20000;

export interface CityInput {
  rev: number;
  /** lng, lat per lot. */
  labelPoint: Float64Array;
  lotAreaM2: Uint32Array;
  existingStories: Uint8Array;
  /** The effective story limit per lot. */
  stories: Uint8Array;
  /** 1 for lots whose unused allowance counts toward room to grow (countableMask). */
  countable: Uint8Array;
  sources: LimitSources;
}

export interface CityModel {
  /** Per lot; NO_COMPONENT for a lot with stories 0. */
  lotComponent: Uint32Array;
  componentStories: Uint8Array;
  /** Σ over the component's countable lots of max(0, stories − existing stories). */
  componentRoom: Uint32Array;
  /** glazeStep of the component's area-weighted unused stories. */
  componentGlaze: Uint8Array;
  /** Per lot: its share of room to grow, countable ? max(0, stories − existing stories) : 0. */
  lotRoom: Uint8Array;
}

export interface StagedBuild<T> {
  /** Runs work units until done or budgetMs has passed (at least one unit per call). true = done. */
  step(budgetMs: number, now: () => number): boolean;
  /** Throws until step has returned true. */
  result(): T;
}

export type CityResult = { city: HeightCity; model: CityModel };

export function createCityBuild(input: CityInput): StagedBuild<CityResult> {
  return stagedBuild(cityBuild(input), 'city build');
}

/** A StagedBuild over a generator that yields after each work unit. */
export function stagedBuild<T>(gen: Generator<void, T, void>, what: string): StagedBuild<T> {
  let done: { value: T } | null = null;
  return {
    step(budgetMs, now) {
      if (done) return true;
      const t0 = now();
      for (;;) {
        const r = gen.next();
        if (r.done) {
          done = { value: r.value };
          return true;
        }
        if (now() - t0 >= budgetMs) return false;
      }
    },
    result() {
      if (!done) throw new Error(`${what} is not done`);
      return done.value;
    }
  };
}

/** [from, to) chain ranges of at most about maxVerts vertices each (at least one chain). */
export function* chainRanges(c: Chains, maxVerts: number): Generator<[number, number]> {
  const n = c.starts.length - 1;
  let from = 0;
  while (from < n) {
    let to = from + 1;
    while (to < n && c.starts[to + 1] - c.starts[from] <= maxVerts) to++;
    yield [from, to];
    from = to;
  }
}

function* cityBuild(input: CityInput): Generator<void, CityResult, void> {
  const f = CITY_FRAME;
  const { cols, rows } = f;
  const cells = cols * rows;
  const { stories, labelPoint, lotAreaM2, existingStories, countable } = input;
  const source = input.sources.source;
  const nLots = stories.length;

  // Nearest lot label point within its reach.
  const reach = new Float32Array(nLots);
  for (let i = 0; i < nLots; i++) {
    const r = 0.5 * Math.sqrt(lotAreaM2[i]) + 20;
    reach[i] = Math.min(REACH_MAX_M, Math.max(REACH_MIN_M, r));
  }
  const field = new NearestField(f, labelPoint, reach);
  yield;
  for (let r = 0; r < rows; r += NEAREST_ROWS) {
    field.forward(r, Math.min(rows, r + NEAREST_ROWS));
    yield;
  }
  for (let r1 = rows; r1 > 0; r1 -= NEAREST_ROWS) {
    field.backward(Math.max(0, r1 - NEAREST_ROWS), r1);
    yield;
  }
  const best = field.result();

  // Components: union-find over 4-connected cells of equal stories > 0. A root is always the
  // smallest cell index of its set, so the flattening pass meets each root before its members.
  const cellStories = new Uint8Array(cells);
  const parent = new Int32Array(cells);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra < rb) parent[rb] = ra;
    else if (rb < ra) parent[ra] = rb;
  };
  for (let r0 = 0; r0 < rows; r0 += CELL_ROWS) {
    for (let r = r0; r < Math.min(rows, r0 + CELL_ROWS); r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        parent[i] = i;
        const b = best[i];
        const s = b >= 0 ? stories[b] : 0;
        cellStories[i] = s;
        if (s === 0) continue;
        if (c > 0 && cellStories[i - 1] === s) union(i, i - 1);
        if (r > 0 && cellStories[i - cols] === s) union(i, i - cols);
      }
    yield;
  }
  const cellComp = new Uint32Array(cells);
  const compStories: number[] = [];
  for (let r0 = 0; r0 < rows; r0 += CELL_ROWS) {
    const end = Math.min(rows, r0 + CELL_ROWS) * cols;
    for (let i = r0 * cols; i < end; i++) {
      const s = cellStories[i];
      if (s === 0) {
        cellComp[i] = NO_COMPONENT;
        continue;
      }
      const root = find(i);
      if (root === i) {
        cellComp[i] = compStories.length;
        compStories.push(s);
      } else cellComp[i] = cellComp[root];
    }
    yield;
  }

  // Lot components: the label-point cell's when the stories match, else an equal 4-neighbour's,
  // else a singleton.
  const lotComponent = new Uint32Array(nLots);
  for (let i0 = 0; i0 < nLots; i0 += LOTS_PER_UNIT) {
    for (let i = i0; i < Math.min(nLots, i0 + LOTS_PER_UNIT); i++) {
      const s = stories[i];
      if (s === 0) {
        lotComponent[i] = NO_COMPONENT;
        continue;
      }
      const [x, y] = project(labelPoint[2 * i], labelPoint[2 * i + 1]);
      const c = Math.floor((x - f.x0) / f.cell);
      const r = Math.floor((y - f.y0) / f.cell);
      let comp = NO_COMPONENT;
      if (c >= 0 && c < cols && r >= 0 && r < rows) {
        const k = r * cols + c;
        if (cellStories[k] === s) comp = cellComp[k];
        else if (c > 0 && cellStories[k - 1] === s) comp = cellComp[k - 1];
        else if (c < cols - 1 && cellStories[k + 1] === s) comp = cellComp[k + 1];
        else if (r > 0 && cellStories[k - cols] === s) comp = cellComp[k - cols];
        else if (r < rows - 1 && cellStories[k + cols] === s) comp = cellComp[k + cols];
      }
      if (comp === NO_COMPONENT) {
        comp = compStories.length;
        compStories.push(s);
      }
      lotComponent[i] = comp;
    }
    yield;
  }

  // Per-component sums: room to grow, and area-weighted unused stories for the glaze.
  const nComp = compStories.length;
  const componentStories = Uint8Array.from(compStories);
  const componentRoom = new Uint32Array(nComp);
  const unusedM2 = new Float64Array(nComp);
  const areaM2 = new Float64Array(nComp);
  const lotRoom = new Uint8Array(nLots);
  for (let i0 = 0; i0 < nLots; i0 += LOTS_PER_UNIT) {
    for (let i = i0; i < Math.min(nLots, i0 + LOTS_PER_UNIT); i++) {
      const comp = lotComponent[i];
      if (comp === NO_COMPONENT) continue;
      areaM2[comp] += lotAreaM2[i];
      if (!countable[i]) continue;
      const unused = Math.max(0, stories[i] - existingStories[i]);
      lotRoom[i] = unused;
      componentRoom[comp] += unused;
      unusedM2[comp] += unused * lotAreaM2[i];
    }
    yield;
  }
  const componentGlaze = new Uint8Array(nComp);
  for (let k = 0; k < nComp; k++) componentGlaze[k] = glazeStep(unusedM2[k], areaM2[k]);
  yield;

  // Pieces: (component, source of the cell's nearest lot), labelled 1.. on the raster. The
  // union-find parents are done with, so their buffer holds the piece labels.
  const labels = new Uint32Array(parent.buffer);
  const pieceIndex = new Map<number, number>();
  const pieceStories: number[] = [];
  const pieceSrc: number[] = [];
  let lastKey = -1;
  let lastLabel = EMPTY;
  for (let r0 = 0; r0 < rows; r0 += CELL_ROWS) {
    const end = Math.min(rows, r0 + CELL_ROWS) * cols;
    for (let i = r0 * cols; i < end; i++) {
      const comp = cellComp[i];
      if (comp === NO_COMPONENT) {
        labels[i] = EMPTY;
        continue;
      }
      const src = source[best[i]];
      const key = comp * 65536 + src;
      if (key !== lastKey) {
        let label = pieceIndex.get(key);
        if (label === undefined) {
          pieceStories.push(componentStories[comp]);
          pieceSrc.push(src);
          label = pieceStories.length;
          pieceIndex.set(key, label);
        }
        lastKey = key;
        lastLabel = label;
      }
      labels[i] = lastLabel;
    }
    yield;
  }

  // Chains: trace, simplify, smooth.
  const trace = createChainTrace(labels, cols, rows);
  for (let y = 0; y <= rows; y += TRACE_ROWS) {
    trace.junctions(y, y + TRACE_ROWS);
    yield;
  }
  for (let y = 0; y <= rows; y += TRACE_ROWS) {
    trace.loops(y, y + TRACE_ROWS);
    yield;
  }
  const traced = trace.result();
  yield;
  const simplePts: Float64Array[] = [];
  for (const [from, to] of chainRanges(traced, VERTS_PER_UNIT)) {
    simplifyChainRange(traced, CITY_SIMPLIFY_M / CITY_CELL_M, from, to, simplePts);
    yield;
  }
  const simple = chainsFromPoints(traced, simplePts);
  const smoothPts: Float64Array[] = [];
  // smoothing quadruples the vertices, so a quarter of the vertices per unit
  for (const [from, to] of chainRanges(simple, VERTS_PER_UNIT / 4)) {
    smoothChainRange(simple, SMOOTH_ITERATIONS, from, to, smoothPts);
    yield;
  }
  const smooth = chainsFromPoints(simple, smoothPts);
  yield;

  // Chain attributes, positions and contour label candidates.
  const nChains = smooth.starts.length - 1;
  const hi = new Uint8Array(nChains);
  const lo = new Uint8Array(nChains);
  const kind = new Uint8Array(nChains);
  const srcA = new Uint16Array(nChains);
  const srcB = new Uint16Array(nChains);
  const positions = new Float64Array(smooth.xy.length);
  const candidates: LabelCandidate[] = [];
  const xy = smooth.xy;
  for (const [from, to] of chainRanges(smooth, VERTS_PER_UNIT)) {
    for (let k = from; k < to; k++) {
      const L = smooth.left[k];
      const R = smooth.right[k];
      const sL = L === EMPTY ? 0 : pieceStories[L - 1];
      const sR = R === EMPTY ? 0 : pieceStories[R - 1];
      const srcL = L === EMPTY ? SRC_NONE : pieceSrc[L - 1];
      const srcR = R === EMPTY ? SRC_NONE : pieceSrc[R - 1];
      // A is the higher side (the left on a tie), B the lower.
      const leftHigh = sL >= sR;
      hi[k] = leftHigh ? sL : sR;
      lo[k] = leftHigh ? sR : sL;
      srcA[k] = leftHigh ? srcL : srcR;
      srcB[k] = leftHigh ? srcR : srcL;
      kind[k] = sL !== sR ? CHAIN_LIMIT : CHAIN_SOURCE;

      const v0 = smooth.starts[k];
      const v1 = smooth.starts[k + 1];
      let lenCells = 0;
      for (let v = v0; v < v1; v++) {
        const [lng, lat] = vertexToLngLat(f, xy[2 * v], xy[2 * v + 1]);
        positions[2 * v] = lng;
        positions[2 * v + 1] = lat;
        if (v > v0)
          lenCells += Math.hypot(xy[2 * v] - xy[2 * v - 2], xy[2 * v + 1] - xy[2 * v - 1]);
      }
      const lenM = lenCells * CITY_CELL_M;
      if (kind[k] !== CHAIN_LIMIT || lenM < CONTOUR_LABEL_MIN_M) continue;
      // the label sits halfway along the chain
      let rest = lenCells / 2;
      for (let v = v0 + 1; v < v1; v++) {
        const ax = xy[2 * v - 2];
        const ay = xy[2 * v - 1];
        const seg = Math.hypot(xy[2 * v] - ax, xy[2 * v + 1] - ay);
        if (seg >= rest || v === v1 - 1) {
          const t = seg > 0 ? Math.min(1, rest / seg) : 0;
          const [lng, lat] = vertexToLngLat(
            f,
            ax + t * (xy[2 * v] - ax),
            ay + t * (xy[2 * v + 1] - ay)
          );
          candidates.push({
            lng,
            lat,
            zM: 0,
            text: contourLabelText(hi[k]),
            priority: lenM,
            roomM: Infinity // contour labels sit on the line: only collisions thin them
          });
          break;
        }
        rest -= seg;
      }
    }
    yield;
  }
  const contourLabels = toLabelSet(candidates, placeLabels(candidates, CONTOUR_ZOOMS));

  return {
    city: {
      rev: input.rev,
      sourceIds: [...input.sources.ruleIds],
      chains: { starts: smooth.starts, positions, hi, lo, kind, srcA, srcB },
      labels: contourLabels
    },
    model: { lotComponent, componentStories, componentRoom, componentGlaze, lotRoom }
  };
}
