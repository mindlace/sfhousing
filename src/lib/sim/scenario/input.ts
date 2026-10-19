// Assembling the SimInput from the three decoded scenario files (spec §4.2 steps 5-6) and the
// per-input precompute (step 7): initiation hazards, log(1 − h) and renormalised size draws.
// Worker-safe and pure apart from the identity-keyed memo.
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, featureValue, type ScenarioParcels } from '$lib/data/scenario-codec';
import { exp, log as ln } from '$lib/timelapse/math';
import { initiationHazard } from '$lib/timelapse/model';
import type { ProjectsFile } from '$lib/timelapse/projects';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { Calibration, FeatureId } from '$lib/timelapse/types';
import { isoOf } from './dates';
import { simEntity } from './rng';
import type { SimInput } from './types';

type ScenarioFile = 'parcels.bin' | 'projects.json' | 'calibration.json';

/** A decoded file that cannot run: the host maps it to `scenario-invalid`. */
export class ScenarioInputError extends Error {
  name = 'ScenarioInputError';
  constructor(
    readonly file: ScenarioFile,
    message: string // the first problem
  ) {
    super(message);
  }
}

/** The first index where `levels` differs from T11 `FILL_LEVELS`, or -1 (ruling A2). */
function fillLevelsMismatch(levels: readonly number[]): number {
  const n = Math.max(levels.length, FILL_LEVELS.length);
  for (let k = 0; k < n; k++) if (levels[k] !== FILL_LEVELS[k]) return k;
  return -1;
}

function checkFillLevels(file: ScenarioFile, name: string, levels: readonly number[]): void {
  const k = fillLevelsMismatch(levels);
  if (k >= 0) {
    throw new ScenarioInputError(
      file,
      `${name} [${levels.join(', ')}] differs from FILL_LEVELS ` +
        `[${FILL_LEVELS.join(', ')}] at index ${k}`
    );
  }
}

/**
 * The FZP SimInput (spec §4.2 step 6). Throws `ScenarioInputError` when the calibration's (or
 * T11's) fill levels differ from `FILL_LEVELS`. The run's `asOf` is `projects.asOf`; a different
 * `calibration.asOf` is logged once.
 */
export function buildSimInput(
  files: { parcels: ScenarioParcels; projects: ProjectsFile; calibration: Calibration },
  warn?: (msg: string) => void
): SimInput {
  const { parcels, projects, calibration } = files;
  checkFillLevels('calibration.json', 'size.fillLevels', calibration.size.fillLevels);
  checkFillLevels('parcels.bin', 'fillLevels', parcels.fillLevels);
  if (calibration.asOf !== projects.asOf) {
    warn?.(
      `calibration.json: asOf ${isoOf(calibration.asOf)} differs from projects.json asOf ` +
        `${isoOf(projects.asOf)}; the run uses ${isoOf(projects.asOf)}`
    );
  }
  return { parcels, projects: projects.projects, calibration, asOf: projects.asOf };
}

export interface Precompute {
  /** monthly initiation hazard per parcel; 0 = never initiates */
  hazard: Float64Array;
  /** log(1 − hazard[i]) from math.ts */
  log1mh: Float64Array;
  /**
   * count × F: per parcel, cumulative renormalised size probabilities over the levels with
   * yield[f] > existingUnits (a level that does not qualify adds nothing); the last qualifying
   * level and every level after it are exactly 1. A row is all 0 when no level qualifies.
   */
  sizeCum: Float32Array;
  parcelIndexOf(id: ParcelId): number; // -1 if absent
  /** the rows that can initiate (hostable, hazard > 0, log1mh < 0), ascending */
  candidates: Int32Array;
  /** `simEntity` of each candidate's parcel id, index-aligned with `candidates` */
  entity: Uint32Array;
  /**
   * Per candidate, a bound on the first initiation draw `u = draw(INIT, k = 0)` for a parcel at
   * risk from `asOf`: when u exceeds it, that initiation is certainly after `horizon`
   * (`initiationDay` would return null). Infinity where no safe bound exists. A cost shortcut
   * only: every u at or below the bound goes through the exact computation.
   */
  skipAbove(horizon: Day): Float64Array;
}

const memo = new WeakMap<SimInput, Precompute>();

/** `simEntity` per row, shared by every input over the same id column (the twin's view too). */
const entities = new WeakMap<readonly ParcelId[], { hash: Uint32Array; done: Uint8Array }>();

function entityOf(ids: readonly ParcelId[], i: number): number {
  let e = entities.get(ids);
  if (!e) {
    e = { hash: new Uint32Array(ids.length), done: new Uint8Array(ids.length) };
    entities.set(ids, e);
  }
  if (e.done[i] === 0) {
    e.hash[i] = simEntity(ids[i]);
    e.done[i] = 1;
  }
  return e.hash[i];
}

/**
 * The last geometric month T whose earliest initiation day from `asOf` (v → 0 in §4.4.4 step 2,
 * `asOf + 1 + floor((T − 1) × MONTH_DAYS)`, as the engine evaluates it) is on or before the
 * horizon; 0 when even T = 1 is after it.
 */
export function lastInitiationMonth(asOf: Day, horizon: Day): number {
  const earliest = (T: number) => asOf + 1 + Math.floor((T - 1) * MONTH_DAYS);
  if (earliest(1) > horizon) return 0;
  let T = Math.max(1, Math.floor((horizon - asOf - 1) / MONTH_DAYS));
  while (T > 1 && earliest(T) > horizon) T--;
  while (earliest(T + 1) <= horizon) T++;
  return T;
}

/**
 * The `skipAbove` bounds (see `Precompute`). With T = max(1, ceil(log(1 − u) / log1mh)), the
 * initiation is after the horizon exactly when T > Tmax (`lastInitiationMonth`), that is when
 * u > u* = 1 − (1 − h)^Tmax = 1 − exp(Tmax · log1mh). The bound is u* widened by a relative
 * 1e-6, which is about 10⁴ times every rounding error of the exact path's `1 − u`, `log` and
 * division for any u* above 1e-6; below that no bound is used.
 */
function skipBounds(log1mh: Float64Array, candidates: Int32Array, Tmax: number): Float64Array {
  const out = new Float64Array(candidates.length).fill(Infinity);
  if (Tmax < 1) return out;
  for (let c = 0; c < candidates.length; c++) {
    const uStar = 1 - exp(Tmax * log1mh[candidates[c]]);
    if (uStar > 1e-6) out[c] = uStar * (1 + 1e-6) + 1e-12;
  }
  return out;
}

/** The size bucket: the first `byEnvelope` entry with stories ≤ `maxStoriesUpTo`, else last. */
function bucketOf(cal: Calibration, stories: number): number[] {
  const rows = cal.size.byEnvelope;
  for (const r of rows) if (stories <= r.maxStoriesUpTo) return r.probs;
  return rows[rows.length - 1].probs;
}

/**
 * Fills row i of a `sizeCum`-shaped array `out` (at offset `at`) against `existing` units; false
 * when no level gains a home (the row stays 0).
 */
function fillSizeRow(
  p: ScenarioParcels,
  i: number,
  probs: number[],
  existing: number,
  out: Float32Array,
  at: number
): boolean {
  const F = FILL_LEVELS.length;
  let total = 0;
  let last = -1;
  for (let f = 0; f < F; f++) {
    if (p.yield[i * F + f] > existing && probs[f] > 0) {
      total += probs[f];
      last = f;
    }
  }
  if (last < 0) return false;
  let acc = 0;
  for (let f = 0; f < F; f++) {
    if (f >= last) out[at + f] = 1;
    else {
      if (p.yield[i * F + f] > existing) acc += probs[f];
      out[at + f] = acc / total;
    }
  }
  return true;
}

/**
 * Parcel i's cumulative size row (as in `Precompute.sizeCum`) against `existing` units instead of
 * T11 `existingUnits[i]`: the size draw of a later project on a parcel already demolished in the
 * run (§4.4.6), which uses 0. All 0 when no level qualifies.
 */
export function sizeCumAgainst(input: SimInput, i: number, existing: number): Float32Array {
  const p = input.parcels;
  const out = new Float32Array(FILL_LEVELS.length);
  fillSizeRow(p, i, bucketOf(input.calibration, p.envelopeStories[i]), existing, out, 0);
  return out;
}

/**
 * The per-input precompute (spec §4.2 step 7, §4.4.4), memoised by `SimInput` identity. Only
 * hostable parcels with a gaining size level get a hazard; a hostable parcel with a non-finite
 * term feature gets 0 (`initiationHazard` would silently use bin 0), reported in one warning.
 * Features read the `fzp` variant: a `baseZoning` view supplies its base columns there.
 */
export function precomputeOf(input: SimInput, warn?: (msg: string) => void): Precompute {
  const hit = memo.get(input);
  if (hit) return hit;
  const p = input.parcels;
  const model = input.calibration.initiation;
  const n = p.count;
  const F = FILL_LEVELS.length;
  const hazard = new Float64Array(n);
  const log1mh = new Float64Array(n);
  const sizeCum = new Float32Array(n * F);
  const features = {} as Record<FeatureId, number>;
  let bad = 0;
  let firstBad = '';
  for (let i = 0; i < n; i++) {
    const probs = bucketOf(input.calibration, p.envelopeStories[i]);
    const sized = fillSizeRow(p, i, probs, p.existingUnits[i], sizeCum, i * F);
    if (p.hostable[i] === 1) {
      let finite = true;
      for (const t of model.terms) {
        const v = featureValue(p, i, t.feature, 'fzp');
        if (!Number.isFinite(v)) {
          if (bad === 0) firstBad = `${p.id[i]} ${t.feature}`;
          bad++;
          finite = false;
          break;
        }
        features[t.feature] = v;
      }
      if (finite && sized) hazard[i] = initiationHazard(model, features);
    }
    log1mh[i] = ln(1 - hazard[i]);
  }
  if (bad > 0) {
    warn?.(
      `parcels.bin: hazard 0 for ${bad} parcel(s) with a non-finite feature; first: ${firstBad}`
    );
  }
  let m = 0;
  for (let i = 0; i < n; i++) if (p.hostable[i] === 1 && hazard[i] > 0 && log1mh[i] < 0) m++;
  const candidates = new Int32Array(m);
  const entity = new Uint32Array(m);
  for (let i = 0, c = 0; i < n; i++) {
    if (!(p.hostable[i] === 1 && hazard[i] > 0 && log1mh[i] < 0)) continue;
    candidates[c] = i;
    entity[c++] = entityOf(p.id, i);
  }
  const bounds = new Map<Day, Float64Array>();
  const pre: Precompute = {
    hazard,
    log1mh,
    sizeCum,
    parcelIndexOf: (id) => p.index.get(id) ?? -1,
    candidates,
    entity,
    skipAbove(horizon) {
      let b = bounds.get(horizon);
      if (!b) {
        b = skipBounds(log1mh, candidates, lastInitiationMonth(input.asOf, horizon));
        bounds.set(horizon, b);
      }
      return b;
    }
  };
  memo.set(input, pre);
  return pre;
}
