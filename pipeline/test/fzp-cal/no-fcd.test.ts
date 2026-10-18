// No-FCD completions: incidence kept, durations from histories with an FCD (partner ruling P1,
// controller ruling R13 with the conductor's guard; stage-calibration spec §4.4 step 1).
import { describe, expect, it } from 'vitest';
import { OUTCOMES, ajSweep } from '../../lib/fzp-cal/aalen-johansen';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import { weightAdvances } from '../../lib/fzp-cal/no-fcd';
import type { CalStage, Spell, UnobservedAdvance } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';

const V2007 = isoToDay('2007-01-01');
const AS_OF = isoToDay('2026-06-30');
const E0 = isoToDay('2012-01-01');

let seq = 0;
function spell(x: number, outcome: Spell['outcome'], stage: CalStage = 'construction'): Spell {
  seq++;
  return {
    pathway: 'discretionary',
    stage,
    a: 0,
    e: E0,
    x,
    outcome,
    projectId: `s${String(seq).padStart(5, '0')}`
  };
}

function unobserved(
  n: number,
  stage: UnobservedAdvance['stage'] = 'construction',
  complete = isoToDay('2015-01-01'),
  enteredPermitIssued = isoToDay('2013-01-01')
): UnobservedAdvance[] {
  return Array.from({ length: n }, (_, i) => ({
    projectId: `u${stage}${i}`,
    pathway: 'discretionary',
    stage,
    complete,
    enteredPermitIssued
  }));
}

const advances = (n: number, stage: CalStage = 'construction') =>
  Array.from({ length: n }, (_, i) => spell(100 * (i + 1), 'advance', stage));

describe('weightAdvances', () => {
  it('10 advances and 5 unobserved: every advance gets w = 1.5', () => {
    const r = weightAdvances(
      advances(10),
      unobserved(5),
      'construction',
      V2007,
      AS_OF,
      FIXTURE_CAL
    );
    expect(r.spells.map((s) => s.w)).toEqual(new Array(10).fill(1.5));
    expect({ X: r.X, A: r.A, w: r.w, added: r.added, dropped: r.dropped }).toEqual({
      X: 5,
      A: 10,
      w: 1.5,
      added: 5,
      dropped: 0
    });
    expect(r.flagged).toBe(false);
  });

  it('exit and censored spells keep weight 1 (no w), and order is kept', () => {
    const cell = [spell(50, 'advance'), spell(60, 'cancelled'), spell(70, 'censored')];
    const r = weightAdvances(cell, unobserved(1), 'construction', V2007, AS_OF, FIXTURE_CAL);
    expect(r.spells.map((s) => [s.projectId, s.w])).toEqual([
      [cell[0].projectId, 2],
      [cell[1].projectId, undefined],
      [cell[2].projectId, undefined]
    ]);
    expect(cell[0].w).toBeUndefined();
  });

  it('A = 0 drops X: the cell fits without them, counted in dropped', () => {
    const cell = [spell(60, 'cancelled'), spell(70, 'censored')];
    const r = weightAdvances(cell, unobserved(3), 'construction', V2007, AS_OF, FIXTURE_CAL);
    expect(r.spells).toEqual(cell);
    expect({ X: r.X, A: r.A, w: r.w, added: r.added, dropped: r.dropped }).toEqual({
      X: 3,
      A: 0,
      w: 1,
      added: 0,
      dropped: 3
    });
  });

  it('X = 0 leaves the spells unweighted', () => {
    const cell = advances(4);
    const r = weightAdvances(cell, [], 'construction', V2007, AS_OF, FIXTURE_CAL);
    expect(r.spells).toEqual(cell);
    expect(r.spells.every((s) => s.w === undefined)).toBe(true);
    expect(r.w).toBe(1);
  });

  it('cell membership: construction iff complete >= V; permitIssued also needs entry < asOf', () => {
    const late = isoToDay('2016-01-01');
    const u = [
      ...unobserved(2, 'construction', isoToDay('2015-01-01')),
      ...unobserved(1, 'construction', isoToDay('2014-12-31')),
      ...unobserved(1, 'permitIssued', isoToDay('2015-06-01'), isoToDay('2014-01-01'))
    ];
    const c = weightAdvances(
      advances(4),
      u,
      'construction',
      isoToDay('2015-01-01'),
      AS_OF,
      FIXTURE_CAL
    );
    expect(c.X).toBe(2);
    const p = [
      ...unobserved(1, 'permitIssued', isoToDay('2015-06-01'), isoToDay('2014-01-01')),
      ...unobserved(1, 'permitIssued', isoToDay('2014-06-01'), isoToDay('2014-01-01')),
      ...unobserved(1, 'permitIssued', late + 30, late)
    ];
    const pi = weightAdvances(
      advances(4, 'permitIssued'),
      p,
      'permitIssued',
      isoToDay('2015-01-01'),
      late,
      FIXTURE_CAL
    );
    expect(pi.X).toBe(1);
    expect(pi.w).toBe(1.25);
  });

  it('flags a cell with w > 1.5 or fewer than nEventsMin observed advances', () => {
    const heavy = weightAdvances(
      advances(10),
      unobserved(6),
      'construction',
      V2007,
      AS_OF,
      FIXTURE_CAL
    );
    expect(heavy.w).toBe(1.6);
    expect(heavy.flagged).toBe(true);
    const thin = weightAdvances(
      advances(10),
      unobserved(1),
      'construction',
      V2007,
      AS_OF,
      LIVE_CAL
    );
    expect(thin.w).toBe(1.1);
    expect(thin.flagged).toBe(true); // A = 10 < 20
    const ok = weightAdvances(advances(40), unobserved(10), 'construction', V2007, AS_OF, LIVE_CAL);
    expect(ok.flagged).toBe(false);
  });

  it('guard: a flagged pathway subset takes the pooled cell its w (pooled A 40, X 10)', () => {
    const pooled = weightAdvances(
      advances(40),
      unobserved(10),
      'construction',
      V2007,
      AS_OF,
      LIVE_CAL
    );
    expect(pooled.w).toBe(1.25);
    expect(pooled.flagged).toBe(false);
    const sub = weightAdvances(
      advances(4),
      unobserved(3),
      'construction',
      isoToDay('2015-01-01'),
      AS_OF,
      LIVE_CAL,
      pooled.w
    );
    expect(sub.flagged).toBe(true); // own w = 1.75 and A = 4 < 20
    expect({ X: sub.X, A: sub.A, w: sub.w }).toEqual({ X: 3, A: 4, w: 1.25 });
    expect(sub.spells.map((s) => s.w)).toEqual([1.25, 1.25, 1.25, 1.25]);
    expect(sub.added).toBe(1);
    // an unflagged subset keeps its own w even when a pooled w is passed
    const own = weightAdvances(
      advances(40),
      unobserved(4),
      'construction',
      V2007,
      AS_OF,
      LIVE_CAL,
      1.25
    );
    expect(own.w).toBe(1.1);
  });

  it('R19: a flagged subset with X = 0 keeps w = 1 even when a pooled w is passed', () => {
    const cell = advances(4);
    const sub = weightAdvances(
      cell,
      unobserved(2, 'construction', isoToDay('2014-06-01')), // before the 2015 cut: X = 0
      'construction',
      isoToDay('2015-01-01'),
      AS_OF,
      LIVE_CAL,
      1.25
    );
    expect(sub.flagged).toBe(true); // A = 4 < 20
    expect({ X: sub.X, A: sub.A, w: sub.w, added: sub.added }).toEqual({
      X: 0,
      A: 4,
      w: 1,
      added: 0
    });
    expect(sub.spells).toBe(cell);
  });

  it('a construction-only unobserved advance (no permitIssued entry) counts in construction', () => {
    const u: UnobservedAdvance[] = [
      { projectId: 'nc', pathway: null, stage: 'construction', complete: isoToDay('2015-01-01') }
    ];
    const r = weightAdvances(advances(4), u, 'construction', V2007, AS_OF, FIXTURE_CAL);
    expect(r.X).toBe(1);
    expect(r.w).toBe(1.25);
  });

  it('rejects spells of another stage', () => {
    expect(() =>
      weightAdvances(
        [spell(10, 'advance', 'permitIssued')],
        [],
        'construction',
        V2007,
        AS_OF,
        LIVE_CAL
      )
    ).toThrow(/construction/);
  });

  it('AJ on 10 advances, 10 exits and 5 unobserved: eventual advance share 15/25 (no censoring)', () => {
    const cell = [
      ...advances(10),
      ...Array.from({ length: 10 }, (_, i) => spell(150 + 100 * i, 'withdrawn'))
    ];
    const r = weightAdvances(cell, unobserved(5), 'construction', V2007, AS_OF, FIXTURE_CAL);
    const sw = ajSweep(r.spells);
    expect(sw.n[0]).toBe(25);
    expect(sw.events.advance).toBe(15);
    const F: Record<string, number> = {};
    for (const j of OUTCOMES) F[j] = 0;
    let S = 1;
    for (let i = 0; i < sw.d.length; i++) {
      let sum = 0;
      for (const j of OUTCOMES) {
        const h = sw.e[j][i] / sw.n[i];
        F[j] += S * h;
        sum += h;
      }
      S *= 1 - sum;
    }
    expect(Math.abs(F.advance - 15 / 25)).toBeLessThan(1e-12);
    expect(Math.abs(F.withdrawn - 10 / 25)).toBeLessThan(1e-12);
    expect(Math.abs(S)).toBeLessThan(1e-12);
  });
});
