// The /lesscars playback host (Plan 2 Task 4): a third host behind the Worker router, beside the
// editor and scenario hosts. It plays the stored representative future: it decodes
// scenarios/lesscars/timeline.bin against parcels.bin, turns the initiative builds into drawable
// Schedules (builds.ts), packs the market and parking-site projects per chunk cell with the
// scenario geometry, packs every freed-site build once into the synthetic cell `lc-sites-cell`,
// answers building cards, and posts the garage and parking parcels' positions and the
// reservation verdicts. It simulates nothing. Worker-bundle module: zod-free, DOM-free,
// $app-free; the geometry module's determinism lint applies to what it calls.
//
// Structure. Each accepted `initPlayback` gets one `Session` with its own cancellation token, as
// in scenario-host.ts: a new `initPlayback` (accepted or not) and `dispose` cancel it, so a
// superseded session never posts again. Posts, in order: `ready`; once parcels.bin, the FZP
// files and timeline.bin are in, `playbackLoaded`, then revision 0 (the sites cell, every ready
// packable cell and the full demolish list); then one revision per packing slice as chunks
// arrive (a `setTimeout(0)` macrotask that packs while the slice's time so far plus the last
// pack's cost fits `SLICE_PLAN_MS`).
//
// Clearance. A kept parking-conversion reservation clears its lot from the conversion project's
// start day (the earlier of that and any construction on the lot wins). A kept edge-garage
// `{ parcel }` reservation clears nothing: clearance belongs to parking conversions
// (docs/dev/lesscars.md, "Builder's calls on the format"); the page draws the garage as a marker.
// A voided reservation draws nothing: no build, no clearance; the lot shows the market's project.
import {
  decodeTimelinePayload,
  type InitiativeBuild,
  type LessCarsSite,
  type LessCarsTimeline
} from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON } from '$lib/data/lesscars/schedule';
import { inflateRawBody } from '$lib/data/column-file';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { packTimedCell, packTimedTransferables, type TimedPackInput } from '$lib/map/pack-timed';
import type { TimedPackedCell } from '$lib/map/types';
import type { Day } from '$lib/timelapse/time';
import { cellsIntersecting, createChunkLoader, type ChunkLoader, type FetchLike } from '../chunks';
import { DEFAULT_RETRY_DELAYS_MS } from '../host';
import { createLru } from '../lru';
import { checkManifestShape } from '../manifest-shape';
import type { Rev, SimRequest } from '../protocol';
import { createGeometry, type Geometry } from '../scenario/geometry';
import {
  datasetUrl,
  fetchWithRetry,
  loadScenario,
  scenarioUrls,
  type FetchBytesLike,
  type LoadFailure,
  type ScenarioUrls
} from '../scenario/load';
import { MEMO_CAP, SLICE_PLAN_MS } from '../scenario/scenario-host';
import type { ScenarioErrorCode, ScenarioResponse, Schedule, SimInput } from '../scenario/types';
import { SITES_CELL, buildSchedule, freedMassing, playbackCard, type CardEntry } from './builds';
import type { PlaybackCard, PlaybackRequest, PlaybackResponse } from './types';

export type PlaybackHostRequest =
  PlaybackRequest | Extract<SimRequest, { type: 'prefetch' | 'retryChunks' }>;

export interface PlaybackHostDeps {
  fetch: FetchLike; // JSON files (chunks, projects.json, calibration.json)
  fetchBytes: FetchBytesLike; // parcels.bin, timeline.bin
  post(msg: PlaybackResponse | ScenarioResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number; // ms
  generate?: typeof generate;
  generateForUnits?: typeof generateForUnits;
  retryDelaysMs?: readonly number[]; // default DEFAULT_RETRY_DELAYS_MS (1, 4, 16 s)
  maxConcurrent?: number;
  warn?(msg: string): void; // default console.warn
  /** Test seam: the parcels.bin decoder (default `readScenarioParcels`). */
  decodeParcels?(bytes: Uint8Array): Promise<ScenarioParcels>;
  /** Test seam: timeline.bin's raw-deflate inflate (default `inflateRawBody`), so a harness can
   *  tell when this host-external async step has settled. */
  inflate?(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface PlaybackHost {
  handle(r: PlaybackHostRequest): void;
  dispose(): void;
}

interface Token {
  readonly cancelled: boolean;
  later(fn: () => void, ms: number): unknown;
  cancel(): void;
}

function createToken(deps: Pick<PlaybackHostDeps, 'setTimeout' | 'clearTimeout'>): Token {
  const timers = new Set<unknown>();
  let cancelled = false;
  return {
    get cancelled() {
      return cancelled;
    },
    later(fn, ms) {
      if (cancelled) return undefined;
      const h = deps.setTimeout(() => {
        timers.delete(h);
        if (!cancelled) fn();
      }, ms);
      timers.add(h);
      return h;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const h of timers) deps.clearTimeout(h);
      timers.clear();
    }
  };
}

/** A freed-site build and the site it stands on. */
interface Freed {
  build: InitiativeBuild;
  site: LessCarsSite;
  schedule: Schedule;
}

/** A loaded session's playback state. */
interface Play {
  timeline: LessCarsTimeline;
  /** Card entries by project id: market schedules and `lc-build:` builds. */
  entries: Map<string, CardEntry>;
  geometry: Geometry;
  revision: number; // the last posted
  pending: boolean; // a packing slice is scheduled
  packCost: number | undefined; // ms of the last packed cell
}

interface Session {
  rev: Rev;
  manifest: Manifest;
  plan: Extract<PlaybackRequest, { type: 'initPlayback' }>['plan'];
  sites: Extract<PlaybackRequest, { type: 'initPlayback' }>['sites'];
  urls: ScenarioUrls;
  timelineUrl: string;
  token: Token;
  loader: ChunkLoader;
  byCell: Map<string, ParcelRecord[]>;
  records: Map<ParcelId, ParcelRecord>;
  /** Every cell `prefetch` has asked for. */
  wanted: Set<string>;
  memo: ReturnType<typeof createLru<string, GeneratedBuilding | null>>;
  logged: Set<string>;
  play: Play | null;
}

type InitRequest = Extract<PlaybackRequest, { type: 'initPlayback' }>;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ignore = () => {};
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createPlaybackHost(deps: PlaybackHostDeps): PlaybackHost {
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const warn = deps.warn ?? ((msg: string) => console.warn(`[lesscars] ${msg}`));
  const gen = deps.generate ?? generate;
  const genForUnits = deps.generateForUnits ?? generateForUnits;
  const inflate = deps.inflate ?? inflateRawBody;

  let s: Session | null = null;
  let latestRev = 0;

  const post = (msg: PlaybackResponse | ScenarioResponse, transfer: ArrayBuffer[] = []) =>
    deps.post(msg, transfer);
  const error = (rev: Rev, code: ScenarioErrorCode, message: string) =>
    post({ type: 'error', rev, code, message });
  const live = (st: Session) => s === st && !st.token.cancelled;
  const logOnce = (st: Session, key: string, msg: string) => {
    if (st.logged.has(key)) return;
    st.logged.add(key);
    warn(msg);
  };

  function end(): void {
    s?.token.cancel();
    s?.loader.dispose();
    s = null;
  }

  function fail(st: Session, code: ScenarioErrorCode, message: string): void {
    end();
    error(st.rev, code, message);
  }

  function initPlayback(req: InitRequest): void {
    end(); // any initPlayback, accepted or not, supersedes the previous one
    const shape = checkManifestShape(req.manifest);
    if (shape !== null) return error(req.rev, 'manifest-invalid', shape);
    const manifest = req.manifest;
    const version = manifest.datasetVersion;
    const urls = scenarioUrls(manifest);
    if (urls === null) {
      return error(req.rev, 'scenario-missing', `dataset ${version} has no fzp scenario`);
    }
    const timelineUrl = datasetUrl(manifest, manifest.scenarios?.lesscars?.timeline);
    if (timelineUrl === null) {
      return error(req.rev, 'scenario-missing', `dataset ${version} has no lesscars timeline`);
    }
    for (const [name, file] of [
      ['plan', req.plan],
      ['sites', req.sites]
    ] as const) {
      const v = (file as { datasetVersion?: unknown } | null | undefined)?.datasetVersion;
      if (v !== version) {
        return error(req.rev, 'bad-request', `${name} is for ${String(v)}, not ${version}`);
      }
    }
    // `st` is assigned before any loader callback can run: they only come asynchronously.
    const st = {
      rev: req.rev,
      manifest,
      plan: req.plan,
      sites: req.sites,
      urls,
      timelineUrl,
      token: createToken(deps),
      byCell: new Map(),
      records: new Map(),
      wanted: new Set(),
      memo: createLru<string, GeneratedBuilding | null>(MEMO_CAP),
      logged: new Set(),
      play: null
    } as Omit<Session, 'loader'> as Session;
    st.loader = createChunkLoader(manifest, {
      fetch: deps.fetch,
      setTimeout: deps.setTimeout,
      clearTimeout: deps.clearTimeout,
      retryDelaysMs,
      maxConcurrent: deps.maxConcurrent ?? 4,
      onLoaded: (cellId, recs) => onChunk(st, cellId, recs),
      onReport: (r) => {
        if (live(st)) post({ type: 'chunks', ...r });
      }
    });
    s = st;
    post({
      type: 'ready',
      rev: req.rev,
      datasetVersion: version,
      chunkCount: manifest.chunks.length
    });
    load(st);
  }

  // --- loading ---

  async function fetchTimeline(st: Session): Promise<ArrayBuffer | LoadFailure | null> {
    const url = st.timelineUrl;
    const r = await fetchWithRetry(
      url,
      () =>
        deps
          .fetchBytes(url)
          .then((x) => ({ ok: x.ok, status: x.status, read: () => x.arrayBuffer() })),
      { setTimeout: (fn, ms) => st.token.later(fn, ms), retryDelaysMs },
      () => !live(st)
    );
    if (r.kind === 'stopped') return null;
    if (r.kind === 'failed') return { code: 'internal', message: r.message };
    return r.value;
  }

  function load(st: Session): void {
    const stop = () => !live(st);
    const scenario = loadScenario(
      {
        fetch: deps.fetch,
        fetchBytes: deps.fetchBytes,
        setTimeout: (fn, ms) => st.token.later(fn, ms),
        retryDelaysMs,
        warn,
        decodeParcels: deps.decodeParcels
      },
      st.urls,
      stop
    );
    const timelineFetch = fetchTimeline(st);
    // A failed file ends the session at once, without waiting on the other's retries (the
    // ended session's token then stops them).
    void scenario.then((r) => {
      if (live(st) && 'code' in r) fail(st, r.code, r.message);
    }, ignore);
    void timelineFetch.then((b) => {
      if (live(st) && b !== null && !(b instanceof ArrayBuffer)) fail(st, b.code, b.message);
    }, ignore);
    Promise.all([scenario, timelineFetch])
      .then(async ([r, bin]) => {
        if (!live(st)) return;
        if ('code' in r) return fail(st, r.code, r.message);
        if (bin === null) return; // stopped
        if (!(bin instanceof ArrayBuffer)) return fail(st, bin.code, bin.message);
        let timeline: LessCarsTimeline;
        try {
          const bytes = await inflate(new Uint8Array(bin));
          if (!live(st)) return;
          timeline = decodeTimelinePayload(bytes, r.fzp.parcels);
          if (timeline.datasetVersion !== st.manifest.datasetVersion) {
            throw new Error(
              `datasetVersion is ${timeline.datasetVersion}, not ${st.manifest.datasetVersion}`
            );
          }
        } catch (e) {
          if (live(st)) fail(st, 'scenario-invalid', `timeline.bin: ${messageOf(e)}`);
          return;
        }
        loaded(st, r.fzp, timeline);
      })
      .catch((e: unknown) => {
        if (live(st)) fail(st, 'internal', String(e));
      });
  }

  /** Everything is in: the entries, `playbackLoaded`, the geometry and revision 0. */
  function loaded(st: Session, fzp: SimInput, timeline: LessCarsTimeline): void {
    const parcels = fzp.parcels;
    const projects = st.plan.plan.projects;
    const labels = new Map(projects.map((p) => [p.id, p.label]));
    const sites = new Map(st.sites.sites.map((x) => [x.siteId, x]));

    const entries = new Map<string, CardEntry>();
    for (const schedule of timeline.schedules) {
      entries.set(schedule.projectId, { kind: 'market', schedule });
    }
    const parking: Schedule[] = [];
    const freed: Freed[] = [];
    for (const build of timeline.builds) {
      const planLabel = labels.get(build.projectId) ?? build.projectId;
      if (build.parcelRow !== null) {
        const schedule = buildSchedule(build, parcels.id[build.parcelRow], LESSCARS_HORIZON);
        entries.set(schedule.projectId, { kind: 'parking', schedule, build, planLabel });
        parking.push(schedule);
        continue;
      }
      const site = sites.get(build.siteId);
      if (!site) {
        logOnce(
          st,
          `site:${build.siteId}`,
          `freed build ${build.siteId} has no site in sites.json`
        );
        continue;
      }
      const schedule = buildSchedule(build, build.siteId, LESSCARS_HORIZON);
      entries.set(schedule.projectId, { kind: 'freed', schedule, build, planLabel });
      freed.push({ build, site, schedule });
    }

    // The plan's parcels: positions for the page's markers, and the parking clearance days.
    const places: Record<ParcelId, [number, number]> = {};
    const clearFrom = new Map<ParcelId, Day>();
    const startOf = new Map(st.plan.times.map((t) => [t.id, t.startDay]));
    for (const p of projects) {
      let id: ParcelId | null = null;
      if (p.kind === 'parking-conversion') {
        id = p.parcel;
        const start = startOf.get(p.id);
        if (start !== undefined) clearFrom.set(id, start);
      } else if (p.kind === 'edge-garage' && 'parcel' in p.site) id = p.site.parcel;
      if (id === null) continue;
      const i = parcels.index.get(id);
      if (i !== undefined) places[id] = [parcels.labelPoint[2 * i], parcels.labelPoint[2 * i + 1]];
    }
    const reservations = timeline.reservations.map((x) => ({
      parcelId: parcels.id[x.row],
      kept: x.kept
    }));
    post({ type: 'playbackLoaded', rev: st.rev, seed: timeline.seed, places, reservations });

    const geometry = createGeometry({
      input: fzp,
      schedules: [...timeline.schedules, ...parking],
      records: st.byCell,
      recordOf: (id) => st.records.get(id),
      massingCtx: {
        input: fzp,
        memo: st.memo,
        gen,
        genForUnits,
        logOnce: (projectId, msg) => logOnce(st, `massing:${projectId}`, msg)
      },
      warnOnce: (key, msg) => logOnce(st, key, msg)
    });
    const play: Play = {
      timeline,
      entries,
      geometry,
      revision: -1,
      pending: false,
      packCost: undefined
    };
    st.play = play;

    // Revision 0: the sites cell, every ready packable cell, and the full demolish list.
    const cells: TimedPackedCell[] = [];
    if (freed.length > 0) cells.push(packSites(st, freed));
    for (let id = geometry.packable()[0]; id !== undefined; id = geometry.packable()[0]) {
      cells.push(geometry.pack(id));
    }
    const demolish = new Map<ParcelId, Day>();
    for (const d of geometry.demolish()) demolish.set(d.parcelId, d.day);
    for (const x of reservations) {
      const day = x.kept ? clearFrom.get(x.parcelId) : undefined;
      if (day === undefined) continue;
      const at = demolish.get(x.parcelId);
      if (at === undefined || day < at) demolish.set(x.parcelId, day);
    }
    postRevision(
      st,
      play,
      cells,
      [...demolish.keys()].sort(cmp).map((parcelId) => ({ parcelId, day: demolish.get(parcelId)! }))
    );
    // the viewport was asked for before the parking projects' extra cells were known
    st.loader.want(geometry.cellsFor(st.wanted));
  }

  /** Every freed-site build in one cell; an unpackable one is logged and left out. */
  function packSites(st: Session, freed: Freed[]): TimedPackedCell {
    const items: TimedPackInput[] = freed.map((f) => ({
      schedule: f.schedule,
      massings: [freedMassing(f.build, f.site.rec, gen)],
      pickParcelId: f.build.siteId
    }));
    try {
      return packTimedCell(SITES_CELL, items);
    } catch {
      const good = items.filter((item) => {
        try {
          packTimedCell(SITES_CELL, [item]);
          return true;
        } catch (e) {
          const id = item.schedule.projectId;
          logOnce(st, `pack:${id}`, `${messageOf(e)}; not drawn`);
          return false;
        }
      });
      return packTimedCell(SITES_CELL, good);
    }
  }

  function postRevision(
    st: Session,
    play: Play,
    cells: TimedPackedCell[],
    demolish: { parcelId: ParcelId; day: Day }[]
  ): void {
    play.revision++;
    post(
      {
        type: 'playback',
        rev: st.rev,
        render: { revision: play.revision, cells, removedCells: [], demolish },
        complete: play.geometry.complete()
      },
      cells.flatMap(packTimedTransferables)
    );
  }

  // --- chunks and packing ---

  function onChunk(st: Session, cellId: string, recs: ParcelRecord[]): void {
    if (!live(st)) return; // a superseded session's loader
    st.byCell.set(cellId, recs);
    for (const r of recs) st.records.set(r.id, r);
    const play = st.play;
    if (!play) return; // the geometry, once made, takes every ready cell
    play.geometry.onRecords(cellId, recs);
    kick(st, play);
  }

  function kick(st: Session, play: Play): void {
    if (play.pending || !live(st) || play.geometry.packable().length === 0) return;
    play.pending = true;
    st.token.later(() => {
      play.pending = false;
      try {
        slice(st, play);
      } catch (e) {
        if (!live(st)) return;
        fail(st, 'internal', String(e));
      }
    }, 0);
  }

  /** One macrotask: packs ready cells while they fit `SLICE_PLAN_MS`, then one revision. */
  function slice(st: Session, play: Play): void {
    const g = play.geometry;
    const start = deps.now();
    const cells: TimedPackedCell[] = [];
    for (let first = true; ; first = false) {
      const cellId = g.packable()[0];
      if (cellId === undefined) break;
      if (!first && deps.now() - start + (play.packCost ?? Infinity) > SLICE_PLAN_MS) break;
      const t0 = deps.now();
      cells.push(g.pack(cellId));
      play.packCost = deps.now() - t0;
    }
    if (cells.length > 0) postRevision(st, play, cells, []);
    kick(st, play);
  }

  function prefetch(st: Session, bbox: readonly number[]): void {
    const cells = cellsIntersecting(st.manifest, bbox);
    for (const c of cells) st.wanted.add(c);
    const all = new Set(cells);
    const g = st.play?.geometry;
    if (g) for (const c of g.cellsFor(cells)) all.add(c);
    st.loader.want(all);
  }

  function card(projectId: string, day: Day): PlaybackCard | null {
    const entry = s?.play?.entries.get(projectId);
    return entry ? playbackCard(entry, day) : null;
  }

  function dispatch(req: PlaybackHostRequest): void {
    switch (req.type) {
      case 'initPlayback':
        return initPlayback(req);
      case 'playbackCard': {
        let c: PlaybackCard | null;
        try {
          c = card(req.projectId, req.day);
        } catch (e) {
          warn(`playbackCard ${req.projectId}: ${messageOf(e)}`);
          c = null; // the client's promise must still resolve
        }
        return post({ type: 'playbackCard', reqId: req.reqId, card: c });
      }
      case 'prefetch':
        if (s) prefetch(s, req.bbox);
        return;
      case 'retryChunks':
        s?.loader.retryFailed();
        return;
      default: {
        const never: never = req;
        throw new Error(`unknown request ${String((never as { type?: unknown }).type)}`);
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
      end();
    }
  };
}
