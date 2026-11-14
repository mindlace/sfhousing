// The timeline host (ensemble-runner spec S14, rules 2, 3, 18, 20, 21): one session per
// `openTimeline`, checked and loaded as `initScenario` is today (scenario-host.ts:518-583,
// 630-664), then filled by the runner (`runner/runner.ts`). Today's shared requests are answered
// from the session's dataset (`runner/lookups.ts`) and the plan's frame at the last `viewMonth`.
//
// A new `openTimeline` (or `dispose`) ends the session: its timers are cancelled, nothing of it is
// posted afterwards, and the requests still waiting on it are answered `no-session`.
// Worker-bundle module: zod-free, DOM-free, $app-free.
import type { GrossTable } from '$lib/data/gross-table';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { PolicyParcels } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { cellsIntersecting, type FetchLike } from '$lib/sim/chunks';
import { DEFAULT_RETRY_DELAYS_MS } from '$lib/sim/host';
import { createLru } from '$lib/sim/lru';
import { checkManifestShape } from '$lib/sim/manifest-shape';
import type { ParcelSummary, Rev } from '$lib/sim/protocol';
import {
  scenarioUrls,
  type FetchBytesLike,
  type Loaded,
  type LoadFailure,
  type ScenarioUrls
} from '$lib/sim/scenario/load';
import { PREVIEW_MAX_LOTS } from '$lib/sim/scenario/preview';
import { createToken, MEMO_CAP, type Token } from '$lib/sim/scenario/scenario-host';
import {
  openTimelineProblem,
  setPolicyProblem,
  type OpenTimelineRequest,
  type TimelineErrorCode,
  type TimelineHostRequest,
  type TimelineHostResponse
} from '$lib/sim/timeline-protocol';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { limitsAt, limitsOf } from './policy/limits';
import { cardAt } from './score';
import {
  createChunkSet,
  loadDataset,
  type ChunkSet,
  type Dataset,
  type DatasetDeps
} from './runner/dataset';
import {
  cardDepsOf,
  createBrushService,
  lotAtResult,
  lotOutlinesResult,
  previewResult
} from './runner/lookups';
import { createRunner, type Runner } from './runner/runner';

export interface TimelineHostDeps {
  fetch: FetchLike;
  fetchBytes: FetchBytesLike;
  post(msg: TimelineHostResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number;
  /** Default `DEFAULT_RETRY_DELAYS_MS` (1, 4, 16 s). */
  retryDelaysMs?: readonly number[];
  maxConcurrent?: number;
  /** Generator-memo cap in entries (default `MEMO_CAP`). */
  memoCap?: number;
  /** The most lots one `previewBuildings` builds (default `PREVIEW_MAX_LOTS`). */
  previewMaxLots?: number;
  /** Default `console.warn`. */
  warn?(msg: string): void;
  generate?: typeof generate;
  generateForUnits?: typeof generateForUnits;
  decodeParcels?(bytes: Uint8Array): Promise<ScenarioParcels>;
  decodePolicy?(bytes: Uint8Array, parcels: ScenarioParcels): Promise<PolicyParcels>;
  decodeGross?(bytes: Uint8Array): Promise<GrossTable>;
  /** Seam: the load itself (default `loadScenario(…, { policy: true })`). */
  load?(urls: ScenarioUrls): Promise<Loaded | LoadFailure>;
}

export interface TimelineHost {
  handle(req: TimelineHostRequest): void;
  dispose(): void;
}

/** What the runner opens with once loaded: the open request, or the latest edit before the load. */
interface Opening {
  rev: Rev;
  policy: SimPolicy4;
  lots: Record<string, ParcelId[]>;
  worlds: number;
  months: number;
}

interface Session {
  rev: Rev;
  manifest: Manifest;
  urls: ScenarioUrls;
  token: Token;
  chunks: ChunkSet;
  ds: Dataset | null;
  runner: Runner | null;
  brush: ReturnType<typeof createBrushService> | null;
  /** Brush requests that came before the load (query null: the catalog). */
  early: { reqId: number; query: unknown | null }[];
  opening: Opening;
  /** A `viewMonth` before the runner exists. */
  view: number | null;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function createTimelineHost(deps: TimelineHostDeps): TimelineHost {
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const warn = deps.warn ?? ((msg: string) => console.warn(`[sim] ${msg}`));
  const gen = deps.generate ?? generate;
  const genForUnits = deps.generateForUnits ?? generateForUnits;
  const previewMaxLots = deps.previewMaxLots ?? PREVIEW_MAX_LOTS;

  // Valid within one datasetVersion (content keys hold no version): kept across sessions of the
  // same version, cleared with the once-only log keys for another (scenario-host.ts:474-483,
  // 530-534).
  const memo = createLru<string, GeneratedBuilding | null>(deps.memoCap ?? MEMO_CAP);
  const logged = new Set<string>();
  let memoVersion: string | null = null;
  const logOnce = (key: string, msg: string) => {
    if (logged.has(key)) return;
    logged.add(key);
    warn(msg);
  };

  let s: Session | null = null;
  let latestRev = 0;

  const post = (msg: TimelineHostResponse, transfer: ArrayBuffer[] = []) =>
    deps.post(msg, transfer);
  const error = (rev: Rev, code: TimelineErrorCode, message: string) =>
    post({ type: 'error', rev, code, message });

  /** True while `st` is the current, uncancelled session. */
  const live = (st: Session) => s === st && !st.token.cancelled;

  function brushNoSession(reqId: number, isCatalog: boolean): void {
    if (isCatalog) return post({ type: 'brushCatalog', reqId, catalog: null });
    const message = 'brushes need a loaded session initialised with levers';
    post({ type: 'brushLots', reqId, result: { ok: false, reason: 'no-session', message } });
  }

  function end(): void {
    const st = s;
    s = null;
    if (st === null) return;
    st.token.cancel();
    st.chunks.dispose();
    st.runner?.dispose();
    // every request still waiting on this session is answered now
    st.brush?.end();
    const early = st.early;
    st.early = [];
    for (const e of early) brushNoSession(e.reqId, e.query === null);
  }

  function fail(st: Session, code: TimelineErrorCode, message: string): void {
    const rev = st.opening.rev;
    end();
    error(rev, code, message);
  }

  function openTimeline(req: OpenTimelineRequest): void {
    end(); // any openTimeline, accepted or not, supersedes the previous one
    const rev = isInt((req as { rev?: unknown }).rev) ? req.rev : latestRev;
    const bad = openTimelineProblem(req);
    if (bad !== null) return error(rev, 'bad-request', bad);
    const shape = checkManifestShape(req.manifest);
    if (shape !== null) return error(rev, 'manifest-invalid', shape);
    const manifest = req.manifest;
    const version = manifest.datasetVersion;
    const urls = scenarioUrls(manifest);
    if (urls === null) {
      return error(rev, 'scenario-missing', `dataset ${version} has no fzp scenario`);
    }
    if (version !== memoVersion) {
      memo.clear();
      logged.clear();
      memoVersion = version;
    }
    const token = createToken(deps);
    // `st` is assigned before any loader callback can run: they only come asynchronously.
    const st = {
      rev,
      manifest,
      urls,
      token,
      ds: null,
      runner: null,
      brush: null,
      early: [],
      opening: {
        rev,
        policy: req.policy,
        lots: req.lots,
        worlds: req.worlds,
        months: req.months
      },
      view: null
    } as Omit<Session, 'chunks'> as Session;
    const dsDeps: DatasetDeps = {
      fetch: deps.fetch,
      fetchBytes: deps.fetchBytes,
      later: (fn, ms) => token.later(fn, ms),
      clearTimeout: deps.clearTimeout,
      now: deps.now,
      warn,
      retryDelaysMs,
      maxConcurrent: deps.maxConcurrent ?? 4,
      stopped: () => !live(st),
      onChunk: () => st.runner?.chunkArrived(),
      onChunksReport: (r) => {
        post(r);
        st.runner?.chunkArrived();
      },
      decodeParcels: deps.decodeParcels,
      decodePolicy: deps.decodePolicy,
      decodeGross: deps.decodeGross,
      load: deps.load
    };
    st.chunks = createChunkSet(manifest, dsDeps);
    s = st;
    post({ type: 'ready', rev, datasetVersion: version, chunkCount: manifest.chunks.length });
    loadDataset(manifest, urls, st.chunks, dsDeps, memo, { gen, genForUnits, logOnce }).then(
      (r) => {
        if (!live(st)) return;
        if ('code' in r) return fail(st, r.code, r.message);
        loaded(st, r);
      },
      (e: unknown) => {
        if (live(st)) fail(st, 'internal', String(e));
      }
    );
  }

  /** The dataset is in: the brush service, the waiting brush requests, then the runner. */
  function loaded(st: Session, ds: Dataset): void {
    st.ds = ds;
    st.brush = createBrushService({
      manifest: st.manifest,
      parcels: ds.loaded.fzp.parcels,
      policy: ds.loaded.policy!,
      fetch: deps.fetch,
      later: (fn, ms) => st.token.later(fn, ms),
      retryDelaysMs,
      stopped: () => !live(st),
      warn,
      post
    });
    const early = st.early;
    st.early = [];
    for (const e of early) st.brush.request(e.reqId, e.query);
    const runner = createRunner({
      dataset: ds,
      post: (msg, transfer) => {
        if (live(st)) post(msg, transfer);
      },
      now: deps.now,
      later: (fn, ms) => st.token.later(fn, ms),
      warn,
      logOnce
    });
    st.runner = runner;
    if (st.view !== null) runner.viewMonth(st.view);
    // the view's cells were wanted before the stream existed
    runner.wantCells(st.chunks.wanted);
    const o = st.opening;
    st.rev = o.rev;
    runner.open(o.rev, o.policy, o.lots, o.worlds, o.months);
  }

  function setPolicy(req: Extract<TimelineHostRequest, { type: 'setPolicy' }>): void {
    const bad = setPolicyProblem(req);
    const rev = isInt((req as { rev?: unknown }).rev) ? req.rev : latestRev;
    if (bad !== null) return error(rev, 'bad-request', bad);
    const st = s;
    if (st === null) return error(rev, 'bad-request', 'setPolicy needs an open timeline');
    if (st.runner === null) {
      // before the load: the latest edit is the one opened (Review Focus 1)
      if (rev >= st.opening.rev)
        st.opening = { ...st.opening, rev, policy: req.policy, lots: req.lots };
      return;
    }
    // the runner's rev becomes this one only when it accepts the edit (rule 12)
    st.runner.setPolicy(rev, req.policy, req.lots);
  }

  // --- shared requests ---

  /**
   * World 1 of the plan as it stands, on the requested day (clamped) and the frame of the model
   * month holding it (rule 18). Null when the record is not loaded or no world exists yet.
   */
  function parcelSummary(
    req: Extract<TimelineHostRequest, { type: 'parcelSummary' }>
  ): ParcelSummary | null {
    const st = s;
    const ds = st?.ds;
    const runner = st?.runner;
    if (!st || !ds || !runner || !st.chunks.records.has(req.parcelId)) return null;
    const card = runner.card(req.day);
    if (card === null) return null;
    const { summary, lookups } = cardAt(
      card.world,
      ds.statics,
      card.frame,
      cardDepsOf(ds, () => card.frame.view.parcels, logOnce),
      req.parcelId,
      card.day,
      req.projectId
    );
    summary.lookups = lookups ?? undefined;
    return summary;
  }

  function brushRequest(reqId: number, query: unknown | null): void {
    const st = s;
    if (!st) return brushNoSession(reqId, query === null);
    if (st.brush) return st.brush.request(reqId, query);
    st.early.push({ reqId, query });
  }

  function noSession<T extends 'lotOutlines' | 'previewBuildings' | 'lotAt' | 'heightLids'>(
    type: T,
    reqId: number,
    what: string
  ): void {
    const message = `${what} need a loaded session initialised with levers`;
    post({ type, reqId, result: { ok: false, reason: 'no-session', message } } as Extract<
      TimelineHostResponse,
      { type: T }
    >);
  }

  function dispatch(req: TimelineHostRequest): void {
    switch (req.type) {
      case 'openTimeline':
        return openTimeline(req);
      case 'setPolicy':
        return setPolicy(req);
      case 'viewMonth':
        if (!s) return;
        if (s.runner) s.runner.viewMonth(req.month);
        else s.view = req.month;
        return;
      case 'resyncMap':
        s?.runner?.resyncMap();
        return;
      case 'parcelSummary': {
        let summary: ParcelSummary | null;
        try {
          summary = parcelSummary(req);
        } catch (e) {
          warn(`parcelSummary ${req.parcelId}: ${e instanceof Error ? e.message : String(e)}`);
          summary = null; // the client's promise must still resolve
        }
        return post({ type: 'parcelSummary', reqId: req.reqId, summary });
      }
      case 'resolveBrush':
        return brushRequest(req.reqId, req.query);
      case 'brushCatalog':
        return brushRequest(req.reqId, null);
      case 'lotOutlines': {
        if (!s) return noSession('lotOutlines', req.reqId, 'outlines');
        const { result, transfer } = lotOutlinesResult(s.chunks.records, req.lots);
        return post({ type: 'lotOutlines', reqId: req.reqId, result }, transfer);
      }
      case 'previewBuildings': {
        const frame = s?.runner?.viewFrame() ?? null;
        if (!s?.ds || frame === null) return noSession('previewBuildings', req.reqId, 'previews');
        const { result, transfer } = previewResult({
          parcels: s.ds.loaded.fzp.parcels,
          protectedRow: (row) => limitsAt(frame, row).protected,
          records: s.chunks.records,
          memo,
          gen,
          lots: req.lots,
          stories: req.stories,
          maxLots: previewMaxLots
        });
        return post({ type: 'previewBuildings', reqId: req.reqId, result }, transfer);
      }
      case 'lotAt': {
        if (!s?.ds) return noSession('lotAt', req.reqId, 'lot lookups');
        const frame = s.runner?.viewFrame() ?? null;
        const result = lotAtResult(s.manifest, s.chunks.byCell, req.point, (id) =>
          frame === null ? null : (limitsOf(frame, id)?.owner ?? null)
        );
        return post({ type: 'lotAt', reqId: req.reqId, result });
      }
      case 'heightLids':
        // Task 9 builds them from `cityInputAt`; until then they are not available
        return noSession('heightLids', req.reqId, 'height lids');
      case 'prefetch': {
        if (!s) return;
        const cells = cellsIntersecting(s.manifest, req.bbox);
        s.chunks.want(cells);
        s.runner?.wantCells(cells);
        return;
      }
      case 'retryChunks':
        s?.chunks.retryFailed();
        return;
      default: {
        const never: never = req;
        throw new Error(`unknown request ${String((never as { type?: unknown }).type)}`);
      }
    }
  }

  return {
    handle(req) {
      if ('rev' in req && isInt(req.rev)) latestRev = Math.max(latestRev, req.rev);
      try {
        dispatch(req);
      } catch (e) {
        error(s?.runner?.rev ?? s?.rev ?? latestRev, 'internal', String(e));
      }
    },
    dispose() {
      end();
    }
  };
}
