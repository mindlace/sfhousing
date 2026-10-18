/**
 * Qualifying predicate, normalisation steps 1-4 and spell building (stage-calibration spec §4.4).
 * Steps 1-3 are the registered `sc.*` rules (counted here, recorded by the build through
 * `recordQuality`); step 4 is a method count. Values change only in memory: `src` stays as read.
 */
import { isoToDay } from '../../project-records/multiphase';
import {
  PATHWAYS,
  STAGE_ORDER,
  pathwayStages,
  type Day,
  type ExitReason,
  type ProjectHistory,
  type Stage
} from '../../../src/lib/timelapse/types';
import { PLANNING_START, PERMIT_POOLED_START, windowStart } from './window';
import type { CalStage, NormHistory, RuleTally, ScRuleId, Spell, Tallies } from './types';

type StepRule = 'sc.stages.gap-impute' | 'sc.stages.running-max' | 'sc.exit.last-stage';

/** Net units at the first recorded stage (STAGE_ORDER order) of at least 1. */
export function qualifies(h: ProjectHistory): boolean {
  for (const s of STAGE_ORDER) {
    const u = h.unitsAt[s];
    if (typeof u === 'number' && Number.isFinite(u)) return u - h.existingUnits >= 1;
  }
  return false;
}

const stageIndex = (s: Stage): number => STAGE_ORDER.indexOf(s);

function emptyTally(of: number): RuleTally {
  return { fired: 0, of, sample: [] };
}

/**
 * Steps 1-4 of §4.4 in order, on qualifying histories sorted by id. Only the stages of the
 * history's pathway (`STAGE_ORDER` for a null pathway) are read; other `entered` keys are ignored.
 */
export function normalise(
  hs: ProjectHistory[],
  asOf: Day
): {
  norm: NormHistory[];
  tallies: Pick<Tallies, StepRule>;
  method: { permitOnlyPre2015: { fired: number; of: number }; ppaPooled: number };
  perStage: Record<ScRuleId, Partial<Record<Stage, number>>>;
} {
  void asOf;
  const exitsOf = hs.filter((h) => h.end.kind === 'exit').length;
  const tallies: Pick<Tallies, StepRule> = {
    'sc.stages.gap-impute': emptyTally(hs.length),
    'sc.stages.running-max': emptyTally(hs.length),
    'sc.exit.last-stage': emptyTally(exitsOf)
  };
  const perStage: Record<ScRuleId, Partial<Record<Stage, number>>> = {
    'sc.stages.gap-impute': {},
    'sc.stages.running-max': {},
    'sc.exit.last-stage': {},
    'sc.exit.purge-censor': {},
    'sc.revision.ratio-clamp': {}
  };
  const method = {
    permitOnlyPre2015: { fired: 0, of: 0 },
    ppaPooled: 0
  };
  const preDay = isoToDay(PLANNING_START);

  const fire = (rule: StepRule, id: string, stage: Stage) => {
    perStage[rule][stage] = (perStage[rule][stage] ?? 0) + 1;
    const t = tallies[rule];
    if (t.sample[t.sample.length - 1] !== id) {
      t.fired++;
      t.sample.push(id);
    }
  };

  const norm: NormHistory[] = hs.map((h) => {
    const used = h.pathway ? pathwayStages(h.pathway) : [...STAGE_ORDER];
    const observed: Partial<Record<Stage, Day>> = {};
    for (const s of used) {
      const d = h.entered[s];
      if (d !== undefined) observed[s] = d;
    }

    // Step 1: a missing stage with a later entered stage (complete counts) takes the next
    // entered stage's day. preApplication is optional on every pathway and is never imputed.
    const eff: Partial<Record<Stage, Day>> = { ...observed };
    let nextDay: Day | undefined;
    for (let i = used.length - 1; i >= 0; i--) {
      const s = used[i];
      if (observed[s] !== undefined) {
        nextDay = observed[s];
      } else if (nextDay !== undefined && s !== 'preApplication') {
        eff[s] = nextDay;
        fire('sc.stages.gap-impute', h.id, s);
      }
    }

    // Step 2: running maximum over the entered stages.
    let run = -Infinity;
    for (const s of used) {
      const v = eff[s];
      if (v === undefined) continue;
      if (v < run) {
        eff[s] = run;
        fire('sc.stages.running-max', h.id, s);
      } else {
        run = v;
      }
    }

    // Step 3: an exit applies at the last entered stage, no earlier than that stage's start.
    let end = h.end;
    if (end.kind === 'exit') {
      let last: Stage | undefined;
      for (const s of used) if (eff[s] !== undefined) last = s;
      if (last !== undefined) {
        const day = Math.max(end.day, eff[last] as Day);
        if (last !== end.stage || day !== end.day) {
          end = { kind: 'exit', stage: last, reason: end.reason, day };
          fire('sc.exit.last-stage', h.id, last);
        }
      }
    }

    // Step 4: a permit-only history filed before 2015 counts as pathway unknown.
    let pathway = h.pathway;
    if (h.pathway === 'permitOnly') {
      method.permitOnlyPre2015.of++;
      const pf = eff.permitFiled;
      if (pf !== undefined && pf < preDay) {
        pathway = null;
        method.permitOnlyPre2015.fired++;
      }
    }

    return {
      id: h.id,
      pathway,
      parcelIds: h.parcelIds,
      eff,
      end,
      purgeCensored: false,
      src: h
    };
  });

  return { norm, tallies, method, perStage };
}

interface RawSpell {
  stage: CalStage;
  e: Day;
  z: Day;
  outcome: Spell['outcome'];
}

/** Every entered non-terminal stage's spell, before any window cut. */
function rawSpells(h: NormHistory, asOf: Day): RawSpell[] {
  const entered = STAGE_ORDER.filter((s) => h.eff[s] !== undefined);
  const out: RawSpell[] = [];
  entered.forEach((s, i) => {
    if (s === 'complete') return;
    const e = h.eff[s] as Day;
    const next = entered[i + 1];
    let z: Day;
    let outcome: Spell['outcome'];
    if (next !== undefined) {
      z = h.eff[next] as Day;
      outcome = 'advance';
    } else if (h.end.kind === 'exit' && h.purgeCensored) {
      z = Math.min(h.end.day, asOf);
      outcome = 'censored';
    } else if (h.end.kind === 'exit') {
      z = h.end.day;
      outcome = h.end.reason satisfies ExitReason;
    } else if (h.end.kind === 'complete') {
      z = h.end.day;
      outcome = 'advance';
    } else {
      z = Math.min(h.end.lastObserved, asOf);
      outcome = 'censored';
    }
    out.push({ stage: s, e, z: Math.max(z, e), outcome });
  });
  return out;
}

const pathwayRank = (p: Spell['pathway']): number =>
  p === null ? PATHWAYS.length : PATHWAYS.indexOf(p);

/** Spells at the pooled window starts (§4.4 "Spells"), sorted by (pathway, stage, project id). */
export function buildSpells(norm: NormHistory[], asOf: Day): Spell[] {
  const spells: Spell[] = [];
  for (const h of norm) {
    for (const r of rawSpells(h, asOf)) {
      const v = windowStart(r.stage, 'pooled');
      if (r.z < v || r.e >= asOf) continue;
      spells.push({
        pathway: h.pathway,
        stage: r.stage,
        a: Math.max(0, v - r.e),
        e: r.e,
        x: r.z - r.e,
        outcome: r.outcome,
        projectId: h.id
      });
    }
  }
  return spells.sort(
    (p, q) =>
      pathwayRank(p.pathway) - pathwayRank(q.pathway) ||
      stageIndex(p.stage) - stageIndex(q.stage) ||
      (p.projectId < q.projectId ? -1 : p.projectId > q.projectId ? 1 : 0)
  );
}

/** Re-cuts spells to a later window start: drops those ending before `from`, recomputes `a`. */
export function cutSpells(spells: Spell[], from: Day): Spell[] {
  return spells.filter((s) => s.e + s.x >= from).map((s) => ({ ...s, a: Math.max(0, from - s.e) }));
}

/** Histories with no spell ending on or after the first assessor roll (`calibration.window.preRoll`). */
export function preRollCount(norm: NormHistory[]): number {
  const roll = isoToDay(PERMIT_POOLED_START);
  let n = 0;
  for (const h of norm) {
    if (!rawSpells(h, Number.POSITIVE_INFINITY).some((r) => r.z >= roll)) n++;
  }
  return n;
}
