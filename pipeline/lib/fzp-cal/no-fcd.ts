/**
 * No-FCD completions in the permit-side cells (partner ruling P1; controller ruling R13 with the
 * conductor's guard; stage-calibration spec §4.4 step 1, rule `sc.stages.no-fcd-duration`).
 *
 * A completion with no construction start passed permitIssued → construction → complete, but its
 * time in those two stages is unobserved. Missing at random among advancers: in each fitted
 * (window, pathway-subset) cell its observed advance spells are up-weighted so that their total
 * weight is A + X, observed advances plus the cell's no-FCD completions; each advance gets
 * w = 1 + X/A. Exits and censored spells keep weight 1. Equivalently, each no-FCD completion is a
 * clone, split evenly, of the cell's observed advancers.
 */
import { CalibrationError, type CalProfile, type Spell, type UnobservedAdvance } from './types';

export interface AdvanceWeighting {
  /** the cell's spells, in input order; advances carry `w` when it is not 1 */
  spells: Spell[];
  /** weight added to the advances, A·(w − 1): X with the cell's own w */
  added: number;
  /** X when A = 0: the cell fits without its no-FCD completions (reported) */
  dropped: number;
  /** no-FCD completions in the cell */
  X: number;
  /** observed advance spells in the cell */
  A: number;
  /** the weight applied to every advance */
  w: number;
  /**
   * The conductor's guard: w > 1.5 or A < `nEventsMin`, on the cell's own X and A (A counts
   * observed records, ruling R18). The caller pools a flagged pathway-level subset (passing the
   * pooled cell's w) and stops on a flagged pooled cell.
   */
  flagged: boolean;
}

/**
 * Weights the advances of one `permitIssued` or `construction` cell. `spells` is the cell's
 * spells (one stage, already cut at the window start `from`), `unobserved` the no-FCD advances of
 * the same pathway subset. A no-FCD completion is in the cell iff it is of `stage`, its completion
 * day is >= `from` and, for `permitIssued`, it entered permitIssued before `asOf`. With A = 0 the
 * cell keeps its spells and drops X. `pooledW` is the pooled cell's w: a flagged subset takes it
 * instead of its own (the guard's pooling before weighting) when its own X > 0 (ruling R19: a
 * flagged subset with no no-FCD completions keeps w = 1); an unflagged cell ignores it.
 */
export function weightAdvances(
  spells: Spell[],
  unobserved: UnobservedAdvance[],
  stage: 'permitIssued' | 'construction',
  from: number,
  asOf: number,
  cal: CalProfile,
  pooledW?: number
): AdvanceWeighting {
  let A = 0;
  for (const s of spells) {
    if (s.stage !== stage) {
      throw new CalibrationError(
        `weightAdvances(${stage}) got a ${s.stage} spell (${s.projectId})`
      );
    }
    if (s.outcome === 'advance') A++;
  }
  let X = 0;
  for (const u of unobserved) {
    if (u.stage !== stage || u.complete < from) continue;
    if (stage === 'permitIssued') {
      const entered = u.enteredPermitIssued;
      if (entered === undefined || entered >= asOf) continue;
    }
    X++;
  }

  const own = A > 0 ? 1 + X / A : 1;
  const flagged = own > 1.5 || A < cal.nEventsMin;
  // R19: only a subset with its own no-FCD completions (X > 0) takes the pooled w.
  const w = A === 0 ? 1 : flagged && X > 0 && pooledW !== undefined ? pooledW : own;
  const dropped = A === 0 ? X : 0;
  if (w === 1) return { spells, added: 0, dropped, X, A, w, flagged };

  return {
    spells: spells.map((s) => (s.outcome === 'advance' ? { ...s, w } : s)),
    added: A * (w - 1),
    dropped,
    X,
    A,
    w,
    flagged
  };
}
