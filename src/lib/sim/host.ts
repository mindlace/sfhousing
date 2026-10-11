// Worker host core (spec §4.9): handles I15 requests, owns the ParcelIndex, the plan and the
// committed envelopes, and drives the chunk loader and the display. Worker-bundle module:
// zod-free, DOM-free, $app-free; only `import type` from $lib/data/manifest.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { fnv1a32, generate, type BuildoutMode, type GeneratedBuilding } from '$lib/generator';
import {
  applyOp,
  createParcelIndex,
  emptyPlan,
  opBBox,
  resolveChunk,
  resolveEnvelopes,
  resolveParcels,
  validatePlan,
  type Envelope,
  type EnvelopeChange,
  type EnvelopeMap,
  type OpCoverage,
  type ParcelIndex,
  type Plan,
  type PlanOp
} from '$lib/plan';
import { M1_TARGETS, type Target } from '$lib/scoreboard';
import { cellsIntersecting, createChunkLoader, type ChunkLoader, type FetchLike } from './chunks';
import { createDisplay, type Display } from './display';
import { createLru, type Lru } from './lru';
import { checkManifestShape } from './manifest-shape';
import type { ErrorResponse, OpStats, ParcelSummary, SimRequest, SimResponse } from './protocol';

export interface SimHostDeps {
  fetch: FetchLike;
  post(msg: SimResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  generate?: typeof generate; // default: $lib/generator generate
  targets?: readonly Target[]; // default M1_TARGETS
  retryDelaysMs?: readonly number[]; // default DEFAULT_RETRY_DELAYS_MS
  maxConcurrent?: number; // default 4
  batchParcels?: number; // default 5000
  memoCap?: number; // generate-memo entries, default DEFAULT_MEMO_CAP
}

export interface SimHost {
  handle(req: SimRequest): void;
  dispose(): void;
}

/**
 * Generate-memo cap, in entries (W7d, measured on the host.bench synthetic city with the real
 * generator). One entry retains ≈0.8–1.0 KB (key, Map slot and building) and ≈77 B when the
 * display already holds the building. 160,000 covers every SF parcel (≈150k) at one height, so
 * a whole-city reload, or the undo and redo of a whole-city stroke, still hits; below the
 * eligible count those sequences thrash to 0–12 % hits. Every smaller sequence (preview then
 * commit, undo/redo, repaint) already reaches the unbounded hit rate at 65,536. Worst case, all
 * entries off-display: ≈160 MB, against the unbounded memo's ≈150k × 80 heights.
 */
export const DEFAULT_MEMO_CAP = 160_000;

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = Object.freeze([1000, 4000, 16000]);

interface Preview {
  op: PlanOp;
  env: Map<ParcelId, Envelope | null>;
}

interface State {
  manifest: Manifest;
  version: string;
  mode: BuildoutMode;
  index: ParcelIndex;
  cellOf: Map<ParcelId, string>;
  plan: Plan; // host copy; the ops array is owned by the host
  opIds: Set<string>;
  committed: EnvelopeMap;
  preview: Preview | null;
  memo: Lru<string, GeneratedBuilding | null>; // bounded; a miss just regenerates
  logged: Set<ParcelId>; // bounded by the parcel count; keeps an evicted throw from re-logging
  display: Display;
  loader: ChunkLoader;
  opCells: WeakMap<PlanOp, string[]>;
}

type RevRequest = Extract<SimRequest, { rev: number }>;

/** The value an op writes to a covered eligible parcel (null = delete). Exhaustive (spec §5). */
function written(op: PlanOp): Envelope | null {
  switch (op.kind) {
    case 'paint':
      return { maxStories: op.stories };
    case 'erase':
      return null;
    default: {
      const never: never = op;
      throw new Error(`unknown op kind ${String((never as { kind?: unknown }).kind)}`);
    }
  }
}

export function createSimHost(deps: SimHostDeps): SimHost {
  const gen = deps.generate ?? generate;
  const targets = deps.targets ?? M1_TARGETS;
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxConcurrent = deps.maxConcurrent ?? 4;
  const batchParcels = deps.batchParcels ?? 5000;
  const memoCap = deps.memoCap ?? DEFAULT_MEMO_CAP;

  let s: State | null = null;
  let latestRev = 0;

  const post = (msg: SimResponse, transfer: ArrayBuffer[] = []) => deps.post(msg, transfer);
  const error = (rev: number, code: ErrorResponse['code'], message: string) =>
    post({ type: 'error', rev, code, message });

  function envFor(st: State, id: ParcelId): Envelope | null {
    if (st.preview && st.preview.env.has(id)) return st.preview.env.get(id)!;
    return st.committed.get(id) ?? null;
  }

  function opCellsOf(st: State, op: PlanOp): string[] {
    let cells = st.opCells.get(op);
    if (!cells) {
      cells = cellsIntersecting(st.manifest, opBBox(op));
      st.opCells.set(op, cells);
    }
    return cells;
  }

  function neededCells(st: State): Set<string> {
    const out = new Set<string>();
    const ops = st.preview ? [...st.plan.ops, st.preview.op] : st.plan.ops;
    for (const op of ops) for (const c of opCellsOf(st, op)) out.add(c);
    return out;
  }

  function complete(st: State): boolean {
    for (const c of neededCells(st)) if (!st.loader.isReady(c)) return false;
    return true;
  }

  function build(st: State, rec: ParcelRecord, env: Envelope): GeneratedBuilding | null {
    const key = `${rec.id}|${env.maxStories}`;
    const hit = st.memo.get(key);
    if (hit !== undefined) return hit;
    let out: GeneratedBuilding | null;
    try {
      out = gen(rec, env, fnv1a32(rec.id), st.mode);
    } catch (e) {
      // R10: bad data or a generator bug costs one parcel, logged once.
      if (!st.logged.has(rec.id)) {
        st.logged.add(rec.id);
        console.error(`[sim] generate ${rec.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      out = null;
    }
    st.memo.set(key, out);
    return out;
  }

  function onLoaded(st: State, cellId: string, records: ParcelRecord[]): void {
    if (s !== st) return; // a superseded init's loader
    try {
      applyChunk(st, cellId, records);
    } catch (e) {
      // The loader would swallow this; report it so the client resyncs with a `load`.
      error(
        latestRev,
        'internal',
        `chunk ${cellId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  function applyChunk(st: State, cellId: string, records: ParcelRecord[]): void {
    const ids = st.index.addChunk(cellId, records);
    for (const id of ids) st.cellOf.set(id, cellId);
    for (const [id, env] of resolveChunk(st.plan, st.index, ids)) {
      if (env) st.committed.set(id, env);
    }
    if (st.preview) {
      const covered = new Set(st.index.covered(st.preview.op));
      const value = written(st.preview.op);
      for (const id of ids) {
        if (covered.has(id) && st.index.get(id)!.eligible) st.preview.env.set(id, value);
      }
    }
    st.display.update(ids, (id) => envFor(st, id), {
      rev: latestRev,
      phase: 'chunk',
      complete: () => complete(st)
    });
  }

  function init(req: Extract<SimRequest, { type: 'init' }>): void {
    const problem = checkManifestShape(req.manifest);
    if (problem !== null) {
      if (s) {
        s.loader.dispose();
        s = null;
      }
      error(req.rev, 'manifest-invalid', problem);
      return;
    }
    s?.loader.dispose();
    s = null; // a throw below must not leave the disposed state in place
    const manifest = req.manifest;
    const version = manifest.datasetVersion;
    // `st` is assigned before any callback can run: the loader only calls back asynchronously.
    const st = {
      manifest,
      version,
      mode: req.mode,
      index: createParcelIndex(),
      cellOf: new Map(),
      plan: emptyPlan(version), // version already regex-checked
      opIds: new Set(),
      committed: new Map(),
      preview: null,
      memo: createLru(memoCap),
      logged: new Set(),
      opCells: new WeakMap()
    } as Omit<State, 'display' | 'loader'> as State;
    st.display = createDisplay({
      record: (id) => st.index.get(id),
      cellOf: (id) => st.cellOf.get(id),
      build: (rec, env) => build(st, rec, env),
      targets,
      post: (msg, transfer) => post(msg, transfer),
      batchParcels
    });
    st.loader = createChunkLoader(manifest, {
      fetch: deps.fetch,
      setTimeout: deps.setTimeout,
      clearTimeout: deps.clearTimeout,
      retryDelaysMs,
      maxConcurrent,
      onLoaded: (cellId, records) => onLoaded(st, cellId, records),
      onReport: (r) => {
        if (s === st) post({ type: 'chunks', ...r });
      }
    });
    s = st;
    latestRev = req.rev;
    post({
      type: 'ready',
      rev: req.rev,
      datasetVersion: version,
      chunkCount: manifest.chunks.length
    });
  }

  function load(st: State, req: Extract<SimRequest, { type: 'load' }>): void {
    const v = validatePlan(req.plan);
    if (!v.ok) {
      error(req.rev, 'bad-request', v.errors[0]?.message ?? 'invalid plan');
      return;
    }
    // Conductor ruling: a plan from another datasetVersion renders on the manifest's data.
    st.plan = { ...v.value, ops: v.value.ops.slice() };
    st.opIds = new Set(st.plan.ops.map((op) => op.id));
    st.preview = null;
    st.committed = resolveEnvelopes(st.plan, st.index);
    st.loader.want(neededCells(st));
    st.display.reset();
    st.display.update(st.committed.keys(), (id) => envFor(st, id), {
      rev: req.rev,
      phase: 'load',
      complete: () => complete(st)
    });
  }

  /** The validated (quantised) copy of op, or an error message. Shape only. */
  function validOp(st: State, op: PlanOp): PlanOp | string {
    const v = validatePlan({ schema: 1, datasetVersion: st.version, ops: [op] });
    if (!v.ok) return v.errors[0]?.message ?? 'invalid op';
    return v.value.ops[0];
  }

  /** validOp plus the plan's unique-id rule (commits only). */
  function check(st: State, op: PlanOp): PlanOp | string {
    const checked = validOp(st, op);
    if (typeof checked === 'string') return checked;
    if (st.opIds.has(checked.id)) return `Duplicate op id "${checked.id}".`;
    return checked;
  }

  function preview(st: State, req: Extract<SimRequest, { type: 'preview' }>): void {
    const op = validOp(st, req.op); // duplicate ids are fine: a preview is never stored
    if (typeof op === 'string') {
      error(req.rev, 'bad-request', op);
      return;
    }
    const value = written(op);
    const env = new Map<ParcelId, Envelope | null>();
    for (const id of st.index.covered(op)) if (st.index.get(id)!.eligible) env.set(id, value);
    const touched = new Set<ParcelId>(st.preview?.env.keys());
    for (const id of env.keys()) touched.add(id);
    st.preview = { op, env };
    st.loader.want(opCellsOf(st, op));
    st.display.update(touched, (id) => envFor(st, id), {
      rev: req.rev,
      phase: 'preview',
      complete: () => complete(st)
    });
  }

  function cancelPreview(st: State, req: Extract<SimRequest, { type: 'cancelPreview' }>): void {
    const touched = [...(st.preview?.env.keys() ?? [])];
    st.preview = null;
    // Always one diff, even with no preview: it supersedes any in-flight preview diff (§4.9).
    st.display.update(touched, (id) => envFor(st, id), {
      rev: req.rev,
      phase: 'cancel',
      complete: () => complete(st)
    });
  }

  /** OpStats for op, just applied to st.committed (spec §4.5 "Result announcement"). */
  function computeStats(
    st: State,
    op: PlanOp,
    coverage: OpCoverage,
    changes: EnvelopeChange[]
  ): OpStats {
    const before = new Map<ParcelId, Envelope | null>();
    for (const c of changes) before.set(c.id, c.before);
    let built = 0;
    let notBigger = 0;
    let removed = 0;
    for (const id of coverage.eligible) {
      const rec = st.index.get(id)!;
      const after = st.committed.get(id) ?? null;
      const was = before.has(id) ? before.get(id)! : after; // unchanged → before = after
      const bAfter = after ? build(st, rec, after) : null;
      const bBefore = was ? build(st, rec, was) : null;
      if (op.kind === 'paint') {
        if (bAfter) built++;
        else notBigger++;
      }
      if (bBefore && !bAfter) removed++;
    }
    return {
      opId: op.id,
      kind: op.kind,
      ...(op.kind === 'paint' ? { stories: op.stories } : {}),
      covered: coverage.eligible.length,
      ineligible: coverage.ineligible.length,
      built,
      notBigger,
      removed,
      partial: opCellsOf(st, op).some((c) => !st.loader.isReady(c))
    };
  }

  function commit(st: State, req: Extract<SimRequest, { type: 'commit' }>): void {
    const op = check(st, req.op);
    if (typeof op === 'string') {
      error(req.rev, 'bad-request', op);
      return;
    }
    // Promotion needs no special path: after a matching preview (same validated op), the
    // rendered envelopes already equal the committed ones, so the commit diff is empty.
    const { changes, coverage } = applyOp(st.committed, op, st.index);
    const stats = computeStats(st, op, coverage, changes);
    st.plan.ops.push(op);
    st.opIds.add(op.id);
    const touched = new Set<ParcelId>(coverage.eligible);
    if (st.preview) for (const id of st.preview.env.keys()) touched.add(id);
    st.preview = null;
    st.loader.want(opCellsOf(st, op));
    st.display.update(touched, (id) => envFor(st, id), {
      rev: req.rev,
      phase: 'commit',
      stats,
      complete: () => complete(st)
    });
  }

  function undo(st: State, req: Extract<SimRequest, { type: 'undo' }>): void {
    const last = st.plan.ops.at(-1);
    if (!last || last.id !== req.opId) {
      error(req.rev, 'bad-request', `"${req.opId}" is not the last committed op.`);
      return;
    }
    st.plan.ops.pop();
    st.opIds.delete(last.id);
    const ids = st.index.covered(last).filter((id) => st.index.get(id)!.eligible);
    for (const [id, env] of resolveParcels(st.plan.ops, st.index, ids)) {
      if (env) st.committed.set(id, env);
      else st.committed.delete(id);
    }
    st.display.update(ids, (id) => envFor(st, id), {
      rev: req.rev,
      phase: 'undo',
      complete: () => complete(st)
    });
  }

  function parcelSummary(st: State | null, parcelId: ParcelId): ParcelSummary | null {
    const rec = st?.index.get(parcelId);
    if (!st || !rec) return null; // never fetches (spec §4.9)
    const b = st.display.building(parcelId);
    return {
      parcelId,
      neighborhood: rec.neighborhood,
      landUse: rec.landUse,
      eligible: rec.eligible,
      existingUnits: rec.existingUnits,
      envelope: envFor(st, parcelId),
      generated: b ? { typology: b.typology, stories: b.stories, units: b.units } : null
    };
  }

  function dispatch(req: SimRequest): void {
    switch (req.type) {
      case 'init':
        return init(req);
      case 'parcelSummary': {
        let summary: ParcelSummary | null;
        try {
          summary = parcelSummary(s, req.parcelId);
        } catch (e) {
          console.error(`[sim] parcelSummary ${req.parcelId}:`, e);
          summary = null; // the client's promise must still resolve
        }
        post({ type: 'parcelSummary', reqId: req.reqId, summary });
        return;
      }
      case 'prefetch':
        if (s) s.loader.want(cellsIntersecting(s.manifest, req.bbox));
        return;
      case 'retryChunks':
        s?.loader.retryFailed();
        return;
    }
    const st = s;
    if (!st) {
      error(req.rev, 'bad-request', 'not initialised'); // R9
      return;
    }
    switch (req.type) {
      case 'load':
        return load(st, req);
      case 'commit':
        return commit(st, req);
      case 'undo':
        return undo(st, req);
      case 'preview':
        return preview(st, req);
      case 'cancelPreview':
        return cancelPreview(st, req);
      default: {
        const never: never = req;
        throw new Error(`unknown request ${String((never as RevRequest).type)}`);
      }
    }
  }

  return {
    handle(req) {
      if ('rev' in req) latestRev = Math.max(latestRev, req.rev);
      try {
        dispatch(req);
      } catch (e) {
        error('rev' in req ? req.rev : latestRev, 'internal', String(e));
      }
    },
    dispose() {
      s?.loader.dispose();
      s = null;
    }
  };
}
