/**
 * Historical replay (timelapse-sim spec §6 "Pipeline", AC 2): observed project histories are
 * turned into in-flight starting states at their stage entry, run through `simulate` with 20
 * seeds, censored where each history's own observation ends, and the simulated per-stage
 * Aalen–Johansen cumulative incidence (advance and each exit reason) is compared with the
 * observed one. The observed side is stage-calibration's own code path (`qualifies`,
 * `normalise`, `purgeCensor`, `buildSpells`, `weightAdvances`, `ajSweep`/`ajTable`).
 *
 * Cohorts follow each stage's fit: `filed` and `entitled` per (pathway, stage), spells entered on
 * or after 2015-01-01; `preApplication` pooled across pathways over the same window, as
 * stage-calibration fits it (see `cohortsOf`); permit-side stages pooled across pathways from
 * 2007-01-01, left-truncated there (DQ-1). In a pooled cohort each twin runs its history's own
 * pathway, the unclassifiable ones mixed in the cohort's own proportions.
 * Only cohorts with n ≥ 50 are checked. Pass bar at every month and outcome:
 * |Δ| ≤ max(0.03, 2.5·SE), SE combining a bootstrap of the observed cohort with the spread of
 * the 20 seeds. The tolerance is a test parameter, not a model number. A cohort with no month at
 * LIVE_CAL.nRiskMin observed at risk is too thin to compare: it is reported with its n and its
 * largest observed at-risk, not failed. A block fails if no cohort is comparable, or if any
 * comparable cohort is out of tolerance (`blockFailures`).
 *
 * Two blocks: `live` reads the newest non-fixture build's `project-histories.json` (derived
 * cache) and `calibration.json` (build output), and is skipped with the reason printed when
 * there is none (`SFH_REPLAY_PIPELINE_DIR` and `SFH_REPLAY_VERSION` point it at another
 * pipeline directory or version, read only); `synthetic` always runs, on histories sampled from
 * `mini-calibration.json`'s own tables, so the replay machinery itself is exercised in CI. Each
 * block prints its per-cohort table with console.info.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { mulberry32 } from '../../src/lib/generator/seed';
import { nextStage } from '../../src/lib/sim/scenario/engine';
import miniCalibrationJson from '../../src/lib/sim/scenario/fixtures/mini-calibration.json';
import { miniCity } from '../../src/lib/sim/scenario/fixtures/mini-parcels';
import { simulate } from '../../src/lib/sim/scenario/simulate';
import type { Schedule, SimInput } from '../../src/lib/sim/scenario/types';
import { parseCalibration, sampleTransition } from '../../src/lib/timelapse/model';
import type { InFlightProject } from '../../src/lib/timelapse/projects';
import {
  PATHWAYS,
  type Calibration,
  type Day,
  type Pathway,
  type ProjectHistoriesFile,
  type ProjectHistory,
  type Stage
} from '../../src/lib/timelapse/types';
import { MONTH_DAYS } from '../../src/lib/timelapse/time';
import { isoToDay } from '../project-records/multiphase';
import {
  OUTCOMES,
  ajSweep,
  ajTable,
  countAtRisk,
  riskIndex,
  type Outcome
} from '../lib/fzp-cal/aalen-johansen';
import { LIVE_CAL } from '../lib/fzp-cal/config';
import { weightAdvances } from '../lib/fzp-cal/no-fcd';
import { purgeCensor } from '../lib/fzp-cal/purge';
import { buildSpells, normalise, qualifies } from '../lib/fzp-cal/spells';
import type { CalStage, Spell } from '../lib/fzp-cal/types';
import { windowStart } from '../lib/fzp-cal/window';
import { CALIBRATION_JSON } from '../steps/calibration';
import { HISTORIES_JSON } from '../steps/projects';

const PLANNING: readonly CalStage[] = ['preApplication', 'filed', 'entitled'];
const PERMIT = ['permitFiled', 'permitIssued', 'construction'] as const;
/** Test parameters (spec §6): cohort floor, seeds, the pass bar, bootstrap resamples. */
const N_MIN = 50;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const TOL = 0.03;
const SE_MULT = 2.5;
const BOOTSTRAP = 200;

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** One checked cohort: its observed spells and the pathway each one's simulated twin runs. */
interface Cohort {
  key: string;
  stage: CalStage;
  obs: Spell[];
  twinPathway: Pathway[];
}

/**
 * A pathway for every spell of a pooled cohort: its history's own declared pathway, or for an
 * unclassifiable history (null) the next pick of a largest-remainder sequence over the cohort's
 * classified mix, so the twins keep the cohort's own proportions.
 */
function mixPathways(declared: (Pathway | null)[]): Pathway[] {
  const counts = PATHWAYS.map((p) => declared.filter((d) => d === p).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) throw new Error('pooled cohort has no classified history to take a mix from');
  const given = PATHWAYS.map(() => 0);
  let m = 0;
  return declared.map((d) => {
    if (d !== null) return d;
    m++;
    let best = 0;
    for (let i = 1; i < PATHWAYS.length; i++) {
      if (m * counts[i] - total * given[i] > m * counts[best] - total * given[best]) best = i;
    }
    given[best]++;
    return PATHWAYS[best];
  });
}

/** The cohorts of a history set, through stage-calibration's normalisation and spells. */
function cohortsOf(histories: ProjectHistory[], asOf: Day): Cohort[] {
  const q = histories.filter(qualifies).sort(byId);
  const { norm } = purgeCensor(normalise(q, asOf).norm, LIVE_CAL);
  const { spells, unobserved } = buildSpells(norm, asOf);
  // The twin runs the history's declared pathway (the defensive permitOnly-before-2015 rule only
  // pools the observation); a null pathway takes the cohort mix.
  const declared = new Map(norm.map((h) => [h.id, h.src.pathway]));
  const out: Cohort[] = [];
  const pooled = (stage: CalStage, obs: Spell[]) => {
    if (obs.length < N_MIN) return;
    const mix = mixPathways(obs.map((s) => declared.get(s.projectId) ?? null));
    out.push({ key: `pooled ${stage}`, stage, obs, twinPathway: mix });
  };
  // preApplication is one cohort pooled across pathways, not one per pathway (conductor ruling,
  // final review Important 1; the spec §6 amendment is pending with the conductor): stage-
  // calibration fits it pooled for every pathway (`fitTransitions`, pipeline/lib/fzp-cal/
  // transitions.ts), so a per-pathway cut would compare a pathway's spells with a pooled table.
  // The twins keep their own pathways in the cohort's own mix, as on the permit side.
  pooled(
    'preApplication',
    spells.filter(
      (s) => s.stage === 'preApplication' && s.e >= windowStart('preApplication', 'pooled')
    )
  );
  for (const stage of PLANNING) {
    if (stage === 'preApplication') continue;
    const from = windowStart(stage, 'pathway');
    for (const p of PATHWAYS) {
      const obs = spells.filter((s) => s.stage === stage && s.pathway === p && s.e >= from);
      if (obs.length < N_MIN) continue;
      out.push({ key: `${p} ${stage}`, stage, obs, twinPathway: obs.map(() => p) });
    }
  }
  for (const stage of PERMIT) {
    let obs = spells.filter((s) => s.stage === stage);
    if (stage !== 'permitFiled') {
      // the pooled cell's no-FCD completions, as the fit carries them (ruling R13)
      const from = windowStart(stage, 'pooled');
      obs = weightAdvances(obs, unobserved, stage, from, asOf, LIVE_CAL).spells;
    }
    pooled(stage, obs);
  }
  return out;
}

type Kind = Outcome;

/** The leaving event of the twin's stage: the next entry, or an exit from it; null if open. */
function leave(s: Schedule, stage: Stage): { kind: Kind; day: Day } | null {
  const d = s.entered[nextStage(s.pathway, stage)];
  if (d !== undefined) return { kind: 'advance', day: d };
  if (s.end.kind === 'exit' && s.end.stage === stage) return { kind: s.end.reason, day: s.end.day };
  return null;
}

/** Every T11 parcel non-hostable: the replay runs the in-flight twins only, no initiation. */
function noHosts(p: ScenarioParcels): ScenarioParcels {
  return { ...p, hostable: new Uint8Array(p.count) };
}

/**
 * Simulated spells, `[cohort][seed]`. Each observed spell becomes an in-flight project at its
 * stage entry: entered `a` days before the run's `asOf` (its left-truncation age, 0 when it
 * entered inside the window), so the engine's in-flight conditioning on survival to `asOf` is the
 * fit's delayed entry. Its simulated spell is censored at the observed history's own end: its
 * censoring day for a censored spell (`lastObserved` or the snapshot), the snapshot otherwise.
 */
function replay(cohorts: Cohort[], cal: Calibration, asOf: Day, parcels: ScenarioParcels) {
  const projects: InFlightProject[] = [];
  const twins: { ci: number; a: number; c: number; pathway: Pathway }[] = [];
  cohorts.forEach((co, ci) => {
    co.obs.forEach((s, i) => {
      const pathway = co.twinPathway[i];
      projects.push({
        id: `RPL:${String(ci).padStart(2, '0')}:${String(i).padStart(6, '0')}`,
        label: null,
        parcelIds: [],
        pathway,
        stage: co.stage,
        history: { [co.stage]: asOf - s.a },
        units: 10,
        existingUnits: 0,
        stories: null,
        storiesTier: null,
        multiPhase: false,
        phases: null,
        sources: [],
        quality: []
      });
      twins.push({ ci, a: s.a, c: s.outcome === 'censored' ? s.x : asOf - s.e, pathway });
    });
  });
  const index = new Map(projects.map((p, k) => [p.id, k]));
  const horizon = asOf + twins.reduce((m, t) => Math.max(m, t.c - t.a), 0) + 1;
  const input: SimInput = { parcels: noHosts(parcels), projects, calibration: cal, asOf };
  const out: Spell[][][] = cohorts.map(() => SEEDS.map(() => []));
  SEEDS.forEach((seed, si) => {
    for (const sch of simulate(input, seed, horizon)) {
      if (sch.origin !== 'pipeline') throw new Error(`unexpected simulated ${sch.projectId}`);
      const k = index.get(sch.projectId)!;
      const t = twins[k];
      const stage = cohorts[t.ci].stage;
      const e = asOf - t.a;
      const ev = leave(sch, stage);
      const d = ev === null ? Infinity : ev.day - e;
      const base = { pathway: t.pathway, stage, a: t.a, e, projectId: sch.projectId };
      out[t.ci][si].push(
        ev !== null && d <= t.c
          ? { ...base, x: d, outcome: ev.kind }
          : { ...base, x: t.c, outcome: 'censored' }
      );
    }
  });
  return out;
}

type Table = ReturnType<typeof ajTable>;
const series = (t: Table, j: Outcome): number[] => (j === 'advance' ? t.advance : t.exit[j]!);

function variance(xs: number[]): number {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
}

interface Verdict {
  key: string;
  n: number;
  months: number;
  /** the most observed records at risk at any whole month up to LIVE_CAL.kMax (unweighted) */
  maxAtRisk: number;
  /** too thin to compare: no month with LIVE_CAL.nRiskMin observed at risk (reported, not failed) */
  thin: boolean;
  maxAbs: number;
  /** the pass bar where |Δ| is largest */
  bar: number;
  worst: string;
  failures: string[];
}

/** The most observed records at risk at any whole month 1..kMax, unweighted (as `tableMonths`). */
function maxAtRiskOf(spells: Spell[]): number {
  const idx = riskIndex(spells);
  let m = 0;
  for (let k = 1; k <= LIVE_CAL.kMax; k++) m = Math.max(m, countAtRisk(idx, k * MONTH_DAYS));
  return m;
}

/**
 * The observed AJ table (LIVE_CAL's kMax and risk floor set its months) against the simulated
 * one over all seeds, at every whole month and outcome. A cohort with no month at the risk floor
 * has no table to compare: it is marked thin, with no failure (spec §6 pass rule).
 */
function compare(co: Cohort, sims: Spell[][], salt: number): Verdict {
  const o = ajTable(ajSweep(co.obs), undefined, LIVE_CAL.kMax, LIVE_CAL.nRiskMin, co.obs);
  const K = o.months;
  const v: Verdict = {
    key: co.key,
    n: co.obs.length,
    months: K,
    maxAtRisk: maxAtRiskOf(co.obs),
    thin: K === 0,
    maxAbs: 0,
    bar: 0,
    worst: '',
    failures: []
  };
  if (v.thin) return v;
  // nRiskMin 0 reads every table to the observed table's K months
  const tab = (sp: Spell[]) => ajTable(ajSweep(sp), undefined, K, 0, sp);
  const sim = tab(sims.flat());
  const perSeed = sims.map(tab);
  const rand = mulberry32(0x5eed0000 + salt);
  const boots = Array.from({ length: BOOTSTRAP }, () =>
    tab(Array.from(co.obs, () => co.obs[Math.floor(rand() * co.obs.length)]))
  );
  for (const j of OUTCOMES) {
    for (let k = 0; k < K; k++) {
      const got = series(sim, j)[k];
      const want = series(o, j)[k];
      const delta = Math.abs(got - want);
      const se = Math.sqrt(
        variance(boots.map((b) => series(b, j)[k])) +
          variance(perSeed.map((t) => series(t, j)[k])) / SEEDS.length
      );
      const bar = Math.max(TOL, SE_MULT * se);
      const at = `${j} by month ${k + 1}: simulated ${got.toFixed(4)} vs observed ${want.toFixed(4)}`;
      if (delta > v.maxAbs) {
        v.maxAbs = delta;
        v.bar = bar;
        v.worst = `${at} (bar ${bar.toFixed(4)})`;
      }
      if (delta > bar) v.failures.push(`${at}: |Δ| ${delta.toFixed(4)} > ${bar.toFixed(4)}`);
    }
  }
  return v;
}

/**
 * The block's pass rule (spec §6): thin cohorts are reported, not failed; the block fails when no
 * cohort is comparable, or with every failure of a comparable cohort.
 */
function blockFailures(verdicts: Verdict[]): string[] {
  const comparable = verdicts.filter((v) => !v.thin);
  if (comparable.length === 0) {
    const thin = verdicts.map((v) => `${v.key}: n ${v.n}, max at-risk ${v.maxAtRisk}`);
    return [
      `no cohort comparable (none has a month with ${LIVE_CAL.nRiskMin} observed at risk)` +
        (thin.length ? `: ${thin.join('; ')}` : ': no cohort with n ≥ 50')
    ];
  }
  return comparable.flatMap((v) => v.failures.map((m) => `${v.key}: ${m}`));
}

/** One line per cohort: key, n, months compared or too thin, max |Δ|, its bar, and the verdict. */
function formatVerdicts(verdicts: Verdict[]): string {
  const w = Math.max(0, ...verdicts.map((v) => v.key.length));
  return verdicts
    .map((v) => {
      const head = `${v.key.padEnd(w)}  n ${String(v.n).padStart(6)}  `;
      if (v.thin) return `${head}too thin (max at-risk ${v.maxAtRisk}): reported, not compared`;
      const verdict = v.failures.length ? `FAIL (${v.failures.length})` : 'ok';
      return (
        `${head}${String(v.months).padStart(3)} months  max |Δ| ${v.maxAbs.toFixed(4)}` +
        `  bar ${v.bar.toFixed(4)}  ${verdict}${v.worst ? `  worst: ${v.worst}` : ''}`
      );
    })
    .join('\n');
}

function runReplay(
  histories: ProjectHistory[],
  asOf: Day,
  cal: Calibration,
  parcels: ScenarioParcels,
  label: string
): { cohorts: Cohort[]; verdicts: Verdict[] } {
  const cohorts = cohortsOf(histories, asOf);
  const sims = replay(cohorts, cal, asOf, parcels);
  const verdicts = cohorts.map((co, i) => compare(co, sims[i], i));
  // console.info goes to stdout (chreode polices stderr only)
  console.info(`[simulate-replay] ${label}\n${formatVerdicts(verdicts)}`);
  return { cohorts, verdicts };
}

// ---------------------------------------------------------------------------------------------
// Synthetic histories: sampled from mini-calibration.json's own tables.

const MINI_CAL: Calibration = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
/** Histories per (pathway, start) group. */
const N_SYNTH = 8000;
const SYNTH_SEED = 20261018;
/** Share of histories observed only until a uniform day before the snapshot. */
const EARLY_CENSOR = 0.3;
/** Share of the long-window group recorded with no pathway (pooled cohorts only). */
const NULL_PATHWAY = 0.05;

/**
 * One history walked through the pathway's stages from `s0` on `e0`, every duration drawn fresh
 * from the calibration (`sampleTransition` at 0 months), observed until `lastObserved`.
 */
function walk(
  rand: () => number,
  id: string,
  p: Pathway,
  s0: Stage,
  e0: Day,
  lastObserved: Day,
  recorded: Pathway | null
): ProjectHistory {
  const entered: Partial<Record<Stage, Day>> = { [s0]: e0 };
  let end: ProjectHistory['end'] = { kind: 'open', lastObserved };
  let s = s0;
  let from = e0;
  for (;;) {
    const r = sampleTransition(MINI_CAL.transitions[p][s as CalStage]!, rand(), 0);
    const day = from + Math.floor(r.days);
    if (day > lastObserved) break;
    if (r.kind !== 'advance') {
      end = { kind: 'exit', stage: s, reason: r.kind, day };
      break;
    }
    const n = nextStage(p, s);
    entered[n] = day;
    if (n === 'complete') {
      end = { kind: 'complete', day };
      break;
    }
    s = n;
    from = day;
  }
  return {
    id,
    pathway: recorded,
    parcelIds: [],
    entered,
    end,
    unitsAt: { [s0]: 10 },
    existingUnits: 0,
    storiesProposed: null,
    baseStoriesAtFiling: null,
    sources: [],
    quality: []
  };
}

/**
 * Per pathway, two groups of N_SYNTH: from `preApplication`, entered 2015-01-01 onwards (each
 * pathway's group is exactly N_SYNTH of the pooled preApplication cohort); and from the
 * pathway's first core stage (`filed`, or `permitFiled` for permitOnly), entered 2001-01-01
 * onwards, so Planning-side spells before the 2015 window are left out, permit-side spells
 * straddle the 2007-01-01 window start and enter by left truncation, and 5% of the group is
 * recorded with a null pathway. Starting at the pathway's first stages leaves no gap for
 * normalisation to impute.
 */
function syntheticHistories(snapshot: Day): ProjectHistory[] {
  const rand = mulberry32(SYNTH_SEED);
  const groups: { tag: string; s0: (p: Pathway) => Stage; from: Day; nulls: number }[] = [
    { tag: 'ppa', s0: () => 'preApplication', from: isoToDay('2015-01-01'), nulls: 0 },
    {
      tag: 'core',
      s0: (p) => (p === 'permitOnly' ? 'permitFiled' : 'filed'),
      from: isoToDay('2001-01-01'),
      nulls: NULL_PATHWAY
    }
  ];
  const out: ProjectHistory[] = [];
  for (const p of PATHWAYS) {
    for (const g of groups) {
      for (let i = 0; i < N_SYNTH; i++) {
        const e0 = g.from + Math.floor(rand() * (snapshot - 90 - g.from));
        const lastObserved =
          rand() < EARLY_CENSOR ? e0 + Math.floor(rand() * (snapshot - e0)) : snapshot;
        const recorded = rand() < g.nulls ? null : p;
        const id = `SYN:${p}:${g.tag}:${String(i).padStart(5, '0')}`;
        out.push(walk(rand, id, p, g.s0(p), e0, lastObserved, recorded));
      }
    }
  }
  return out;
}

describe('simulate-replay: synthetic histories from the mini calibration', () => {
  const snapshot = MINI_CAL.asOf;
  const histories = syntheticHistories(snapshot);
  let result: ReturnType<typeof runReplay> | undefined;
  const run = () =>
    (result ??= runReplay(histories, snapshot, MINI_CAL, miniCity().parcels, 'synthetic'));

  const KEYS = [
    'pooled preApplication',
    'discretionary filed',
    'streamlined filed',
    'discretionary entitled',
    'streamlined entitled',
    'pooled permitFiled',
    'pooled permitIssued',
    'pooled construction'
  ];

  it('builds every cohort as the calibration fits it: preApplication pooled, filed and entitled per pathway', () => {
    const { cohorts } = run();
    expect(cohorts.map((c) => c.key)).toEqual(KEYS);
    const planning = cohorts.filter((c) => PLANNING.includes(c.stage));
    const permit = cohorts.filter((c) => !PLANNING.includes(c.stage));
    expect(permit.map((c) => c.stage)).toEqual([...PERMIT]);
    // Planning: entered inside the 2015 window
    for (const c of planning) {
      expect(c.obs.every((s) => s.a === 0 && s.e >= isoToDay('2015-01-01'))).toBe(true);
    }
    // filed and entitled: one pathway each, the twins on it
    for (const c of planning.filter((x) => x.stage !== 'preApplication')) {
      const p = c.key.split(' ')[0];
      expect(c.obs.every((s) => s.pathway === p)).toBe(true);
      expect(c.twinPathway.every((x) => x === p)).toBe(true);
    }
    // preApplication: every pathway's spells in one cohort, each twin on its own pathway
    const ppa = cohorts.find((c) => c.stage === 'preApplication')!;
    expect(ppa.obs).toHaveLength(PATHWAYS.length * N_SYNTH);
    expect(ppa.twinPathway).toEqual(ppa.obs.map((s) => s.projectId.split(':')[1]));
    expect(new Set(ppa.twinPathway)).toEqual(new Set(PATHWAYS));
    // permit side: some spells enter by left truncation at 2007-01-01, and pooled cohorts mix
    // every pathway, unclassifiable histories included
    for (const c of permit) {
      expect(c.obs.some((s) => s.a > 0)).toBe(true);
      expect(c.obs.some((s) => s.pathway === null)).toBe(true);
      expect(new Set(c.twinPathway)).toEqual(new Set(PATHWAYS));
    }
    // censoring: at the snapshot and earlier
    const all = cohorts.flatMap((c) => c.obs);
    expect(all.some((s) => s.outcome === 'censored' && s.e + s.x < snapshot)).toBe(true);
    expect(all.some((s) => s.outcome === 'censored' && s.e + s.x === snapshot)).toBe(true);
    expect(Math.min(...cohorts.map((c) => c.obs.length))).toBeGreaterThanOrEqual(N_MIN);
  });

  it('keeps the cohort pathway mix for unclassifiable histories', () => {
    const declared: (Pathway | null)[] = [
      ...Array<Pathway>(6).fill('discretionary'),
      ...Array<Pathway>(3).fill('streamlined'),
      'permitOnly',
      ...Array<null>(10).fill(null)
    ];
    const mixed = mixPathways(declared);
    expect(mixed.slice(0, 10)).toEqual(declared.slice(0, 10));
    const assigned = mixed.slice(10);
    expect(PATHWAYS.map((p) => assigned.filter((x) => x === p).length)).toEqual([6, 3, 1]);
  });

  it.each(KEYS)('%s: simulated incidence matches the observed Aalen–Johansen', (key) => {
    const v = run().verdicts.find((x) => x.key === key)!;
    // every synthetic cohort is large: comparable, none too thin
    expect(v.thin).toBe(false);
    expect(v.months).toBeGreaterThan(0);
    expect(v.failures).toEqual([]);
  });

  it('passes the block: every cohort comparable and within tolerance', () => {
    expect(blockFailures(run().verdicts)).toEqual([]);
  });

  it('fails a simulation whose table is off (the check has power)', () => {
    const co = run().cohorts.find((c) => c.key === 'pooled permitIssued')!;
    // every pathway's permitIssued advance table at 85%: about 0.12 less by month 12
    const off = structuredClone(miniCalibrationJson) as { transitions: Record<string, unknown> };
    for (const p of PATHWAYS) {
      const t = (off.transitions[p] as Record<string, { advance: number[] }>).permitIssued;
      t.advance = t.advance.map((x) => Math.floor(x * 0.85 * 1e6) / 1e6);
    }
    const cal = parseCalibration(off as unknown);
    const [sims] = replay([co], cal, snapshot, miniCity().parcels);
    const v = compare(co, sims, 0);
    expect(v.maxAbs).toBeGreaterThan(0.1);
    expect(v.failures.length).toBeGreaterThan(0);
  });
});

describe('simulate-replay: too-thin cohorts', () => {
  /**
   * 60 spells entered at age 0: 45 advance on day 10, 15 censored on day 400. Month 1 to 13 has
   * 15 at risk and later months none, so no month reaches LIVE_CAL.nRiskMin (20).
   */
  const thinCohort: Cohort = (() => {
    const obs: Spell[] = Array.from({ length: 60 }, (_, i) => ({
      pathway: 'streamlined',
      stage: 'entitled',
      a: 0,
      e: isoToDay('2020-01-01') + i,
      x: i < 45 ? 10 : 400,
      outcome: i < 45 ? 'advance' : 'censored',
      projectId: `THIN:${String(i).padStart(2, '0')}`
    }));
    return {
      key: 'streamlined entitled',
      stage: 'entitled',
      obs,
      twinPathway: obs.map(() => 'streamlined')
    };
  })();

  const verdict = (key: string, failures: string[]): Verdict => ({
    key,
    n: 100,
    months: 12,
    maxAtRisk: 100,
    thin: false,
    maxAbs: failures.length ? 0.2 : 0.01,
    bar: 0.03,
    worst: '',
    failures
  });

  it('reports a cohort with no month at the at-risk minimum as too thin, with n and max at-risk', () => {
    expect(LIVE_CAL.nRiskMin).toBe(20);
    const v = compare(thinCohort, [], 0);
    expect(v.thin).toBe(true);
    expect(v.n).toBe(60);
    expect(v.maxAtRisk).toBe(15);
    expect(v.months).toBe(0);
    expect(v.failures).toEqual([]);
    expect(formatVerdicts([v])).toContain('too thin (max at-risk 15)');
  });

  it('does not fail the block for a thin cohort beside a comparable one', () => {
    const thin = compare(thinCohort, [], 0);
    expect(blockFailures([thin, verdict('pooled permitFiled', [])])).toEqual([]);
    expect(
      blockFailures([thin, verdict('pooled permitFiled', ['advance by month 3: off'])])
    ).toEqual(['pooled permitFiled: advance by month 3: off']);
  });

  it('fails the block when every cohort is too thin, or there is none', () => {
    const failures = blockFailures([compare(thinCohort, [], 0)]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/no cohort comparable/);
    expect(failures[0]).toContain('streamlined entitled: n 60, max at-risk 15');
    expect(blockFailures([])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Live: the newest non-fixture build's histories and calibration.

/**
 * Read-only overrides: `SFH_REPLAY_PIPELINE_DIR` names the pipeline directory whose
 * `.cache/derived` and `out` are read (default this checkout's `pipeline/`), and
 * `SFH_REPLAY_VERSION` picks one version instead of the newest non-fixture one.
 */
const PIPELINE_DIR =
  process.env.SFH_REPLAY_PIPELINE_DIR ||
  join(fileURLToPath(new URL('../..', import.meta.url)), 'pipeline');
const PICK = process.env.SFH_REPLAY_VERSION || null;
const OUT = join(PIPELINE_DIR, 'out');
const DERIVED = join(PIPELINE_DIR, '.cache/derived');

/** The newest non-fixture version (or SFH_REPLAY_VERSION) with both files, or why there is none. */
function findLive(): { version: string; histories: string; calibration: string } | string {
  if (!existsSync(DERIVED)) return `no derived cache at ${DERIVED} (run the pipeline build)`;
  const found = readdirSync(DERIVED)
    .filter((v) => (PICK === null ? !/^fixture-\d+$/.test(v) : v === PICK))
    .map((version) => ({
      version,
      histories: join(DERIVED, version, HISTORIES_JSON),
      calibration: join(OUT, version, CALIBRATION_JSON)
    }))
    .filter((f) => existsSync(f.histories) && existsSync(f.calibration))
    .sort((a, b) => statSync(b.histories).mtimeMs - statSync(a.histories).mtimeMs);
  return (
    found[0] ??
    `no ${PICK === null ? 'non-fixture version' : `version ${PICK}`} with ${HISTORIES_JSON}` +
      ` under ${DERIVED} and ${CALIBRATION_JSON} under ${OUT}`
  );
}

const live = findLive();
if (typeof live === 'string') console.info(`[simulate-replay] live block skipped: ${live}`);

describe.skipIf(typeof live === 'string')(
  `simulate-replay: live build ${typeof live === 'string' ? `(skipped: ${live})` : live.version}`,
  () => {
    it('every comparable cohort with n ≥ 50 matches the observed Aalen–Johansen', () => {
      const f = live as Exclude<typeof live, string>;
      const file = JSON.parse(readFileSync(f.histories, 'utf8')) as ProjectHistoriesFile;
      const cal = parseCalibration(JSON.parse(readFileSync(f.calibration, 'utf8')) as unknown);
      expect(file.asOf).toBe(cal.asOf);
      const { verdicts } = runReplay(
        file.histories,
        file.asOf,
        cal,
        miniCity().parcels,
        `live ${f.version} (${PIPELINE_DIR})`
      );
      // too-thin cohorts are reported above, not failed; none comparable fails
      expect(blockFailures(verdicts)).toEqual([]);
    });
  }
);
