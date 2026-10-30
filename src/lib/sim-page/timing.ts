/**
 * The /sim permitting timing model (sim-timers plan Task 3, Calls 1 to 12): presets, the
 * current timing set with its custom edits and route shares, stage bounds and floors, and the
 * compile to `SimLevers` fields. Pure TS: no Svelte, no DOM.
 *
 * A set compiles to `timers = [...presetTimers, ...edits]`. Shown months are
 * `typical0 × freshScale`, rounded to 0.5 month (Calls 1 and 2), where `typical0` is the base
 * calibration's `typicalMonths` and the fresh scale is `scaleTable(timers, 'new')`.
 */
import { cumulativeTotal, eventualProbabilities, typicalMonths } from '$lib/timelapse/model';
import { MONTH_DAYS } from '$lib/timelapse/time';
import {
  PATHWAYS,
  pathwayStages,
  type Calibration,
  type ExitReason,
  type Pathway,
  type Provenance,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import { scaleTable } from '$lib/sim/levers/timers';
import {
  MAX_SCALE,
  MIN_SCALE,
  type SimLevers,
  type TimedStage,
  type TimerEdit
} from '$lib/sim/levers/types';
import {
  BENCHMARK_PERMIT_DAYS,
  CEQA_FILED_RATIO,
  NO_DISCRETIONARY_BASIS,
  SB423_DEADLINE_DAYS,
  SB423_DEADLINE_QUANTILE,
  SB423_SMALL_SHARE,
  STAGE_FLOORS,
  type Evidence
} from './timing-sources';

type Tabled = Exclude<Stage, 'complete'>;

export type PresetId =
  'observed' | 'sb423Clock' | 'noDiscretionary' | 'ceqaInfill' | 'benchmarkPermits';

export interface Preset {
  id: PresetId;
  name: string;
  summary: string;
  /** Who the preset's changes reach; null when it changes nothing. */
  reach: 'new' | 'all' | null;
  available: boolean;
  unavailableReason: string | null;
  provenance: Provenance[];
}

const OBSERVED_PROVENANCE: Provenance = {
  tier: 0,
  label: 'SF as observed: the calibration fitted to SF Planning and DBI records',
  sources: [],
  method:
    "No change: each stage's table and the route shares are the calibration's own, fitted per " +
    'record; each carries its own provenance, shown with the stage.'
};

const BENCHMARK_RATIO_PROVENANCE: Provenance = {
  tier: 2,
  label: "Applying San Diego's permit pace to SF permit review",
  sources: BENCHMARK_PERMIT_DAYS.sanDiego.provenance.sources,
  method:
    `permitFiled is scaled on every pathway by San Diego / SF = ` +
    `${BENCHMARK_PERMIT_DAYS.sanDiego.value} / ${BENCHMARK_PERMIT_DAYS.sf.value} days (both ` +
    "tier 1, BLA Exhibit 1). Reading the ratio of two cities' medians as a time scale on our " +
    'stage is an inference (tier 2). A permit-office speedup reaches every project.'
};

const sourcedProvenance = (e: Evidence<unknown>): Provenance[] =>
  e.value === null ? [] : [e.provenance];

/** The presets in display order (Call 9). `available` follows Task 2's sourcing (Call 8). */
export const PRESETS: readonly Preset[] = [
  {
    id: 'observed',
    name: 'SF as observed',
    summary:
      'The timelines and route shares in the records. Family Zoning Plan Local Program lots ' +
      'use the streamlined route.',
    reach: null,
    available: true,
    unavailableReason: null,
    provenance: [OBSERVED_PROVENANCE]
  },
  {
    id: 'sb423Clock',
    name: 'SB 423 approval clock',
    // Route shares stay observed because SB423_ROUTE_SHIFT is unsourced (timing-sources.ts).
    summary:
      'Streamlined approvals meet the 90 or 180 day deadline for 90% of outcomes, for projects ' +
      'filing after the policy starts. The route shares stay as observed: no source says how ' +
      'many discretionary projects would switch.',
    reach: 'new',
    available: SB423_SMALL_SHARE.value !== null,
    unavailableReason: SB423_SMALL_SHARE.value === null ? SB423_SMALL_SHARE.reason : null,
    provenance: [
      SB423_DEADLINE_DAYS.provenance,
      ...sourcedProvenance(SB423_SMALL_SHARE),
      SB423_DEADLINE_QUANTILE.provenance
    ]
  },
  {
    id: 'noDiscretionary',
    name: 'No discretionary review',
    summary:
      'Projects that would go through discretionary review take the streamlined route instead, ' +
      'for projects filing after the policy starts. The permit-only share is kept.',
    reach: 'new',
    available: true,
    unavailableReason: null,
    provenance: [NO_DISCRETIONARY_BASIS.provenance]
  },
  {
    id: 'ceqaInfill',
    name: 'CEQA infill exemption (AB 130 / SB 131, 2025)',
    summary:
      'Discretionary review without CEQA for infill housing, for projects filing after the ' +
      'policy starts. Streamlined approvals are ministerial and untouched.',
    reach: 'new',
    available: CEQA_FILED_RATIO.value !== null,
    unavailableReason: CEQA_FILED_RATIO.value === null ? CEQA_FILED_RATIO.reason : null,
    provenance: sourcedProvenance(CEQA_FILED_RATIO)
  },
  {
    id: 'benchmarkPermits',
    name: "Permits at San Diego's pace",
    summary:
      "Permit review on every route at San Diego's median pace (134 days against SF's 280), " +
      'for every project, including those already in the pipeline.',
    reach: 'all',
    available: true,
    unavailableReason: null,
    provenance: [
      BENCHMARK_PERMIT_DAYS.sf.provenance,
      BENCHMARK_PERMIT_DAYS.sanDiego.provenance,
      BENCHMARK_RATIO_PROVENANCE
    ]
  }
];

const presetById = (id: PresetId): Preset => PRESETS.find((p) => p.id === id)!;

/** The stages the city controls (Call 5); `entitled` and `construction` are shown, locked. */
export const EDITABLE_STAGES: readonly TimedStage[] = [
  'preApplication',
  'filed',
  'permitFiled',
  'permitIssued'
];

const STAGE_LABELS: Record<Tabled, string> = {
  preApplication: 'Pre-application',
  filed: 'Filed to entitled',
  entitled: 'Entitled to permit filed',
  permitFiled: 'Permit review',
  permitIssued: 'Permit issued to construction start',
  construction: 'Construction'
};

const LOCK_REASONS: Partial<Record<Tabled, string>> = {
  entitled: "Set by the applicant's timing, not by the city",
  construction: 'Set mostly by the builder, financing and technology'
};

export interface TimingSet {
  preset: PresetId;
  /** The preset's resolved timers (Call 3). */
  presetTimers: TimerEdit[];
  /** Whole percents summing to 100, or null = observed. */
  presetRouteShares: Record<Pathway, number> | null;
  /** Custom edits: reach 'all', at most one per (pathway, stage), editable stages only. */
  edits: TimerEdit[];
  /** Custom whole percents summing to 100, or null = the preset's. */
  routeShares: Record<Pathway, number> | null;
  localProgramStreamlined: boolean;
}

export interface SimTiming {
  current: TimingSet;
  saved: { label: string; set: TimingSet } | null;
}

export const OBSERVED_TIMING: SimTiming = {
  current: {
    preset: 'observed',
    presetTimers: [],
    presetRouteShares: null,
    edits: [],
    routeShares: null,
    localProgramStreamlined: true
  },
  saved: null
};

// ---- small numerics ----

const EPS = 1e-9;
const roundHalf = (x: number) => Math.round(x * 2) / 2;
const ceilHalf = (x: number) => Math.ceil(x * 2 - EPS) / 2;
const floorHalf = (x: number) => Math.floor(x * 2 + EPS) / 2;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** The last month the model can report (`typicalMonths`' cap, `MAX_EVENT_MONTH`). */
const MAX_EVENT_MONTH = Math.floor(16777216 / MONTH_DAYS);

/** Least k >= 1 with C(k) >= q; `MAX_EVENT_MONTH` when the tail never gets there. */
export function exitMonth(t: Transition, q: number): number {
  for (let k = 1; k <= t.months; k++) if (cumulativeTotal(t, k) >= q) return k;
  if (cumulativeTotal(t, MAX_EVENT_MONTH) < q) return MAX_EVENT_MONTH;
  let lo = t.months; // C(lo) < q
  let hi = MAX_EVENT_MONTH; // C(hi) >= q
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (cumulativeTotal(t, mid) >= q) hi = mid;
    else lo = mid;
  }
  return hi;
}

const typicalCache = new WeakMap<Calibration, ReturnType<typeof typicalMonths>>();

/** `typicalMonths` of the base calibration, memoised per calibration object. */
function typical0(cal: Calibration): ReturnType<typeof typicalMonths> {
  let t = typicalCache.get(cal);
  if (t === undefined) {
    t = typicalMonths(cal);
    typicalCache.set(cal, t);
  }
  return t;
}

/** Shares as whole percents summing to 100, by largest remainder (ties in pathway order). */
function wholePercents(
  weights: Record<Pathway, number>,
  total: number,
  among: readonly Pathway[] = PATHWAYS
): Record<Pathway, number> {
  const out = { discretionary: 0, streamlined: 0, permitOnly: 0 };
  let sum = 0;
  for (const p of among) sum += weights[p];
  const raw = among.map((p) => ({
    p,
    x: sum > 0 ? (weights[p] / sum) * total : total / among.length
  }));
  let left = total;
  for (const r of raw) {
    out[r.p] = Math.floor(r.x + EPS);
    left -= out[r.p];
  }
  const order = [...raw].sort(
    (a, b) => b.x - Math.floor(b.x + EPS) - (a.x - Math.floor(a.x + EPS))
  );
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i].p]++;
  return out;
}

const sameShares = (a: Record<Pathway, number>, b: Record<Pathway, number>) =>
  PATHWAYS.every((p) => a[p] === b[p]);

// ---- floors ----

function floorOf(p: Pathway, st: TimedStage): Evidence<number> | null {
  return STAGE_FLOORS[p][st] ?? null;
}

/** The scale that puts the stage at its floor, rounded up to 0.5 month; null with no floor. */
function floorScale(cal: Calibration, p: Pathway, st: TimedStage): number | null {
  const f = floorOf(p, st)?.value ?? null;
  const t0 = typical0(cal)[p][st];
  if (f === null || t0 === undefined) return null;
  return ceilHalf(f) / t0;
}

/** A preset scale raised to the floor (Call 9); a preset never slows a stage past observed. */
function withFloor(cal: Calibration, p: Pathway, st: TimedStage, raw: number): number {
  const fs = floorScale(cal, p, st);
  const s = fs !== null && raw < fs ? Math.min(fs, Math.max(raw, 1)) : raw;
  return clampScale(s);
}

// ---- presets ----

function observedPercents(cal: Calibration): Record<Pathway, number> {
  return wholePercents(cal.pathwayForNew, 100);
}

/** The preset's own set, resolved against `cal` (Call 3). Throws for an unavailable preset. */
export function resolvePreset(id: PresetId, cal: Calibration): TimingSet {
  const preset = presetById(id);
  if (!preset.available) {
    throw new Error(`preset ${id} is not available: ${preset.unavailableReason}`);
  }
  const set: TimingSet = { ...structuredClone(OBSERVED_TIMING.current), preset: id };
  switch (id) {
    case 'observed':
    case 'ceqaInfill': // unreachable while CEQA_FILED_RATIO is unsourced
      break;
    case 'sb423Clock': {
      const t = cal.transitions.streamlined.filed;
      const share = SB423_SMALL_SHARE.value;
      if (t === undefined || share === null) break;
      const { small, large } = SB423_DEADLINE_DAYS.value;
      const deadline = (small * share + large * (1 - share)) / MONTH_DAYS;
      const q = exitMonth(t, SB423_DEADLINE_QUANTILE.value);
      const raw = Math.min(1, deadline / q);
      if (raw < 1) {
        const scale = withFloor(cal, 'streamlined', 'filed', raw);
        if (scale !== 1)
          set.presetTimers.push({ pathway: 'streamlined', stage: 'filed', scale, reach: 'new' });
      }
      break;
    }
    case 'noDiscretionary': {
      const o = observedPercents(cal);
      set.presetRouteShares = {
        discretionary: 0,
        streamlined: o.discretionary + o.streamlined,
        permitOnly: o.permitOnly
      };
      break;
    }
    case 'benchmarkPermits': {
      const ratio = BENCHMARK_PERMIT_DAYS.sanDiego.value / BENCHMARK_PERMIT_DAYS.sf.value;
      for (const p of PATHWAYS) {
        if (cal.transitions[p].permitFiled === undefined) continue;
        const scale = withFloor(cal, p, 'permitFiled', ratio);
        set.presetTimers.push({ pathway: p, stage: 'permitFiled', scale, reach: 'all' });
      }
      break;
    }
  }
  return set;
}

export function isCustom(s: TimingSet): boolean {
  return s.edits.length > 0 || s.routeShares !== null;
}

export function timingLabel(s: TimingSet): string {
  const name = presetById(s.preset).name;
  return isCustom(s) ? `Custom (from ${name})` : name;
}

/** The preset's own set without the custom layer: the resolved numbers the set carries. */
const presetSet = (s: TimingSet): TimingSet => ({
  ...structuredClone(s),
  edits: [],
  routeShares: null
});

/**
 * Where Revert goes (Call 12): the save if there is one, else the current preset's own set.
 * Null when the current set already equals it. The preset's set is the resolved numbers the
 * current set carries (Call 3), so a revert does not re-resolve against `cal`.
 */
export function revertTarget(
  t: SimTiming,
  _cal: Calibration
): { label: string; set: TimingSet } | null {
  const target = t.saved ?? {
    label: presetById(t.current.preset).name,
    set: presetSet(t.current)
  };
  return JSON.stringify(target.set) === JSON.stringify(t.current) ? null : target;
}

export function compileTiming(
  s: TimingSet
): Pick<SimLevers, 'timers' | 'routeShares' | 'localProgramStreamlined'> {
  const shares = s.routeShares ?? s.presetRouteShares;
  return {
    timers: [...s.presetTimers, ...s.edits].map((t) => ({ ...t })),
    routeShares: shares ? { ...shares } : null,
    localProgramStreamlined: s.localProgramStreamlined
  };
}

// ---- route shares ----

/** The shares the set gives new projects, as whole percents. */
export function shownRouteShares(s: TimingSet, cal: Calibration): Record<Pathway, number> {
  const r = s.routeShares ?? s.presetRouteShares;
  return r ? { ...r } : observedPercents(cal);
}

/**
 * Set one route's share (Call 10): the other two take the rest in proportion to their current
 * values, or evenly when both are 0, by largest remainder. Back at the preset's shares, the
 * custom shares are cleared.
 */
export function setRouteShare(s: TimingSet, cal: Calibration, p: Pathway, pct: number): TimingSet {
  const v = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  const cur = shownRouteShares(s, cal);
  const others = PATHWAYS.filter((x) => x !== p);
  const next = wholePercents(cur, 100 - v, others);
  next[p] = v;
  const presetShown = s.presetRouteShares ?? observedPercents(cal);
  return { ...s, routeShares: sameShares(next, presetShown) ? null : next };
}

// ---- stages ----

export interface StageBounds {
  min: number;
  max: number;
  minBy: 'floor' | 'scale';
  maxBy: 'scale';
}

export interface StageView {
  stage: Tabled;
  label: string;
  /** Typical months under the set, for new projects (`typical0 × fresh`, to 0.5 month). */
  months: number;
  observedMonths: number;
  editable: boolean;
  lockReason: string | null;
  advance: number;
  exits: Partial<Record<ExitReason, number>>;
  /** Null when locked. */
  floor: Evidence<number> | null;
  bounds: StageBounds | null;
  atBound: 'min' | 'max' | null;
  /** Effective scales (`scaleTable`) for new and in-flight projects. */
  fresh: number;
  inFlight: number;
  inFlightClamped: boolean;
  /** Who the non-identity scales on this stage reach. */
  reach: 'new' | 'all' | 'mixed' | null;
  presetLimitedByFloor: boolean;
}

/** Product of the timers' scales on one stage, unclamped. */
function product(timers: readonly TimerEdit[], p: Pathway, st: TimedStage, inFlight = false) {
  let x = 1;
  for (const t of timers)
    if (t.pathway === p && t.stage === st && (!inFlight || t.reach === 'all')) x *= t.scale;
  return x;
}

function typicalOf(cal: Calibration, p: Pathway, st: Tabled): number {
  const t0 = typical0(cal)[p][st];
  if (t0 === undefined) throw new RangeError(`${p} has no ${st} table`);
  return t0;
}

/**
 * The months a custom edit may set (Call 7): min = max(floor, MIN_SCALE × typical0,
 * typical0 × presetFresh × MIN_SCALE), max = min(MAX_SCALE × typical0,
 * typical0 × presetFresh × MAX_SCALE), each rounded inward to 0.5 month.
 */
export function stageBounds(
  cal: Calibration,
  s: TimingSet,
  p: Pathway,
  st: TimedStage
): StageBounds {
  const t0 = typicalOf(cal, p, st);
  const pf = product(s.presetTimers, p, st);
  const floor = floorOf(p, st)?.value ?? null;
  const byScale = Math.max(MIN_SCALE * t0, t0 * pf * MIN_SCALE);
  const max = floorHalf(Math.min(MAX_SCALE * t0, t0 * pf * MAX_SCALE));
  const floorWins = floor !== null && floor >= byScale;
  // Inside a preset that already uses most of the range, the scale bound wins over the floor.
  const min = Math.min(ceilHalf(floorWins ? floor : byScale), max);
  return { min, max, minBy: floorWins ? 'floor' : 'scale', maxBy: 'scale' };
}

/**
 * Set a stage's typical months for every project (Call 2): clamped to `stageBounds`, rounded
 * to 0.5 month, stored as a reach-'all' scale on top of the preset. Back at the preset's
 * months, the edit is removed.
 */
export function setStageMonths(
  cal: Calibration,
  s: TimingSet,
  p: Pathway,
  st: TimedStage,
  months: number
): { set: TimingSet; clamped: 'min' | 'max' | null } {
  if (!EDITABLE_STAGES.includes(st)) throw new RangeError(`${st} is not editable`);
  const b = stageBounds(cal, s, p, st);
  const want = Number.isFinite(months) ? months : b.max;
  const clamped = want < b.min ? 'min' : want > b.max ? 'max' : null;
  const m = Math.min(b.max, Math.max(b.min, roundHalf(want)));
  const base = typicalOf(cal, p, st) * product(s.presetTimers, p, st);
  const edits = s.edits.filter((e) => !(e.pathway === p && e.stage === st));
  if (Math.abs(m - roundHalf(base)) > EPS) {
    edits.push({ pathway: p, stage: st, scale: clampScale(m / base), reach: 'all' });
  }
  return { set: { ...s, edits }, clamped };
}

/** One view per stage the pathway has a table for, in pathway order. */
export function routeView(cal: Calibration, s: TimingSet, p: Pathway): StageView[] {
  const timers = compileTiming(s).timers;
  const fresh = scaleTable(timers, 'new')[p];
  const inFlight = scaleTable(timers, 'inFlight')[p];
  const out: StageView[] = [];
  for (const stage of pathwayStages(p)) {
    if (stage === 'complete') continue;
    const t = cal.transitions[p][stage];
    if (t === undefined) continue;
    const t0 = typicalOf(cal, p, stage);
    const timed = stage !== 'construction';
    const st = stage as TimedStage;
    const editable = timed && EDITABLE_STAGES.includes(st);
    const f = timed ? (fresh[st] ?? 1) : 1;
    const inf = timed ? (inFlight[st] ?? 1) : 1;
    const touching = timed ? timers.filter((x) => x.pathway === p && x.stage === st) : [];
    const moving = touching.filter((x) => x.scale !== 1);
    const reaches = new Set(moving.map((x) => x.reach));
    const months = roundHalf(t0 * f);
    const bounds = editable ? stageBounds(cal, s, p, st) : null;
    const fs = timed ? floorScale(cal, p, st) : null;
    const presetTouched = timed && s.presetTimers.some((x) => x.pathway === p && x.stage === st);
    const e = eventualProbabilities(t, 0);
    out.push({
      stage,
      label: STAGE_LABELS[stage],
      months,
      observedMonths: t0,
      editable,
      lockReason: editable ? null : (LOCK_REASONS[stage] ?? null),
      advance: e.advance,
      exits: { ...e.exit },
      floor: editable ? floorOf(p, st) : null,
      bounds,
      atBound:
        bounds === null
          ? null
          : months <= bounds.min + EPS
            ? 'min'
            : months >= bounds.max - EPS
              ? 'max'
              : null,
      fresh: f,
      inFlight: inf,
      inFlightClamped: timed && Math.abs(inf - product(timers, p, st, true)) > EPS,
      reach: reaches.size === 0 ? null : reaches.size === 2 ? 'mixed' : [...reaches][0],
      presetLimitedByFloor:
        presetTouched &&
        fs !== null &&
        Math.abs(product(s.presetTimers, p, st) - Math.min(fs, 1)) < EPS
    });
  }
  return out;
}
