// Per-revision massing for the timelapse (spec §4.8): the one rendering seam (§5). Simulated
// buildings come from the editor generator on the T11 scenario record, pipeline and phase
// buildings from `generateForUnits` with district options (large-site massing §4.3, §4.5); a
// null or throwing generator gives a footprint entry, so every revision has a renderable and
// pickable entry. A master without phases is massed like any pipeline project (§4.7).
//
// Worker-safe and under the determinism lint rule: the ring conversion calls `localFrame`, which
// lives in generator/geo.ts (the one place transcendental Math is allowed, display-only), so no
// transcendental Math appears here.
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { scenarioRecordOf, type ScenarioParcels } from '$lib/data/scenario-codec';
import { MAX_STORIES } from '$lib/generator/constants';
import { localFrame } from '$lib/generator/geo';
import {
  fnv1a32,
  generate,
  generateForUnits,
  type DistrictOpts,
  type GeneratedBuilding
} from '$lib/generator';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Lru } from '../lru';
import type { Massing, Schedule, SimInput } from './types';

/** What `massingFor` needs. The memo is shared across seeds and inits within one datasetVersion. */
export interface MassingCtx {
  input: SimInput;
  /** The loaded chunk record of a parcel, if its cell is loaded. */
  records: (id: ParcelId) => ParcelRecord | undefined;
  /** Generator results by content key, null included. Cleared on a datasetVersion change. */
  memo: Lru<string, GeneratedBuilding | null>;
  gen: typeof generate;
  genForUnits: typeof generateForUnits;
  /** Logs a message once per project, however often it is called (the ctx's responsibility). */
  logOnce(projectId: string, msg: string): void;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The cell anchor (§4.2): the smallest `ParcelId` present in T11, or null if none is. */
export function cellAnchorParcel(ids: ParcelId[], parcels: ScenarioParcels): ParcelId | null {
  let best: ParcelId | null = null;
  for (const id of ids) if (parcels.index.has(id) && (best === null || id < best)) best = id;
  return best;
}

/** The footprint and massing-anchor parcel (§4.2): the largest `areaM2`, ties to the smallest id. */
export function footprintParcel(recs: ParcelRecord[]): ParcelRecord {
  if (recs.length === 0) throw new RangeError('footprintParcel: no parcel records');
  let best = recs[0];
  for (const r of recs)
    if (r.areaM2 > best.areaM2 || (r.areaM2 === best.areaM2 && r.id < best.id)) best = r;
  return best;
}

/**
 * The parcel's outer ring, `polygon[0]` in local metres, as lng/lat. Passed as stored: packing's
 * `normaliseRing` closes it exactly once, so it is never closed or reopened here.
 */
export function footprintOf(rec: ParcelRecord): { footprint: [number, number][] } {
  const frame = localFrame(rec.labelPoint);
  return { footprint: rec.polygon[0].map(([x, y]) => frame.to(x, y)) };
}

export const simKey = (parcelId: ParcelId, stories: number) => `s|${parcelId}|${stories}`;

export const pipeKey = (
  seed: number,
  units: number,
  stories: number | null,
  ids: ParcelId[],
  opts: DistrictOpts
) =>
  `p|${seed}|${units}|${stories ?? '-'}|${[...new Set(ids)].sort(cmp).join(',')}` +
  `|${opts.storyLimit ?? '-'}|${opts.curatedStories ?? '-'}|${opts.openSpaceShare ?? '-'}`;

/** The T3 rows by id, built once per `SimInput`. */
const rowsByInput = new WeakMap<SimInput, Map<string, InFlightProject>>();
function rowsOf(input: SimInput): Map<string, InFlightProject> {
  let rows = rowsByInput.get(input);
  if (rows === undefined) {
    rows = new Map(input.projects.map((p) => [p.id, p]));
    rowsByInput.set(input, rows);
  }
  return rows;
}

/**
 * The district options of a pipeline schedule (large-site massing §4.3 "Story limit L", §4.5):
 * `storyLimit` is the largest T11 envelope among its parcels, else the phase's curated
 * `maxStories`, else the master's, else `districtMaxStories`; `curatedStories` is the phase's, else the master's;
 * `openSpaceShare` is the master's. Only defined fields are set. Simulated schedules get none.
 * The generator ignores all of it on a site that is not a district.
 */
export function districtOptsFor(schedule: Schedule, ctx: Pick<MassingCtx, 'input'>): DistrictOpts {
  if (schedule.origin === 'simulated') return {};
  const { input } = ctx;
  const row = rowsOf(input).get(schedule.phase?.masterId ?? schedule.projectId);
  const da = row?.daHeights ?? null;
  let zoned = 0;
  for (const id of schedule.parcelIds) {
    const i = input.parcels.index.get(id);
    if (i !== undefined && input.parcels.envelopeStories[i] > zoned)
      zoned = input.parcels.envelopeStories[i];
  }
  const ph = schedule.phase === null ? null : row?.phases?.[schedule.phase.index - 1];
  const storyLimit =
    zoned > 0 ? zoned : (ph?.maxStories ?? da?.maxStories ?? input.districtMaxStories ?? null);
  const phaseStories = ph?.stories ?? null;
  const curatedStories = phaseStories ?? da?.stories ?? null;
  const openSpaceShare = da?.openSpaceShare ?? null;
  const opts: DistrictOpts = {};
  if (storyLimit !== null) opts.storyLimit = storyLimit;
  if (curatedStories !== null) opts.curatedStories = curatedStories;
  if (openSpaceShare !== null) opts.openSpaceShare = openSpaceShare;
  return opts;
}

function memoised(
  ctx: MassingCtx,
  key: string,
  make: () => GeneratedBuilding | null
): GeneratedBuilding | null {
  const hit = ctx.memo.get(key);
  if (hit !== undefined) return hit;
  const b = make();
  ctx.memo.set(key, b);
  return b;
}

/** The records of a schedule's parcels that are loaded, sorted by id. */
function recordsOf(schedule: Schedule, ctx: MassingCtx): ParcelRecord[] {
  const out: ParcelRecord[] = [];
  for (const id of new Set(schedule.parcelIds)) {
    const r = ctx.records(id);
    if (r) out.push(r);
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

function building(
  schedule: Schedule,
  k: number,
  recs: ParcelRecord[],
  ctx: MassingCtx
): GeneratedBuilding | null {
  const { units, stories } = schedule.revisions[k];
  if (schedule.origin === 'simulated') {
    const rec = recs[0];
    const i = ctx.input.parcels.index.get(schedule.parcelIds[0]);
    if (!rec || i === undefined) throw new RangeError(`no scenario row for ${schedule.projectId}`);
    if (stories === null) throw new RangeError(`simulated revision ${k} has no stories`);
    return memoised(ctx, simKey(rec.id, stories), () =>
      ctx.gen(
        scenarioRecordOf(ctx.input.parcels, i, rec),
        { maxStories: stories },
        fnv1a32(rec.id),
        'max'
      )
    );
  }
  if (recs.length === 0) throw new RangeError(`no parcel records for ${schedule.projectId}`);
  const seed = fnv1a32(schedule.projectId);
  const opts = districtOptsFor(schedule, ctx);
  return memoised(
    ctx,
    pipeKey(
      seed,
      units,
      stories,
      recs.map((r) => r.id),
      opts
    ),
    () => ctx.genForUnits(recs, units, stories ?? MAX_STORIES, seed, stories ?? undefined, opts)
  );
}

/**
 * The massing of revision `k` (§4.8), the one rendering seam. A building is stamped with its
 * `source`; a null or throwing generator gives a footprint entry. A master without phases is
 * massed on its own parcels like any pipeline project (large-site massing §4.7).
 * A throw is logged once per project and is not memoised. Throws when the schedule has no loaded
 * parcel record at all (nothing to take a footprint from): callers pack only ready cells.
 */
export function massingFor(schedule: Schedule, k: number, ctx: MassingCtx): Massing {
  const recs = recordsOf(schedule, ctx);
  const fallback = (): Massing => {
    if (recs.length === 0)
      throw new RangeError(`massingFor ${schedule.projectId}: no loaded parcel records`);
    return footprintOf(footprintParcel(recs));
  };
  let b: GeneratedBuilding | null;
  try {
    b = building(schedule, k, recs, ctx);
  } catch (e) {
    ctx.logOnce(
      schedule.projectId,
      `massing failed for ${schedule.projectId}: ${e instanceof Error ? e.message : String(e)}`
    );
    return fallback();
  }
  if (b === null) return fallback();
  return { ...b, source: schedule.origin === 'simulated' ? 'scenario' : 'pipeline' };
}

/** `massingFor` for every revision, index-aligned with `schedule.revisions`. */
export function massingsFor(schedule: Schedule, ctx: MassingCtx): Massing[] {
  return schedule.revisions.map((_, k) => massingFor(schedule, k, ctx));
}
