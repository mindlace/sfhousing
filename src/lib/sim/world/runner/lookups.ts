// The timeline host's shared lookups (ensemble-runner Task 3): brushes, lot outlines, the live
// preview, lotAt, and the parcel card's deps. Wiring only: every model result comes from a
// function the hashed folders export; the parcels and the protection are parameters (the frame
// in use), never levers.
//
// Mirrors the old host (src/lib/sim/scenario/scenario-host.ts), so timeline-ui can retire it:
// - createBrushService: scenario-host.ts:372-392 (files, waiters), 1462-1485 (noSession, the
//   request check), 1565-1635 (filesFor, startBrush, answerBrush), 1637-1694 (brushFile,
//   fetchBrushFile), 501-505 (waiters answered no-session at the end).
// - lotOutlinesResult: scenario-host.ts:1501-1509.
// - previewResult: scenario-host.ts:1533-1562.
// - lotAtResult: scenario-host.ts:1445-1457.
// - buildableStories: scenario-host.ts:1391-1405.
// - cardDepsOf: scenario-host.ts:255-256, 1330-1342 (qualityRules, building, logOnce), 1356
//   (record); `building`'s readiness check is `Geometry.allReady` (scenario/geometry.ts:231-240)
//   over the chunk set's ready cells.
// Worker-bundle module: zod-free, DOM-free, $app-free.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { PolicyParcels } from '$lib/data/policy-codec';
import { scenarioRecordOf, type ScenarioParcels } from '$lib/data/scenario-codec';
import type { TransitNetwork } from '$lib/data/transit';
import { decodeTransit } from '$lib/data/transit-codec';
import {
  fnv1a32,
  lotBuildableStories,
  type generate,
  type GeneratedBuilding
} from '$lib/generator';
import { toLngLat } from '$lib/generator/geo';
import { LID_PAD_M } from '$lib/map/height/lids';
import { packCell, packTransferables } from '$lib/map/pack';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { cellsIntersecting, type FetchLike } from '$lib/sim/chunks';
import {
  BrushDataMissing,
  brushCatalog,
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData,
  type BrushQuery,
  type LotIndex,
  type NeighborhoodShapes
} from '$lib/sim/levers/brushes';
import type { LimitOwner } from '$lib/sim/levers/source';
import type { Lru } from '$lib/sim/lru';
import { packOutlines } from '$lib/sim/outlines';
import { lotAtPoint } from '$lib/sim/scenario/lot-at';
import { brushQueryProblem, datasetUrl, fetchWithRetry } from '$lib/sim/scenario/load';
import { massingFor, simKey } from '$lib/sim/scenario/massing';
import type {
  BrushLotsResult,
  LotAtResult,
  LotOutlinesResult,
  Massing,
  PreviewResult,
  Schedule
} from '$lib/sim/scenario/types';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import type { CardDeps } from '../score/types';
import type { Dataset } from './dataset';

// --- brushes ---

/** The optional brush files and what each decodes to. */
interface BrushFiles {
  transit: TransitNetwork;
  neighborhoods: NeighborhoodShapes;
}
type BrushFile = keyof BrushFiles;
const BRUSH_FILES: readonly BrushFile[] = ['transit', 'neighborhoods'];

/** One brush request not yet answered: it waits on a brush file. */
interface BrushWaiter {
  reqId: number;
  query: BrushQuery | null; // null for `brushCatalog`
}

/** A 4xx on an optional brush file is permanent (absent from this version); 5xx retries. */
const brushPermanent = (status: number) => status >= 400 && status < 500;

/** The files a request needs: every one for the catalog, else the query kind's. */
function filesFor(q: BrushQuery | null): readonly BrushFile[] {
  if (q === null) return BRUSH_FILES;
  switch (q.kind) {
    case 'freehand':
      return [];
    case 'transit':
      return ['transit'];
    case 'area':
      return q.neighborhoods.length > 0 ? ['neighborhoods'] : [];
    default:
      throw new Error(`Unhandled brush: ${JSON.stringify(q satisfies never)}`);
  }
}

/**
 * `resolveBrush` and `brushCatalog` for one loaded session (the service is made once the dataset
 * has loaded, so nothing waits on the load). `parcels` and `policy` are the dataset's as loaded:
 * the `LotIndex` and the resolver memoise on their identity. A request needing an optional file
 * waits for it, fetched once per service on first use; a transient failure (network, 5xx, body
 * read, after the retries) is not cached. `end()` answers every waiting request `no-session`;
 * nothing is posted after it.
 */
export function createBrushService(o: {
  manifest: Manifest;
  parcels: ScenarioParcels;
  policy: PolicyParcels;
  fetch: FetchLike;
  later(fn: () => void, ms: number): unknown;
  retryDelaysMs: readonly number[];
  stopped(): boolean;
  warn(msg: string): void;
  post(msg: TimelineHostResponse, transfer: ArrayBuffer[]): void;
}): { request(reqId: number, query: unknown | null): void; end(): void } {
  const waiting = new Set<BrushWaiter>();
  const files: { [K in BrushFile]?: Promise<BrushFiles[K] | null> } = {};
  let index: LotIndex | null = null;
  let ended = false;
  const stop = () => ended || o.stopped();

  function noSession(reqId: number, isCatalog: boolean): void {
    if (isCatalog) return o.post({ type: 'brushCatalog', reqId, catalog: null }, []);
    const message = 'brushes need a loaded session initialised with levers';
    o.post({ type: 'brushLots', reqId, result: { ok: false, reason: 'no-session', message } }, []);
  }

  async function fetchBrushFile(file: BrushFile): Promise<{ value: unknown; transient: boolean }> {
    const done = (value: unknown, transient = false) => ({ value, transient });
    const m = o.manifest;
    const url = datasetUrl(m, file === 'transit' ? m.transit : m.neighborhoods);
    if (url === null) {
      o.warn(`brushes: dataset ${m.datasetVersion} has no ${file} file`);
      return done(null);
    }
    const r = await fetchWithRetry(
      url,
      () => o.fetch(url).then((x) => ({ ok: x.ok, status: x.status, read: () => x.json() })),
      { setTimeout: (fn, ms) => o.later(fn, ms), retryDelaysMs: o.retryDelaysMs },
      stop,
      brushPermanent
    );
    if (r.kind === 'stopped') return done(null);
    if (r.kind === 'failed') {
      o.warn(`brushes: ${r.message}`);
      return done(null, !r.permanent);
    }
    try {
      if (file === 'transit') return done(decodeTransit(r.value));
      return done(parseNeighborhoods(r.value));
    } catch (e) {
      o.warn(`brushes: ${file} is invalid: ${e instanceof Error ? e.message : String(e)}`);
      return done(null); // a bad file is permanent for this dataset version
    }
  }

  function brushFile<K extends BrushFile>(file: K): Promise<BrushFiles[K] | null> {
    const memo = files as Record<BrushFile, Promise<unknown> | undefined>;
    const hit = memo[file];
    if (hit) return hit as Promise<BrushFiles[K] | null>;
    const p: Promise<unknown> = fetchBrushFile(file).then((r) => {
      if (r.transient && memo[file] === p) delete memo[file];
      return r.value;
    });
    memo[file] = p;
    return p as Promise<BrushFiles[K] | null>;
  }

  function answer(w: BrushWaiter, got: Partial<BrushFiles>): void {
    if (stop() || !waiting.delete(w)) return; // answered no-session at the end
    const data: BrushData = {
      parcels: o.parcels,
      policy: o.policy,
      transit: got.transit ?? null,
      neighborhoods: got.neighborhoods ?? null
    };
    if (w.query === null) {
      let catalog = null;
      try {
        catalog = brushCatalog(data);
      } catch (e) {
        o.warn(`brushCatalog: ${e instanceof Error ? e.message : String(e)}`);
      }
      return o.post({ type: 'brushCatalog', reqId: w.reqId, catalog }, []);
    }
    let result: BrushLotsResult;
    try {
      index ??= createLotIndex(data.parcels);
      const rows = resolveBrushRows(data, index, w.query);
      const lp = data.parcels.labelPoint;
      const points = new Float64Array(2 * rows.length);
      rows.forEach((r, k) => {
        points[2 * k] = lp[2 * r];
        points[2 * k + 1] = lp[2 * r + 1];
      });
      result = { ok: true, lots: rows.map((r) => data.parcels.id[r]), points };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof BrushDataMissing) result = { ok: false, reason: 'data-missing', message };
      else {
        o.warn(`resolveBrush: ${message}`);
        result = { ok: false, reason: 'bad-request', message };
      }
    }
    // `points` is a fresh Float64Array, so its buffer is an ArrayBuffer
    const transfer = result.ok ? [result.points.buffer as ArrayBuffer] : [];
    o.post({ type: 'brushLots', reqId: w.reqId, result }, transfer);
  }

  return {
    request(reqId, query) {
      const isCatalog = query === null;
      if (stop()) return noSession(reqId, isCatalog);
      if (!isCatalog) {
        const bad = brushQueryProblem(query);
        if (bad !== null) {
          const result = { ok: false as const, reason: 'bad-request' as const, message: bad };
          return o.post({ type: 'brushLots', reqId, result }, []);
        }
      }
      const w: BrushWaiter = { reqId, query: isCatalog ? null : (query as BrushQuery) };
      waiting.add(w);
      const need = filesFor(w.query);
      if (need.length === 0) return answer(w, {});
      void Promise.all(need.map((f) => brushFile(f))).then((got) => {
        const out: Partial<BrushFiles> = {};
        need.forEach((f, k) => {
          if (got[k] !== null) (out as Record<string, unknown>)[f] = got[k];
        });
        answer(w, out);
      });
    },
    end() {
      if (ended) return;
      ended = true;
      const all = [...waiting];
      waiting.clear();
      for (const w of all) noSession(w.reqId, w.query === null);
    }
  };
}

// --- outlines, preview, lotAt ---

/**
 * The ring outlines of the requested lots whose records are loaded; a lot not loaded counts as
 * `missing`. `transfer` is the outlines' three buffers.
 */
export function lotOutlinesResult(
  records: Map<ParcelId, ParcelRecord>,
  lots: readonly ParcelId[]
): { result: LotOutlinesResult; transfer: ArrayBuffer[] } {
  const found: ParcelRecord[] = [];
  let missing = 0;
  for (const id of lots) {
    const rec = records.get(id);
    if (rec) found.push(rec);
    else missing++;
  }
  const { outlines, transfer } = packOutlines(found);
  return { result: { ok: true, ...outlines, missing }, transfer };
}

/**
 * The buildings the first `maxLots` requested lots could hold at `stories`, packed as one cell
 * (`'preview'`). Per lot, in order: a repeat is skipped; a lot absent from `parcels` or with
 * `protectedRow(row)` builds nothing; one whose record is not loaded is `missing`. The generator
 * memo (`simKey`) is the one the timeline's massings share.
 */
export function previewResult(o: {
  parcels: ScenarioParcels;
  protectedRow(row: number): boolean;
  records: Map<ParcelId, ParcelRecord>;
  memo: Lru<string, GeneratedBuilding | null>;
  gen: typeof generate;
  lots: readonly ParcelId[];
  stories: number;
  maxLots: number;
}): { result: PreviewResult; transfer: ArrayBuffer[] } {
  const plan = o.parcels;
  const items: { building: GeneratedBuilding; existingUnits: number }[] = [];
  const seen = new Set<ParcelId>();
  let missing = 0;
  for (const id of o.lots.slice(0, o.maxLots)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const i = plan.index.get(id);
    if (i === undefined) continue; // not in the scenario: nothing can be built there
    if (o.protectedRow(i)) continue;
    const rec = o.records.get(id);
    if (!rec) {
      missing++;
      continue;
    }
    if (o.stories <= 0) continue;
    const key = simKey(id, o.stories);
    let b = o.memo.get(key);
    if (b === undefined) {
      b = o.gen(scenarioRecordOf(plan, i, rec), { maxStories: o.stories }, fnv1a32(id), 'max');
      o.memo.set(key, b);
    }
    if (b) items.push({ building: b, existingUnits: plan.existingUnits[i] });
  }
  const pack = items.length > 0 ? packCell('preview', items) : null;
  return {
    result: { ok: true, pack, built: items.length, missing },
    transfer: pack ? packTransferables(pack) : []
  };
}

/**
 * The lot under `point` (lng, lat) among the loaded records of the cells within `LID_PAD_M` (a
 * lot may reach past its cell), and `owner` of it (null where no lot holds the point).
 */
export function lotAtResult(
  manifest: Manifest,
  byCell: Map<string, ParcelRecord[]>,
  point: [number, number],
  owner: (id: ParcelId) => LimitOwner | null
): LotAtResult {
  const dLng = LID_PAD_M / M_PER_DEG_LNG;
  const dLat = LID_PAD_M / M_PER_DEG_LAT;
  const box = [point[0] - dLng, point[1] - dLat, point[0] + dLng, point[1] + dLat];
  const near: ParcelRecord[] = [];
  for (const cellId of cellsIntersecting(manifest, box))
    for (const rec of byCell.get(cellId) ?? []) near.push(rec);
  const rec = lotAtPoint(near, point, (r) => r.polygon.map((ring) => toLngLat(ring, r.labelPoint)));
  return { ok: true, parcelId: rec ? rec.id : null, owner: rec ? owner(rec.id) : null };
}

// --- the card ---

/**
 * The stories `parcelId` can build under `allowed`: the generator's (`simKey` memo, the call the
 * preview and the timeline share) on the lot's scenario record from `parcels`, else
 * `lotBuildableStories(polygon, allowed, existingUnits)`. The lot must be in `parcels` and its
 * record loaded (the card checks both first).
 */
export function buildableStories(
  o: {
    parcels: ScenarioParcels;
    records: Map<ParcelId, ParcelRecord>;
    memo: Lru<string, GeneratedBuilding | null>;
    gen: typeof generate;
  },
  parcelId: ParcelId,
  allowed: number,
  existingUnits: number
): number | null {
  const i = o.parcels.index.get(parcelId);
  const rec = o.records.get(parcelId);
  if (i === undefined || rec === undefined)
    throw new RangeError(`buildableStories: ${parcelId} has no row or no loaded record`);
  const key = simKey(parcelId, allowed);
  let b = o.memo.get(key);
  if (b === undefined) {
    b = o.gen(
      scenarioRecordOf(o.parcels, i, rec),
      { maxStories: allowed },
      fnv1a32(parcelId),
      'max'
    );
    o.memo.set(key, b);
  }
  return b ? b.stories : lotBuildableStories(rec.polygon, allowed, existingUnits);
}

/** A card's massing for a project the map does not draw yet: a footprint entry, no building. */
const NOT_DRAWN: Massing = { footprint: [] };

/**
 * `cardAt`'s deps on the dataset. `building` masses a schedule only once it has a T11 parcel and
 * every T11 parcel's cell is loaded (else `NOT_DRAWN`), so a card never describes a partial-lot
 * building the map does not draw. `parcels()` is the frame in use's (`frame.view.parcels`), read
 * on each `buildable` call. `logOnce` gets keys prefixed `card:`.
 */
export function cardDepsOf(
  ds: Dataset,
  parcels: () => ScenarioParcels,
  logOnce: (k: string, m: string) => void
): CardDeps {
  return {
    qualityRules: new Map(ds.loaded.projects.qualityRules.map((q) => [q.id, q])),
    building: (sc, k) => (scheduleReady(ds, sc) ? massingFor(sc, k, ds.massing) : NOT_DRAWN),
    logOnce: (key, msg) => logOnce(`card:${key}`, msg),
    record: (id) => ds.chunks.records.get(id) ?? null,
    // Null where nothing can be built (today's `LotLimits.buildable`, scenario-host.ts:1405);
    // `cardAt` passes it through to `limits.buildable`.
    buildable: (id, allowed, existingUnits) =>
      buildableStories(
        { parcels: parcels(), records: ds.chunks.records, memo: ds.memo, gen: ds.massing.gen },
        id,
        allowed,
        existingUnits
      )
  };
}

/**
 * True when `s` has a T11 parcel and every T11 parcel's cell is loaded (`Geometry.allReady`,
 * scenario/geometry.ts:231-240): only then is it massed, as the map would draw it.
 */
export function scheduleReady(ds: Dataset, s: Schedule): boolean {
  const P = ds.massing.input.parcels;
  let any = false;
  for (const id of s.parcelIds) {
    const i = P.index.get(id);
    if (i === undefined) continue; // absent from T11: no cell to wait for
    if (!ds.chunks.byCell.has(P.cells[P.cell[i]].cellId)) return false;
    any = true;
  }
  return any;
}
