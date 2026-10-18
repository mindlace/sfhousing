/**
 * Permit-side pathway levels (stage-calibration spec §4.5 "Permit-side stages"): a stratified
 * proportional-hazards scaling of the pooled Aalen–Johansen table. The pooled cell (every
 * qualifying spell since 2007-01-01, any pathway) gives the shape; one ratio per outcome,
 * θ_j = (O_j + κ) / (E_j + κ), fitted on the pathway's spells since 2015-01-01, gives the level.
 */
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import type { ExitReason, Transition } from '../../../src/lib/timelapse/types';
import {
  OUTCOMES,
  ajSweep,
  ajTable,
  atRisk,
  riskIndex,
  type AjSweep,
  type Outcome
} from './aalen-johansen';
import { cutSpells } from './spells';
import { tailFit } from './tail';
import { windowStart } from './window';
import { CalibrationError, type CalProfile, type Spell } from './types';

export type Theta = Record<Outcome, number>;

export interface PhScaled {
  theta: Theta;
  /** fewer than `nSpellsMin` pathway spells since 2015: θ = 1, the pooled table */
  thin: boolean;
  /** the pooled table's */
  months: number;
  advance: number[];
  exit: Partial<Record<ExitReason, number[]>>;
  tail: Transition['tail'];
  /** pooled grid points where Σ_j θ_j·ĥ_j exceeded 1 and was scaled down to 1 */
  capped: number;
  /**
   * max |scaled − the pathway's own 2015+ AJ| over months 1..min(both months) and every outcome
   * (the report's diagnostic; the build warns above 0.05). 0 when the own table has no months.
   */
  maxDiff: number;
}

const perOutcome = <T>(make: () => T): Record<Outcome, T> => {
  const r = {} as Record<Outcome, T>;
  for (const j of OUTCOMES) r[j] = make();
  return r;
};

/**
 * The AJ recursion on the pooled grid with h_j(i) = θ_j·e_j(i)/n(i). Where Σ_j h_j(i) > 1 every
 * h_j(i) is scaled down so the sum (taken in `OUTCOMES` order, as `ajTable` takes it) is at most
 * 1, which keeps S >= 0; `capped` counts those grid points over the whole sweep. With θ = 1 this
 * is exactly `ajTable`'s default table.
 */
export function scaledTable(
  sw: AjSweep,
  theta: Theta,
  kMax: number,
  nRiskMin: number,
  spellsAll: Spell[]
): ReturnType<typeof ajTable> & { capped: number } {
  const H = perOutcome<number[]>(() => []);
  let capped = 0;
  for (let i = 0; i < sw.d.length; i++) {
    let sum = 0;
    for (const j of OUTCOMES) {
      const h = theta[j] * (sw.e[j][i] / sw.n[i]);
      H[j].push(h);
      sum += h;
    }
    if (sum <= 1) continue;
    capped++;
    let c = 1 / sum;
    for (;;) {
      let s = 0;
      for (const j of OUTCOMES) s += H[j][i] * c;
      if (s <= 1) break;
      c *= 1 - Number.EPSILON;
    }
    for (const j of OUTCOMES) H[j][i] *= c;
  }
  const table = ajTable(sw, (j, i) => H[j][i], kMax, nRiskMin, spellsAll);
  return { ...table, capped };
}

/** Person-days of the spells at durations >= `from`: Σ max(0, x − max(a, from)). */
function exposureFrom(spells: Spell[], from: number): number {
  let days = 0;
  for (const s of spells) {
    const start = s.a > from ? s.a : from;
    if (s.x > start) days += s.x - start;
  }
  return days;
}

/** The one stage every spell is in (undefined when there are none). */
function oneStage(spells: Spell[]): Spell['stage'] | undefined {
  const stage = spells[0]?.stage;
  for (const s of spells) {
    if (s.stage !== stage) {
      throw new CalibrationError(`phScale needs spells of one stage, got ${stage} and ${s.stage}`);
    }
  }
  return stage;
}

/**
 * Spec §4.5 permit side. `pooled` is the cell's pooled spells in [Wₛ, asOf]; `pathwaySpells2015`
 * the pathway's spells, re-cut here at the pathway window start (2015-01-01; idempotent on
 * spells already cut there). The pooled sweep gives ĥ_j(d) = e_j(d)/n(d), the pooled table's
 * `months` and its tail (k₀, λ_j). The expected count E_j splits at the pooled tail span start
 * (k₀ − 1)·M, so no duration is counted twice:
 *   E_j = Σ_{d < (k₀−1)M} nₚ(d)·ĥ_j(d) + (pathway person-months from (k₀−1)M)·λ_j,
 * and O_j counts every pathway j event. For pathway spells identical to the pooled ones this
 * gives E_j = O_j exactly (the tail λ_j is occurrence/exposure over that same span).
 * θ_j = (O_j + κ)/(E_j + κ), κ = `phPrior`; a thin pathway keeps θ = 1. The table re-runs the AJ
 * recursion with θ_j·ĥ_j (capped, `scaledTable`); the tail is the pooled tail with λ_j scaled by
 * θ_j. Every exit reason gets an array and a tail value, in `EXIT_ORDER`: dropping reasons with
 * no events is the caller's, as for `ajTable` and `tailFit`.
 */
export function phScale(pooled: Spell[], pathwaySpells2015: Spell[], cal: CalProfile): PhScaled {
  const stage = oneStage([...pooled, ...pathwaySpells2015]);
  const own = stage === undefined ? [] : cutSpells(pathwaySpells2015, windowStart(stage, 'pathway'));

  const sw = ajSweep(pooled);
  const { months } = ajTable(sw, undefined, cal.kMax, cal.nRiskMin, pooled);
  const pooledTail = tailFit(pooled, months, cal);

  const thin = own.length < cal.nSpellsMin;
  const theta = perOutcome(() => 1);
  if (!thin) {
    const from = (pooledTail.k0 - 1) * MONTH_DAYS;
    const idx = riskIndex(own);
    const E = perOutcome(() => 0);
    for (let i = 0; i < sw.d.length && sw.d[i] < from; i++) {
      const np = atRisk(idx, sw.d[i]);
      if (np === 0) continue;
      for (const j of OUTCOMES) E[j] += np * (sw.e[j][i] / sw.n[i]);
    }
    const personMonths = exposureFrom(own, from) / MONTH_DAYS;
    const O = perOutcome(() => 0);
    for (const s of own) if (s.outcome !== 'censored') O[s.outcome]++;
    const k = cal.phPrior;
    for (const j of OUTCOMES) {
      E[j] += personMonths * pooledTail.lambda[j];
      theta[j] = (O[j] + k) / (E[j] + k);
    }
  }

  const table = scaledTable(sw, theta, cal.kMax, cal.nRiskMin, pooled);
  const { tail } = tailFit(pooled, months, cal, theta);

  const self = ajTable(ajSweep(own), undefined, cal.kMax, cal.nRiskMin, own);
  const common = Math.min(months, self.months);
  let maxDiff = 0;
  for (let m = 0; m < common; m++) {
    for (const j of OUTCOMES) {
      const p = j === 'advance' ? table.advance[m] : table.exit[j]![m];
      const q = j === 'advance' ? self.advance[m] : self.exit[j]![m];
      const diff = Math.abs(p - q);
      if (diff > maxDiff) maxDiff = diff;
    }
  }

  return {
    theta,
    thin,
    months,
    advance: table.advance,
    exit: table.exit,
    tail,
    capped: table.capped,
    maxDiff
  };
}
