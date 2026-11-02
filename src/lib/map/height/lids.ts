/**
 * The staged lid build (height-lids plan, Task 7): glass lids for the loaded lots in a view.
 * Pure and worker-safe; the scenario worker steps it in slices.
 *
 * Lots are rasterized at 2 m, labelled by piece: (city component, winning source). A lot with no
 * limit (stories 0, so no component) is BLOCK. Runs of up to 30 m of open ground between two
 * lots of one component are filled (the lid spans the street): with their piece when the sources
 * agree, else with the component's FZP piece. The raster is traced into chains, simplified once
 * (1.2 m) and assembled into faces, so neighbouring faces share edges exactly. Each chain side
 * with a piece is a rim at that piece's height; a chain between two pieces of different heights
 * is a wall from the lower height to the higher. One label per component sits at its cell
 * farthest from any other region, with a component's paint-source pieces counting as a region
 * of their own; paint mode gets a second label set with one label per such part.
 */
import { project, type BBox } from '$lib/plan/geometry';
import { SRC_FZP, SRC_PAINT } from '$lib/sim/levers/source';
import { NO_COMPONENT, chainRanges, stagedBuild, type CityModel, type StagedBuild } from './city';
import { LID_ZOOMS, placeLabels, toLabelSet, type LabelCandidate } from './labels';
import {
  BLOCK,
  EMPTY,
  closeGapLines,
  frameFor,
  insideDistance,
  lineCount,
  rasterizeRings,
  vertexToLngLat,
  type GapDir,
  type RasterFrame
} from './raster';
import { lidLabelText, storiesToM } from './room';
import { CHAIN_LIMIT, CHAIN_SOURCE, type HeightLids, type LabelSet, type LidFace } from './types';
import { assembleFaces, chainsFromPoints, createChainTrace, simplifyChainRange } from './vectorize';

export const LID_CELL_M = 2;
export const LID_CLOSE_M = 30;
export const LID_PAD_M = 60;
export const LID_MAX_SPAN_M = 3000;
export const LID_SIMPLIFY_M = 1.2;

/** The view's bbox spans more than LID_MAX_SPAN_M + 2·LID_PAD_M on some axis. */
export class LidTooLarge extends Error {
  constructor(spanM: number) {
    super(`lid view spans ${Math.round(spanM)} m, over ${LID_MAX_SPAN_M + 2 * LID_PAD_M} m`);
    this.name = 'LidTooLarge';
  }
}

export interface LidLot {
  /** The lot's row in the limits tables (stories, sources, model.lotComponent). */
  row: number;
  /** lng/lat rings (toLngLat of the chunk record's polygon); even-odd. */
  rings: [number, number][][];
}

export interface LidInput {
  limitsRev: number;
  /** The rule ids that SRC_RULE0 + k codes in `sources` index, from the same limits. */
  sourceIds: readonly string[];
  bbox: BBox;
  lots: readonly LidLot[];
  /** Per lot row: the effective story limit, its winning source code, and the city model. */
  stories: Uint8Array;
  sources: Uint16Array;
  model: CityModel;
}

export interface LidBuild extends StagedBuild<HeightLids> {
  readonly frame: RasterFrame;
  /** The piece raster (labels 1.., EMPTY, BLOCK) once the build is done; for tests and debug. */
  raster(): { frame: RasterFrame; labels: Uint32Array };
}

// Work units, sized to a few ms each on a 3 km view so step(budget) overruns by little.
const LOTS_PER_UNIT = 1500;
const CELLS_PER_UNIT = 1 << 18;
const TRACE_CELLS_PER_UNIT = 1 << 16;
const VERTS_PER_UNIT = 20000;
const ROWS_PER_UNIT = 25000;

export function createLidBuild(input: LidInput): LidBuild {
  const [x0, y0] = project(input.bbox[0], input.bbox[1]);
  const [x1, y1] = project(input.bbox[2], input.bbox[3]);
  const span = Math.max(x1 - x0, y1 - y0);
  if (!(span <= LID_MAX_SPAN_M + 2 * LID_PAD_M)) throw new LidTooLarge(span);
  const frame = frameFor(input.bbox, LID_CELL_M, LID_PAD_M);
  const labels = new Uint32Array(frame.cols * frame.rows);
  const build = stagedBuild(lidBuild(input, frame, labels), 'lid build');
  let done = false;
  return {
    frame,
    step(budgetMs, now) {
      done = build.step(budgetMs, now);
      return done;
    },
    result: () => build.result(),
    raster() {
      if (!done) throw new Error('lid build is not done');
      return { frame, labels };
    }
  };
}

/** Per region part: cell count, and the cell farthest from any other part (insideDistance). */
interface Best {
  cells: Uint32Array;
  at: Int32Array;
  dist: Float32Array;
}

function* lidBuild(
  input: LidInput,
  f: RasterFrame,
  labels: Uint32Array
): Generator<void, HeightLids, void> {
  const { cols, rows } = f;
  const cells = cols * rows;
  const { stories, sources, model } = input;

  // Pieces: label k + 1 is piece k. Components in view get a local index for the label stage.
  const pieceIndex = new Map<number, number>();
  const pStories: number[] = [];
  const pSrc: number[] = [];
  const pComp: number[] = [];
  const pLocal: number[] = [];
  const localOf = new Map<number, number>();
  const localComp: number[] = [];
  const pieceLabel = (comp: number, src: number): number => {
    const key = comp * 65536 + src;
    let label = pieceIndex.get(key);
    if (label === undefined) {
      let local = localOf.get(comp);
      if (local === undefined) {
        local = localComp.length;
        localOf.set(comp, local);
        localComp.push(comp);
      }
      pStories.push(model.componentStories[comp]);
      pSrc.push(src);
      pComp.push(comp);
      pLocal.push(local);
      label = pStories.length;
      pieceIndex.set(key, label);
    }
    return label;
  };

  // Rasterize. A lot with no limit, or no component, blocks the lid.
  const lots = input.lots;
  for (let i0 = 0; i0 < lots.length; i0 += LOTS_PER_UNIT) {
    for (let i = i0; i < Math.min(lots.length, i0 + LOTS_PER_UNIT); i++) {
      const { row, rings } = lots[i];
      const comp = model.lotComponent[row];
      const label =
        stories[row] === 0 || comp === NO_COMPONENT ? BLOCK : pieceLabel(comp, sources[row]);
      rasterizeRings(f, rings, label, labels);
    }
    yield;
  }

  // Close street gaps between lots of one component, in all four directions.
  const filled = new Uint8Array(cells);
  const bridge = (a: number, b: number): number => {
    if (a === b) return a;
    const comp = pComp[a - 1];
    if (comp !== pComp[b - 1]) return EMPTY;
    return pSrc[a - 1] === pSrc[b - 1] ? a : pieceLabel(comp, SRC_FZP);
  };
  const rank = (label: number): number => pStories[label - 1];
  for (const d of [0, 1, 2, 3] as GapDir[]) {
    const n = lineCount(f, d);
    const lineLen = d === 0 ? cols : d === 1 ? rows : Math.min(cols, rows);
    const per = Math.max(1, Math.floor(CELLS_PER_UNIT / lineLen));
    for (let from = 0; from < n; from += per) {
      closeGapLines(labels, f, d, from, Math.min(n, from + per), LID_CLOSE_M, bridge, rank, filled);
      yield;
    }
  }

  // Label points. A component in view has two parts, its paint-source pieces (part 2·local + 1)
  // and the rest (2·local); each part's label point is its cell farthest from any other part.
  const nLocal = localComp.length;
  const partOf = new Uint32Array(pStories.length + 1);
  for (let p = 0; p < pStories.length; p++)
    partOf[p + 1] = 2 * pLocal[p] + (pSrc[p] === SRC_PAINT ? 1 : 0) + 1;
  const rowsPer = Math.max(1, Math.floor(CELLS_PER_UNIT / cols));
  const group = new Uint32Array(cells);
  const dist = new Float32Array(cells);
  for (let r0 = 0; r0 < rows; r0 += rowsPer) {
    const end = Math.min(rows, r0 + rowsPer) * cols;
    for (let i = r0 * cols; i < end; i++) {
      const v = labels[i];
      group[i] = v === EMPTY || v === BLOCK ? 0 : partOf[v];
    }
    yield;
  }
  for (let r0 = 0; r0 < rows; r0 += rowsPer) {
    insideDistance(group, f, r0, Math.min(rows, r0 + rowsPer), dist, 'forward');
    yield;
  }
  const parts: Best = {
    cells: new Uint32Array(2 * nLocal),
    at: new Int32Array(2 * nLocal).fill(-1),
    dist: new Float32Array(2 * nLocal).fill(-1)
  };
  for (let r1 = rows; r1 > 0; r1 -= rowsPer) {
    const r0 = Math.max(0, r1 - rowsPer);
    insideDistance(group, f, r0, r1, dist, 'backward');
    // these rows are final now; ties go to the lowest cell index, as a row-major scan would
    for (let i = r0 * cols; i < r1 * cols; i++) {
      const g = group[i] - 1;
      if (g < 0) continue;
      parts.cells[g]++;
      if (dist[i] > parts.dist[g] || (dist[i] === parts.dist[g] && i < parts.at[g])) {
        parts.dist[g] = dist[i];
        parts.at[g] = i;
      }
    }
    yield;
  }
  const anyPaint = pSrc.includes(SRC_PAINT);
  const paintRoom = new Uint32Array(nLocal);
  if (anyPaint) {
    // A painted part's room is city-wide: every painted lot of its component.
    for (let i0 = 0; i0 < sources.length; i0 += ROWS_PER_UNIT) {
      for (let i = i0; i < Math.min(sources.length, i0 + ROWS_PER_UNIT); i++) {
        if (sources[i] !== SRC_PAINT) continue;
        const local = localOf.get(model.lotComponent[i]);
        if (local !== undefined) paintRoom[local] += model.lotRoom[i];
      }
      yield;
    }
  }

  // Chains: trace, simplify.
  const trace = createChainTrace(labels, cols, rows);
  const traceRows = Math.max(1, Math.floor(TRACE_CELLS_PER_UNIT / (cols + 1)));
  for (let y = 0; y <= rows; y += traceRows) {
    trace.junctions(y, y + traceRows);
    yield;
  }
  for (let y = 0; y <= rows; y += traceRows) {
    trace.loops(y, y + traceRows);
    yield;
  }
  const traced = trace.result();
  yield;
  const simplePts: Float64Array[] = [];
  for (const [from, to] of chainRanges(traced, VERTS_PER_UNIT)) {
    simplifyChainRange(traced, LID_SIMPLIFY_M / LID_CELL_M, from, to, simplePts);
    yield;
  }
  const simple = chainsFromPoints(traced, simplePts);
  yield;

  // Vertex positions, rims and walls.
  const xy = simple.xy;
  const ll = new Float64Array(xy.length);
  const rimStarts: number[] = [0];
  const rimPos: number[] = [];
  const rimPiece: number[] = [];
  const rimKind: number[] = [];
  const wa: number[] = [];
  const wb: number[] = [];
  const wLo: number[] = [];
  const wHi: number[] = [];
  const wPiece: number[] = [];
  for (const [from, to] of chainRanges(simple, VERTS_PER_UNIT)) {
    for (let v = simple.starts[from]; v < simple.starts[to]; v++) {
      const [lng, lat] = vertexToLngLat(f, xy[2 * v], xy[2 * v + 1]);
      ll[2 * v] = lng;
      ll[2 * v + 1] = lat;
    }
    for (let k = from; k < to; k++) {
      const v0 = simple.starts[k];
      const v1 = simple.starts[k + 1];
      const L = simple.left[k];
      const R = simple.right[k];
      for (const side of [L, R]) {
        if (side === EMPTY) continue;
        const other = side === L ? R : L;
        const z = storiesToM(pStories[side - 1]);
        for (let v = v0; v < v1; v++) rimPos.push(ll[2 * v], ll[2 * v + 1], z);
        rimStarts.push(rimPos.length / 3);
        rimPiece.push(side - 1);
        rimKind.push(
          other === EMPTY || pStories[other - 1] !== pStories[side - 1] ? CHAIN_LIMIT : CHAIN_SOURCE
        );
      }
      if (L === EMPTY || R === EMPTY) continue;
      const sL = pStories[L - 1];
      const sR = pStories[R - 1];
      if (sL === sR) continue;
      const hiPiece = sL > sR ? L - 1 : R - 1;
      const zLo = storiesToM(Math.min(sL, sR));
      const zHi = storiesToM(Math.max(sL, sR));
      for (let v = v0; v + 1 < v1; v++) {
        wa.push(ll[2 * v], ll[2 * v + 1]);
        wb.push(ll[2 * v + 2], ll[2 * v + 3]);
        wLo.push(zLo);
        wHi.push(zHi);
        wPiece.push(hiPiece);
      }
    }
    yield;
  }

  // Faces, from the same simplified chains.
  const byLabel = assembleFaces(simple);
  yield;
  const faces: LidFace[] = [];
  const toLL = (ring: Float64Array): Float64Array => {
    const out = new Float64Array(ring.length);
    for (let i = 0; i < ring.length; i += 2) {
      const [lng, lat] = vertexToLngLat(f, ring[i], ring[i + 1]);
      out[i] = lng;
      out[i + 1] = lat;
    }
    return out;
  };
  let sinceYield = 0;
  for (const [label, list] of byLabel) {
    for (const face of list) {
      faces.push({ piece: label - 1, rings: [toLL(face.outer), ...face.holes.map(toLL)] });
      sinceYield += face.outer.length + face.holes.reduce((a, h) => a + h.length, 0);
    }
    if (sinceYield >= 2 * VERTS_PER_UNIT) {
      sinceYield = 0;
      yield;
    }
  }
  yield;

  // Labels: one per component, at the label point of its part with the most room (priority: the
  // component's cells); in paint mode, one per part, each with its own room to grow.
  // The sources under a part: the paint part is paint; the rest is every other source of its component.
  const localSources: Set<number>[] = localComp.map(() => new Set<number>());
  for (let p = 0; p < pSrc.length; p++) localSources[pLocal[p]].add(pSrc[p]);
  const ownersOf = (local: number, painted: boolean): number[] =>
    painted
      ? [SRC_PAINT]
      : [...localSources[local]].filter((s) => s !== SRC_PAINT || localSources[local].size === 1);
  const candidate = (local: number, g: number, room: number, priority: number): LabelCandidate => {
    const i = parts.at[g];
    const s = model.componentStories[localComp[local]];
    const [lng, lat] = vertexToLngLat(f, (i % cols) + 0.5, Math.floor(i / cols) + 0.5);
    return {
      lng,
      lat,
      zM: storiesToM(s),
      text: lidLabelText(s, room),
      priority,
      roomM: parts.dist[g],
      owners: ownersOf(local, g % 2 === 1)
    };
  };
  const plain: LabelCandidate[] = [];
  const paint: LabelCandidate[] = [];
  for (let local = 0; local < nLocal; local++) {
    const rest = 2 * local;
    const painted = rest + 1;
    const total = parts.cells[rest] + parts.cells[painted];
    if (total === 0) continue;
    const room = model.componentRoom[localComp[local]] ?? 0;
    const roomier =
      parts.cells[rest] === 0 || parts.dist[painted] > parts.dist[rest] ? painted : rest;
    const c = candidate(local, roomier, room, total);
    plain.push(c);
    if (parts.cells[painted] === 0) {
      paint.push(c);
      continue;
    }
    const pr = Math.min(room, paintRoom[local]);
    paint.push(candidate(local, painted, pr, parts.cells[painted]));
    if (parts.cells[rest] > 0) paint.push(candidate(local, rest, room - pr, parts.cells[rest]));
  }
  const labelSet = toLabelSet(plain, placeLabels(plain, LID_ZOOMS));
  // without paint in view the sets are equal, but never shared (each buffer is transferred once)
  const paintLabels: LabelSet = anyPaint
    ? toLabelSet(paint, placeLabels(paint, LID_ZOOMS))
    : {
        text: [...labelSet.text],
        position: labelSet.position.slice(),
        minZoom: labelSet.minZoom.slice(),
        ...(labelSet.owners
          ? { owners: labelSet.owners.slice(), ownerStarts: labelSet.ownerStarts!.slice() }
          : {})
      };

  const nPieces = pStories.length;
  const glaze = new Uint8Array(nPieces);
  for (let p = 0; p < nPieces; p++) glaze[p] = model.componentGlaze[pComp[p]];
  return {
    limitsRev: input.limitsRev,
    sourceIds: [...input.sourceIds],
    pieces: {
      stories: Uint8Array.from(pStories),
      source: Uint16Array.from(pSrc),
      component: Uint32Array.from(pComp),
      glaze
    },
    faces,
    rims: {
      starts: Uint32Array.from(rimStarts),
      positions: Float64Array.from(rimPos),
      piece: Uint32Array.from(rimPiece),
      kind: Uint8Array.from(rimKind)
    },
    walls: {
      count: wPiece.length,
      a: Float64Array.from(wa),
      b: Float64Array.from(wb),
      zLo: Float32Array.from(wLo),
      zHi: Float32Array.from(wHi),
      piece: Uint32Array.from(wPiece)
    },
    labels: labelSet,
    paintLabels
  };
}
