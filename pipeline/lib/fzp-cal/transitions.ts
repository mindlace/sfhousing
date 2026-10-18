/**
 * Every transition cell of `calibration.json` with its provenance (stage-calibration spec §4.4,
 * §4.5): the 16 occupiable pathway × stage Transitions, each filled by the first rung of the
 * fallback ladder that passes.
 * - preApplication: pooled AJ over 2015+ (tier 2) for all three pathways, else rung 3;
 * - filed, entitled: pathway AJ over 2015+ (tier 0), else pooled AJ (tier 2), else rung 3;
 * - permitFiled, permitIssued, construction: the pooled table over [2007-01-01, asOf] scaled to
 *   the pathway's 2015+ level (`phScale`, tier 2), else rung 3. permitIssued and construction
 *   cells are fitted on spells weighted for their no-FCD completions (`weightAdvances`, ruling R13
 *   and its guard).
 * A rung passes with spells >= `nSpellsMin` and observed events >= `nEventsMin` (unweighted,
 * ruling R18) and when §4.4's rejection checks pass.
 */
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  pathwayStages,
  type Calibration,
  type Day,
  type ExitReason,
  type Pathway,
  type Provenance,
  type Transition
} from '../../../src/lib/timelapse/types';
import {
  OUTCOMES,
  ajSweep,
  ajTable,
  tableMonths,
  type AjSweep,
  type Outcome
} from './aalen-johansen';
import { rung3 } from './fallback';
import { weightAdvances, type AdvanceWeighting } from './no-fcd';
import { phScale } from './ph-pool';
import { datasf } from './provenance';
import { cutSpells } from './spells';
import { rejects, tailFit } from './tail';
import { PPA_SERIES_END, coverageGuard, windowStart, type PartialYear } from './window';
import type {
  CalProfile,
  CalStage,
  PurgeWindow,
  RuleTally,
  Spell,
  UnobservedAdvance
} from './types';

type Source = { label: string; url: string };

/** One cell's no-FCD weighting (ruling R13 and the conductor's guard). */
export interface NoFcdCell {
  X: number;
  A: number;
  w: number;
  flagged: boolean;
  /** X dropped because A = 0 */
  dropped: number;
}

/** What the report prints for each pathway × stage cell. */
export interface CellReport {
  pathway: Pathway;
  stage: CalStage;
  rung: 1 | 2 | 3 | 'ph';
  tier: Provenance['tier'];
  /** spells of the fitted cell (pooled for rungs 2, 'ph' and 3), observed records */
  n: number;
  /** observed (unweighted) events of the fitted cell */
  events: number;
  window: [string, string];
  months: number;
  /** tail span start and its observed events (absent on rung 3) */
  k0?: number;
  tailEvents?: number;
  /** the pathway's own spells in its 2015+ window (rungs 1 and 'ph') */
  pathwaySpells?: number;
  theta?: Partial<Record<Outcome, number>>;
  thin?: boolean;
  maxDiff?: number;
  capped?: number;
  cappedInTable?: number;
  /** permitIssued and construction: the pooled cell's and the pathway subset's weighting */
  noFcd?: { pooled: NoFcdCell; pathway: NoFcdCell };
  /** the cell's spells censored by `sc.exit.purge-censor` */
  purgeCensored: number;
  /** the cell's spells whose history had a stage date imputed by `sc.stages.gap-impute` */
  gapImputed: number;
}

/** Inputs of the provenance `method` text that the spells do not carry. */
export interface FitContext {
  /** every purge window (unwindowed) and the windowed rule tally (`purgeCensorTally`, C3) */
  purge: { windows: PurgeWindow[]; windowed: RuleTally };
  /** the history ids step 1 changed (`normalise(...).imputed`, rule `sc.stages.gap-impute`) */
  gapImpute: { ids: ReadonlySet<string> };
  /** `calibration.method.permitOnlyPre2015` (§4.4 step 4) */
  permitOnlyPre2015: { fired: number; of: number };
}

export interface FitResult {
  transitions: Calibration['transitions'];
  /** pathway-major, stages in `STAGE_ORDER` */
  cells: CellReport[];
  warnings: string[];
  /** rung-3 cells (`calibration.rung3`) */
  rung3: number;
  /** preApplication spells pooled across pathways */
  ppaPooled: number;
  /** `calibration.spells.<pathway|pooled>.<stage>`: observed spells of each fitted cell */
  spellsCount: Record<string, number>;
  /** pooled permit-side cells flagged by the no-FCD guard (`calibration.noFcd.flaggedPooled`) */
  noFcdFlaggedPooled: number;
  /** entries per year of each stage's pooled window (the coverage guard's counts) */
  coverage: Partial<Record<CalStage, Record<number, number>>>;
  /**
   * per stage, the years only partly inside its guard window [Wₛ, entry end]: counted, not
   * asserted (conductor ruling C4); every cell of the stage states them in its `method`
   */
  coveragePartial: Partial<Record<CalStage, PartialYear[]>>;
}

const PERMIT_SIDE: readonly CalStage[] = ['permitFiled', 'permitIssued', 'construction'];

const AJ_METHOD =
  'Aalen–Johansen cumulative incidence, right-censored at last observation, left-truncated at window start';

const COMPLETION_DATING =
  'completion = first TCO/CFC, else permit `completed_date`; TCO data start in 2018, so earlier completions are dated later (bias toward longer durations)';

const fmt = (v: number): string => String(Number(v.toPrecision(4)));

function planningSources(stage: CalStage): Source[] {
  if (stage === 'preApplication') return [datasf('planningRecords'), datasf('planningProjects')];
  if (stage === 'filed') return [datasf('planningProjects'), datasf('planningReview')];
  return [datasf('planningReview'), datasf('planningProjects')];
}

function permitSources(stage: CalStage): Source[] {
  const s = [datasf('permits'), datasf('assessorRoll'), datasf('planningProjects')];
  if (stage === 'construction') s.push(datasf('unitCompletions'));
  return s;
}

/** Observed (unweighted) events of a cell, Σ `AjSweep.observed` (what N_EVENTS_MIN counts, R18). */
function observedEvents(sw: AjSweep): number {
  let n = 0;
  for (const j of OUTCOMES) n += sw.observed[j];
  return n;
}

/** The stage's observed exit-reason counts across `spells`; null when there is no exit. */
function exitShares(spells: Spell[]): Partial<Record<ExitReason, number>> | null {
  const c: Partial<Record<ExitReason, number>> = {};
  let total = 0;
  for (const s of spells) {
    if (s.outcome === 'censored' || s.outcome === 'advance') continue;
    c[s.outcome] = (c[s.outcome] ?? 0) + 1;
    total++;
  }
  return total > 0 ? c : null;
}

/** Reasons with at least one observed event in the cell, in `EXIT_ORDER`. */
function keptReasons(spells: Spell[]): ExitReason[] {
  const seen = new Set<string>();
  for (const s of spells) seen.add(s.outcome);
  return EXIT_ORDER.filter((r) => seen.has(r));
}

function buildTransition(
  t: {
    months: number;
    advance: number[];
    exit: Partial<Record<ExitReason, number[]>>;
    tail: Transition['tail'];
  },
  reasons: ExitReason[],
  provenance: Provenance,
  tailProvenance: Provenance
): Transition {
  const exit: Partial<Record<ExitReason, number[]>> = {};
  const tailExit: Partial<Record<ExitReason, number>> = {};
  for (const r of reasons) {
    exit[r] = t.exit[r]!;
    tailExit[r] = t.tail.exit[r] ?? 0;
  }
  return {
    months: t.months,
    advance: t.advance,
    exit,
    tail: { advance: t.tail.advance, exit: tailExit },
    provenance,
    tailProvenance
  };
}

function tailProv(
  p: Provenance,
  months: number,
  k0: number,
  n: number,
  scaled: boolean
): Provenance {
  return {
    tier: 2,
    label: `Extrapolation beyond month ${months} of the table (tier 2)`,
    sources: p.sources.map((s) => ({ ...s })),
    method: `constant competing hazards, occurrence/exposure over months k₀+ (k₀ = ${k0}), applied beyond month ${months}${scaled ? ', each hazard scaled by the pathway θ' : ''}`,
    n,
    window: p.window
  };
}

/** A plain AJ cell: table, tail, rejection and the ladder thresholds. */
function ajCell(spells: Spell[], cal: CalProfile) {
  const sw = ajSweep(spells);
  const events = observedEvents(sw);
  const table = ajTable(sw, undefined, cal.kMax, cal.nRiskMin, spells);
  const tail = tailFit(spells, table.months, cal);
  const ok =
    spells.length >= cal.nSpellsMin &&
    events >= cal.nEventsMin &&
    !rejects(table.advance, table.exit, tail.tail);
  return { ok, events, table, tail };
}

const noFcdOf = (w: AdvanceWeighting): NoFcdCell => ({
  X: w.X,
  A: w.A,
  w: w.w,
  flagged: w.flagged,
  dropped: w.dropped
});

/**
 * Fits every occupiable pathway × stage cell (spec §4.5). `spells` and `unobserved` are
 * `buildSpells`' output (cut at the pooled window starts, sorted by pathway, stage, project id).
 * The coverage guard runs once per stage over its pooled window (preApplication's ends at
 * min(asOf, PPA_SERIES_END)); with `cal.coverageGuard` a full calendar year with no entry throws,
 * and a partial year is only counted and stated (conductor ruling C4).
 */
export function fitTransitions(
  spells: Spell[],
  unobserved: UnobservedAdvance[],
  asOf: Day,
  cal: CalProfile,
  ctx: FitContext
): FitResult {
  const transitions: Calibration['transitions'] = {
    discretionary: {},
    streamlined: {},
    permitOnly: {}
  };
  const cells: CellReport[] = [];
  const warnings: string[] = [];
  const spellsCount: Record<string, number> = {};
  const coverage: FitResult['coverage'] = {};
  const coveragePartial: FitResult['coveragePartial'] = {};
  /** the current stage's partial-year sentences, stated in every cell's `method` */
  let partialNotes: string[] = [];
  let ppaPooled = 0;
  let noFcdFlaggedPooled = 0;

  const asOfIso = isoOf(asOf);
  const asOfYear = asOfIso.slice(0, 4);
  const v2015Iso = isoOf(windowStart('filed', 'pathway'));
  const purged = new Set(ctx.purge.windowed.sample);
  const purgeCount = (cell: Spell[]): number => {
    let k = 0;
    for (const s of cell) {
      if (s.outcome === 'censored' && purged.has(`${s.projectId}:${s.stage}`)) k++;
    }
    return k;
  };
  const windowsText = ctx.purge.windows
    .map((w) => (w.first === w.last ? isoOf(w.first) : `${isoOf(w.first)} to ${isoOf(w.last)}`))
    .join(', ');
  const purgeSentence = (k: number): string[] =>
    k > 0
      ? [
          `${k} exits in administrative purge windows [${windowsText}] censored (rule sc.exit.purge-censor: tier 2 detection, tier-4 thresholds)`
        ]
      : [];
  const imputed = ctx.gapImpute.ids;
  const imputedCount = (cell: Spell[]): number => {
    let k = 0;
    for (const s of cell) if (imputed.has(s.projectId)) k++;
    return k;
  };
  const imputeSentence = (k: number): string[] =>
    k > 0
      ? [
          `${k} spells from histories with an imputed stage date (rule sc.stages.gap-impute; bias toward zero-duration spells)`
        ]
      : [];
  const pre2015 = `permit-only histories before 2015 count as pathway unknown: n = ${ctx.permitOnlyPre2015.fired} of ${ctx.permitOnlyPre2015.of} (calibration.method.permitOnlyPre2015)`;

  // Rung 3 uses no durations, so it carries no duration caveat (completion dating, imputation);
  // its CellReport still records the pooled cell's purge, imputation and no-FCD counts.
  const fallback = (
    p: Pathway,
    stage: CalStage,
    pooled: Spell[],
    pooledEvents: number,
    window: [string, string],
    noFcd?: CellReport['noFcd']
  ): void => {
    const t = rung3(stage, p, exitShares(pooled), { n: pooled.length, window });
    if (partialNotes.length > 0) {
      t.provenance.method = [t.provenance.method, ...partialNotes].join('; ');
    }
    transitions[p][stage] = t;
    warnings.push(`rung 3 (literature synthetic): ${p} ${stage}`);
    cells.push({
      pathway: p,
      stage,
      rung: 3,
      tier: t.provenance.tier,
      n: pooled.length,
      events: pooledEvents,
      window,
      months: 1,
      ...(noFcd ? { noFcd } : {}),
      purgeCensored: purgeCount(pooled),
      gapImputed: imputedCount(pooled)
    });
  };

  for (const stage of STAGE_ORDER) {
    if (stage === 'complete') continue;
    const pathways = PATHWAYS.filter((p) => pathwayStages(p).includes(stage));
    const pooled = spells.filter((s) => s.stage === stage);
    const from = windowStart(stage, 'pooled');
    const fromIso = isoOf(from);
    const window: [string, string] = [fromIso, asOfIso];
    const guardEnd = stage === 'preApplication' ? Math.min(asOf, isoToDay(PPA_SERIES_END)) : asOf;
    const guard = coverageGuard(pooled, stage, from, guardEnd, cal.coverageGuard);
    coverage[stage] = guard.perYear;
    coveragePartial[stage] = guard.partial;
    partialNotes = guard.partial.map(
      (y) => `partial year ${y.year} (to ${y.to}): ${y.entries} entries, not asserted`
    );
    spellsCount[`calibration.spells.pooled.${stage}`] = pooled.length;

    if (!PERMIT_SIDE.includes(stage)) {
      // Planning side: pathway AJ (tier 0; never for preApplication), pooled AJ (tier 2), rung 3.
      const pool = ajCell(pooled, cal);
      if (stage === 'preApplication') ppaPooled = pooled.length;
      for (const p of pathways) {
        const own = pooled.filter((s) => s.pathway === p);
        const sources = planningSources(stage);
        let fit: { cell: Spell[]; fit: ReturnType<typeof ajCell>; rung: 1 | 2 } | null = null;
        let ownCell: ReturnType<typeof ajCell> | null = null;
        if (stage !== 'preApplication') {
          spellsCount[`calibration.spells.${p}.${stage}`] = own.length;
          ownCell = ajCell(own, cal);
          if (ownCell.ok) fit = { cell: own, fit: ownCell, rung: 1 };
        }
        if (!fit && pool.ok) fit = { cell: pooled, fit: pool, rung: 2 };
        if (!fit) {
          fallback(p, stage, pooled, pool.events, window);
          continue;
        }
        const { cell, rung } = fit;
        const { table, tail, events } = fit.fit;
        const k = purgeCount(cell);
        const g = imputedCount(cell);
        const parts: string[] = [AJ_METHOD];
        if (rung === 1) {
          parts.push(`${p} spells since ${fromIso}: n = ${cell.length}, events = ${events}`);
        } else {
          parts.push(
            `pooled across pathways: every ${stage} spell since ${fromIso}, of any pathway including pathway unknown: n = ${cell.length}, events = ${events}`
          );
          if (stage === 'preApplication') {
            parts.push(
              `every preApplication spell is pooled across pathways, because a PPA-only record's pathway is assigned, not observed: n = ${ppaPooled} (calibration.method.ppaPooled)`
            );
          } else if (ownCell) {
            parts.push(
              `the ${p} cell alone (n = ${own.length}, events = ${ownCell.events}) is below the thresholds or rejected`
            );
          }
        }
        parts.push(...imputeSentence(g), ...purgeSentence(k), ...partialNotes);
        const tier = rung === 1 ? 0 : 2;
        const provenance: Provenance = {
          tier,
          label:
            rung === 1
              ? `SF Planning records ${fromIso.slice(0, 4)}–${asOfYear}, ${p} (tier 0)`
              : `SF Planning records ${fromIso.slice(0, 4)}–${asOfYear}, pooled across pathways (tier 2)`,
          sources,
          method: parts.join('; '),
          n: cell.length,
          window
        };
        transitions[p][stage] = buildTransition(
          { ...table, tail: tail.tail },
          keptReasons(cell),
          provenance,
          tailProv(provenance, table.months, tail.k0, tail.observedEvents, false)
        );
        cells.push({
          pathway: p,
          stage,
          rung,
          tier,
          n: cell.length,
          events,
          window,
          months: table.months,
          k0: tail.k0,
          tailEvents: tail.observedEvents,
          ...(rung === 1 ? { pathwaySpells: own.length } : {}),
          purgeCensored: k,
          gapImputed: g
        });
      }
      continue;
    }

    // Permit side: pooled shape over [Wₛ, asOf], pathway level from 2015+ (phScale), rung 3.
    const nfStage = stage === 'permitIssued' || stage === 'construction' ? stage : null;
    const pooledW = nfStage ? weightAdvances(pooled, unobserved, nfStage, from, asOf, cal) : null;
    // Ruling R24: with X = 0 the weighting is a no-op, so only a flagged pooled cell with X > 0
    // is escalated; `flagged` itself is reported unchanged.
    if (pooledW?.flagged && pooledW.X > 0) {
      noFcdFlaggedPooled++;
      warnings.push(
        `no-FCD weighting flagged at pooled level: ${stage} X=${pooledW.X} A=${pooledW.A} w=${fmt(pooledW.w)}`
      );
    }
    const pooledFit = pooledW ? pooledW.spells : pooled;
    const pooledEvents = observedEvents(ajSweep(pooled));
    const v2015 = windowStart(stage, 'pathway');
    const pooledOk = pooled.length >= cal.nSpellsMin && pooledEvents >= cal.nEventsMin;
    const reasons = keptReasons(pooled);
    const k = purgeCount(pooled);
    const g = imputedCount(pooled);
    const months = pooledOk ? tableMonths(pooledFit, cal.kMax, cal.nRiskMin) : 0;
    const pooledTail = pooledOk ? tailFit(pooledFit, months, cal) : null;

    for (const p of pathways) {
      const own = cutSpells(
        pooled.filter((s) => s.pathway === p),
        v2015
      );
      spellsCount[`calibration.spells.${p}.${stage}`] = own.length;
      const ownW =
        pooledW && nfStage
          ? weightAdvances(
              own,
              unobserved.filter((u) => u.pathway === p),
              nfStage,
              v2015,
              asOf,
              cal,
              pooledW.w
            )
          : null;
      const noFcd =
        pooledW && ownW ? { pooled: noFcdOf(pooledW), pathway: noFcdOf(ownW) } : undefined;
      if (!pooledOk || !pooledTail) {
        fallback(p, stage, pooled, pooledEvents, window, noFcd);
        continue;
      }
      const ph = phScale(pooledFit, ownW ? ownW.spells : own, cal);
      if (rejects(ph.advance, ph.exit, ph.tail)) {
        fallback(p, stage, pooled, pooledEvents, window, noFcd);
        continue;
      }
      const thetaText = (['advance', ...reasons] as Outcome[])
        .map((j) => `${j} θ=${fmt(ph.theta[j])}`)
        .join(', ');
      const parts = [
        `Pooled Aalen–Johansen over all spells since ${fromIso}, the first assessor roll (existing homes at filing are known only from then; pooled across pathways before 2015; pathway unknowable); cause-specific hazards scaled by θ = (O+${cal.phPrior})/(E+${cal.phPrior}) from ${p} spells since ${v2015Iso} (proportional hazards): ${thetaText}`,
        `pooled spells n = ${pooled.length}, events = ${pooledEvents}; ${p} spells since ${v2015Iso}: n = ${own.length}`
      ];
      if (ph.thin) {
        parts.push(
          `fewer than ${cal.nSpellsMin} ${p} spells since ${v2015Iso}: θ = 1 (pure pooled)`
        );
      }
      if (ph.capped > 0) {
        parts.push(`scaled hazards capped at 1 at ${ph.capped} pooled event durations`);
      }
      parts.push(pre2015);
      if (pooledW && ownW) {
        parts.push(
          `${pooledW.X} completions without a construction start (no FCD) kept in incidence, durations from histories with an FCD (rule sc.stages.no-fcd-duration): X=${pooledW.X}, A=${pooledW.A}, w=${fmt(pooledW.w)} pooled; X=${ownW.X}, A=${ownW.A}, w=${fmt(ownW.w)} for ${p} since ${v2015Iso}`
        );
      }
      if (stage === 'construction') parts.push(COMPLETION_DATING);
      parts.push(...imputeSentence(g), ...purgeSentence(k), ...partialNotes);
      const provenance: Provenance = {
        tier: 2,
        label: `SF permit records ${fromIso.slice(0, 4)}–${asOfYear}, pooled across pathways before 2015, scaled to ${p} ${v2015Iso.slice(0, 4)}–${asOfYear} (tier 2)`,
        sources: permitSources(stage),
        method: parts.join('; '),
        n: pooled.length,
        window
      };
      transitions[p][stage] = buildTransition(
        ph,
        reasons,
        provenance,
        tailProv(provenance, ph.months, pooledTail.k0, pooledTail.observedEvents, true)
      );
      const theta: Partial<Record<Outcome, number>> = {};
      for (const j of OUTCOMES) theta[j] = ph.theta[j];
      if (!ph.thin && ph.maxDiff > 0.05) {
        warnings.push(
          `θ diagnostic: ${p} ${stage} max |scaled − own 2015+ AJ| = ${fmt(ph.maxDiff)} > 0.05`
        );
      }
      cells.push({
        pathway: p,
        stage,
        rung: 'ph',
        tier: 2,
        n: pooled.length,
        events: pooledEvents,
        window,
        months: ph.months,
        k0: pooledTail.k0,
        tailEvents: pooledTail.observedEvents,
        pathwaySpells: own.length,
        theta,
        thin: ph.thin,
        maxDiff: ph.maxDiff,
        capped: ph.capped,
        cappedInTable: ph.cappedInTable,
        ...(noFcd ? { noFcd } : {}),
        purgeCensored: k,
        gapImputed: g
      });
    }
  }

  const rank = (c: CellReport) =>
    PATHWAYS.indexOf(c.pathway) * STAGE_ORDER.length + STAGE_ORDER.indexOf(c.stage);
  cells.sort((a, b) => rank(a) - rank(b));
  const rung3Count = cells.filter((c) => c.rung === 3).length;
  return {
    transitions,
    cells,
    warnings,
    rung3: rung3Count,
    ppaPooled,
    spellsCount,
    noFcdFlaggedPooled,
    coverage,
    coveragePartial
  };
}
