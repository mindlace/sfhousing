// Assembling the SimInput from the three decoded scenario files (spec §4.2 steps 5-6) and the
// per-input precompute (step 7): initiation hazards, log(1 − h) and renormalised size draws.
// Worker-safe and pure apart from the identity-keyed memo.
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, featureValue, type ScenarioParcels } from '$lib/data/scenario-codec';
import { log as ln } from '$lib/timelapse/math';
import { initiationHazard } from '$lib/timelapse/model';
import type { ProjectsFile } from '$lib/timelapse/projects';
import type { Calibration, FeatureId } from '$lib/timelapse/types';
import { isoOf } from './dates';
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
}

const memo = new WeakMap<SimInput, Precompute>();

/** The size bucket: the first `byEnvelope` entry with stories ≤ `maxStoriesUpTo`, else last. */
function bucketOf(cal: Calibration, stories: number): number[] {
  const rows = cal.size.byEnvelope;
  for (const r of rows) if (stories <= r.maxStoriesUpTo) return r.probs;
  return rows[rows.length - 1].probs;
}

/** Fills row i of `sizeCum`; false when no level gains a home (the row stays 0). */
function fillSizeRow(p: ScenarioParcels, i: number, probs: number[], out: Float32Array): boolean {
  const F = FILL_LEVELS.length;
  const existing = p.existingUnits[i];
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
    if (f >= last) out[i * F + f] = 1;
    else {
      if (p.yield[i * F + f] > existing) acc += probs[f];
      out[i * F + f] = acc / total;
    }
  }
  return true;
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
    const sized = fillSizeRow(p, i, bucketOf(input.calibration, p.envelopeStories[i]), sizeCum);
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
  const pre: Precompute = {
    hazard,
    log1mh,
    sizeCum,
    parcelIndexOf: (id) => p.index.get(id) ?? -1
  };
  memo.set(input, pre);
  return pre;
}
