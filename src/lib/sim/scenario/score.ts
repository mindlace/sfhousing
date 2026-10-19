// The time-aware score (T8, spec §4.3 and §4.5). Built from one run's Schedules and Masters as
// prefix sums of per-month deltas: every event adds its delta at `idx(day)` (an O(1) table), so
// the cost is O(events + months), never a per-month scan over the schedules. Pure and worker-safe.
import type { Target } from '$lib/scoreboard';
import { M1_TARGETS } from '$lib/scoreboard/targets';
import type { InFlightProject, ProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import { addMonths, dayOf, firstOfMonth } from './dates';
import type { Master } from './simulate';
import type { Schedule, TargetProgressAt, TimelineScore } from './types';

type Shown = TimelineScore['shown'];
type Live = Exclude<Stage, 'complete'>;

/** The stages a project can be in progress at (every stage but `complete`), in `STAGE_ORDER`. */
const LIVE = STAGE_ORDER.filter((s): s is Live => s !== 'complete');
const NL = LIVE.length;
const PLANNING: readonly Live[] = ['preApplication', 'filed', 'entitled'];

/**
 * `months[i]` is the 1st of the i-th month, from `asOf`'s month to the horizon's month (§4.3):
 * 291 entries for 2026-10-16 to 2050-12-31.
 */
export function monthsOf(asOf: Day, horizon: Day): Day[] {
  const last = firstOfMonth(horizon);
  const out: Day[] = [];
  for (let m = firstOfMonth(asOf); m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * `idx(d)`: the `i` with `months[i] ≤ d < T_i`, where `T_i = months[i + 1]` (`horizon + 1` for
 * the last entry), for `months[0] ≤ d ≤ horizon` (§4.3). One table lookup per call; a day outside
 * that range throws a `RangeError`.
 */
export function monthIndexer(months: Day[], horizon: Day): (d: Day) => number {
  const m0 = months[0];
  const table = new Uint16Array(horizon - m0 + 1);
  for (let i = 0; i < months.length; i++) {
    const to = i + 1 < months.length ? months[i + 1] : horizon + 1;
    table.fill(i, months[i] - m0, to - m0);
  }
  return (d) => {
    const k = d - m0;
    if (!(k >= 0 && k < table.length)) throw new RangeError(`idx: day ${d} outside the months`);
    return table[k];
  };
}

/** The series `simulateNet` (Task 8) reproduces exactly, and `planEffect` subtracts. */
export type NetSeries = {
  completedNet: Int32Array;
  completedNetNew: Int32Array;
  entitledNew: Int32Array;
};

/** Per-month deltas of one run's series; `stage[s * n + i]` is `inProgress[LIVE[s]]`. */
interface Acc {
  n: number;
  m0: Day;
  horizon: Day;
  idx: (d: Day) => number;
  pipeline: Int32Array;
  fresh: Int32Array;
  entitled: Int32Array;
  exited: Int32Array;
  stage: Int32Array;
}

/** The month a delta on `day` lands in: days before `months[0]` (history) count at 0. */
const monthOf = (acc: Acc, day: Day): number => (day < acc.m0 ? 0 : acc.idx(day));

/** In stage `s` on `[a, b)` with `units`: in `inProgress` at every `T_i` in that window. */
function addSpan(acc: Acc, s: number, a: Day, b: Day, units: number): void {
  if (!(a < b) || a > acc.horizon) return;
  acc.stage[s * acc.n + monthOf(acc, a)] += units;
  if (b <= acc.horizon) acc.stage[s * acc.n + monthOf(acc, b)] -= units;
}

/** Stage `s` on `[a, b)`, split by the revision current at each instant (`[0]` before its day). */
function addStage(acc: Acc, s: number, a: Day, b: Day, revs: Schedule['revisions']): void {
  for (let k = 0; k < revs.length; k++) {
    const from = k === 0 ? a : Math.max(a, revs[k].day);
    const to = k + 1 < revs.length ? Math.min(b, revs[k + 1].day) : b;
    addSpan(acc, s, from, to, revs[k].units);
  }
}

/** The units of the revision current on `day` (the last one with `revision.day ≤ day`). */
function unitsOn(revs: Schedule['revisions'], day: Day): number {
  let u = revs[0].units;
  for (let k = 1; k < revs.length && revs[k].day <= day; k++) u = revs[k].units;
  return u;
}

function addSchedule(acc: Acc, sc: Schedule, asOf: Day): void {
  const revs = sc.revisions;
  const e = sc.entered;
  const end = sc.end;
  // in progress: each entered stage until the next entered stage, or the exit / completion
  const stop = end.kind === 'open' ? Infinity : end.day;
  let prev = -1;
  let prevDay = 0;
  for (let s = 0; s < NL; s++) {
    const day = e[LIVE[s]];
    if (day === undefined) continue;
    if (prev >= 0) addStage(acc, prev, prevDay, day, revs);
    prev = s;
    prevDay = day;
  }
  if (prev >= 0) addStage(acc, prev, prevDay, stop, revs);
  // net completions: −existing at a construction start after asOf, +final units at completion
  const net = sc.origin === 'pipeline' ? acc.pipeline : acc.fresh;
  const c = e.construction;
  if (c !== undefined && c > asOf) net[acc.idx(c)] -= sc.existingUnits;
  if (end.kind === 'complete') net[acc.idx(end.day)] += revs[revs.length - 1].units;
  else if (end.kind === 'exit' && end.day > asOf)
    acc.exited[acc.idx(end.day)] += unitsOn(revs, end.day);
  // entitledNew: simulated only, net units of the revision current on the entitled day
  const ent = e.entitled;
  if (sc.origin === 'simulated' && ent !== undefined && ent > asOf) {
    acc.entitled[acc.idx(ent)] += unitsOn(revs, ent) - sc.existingUnits;
  }
}

/**
 * A master's bucket (§4.5): each phase's units sit at the master's current Planning stage (the
 * latest entered one), at `entitled` from E, until the phase files (`phaseFiled`) or the master
 * exits; unfiled phases stay to the horizon. A master exit sends Σ `phaseUnits` to `exitedUnits`.
 * Masters never complete or demolish anything.
 */
function addMaster(acc: Acc, m: Master, asOf: Day): void {
  const E = m.end.kind === 'entitled' ? m.end.day : Infinity;
  let total = 0;
  for (let j = 0; j < m.phaseUnits.length; j++) {
    const u = m.phaseUnits[j];
    total += u;
    const f = m.phaseFiled[j];
    const leave = m.end.kind === 'exit' ? m.end.day : f !== null ? f : Infinity;
    let prev = -1;
    let prevDay = 0;
    for (let s = 0; s < PLANNING.length; s++) {
      const st = PLANNING[s]; // the first stages of LIVE, so s is also the LIVE index
      let day = m.entered[st];
      if (st === 'entitled' && E !== Infinity) day = day === undefined ? E : Math.min(day, E);
      if (day === undefined || day >= leave) continue;
      if (prev >= 0) addSpan(acc, prev, prevDay, day, u);
      prev = s;
      prevDay = day;
    }
    if (prev >= 0) addSpan(acc, prev, prevDay, leave, u);
  }
  if (m.end.kind === 'exit' && m.end.day > asOf) acc.exited[acc.idx(m.end.day)] += total;
}

function inProgressOf(live: number[]): Shown[number]['inProgress'] {
  const r = {} as Shown[number]['inProgress'];
  for (let s = 0; s < NL; s++) r[LIVE[s]] = live[s];
  return r;
}

/**
 * The shown series of one run (§4.5): `[i]` is the state at the end of month `i` (events with
 * `day < T_i`). Completions split by origin (phases are pipeline); `entitledNew` is net and
 * simulated only; `inProgress[s]` holds the units of the revision current at `T_i`.
 */
export function shownSeries(
  run: { schedules: Schedule[]; masters: Master[] },
  asOf: Day,
  horizon: Day,
  months: Day[]
): Shown {
  const n = months.length;
  const acc: Acc = {
    n,
    m0: months[0],
    horizon,
    idx: monthIndexer(months, horizon),
    pipeline: new Int32Array(n),
    fresh: new Int32Array(n),
    entitled: new Int32Array(n),
    exited: new Int32Array(n),
    stage: new Int32Array(NL * n)
  };
  for (const s of run.schedules) addSchedule(acc, s, asOf);
  for (const m of run.masters) addMaster(acc, m, asOf);
  const out: Shown = [];
  let pipeline = 0;
  let fresh = 0;
  let entitled = 0;
  let exited = 0;
  const live = new Array<number>(NL).fill(0);
  for (let i = 0; i < n; i++) {
    pipeline += acc.pipeline[i];
    fresh += acc.fresh[i];
    entitled += acc.entitled[i];
    exited += acc.exited[i];
    for (let s = 0; s < NL; s++) live[s] += acc.stage[s * n + i];
    out.push({
      completedNet: pipeline + fresh,
      completedNetPipeline: pipeline,
      completedNetNew: fresh,
      entitledNew: entitled,
      inProgress: inProgressOf(live),
      exitedUnits: exited
    });
  }
  return out;
}

/** The three net series of `shown`, as typed arrays. */
export function netOf(shown: Shown): NetSeries {
  const n = shown.length;
  const out: NetSeries = {
    completedNet: new Int32Array(n),
    completedNetNew: new Int32Array(n),
    entitledNew: new Int32Array(n)
  };
  for (let i = 0; i < n; i++) {
    out.completedNet[i] = shown[i].completedNet;
    out.completedNetNew[i] = shown[i].completedNetNew;
    out.entitledNew[i] = shown[i].entitledNew;
  }
  return out;
}

/** `planEffect` (§4.5): the FZP run minus its `baseZoning` twin, cumulative net units. */
export function planEffectOf(fzp: NetSeries, twin: NetSeries): TimelineScore['planEffect'] {
  const out: TimelineScore['planEffect'] = [];
  for (let i = 0; i < fzp.entitledNew.length; i++) {
    out.push({
      entitledNew: fzp.entitledNew[i] - twin.entitledNew[i],
      completedNetNew: fzp.completedNetNew[i] - twin.completedNetNew[i]
    });
  }
  return out;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `phasing` (§4.5): seed-independent counts over the `multiPhase` rows. A phase is scheduled when
 * it has a published source and a plan date after `asOf`; every other phase is estimated.
 */
export function phasingOf(projects: InFlightProject[], asOf: Day): TimelineScore['phasing'] {
  const out: TimelineScore['phasing'] = {
    masters: 0,
    enrichedMasters: 0,
    phasesScheduled: 0,
    phasesEstimated: 0,
    unenriched: []
  };
  for (const p of projects) {
    if (!p.multiPhase) continue;
    out.masters++;
    if (p.phases === null) {
      out.unenriched.push({
        projectId: p.id,
        label: p.label,
        units: p.units,
        drawn: p.parcelIds.length > 0
      });
      continue;
    }
    out.enrichedMasters++;
    for (const ph of p.phases) {
      const plan = ph.plannedPermitFiled;
      if (ph.source !== null && plan !== null && plan > asOf) out.phasesScheduled++;
      else out.phasesEstimated++;
    }
  }
  out.unenriched.sort((a, b) => b.units - a.units || cmp(a.projectId, b.projectId));
  return out;
}

/** The RHNA deadline (partner ruling OD-T4; tier 1, the RHNA Primer). */
export const RHNA_DEADLINE: Day = dayOf(2031, 1, 31);

/** One entry per target: `(baseline + completedNet[i]) / units`, uncapped. */
export function targetsOf(
  baselineUnits: number,
  shown: Shown,
  targets: readonly Target[] = M1_TARGETS
): TargetProgressAt[] {
  return targets.map((target) => ({
    target,
    deadline: RHNA_DEADLINE,
    fraction: shown.map((r) => (baselineUnits + r.completedNet) / target.units)
  }));
}

const FZP_EFFECTIVE = dayOf(2026, 1, 12);
const KQED = {
  label: 'KQED news coverage (verified by fetch, 2025-10-29)',
  url: 'https://www.kqed.org/news/12062042'
};
const controllerMethod = (scenario: string) =>
  `The Controller's Office of Economic Analysis estimate, ${scenario} scenario, as reported by ` +
  'the press: net additional units from the rezoning "beyond what existing zoning might ' +
  'produce", "over the next 20 years". The primary report was searched for on sf.gov and on ' +
  "the web (2026-10-16) and was not found. The dates are inferred: from is the plan's " +
  'effective date (2026-01-12), by is the end of 2045. Compared with planEffect.completedNetNew ' +
  '(completions, net units).';

/** The published estimates the score compares with (§4.5 "References"). */
export const REFERENCES: TimelineScore['references'] = [
  {
    id: 'planning-citywide',
    label:
      'SF Planning: ~39,000 net units approved because of the rezoning within 5 years (citywide method)',
    units: 39000,
    from: FZP_EFFECTIVE,
    by: dayOf(2031, 1, 12),
    measure: 'planEffect.entitledNew',
    provenance: {
      tier: 1,
      label: 'SF Planning, Family Zoning Plan Land Use Committee presentation, 2025-11-17, slide 6',
      sources: [
        {
          label: 'SF Planning, Land Use Committee presentation, 2025-11-17 (verified by fetch)',
          url: 'https://sfplanning.org/sites/default/files/documents/citywide/fzp_land_use_committee_presentation-111725.pdf'
        }
      ],
      method:
        "SF Planning's citywide method: entitlements from 2005 to 2023 were 22% of zoned " +
        'capacity in 19 years (about 1% a year), so 5% of the added capacity in 5 years is about ' +
        '39,000 net units approved, from the effective date 2026-01-12. Compared with ' +
        'planEffect.entitledNew (entitlements, net units).'
    }
  },
  {
    id: 'controller-high',
    label:
      "Controller's Office of Economic Analysis: 14,646 net additional units from the rezoning by 2045, high growth (via press coverage)",
    units: 14646,
    from: FZP_EFFECTIVE,
    by: dayOf(2045, 12, 31),
    measure: 'planEffect.completedNetNew',
    provenance: {
      tier: 1,
      label: "Controller's Office of Economic Analysis, high growth (tier 1 via secondary: KQED)",
      sources: [KQED],
      method: controllerMethod('high growth')
    }
  },
  {
    id: 'controller-low',
    label:
      "Controller's Office of Economic Analysis: 8,504 net additional units from the rezoning by 2045, conservative (via press coverage)",
    units: 8504,
    from: FZP_EFFECTIVE,
    by: dayOf(2045, 12, 31),
    measure: 'planEffect.completedNetNew',
    provenance: {
      tier: 1,
      label: "Controller's Office of Economic Analysis, conservative (tier 1 via secondary: KQED)",
      sources: [KQED],
      method: controllerMethod('conservative')
    }
  }
];

/** A `TimelineScore` from its parts; the baseline is T3 `rhnaCompletedNet`, passed through. */
export function assembleScore(p: {
  months: Day[];
  shown: Shown;
  planEffect: TimelineScore['planEffect'];
  planEffectBand: TimelineScore['planEffectBand'];
  band: TimelineScore['band'];
  baseline: ProjectsFile['rhnaCompletedNet'];
  phasing: TimelineScore['phasing'];
  targets?: readonly Target[];
}): TimelineScore {
  const { units, since, provenance } = p.baseline;
  return {
    months: p.months,
    shown: p.shown,
    planEffect: p.planEffect,
    planEffectBand: p.planEffectBand,
    band: p.band,
    baseline: { completedNet: units, since, provenance },
    phasing: p.phasing,
    targets: targetsOf(units, p.shown, p.targets),
    references: REFERENCES
  };
}
