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
 * V25's build-side funding checks (finance-data spec 4.10; finite-funding spec, V25's funding
 * rule), which `parseCalibration` cannot see: the programmes are exactly one `baseline-<pool id>`
 * per pool with at least one inflow, in pool order, each on that pool; at least one programme
 * exists; every grant share is above 0; the shares sum to at most 1,000,000 millionths, and to
 * exactly 1,000,000 when every pool has an inflow. A `live` build has `affordableRoutes` at tier 0
 * or the tier 4 fallback (method `Only …`), which the calibration step always warns about on a
 * live build. `detail` states the outcomes and names the pools with no programme; an absent key is
 * ok and says so.
 */
export function fundingOutcomes(
  cal: Calibration,
  live: boolean
): { problems: string[]; detail: string } {
  const problems: string[] = [];
  const detail: string[] = [];
  const bf = cal.baselineFunding;
  if (!bf) detail.push('no baselineFunding');
  else {
    const funded = bf.pools.filter((p) => p.inflows.length > 0);
    const unfunded = bf.pools.filter((p) => p.inflows.length === 0).map((p) => p.id);
    const want = funded.map((p) => `baseline-${p.id}`);
    const got = bf.programmes.map((p) => p.id);
    const pools = bf.programmes.map((p) => p.pool);
    if (
      got.length !== want.length ||
      got.some((id, i) => id !== want[i] || pools[i] !== funded[i].id)
    ) {
      problems.push(
        `baselineFunding programmes [${got.join(', ')}] are not one baseline-<pool id> per pool with an inflow, in pool order [${want.join(', ')}]`
      );
    }
    if (bf.programmes.length === 0) problems.push('baselineFunding has no programme');
    for (const p of bf.programmes) {
      if (p.instrument.kind === 'grant' && !(p.instrument.share > 0)) {
        problems.push(`baselineFunding programme ${p.id} has a share of 0`);
      }
    }
    const millionths = Math.round(
      bf.programmes.reduce(
        (a, p) => a + (p.instrument.kind === 'grant' ? p.instrument.share : 0),
        0
      ) * 1e6
    );
    if (millionths > 1e6) {
      problems.push(`baselineFunding shares sum to ${millionths} millionths, over 1000000`);
    } else if (unfunded.length === 0 && millionths !== 1e6) {
      problems.push(`baselineFunding shares sum to ${millionths} millionths, not 1000000`);
    }
    detail.push(
      `baselineFunding ${bf.pools.length} pools, ${bf.programmes.length} programmes; ` +
        `shares ${millionths} millionths` +
        (unfunded.length > 0 ? `; no programme for ${unfunded.join(', ')}` : '')
    );
  }
  const ar = cal.affordableRoutes;
  if (!ar) detail.push('no affordableRoutes');
  else {
    const t = ar.provenance.tier;
    const fallback = t === 4 && ar.provenance.method.startsWith('Only ');
    if (live && t !== 0 && !fallback) {
      problems.push(
        `affordableRoutes is tier ${t} on a live build and not the warned fallback (tier 0, or tier 4 with a method starting "Only ")`
      );
    }
    detail.push(
      live && fallback ? 'affordableRoutes fallback, warned' : `affordableRoutes tier ${t}`
    );
  }
  return { problems, detail: detail.join('; ') };
}

const finitePos = (x: number) => Number.isFinite(x) && x > 0;

/**
 * V25's checks of the developer's choice and the height-band stage time (building-choice plan,
 * Task 8), which `parseCalibration` does not read: both present, one step each from `asOf`;
 * the spread finite and above 0; a known affordable rule; positive anchors and cost ratio; a
 * carrying rate and drawn share in [0, 1]; band edges strictly ascending to 999 with one positive
 * multiplier and non-negative months per band; every provenance at tier 0 to 4, and a tier-4
 * label saying "invented".
 */
export function choiceOutcomes(cal: Pick<Calibration, 'asOf' | 'choice' | 'heightTime'>): string[] {
  const problems: string[] = [];
  const c = cal.choice;
  const ht = cal.heightTime;
  if (!c) problems.push('no choice');
  if (!ht) problems.push('no heightTime');
  if (!c || !ht) return problems;
  if (c.prices.length !== 1 || c.prices[0].from !== cal.asOf) {
    problems.push(`choice.prices is not one step from asOf ${cal.asOf}`);
  }
  if (ht.steps.length !== 1 || ht.steps[0].from !== cal.asOf) {
    problems.push(`heightTime.steps is not one step from asOf ${cal.asOf}`);
  }
  if (!finitePos(c.choiceSpread))
    problems.push(`choice.choiceSpread ${c.choiceSpread} is not above 0`);
  if (c.affordableRule !== 'market' && c.affordableRule !== 'most-homes') {
    problems.push(`choice.affordableRule ${String(c.affordableRule)} is unknown`);
  }
  for (const s of c.prices) {
    for (const [id, a] of Object.entries(s.value.anchors)) {
      if (![a.stories, a.homes, a.costPerHome, a.valuePerHome].every(finitePos)) {
        problems.push(`choice anchor ${id} has a value that is not above 0`);
      }
    }
    if (!finitePos(s.value.aboveTopCostRatio)) {
      problems.push(`choice.aboveTopCostRatio ${s.value.aboveTopCostRatio} is not above 0`);
    }
    const { rate, drawn } = s.value.carrying;
    if (!(rate >= 0 && rate <= 1 && drawn >= 0 && drawn <= 1)) {
      problems.push(`choice carrying rate ${rate} or drawn share ${drawn} is outside [0, 1]`);
    }
  }
  const up = ht.upTo;
  if (
    up.length === 0 ||
    up[up.length - 1] !== 999 ||
    up.some((x, i) => i > 0 && !(x > up[i - 1]))
  ) {
    problems.push(`heightTime.upTo [${up.join(', ')}] is not strictly ascending to 999`);
  }
  for (const s of ht.steps) {
    const v = s.value;
    for (const k of ['permitIssued', 'construction', 'constructionMonths'] as const) {
      if (v[k].length !== up.length) problems.push(`heightTime.${k} has ${v[k].length} bands`);
    }
    if (![...v.permitIssued, ...v.construction].every(finitePos)) {
      problems.push('heightTime has a multiplier that is not above 0');
    }
    if (!v.constructionMonths.every((m) => Number.isFinite(m) && m >= 0)) {
      problems.push('heightTime has negative or non-finite months');
    }
  }
  const provs = [
    ...Object.entries(c.provenance).map(([k, p]) => [`choice.provenance.${k}`, p] as const),
    ['heightTime.provenance', ht.provenance] as const
  ];
  for (const [path, p] of provs) {
    if (!(Number.isInteger(p.tier) && p.tier >= 0 && p.tier <= 4)) {
      problems.push(`${path} tier ${p.tier} is not 0 to 4`);
    } else if (p.tier === 4 && !/invented/i.test(p.label)) {
      problems.push(`${path} is tier 4 and its label does not say invented`);
    }
  }
  return problems;
}

/**
 * V25: `json` (the file's text, `fileBytes` its size) parses, `asOf` equals the T3 (`projectsAsOf`) and T4d (`historiesAsOf`) snapshot days when given, the
 * file is at most 256 KB, and `fundingOutcomes(cal, live)` and `choiceOutcomes(cal)` find no
 * problem.
 */
export function checkV25(
  json: string,
  fileBytes: number,
  projectsAsOf: Day | undefined,
  historiesAsOf?: Day,
  live = false
): string[] {
  const problems: string[] = [];
  if (fileBytes > CALIBRATION_MAX_BYTES) {
    problems.push(`calibration.json is ${fileBytes} bytes, over ${CALIBRATION_MAX_BYTES}`);
  }
  const parsed = parseCalibrationText(json);
  if ('error' in parsed) return [`does not parse: ${parsed.error}`, ...problems];
  const { cal } = parsed;
  if (projectsAsOf !== undefined && cal.asOf !== projectsAsOf) {
    problems.push(`asOf ${cal.asOf} differs from projects.json asOf ${projectsAsOf}`);
  }
  if (historiesAsOf !== undefined && cal.asOf !== historiesAsOf) {
    problems.push(`asOf ${cal.asOf} differs from project histories asOf ${historiesAsOf}`);
  }
  problems.push(...fundingOutcomes(cal, live).problems);
  problems.push(...choiceOutcomes(cal));
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
 * V27: for every Transition, `n` draws of `sampleTransition` (tau = 0, the engine's two-uniform
 * sampler: uKind, then uTime, from one stream) from `mulberry32(0x5eed)`, re-seeded per cell in `PATHWAYS` x `STAGE_ORDER` order. The empirical cumulative incidence by
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
    const d = sampleTransition(t, rng(), rng(), 0);
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
