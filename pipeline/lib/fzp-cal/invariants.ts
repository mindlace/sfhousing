// Stage-calibration invariants V25-V27 (spec §4.10), as pure functions over the parsed
// calibration.json: each returns the problems found, [] when the invariant holds. V28 and V29 are
// measured by the calibration step (it needs the in-memory computation) and passed through.
import { mulberry32 } from '../../../src/lib/generator/seed';
import {
  CalibrationFormatError,
  cumulativeIncidence,
  cumulativeTotal,
  eventualProbabilities,
  parseCalibration,
  sampleTransition,
  tailRate
} from '../../../src/lib/timelapse/model';
import { monthsIn, type Day } from '../../../src/lib/timelapse/time';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  pathwayStages,
  type Calibration,
  type Pathway,
  type Stage,
  type Transition
} from '../../../src/lib/timelapse/types';

/** The size cap for calibration.json (spec §4.10 V25), 256 KB. */
export const CALIBRATION_MAX_BYTES = 262144;

/** A cell is rejected unless C(K) <= 1 - this (spec §4.4 "Rejection"). */
const CELL_HEADROOM = 1e-6;

/** The `parseCalibration` outcome for JSON text: the calibration or the reason it is not one. */
export function parseCalibrationText(json: string): { cal: Calibration } | { error: string } {
  try {
    return { cal: parseCalibration(JSON.parse(json)) };
  } catch (e) {
    if (e instanceof CalibrationFormatError || e instanceof SyntaxError) {
      return { error: e.message };
    }
    throw e;
  }
}

/**
 * V25: `json` (the file's text, `fileBytes` its size) parses, `size.fillLevels` equals
 * `fillLevels` element for element (ruling A2: `parseCalibration` checks F only internally),
 * `asOf` equals the T3 (`projectsAsOf`) and T4d (`historiesAsOf`) snapshot days when given, and
 * the file is at most 256 KB.
 */
export function checkV25(
  json: string,
  fileBytes: number,
  fillLevels: readonly number[],
  projectsAsOf: Day | undefined,
  historiesAsOf?: Day
): string[] {
  const problems: string[] = [];
  if (fileBytes > CALIBRATION_MAX_BYTES) {
    problems.push(`calibration.json is ${fileBytes} bytes, over ${CALIBRATION_MAX_BYTES}`);
  }
  const parsed = parseCalibrationText(json);
  if ('error' in parsed) return [`does not parse: ${parsed.error}`, ...problems];
  const { cal } = parsed;
  const got = cal.size.fillLevels;
  if (got.length !== fillLevels.length || got.some((x, i) => x !== fillLevels[i])) {
    problems.push(
      `size.fillLevels [${got.join(', ')}] differ from FILL_LEVELS [${fillLevels.join(', ')}]`
    );
  }
  if (projectsAsOf !== undefined && cal.asOf !== projectsAsOf) {
    problems.push(`asOf ${cal.asOf} differs from projects.json asOf ${projectsAsOf}`);
  }
  if (historiesAsOf !== undefined && cal.asOf !== historiesAsOf) {
    problems.push(`asOf ${cal.asOf} differs from project histories asOf ${historiesAsOf}`);
  }
  return problems;
}

/** Why a cell fails the §4.4 rejection checks (C(K) <= 1 - 1e-6 and rho > 0), or null. */
function rejection(t: Transition): string | null {
  if (!Number.isInteger(t.months) || t.months < 1) return `months ${t.months} < 1`;
  const ck = cumulativeTotal(t, t.months);
  if (!(ck <= 1 - CELL_HEADROOM)) return `C(K) = ${ck} > 1 - 1e-6`;
  const rho = tailRate(t);
  if (!(rho > 0)) return `tail rho = ${rho} is not positive`;
  return null;
}

/**
 * V26: every pathway x stage pair a project can occupy (`pathwayStages`, less `complete`) has a
 * cell; every in-flight project's (pathway, stage) has a cell (a `complete` project occupies no
 * stage); every cell passes the §4.4 rejection checks.
 */
export function checkV26(
  cal: Calibration,
  inFlight: { pathway: Pathway; stage: Stage }[]
): string[] {
  const problems: string[] = [];
  for (const p of PATHWAYS) {
    for (const s of pathwayStages(p)) {
      if (s === 'complete') continue;
      const t = cal.transitions?.[p]?.[s];
      if (!t) {
        problems.push(`${p}.${s}: no cell`);
        continue;
      }
      let why: string | null;
      try {
        why = rejection(t);
      } catch (e) {
        why = e instanceof Error ? e.message : String(e);
      }
      if (why) problems.push(`${p}.${s}: rejected, ${why}`);
    }
  }
  const missing = new Set<string>();
  for (const f of inFlight) {
    if (f.stage === 'complete') continue;
    if (!cal.transitions?.[f.pathway]?.[f.stage as Exclude<Stage, 'complete'>]) {
      missing.add(`${f.pathway}.${f.stage}`);
    }
  }
  for (const k of [...missing].sort()) problems.push(`in-flight ${k}: no cell`);
  return problems;
}

/** The `monthsIn(0, days) + 1` event month of a draw. */
const eventMonth = (days: number): number => monthsIn(0, days) + 1;

/** The seed of the V27 stream; re-seeded for every cell. */
export const V27_SEED = 0x5eed;

/**
 * V27: for every Transition, `n` draws of `sampleTransition` (m = 0) from `mulberry32(0x5eed)`,
 * re-seeded per cell in `PATHWAYS` x `STAGE_ORDER` order. The empirical cumulative incidence by
 * `monthsIn(0, days) + 1`, for advance and every exit reason, is within `tol` of
 * `cumulativeIncidence(t, k)` at k = 1..months, and the empirical eventual shares are within
 * `tol` of `eventualProbabilities(t, 0)`. One problem per failing cell, naming its worst gap.
 */
export function checkV27(cal: Calibration, n: number, tol: number): string[] {
  const problems: string[] = [];
  for (const p of PATHWAYS) {
    for (const s of STAGE_ORDER) {
      if (s === 'complete') continue;
      const t = cal.transitions?.[p]?.[s];
      if (!t) continue; // a missing cell is V26's
      try {
        const worst = cellDeviation(t, n);
        if (!(worst.dev <= tol)) {
          problems.push(`${p}.${s}: ${worst.where} off by ${worst.dev.toFixed(4)} > ${tol}`);
        }
      } catch (e) {
        problems.push(`${p}.${s}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return problems;
}

/** The largest gap between a cell's sampled and tabulated incidence, and where it is. */
function cellDeviation(t: Transition, n: number): { dev: number; where: string } {
  const rng = mulberry32(V27_SEED);
  const kinds = ['advance', ...EXIT_ORDER] as const;
  // hits[kind][k] = draws of that kind in event month k; `beyond[kind]` past the table.
  const hits: Record<string, number[]> = {};
  const beyond: Record<string, number> = {};
  for (const kind of kinds) {
    hits[kind] = new Array<number>(t.months + 1).fill(0);
    beyond[kind] = 0;
  }
  for (let i = 0; i < n; i++) {
    const d = sampleTransition(t, rng(), 0);
    const k = eventMonth(d.days);
    if (k <= t.months) hits[d.kind][k]++;
    else beyond[d.kind]++;
  }
  let dev = 0;
  let where = '';
  const note = (d: number, at: string) => {
    if (d > dev || (Number.isNaN(d) && !Number.isNaN(dev))) {
      dev = d;
      where = at;
    }
  };
  const running: Record<string, number> = {};
  for (const kind of kinds) running[kind] = 0;
  for (let k = 1; k <= t.months; k++) {
    const want = cumulativeIncidence(t, k);
    for (const kind of kinds) {
      running[kind] += hits[kind][k];
      const table = kind === 'advance' ? want.advance : (want.exit[kind] ?? 0);
      note(Math.abs(running[kind] / n - table), `${kind} cumulative incidence at month ${k}`);
    }
  }
  const eventual = eventualProbabilities(t, 0);
  for (const kind of kinds) {
    const share = (running[kind] + beyond[kind]) / n;
    const table = kind === 'advance' ? eventual.advance : (eventual.exit[kind] ?? 0);
    note(Math.abs(share - table), `${kind} eventual share`);
  }
  return { dev, where };
}
