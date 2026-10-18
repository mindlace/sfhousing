// V28 regression (fix-v28): the initiation fit on the panel shape after scenario-data decoupled
// hostable_base from the density cap. The at-risk set doubled with parcel-months that have
// potentialRatio 0 (about 60% of exposure before 2023, 5% from 2023) and almost no events, beside
// a thin high-hazard improvementShare bin. The undamped Newton step overshot to a fit with
// hazard 0 in every cell (live: intercept -1.98743e14, back-cast 0 vs 697 / 390).
import { describe, expect, it } from 'vitest';
import { LIVE_CAL } from '../../lib/fzp-cal/config';
import {
  INITIAL_EDGES,
  TERM_ORDER,
  backcastGate,
  fitInitiation,
  type FzpApplication
} from '../../lib/fzp-cal/initiation';
import type { FitCell, PanelResult } from '../../lib/fzp-cal/panel';
import { initiationHazard } from '../../../src/lib/timelapse/model';
import type { FeatureId } from '../../../src/lib/timelapse/types';

/** Live marginals (calibration report, 2026-10-17-4000b4e3): raw bin, exposure, events. */
const PR: [number, number, number][] = [
  [0, 17533585, 44],
  [1, 1984832, 188],
  [3, 5126810, 175],
  [4, 5141817, 172],
  [5, 1592899, 147],
  [6, 577017, 76],
  [7, 958216, 285]
];
const IS: [number, number, number][] = [
  [0, 827923, 464],
  [1, 613657, 101],
  [2, 7612573, 234],
  [3, 13205063, 200],
  [4, 7908023, 65],
  [5, 2747937, 23]
];
const EXPOSURE = 32915176;
const EVENTS = 1087;
/** Share of a year's exposure with potentialRatio 0: before 2023, and from 2023. */
const ZERO_SHARE_PRE_2023 = 0.6;
const ZERO_SHARE_2023 = 0.05;
/** Raw bin of every other term (one bin each). */
const OTHER_BIN: Partial<Record<FeatureId, number>> = {
  existingUnits: 1,
  lotAreaM2: 2,
  yearBuilt: 3,
  storiesGap: 4,
  rentControlLikely: 0,
  landUseClass: 1
};

/**
 * 2007..2025, permit basis before 2015. potentialRatio and improvementShare are independent;
 * each cell's hazard is the product of the live per-bin rate ratios (permit era × 0.85), and its
 * events are the rounded expectation, so the panel is deterministic.
 */
function hostableShapePanel(): PanelResult {
  const cells = new Map<string, FitCell>();
  const events = { record: 0, permit: 0 };
  let exposureMonths = 0;
  const years: number[] = [];
  const base = EVENTS / EXPOSURE;
  const prNonZero = PR.slice(1).reduce((a, r) => a + r[1], 0);
  for (let y = 2007; y <= 2025; y++) {
    years.push(y);
    const basis: 0 | 1 = y < 2015 ? 1 : 0;
    const zero = y < 2023 ? ZERO_SHARE_PRE_2023 : ZERO_SHARE_2023;
    const yearExposure = EXPOSURE / 19;
    for (const [prBin, prExp, prEv] of PR) {
      const prShare = prBin === 0 ? zero : ((1 - zero) * prExp) / prNonZero;
      for (const [isBin, isExp, isEv] of IS) {
        const exposure = Math.round((yearExposure * prShare * isExp) / EXPOSURE);
        const rate = ((prEv / prExp) * (isEv / isExp)) / base;
        const e = Math.round(exposure * rate * (basis === 1 ? 0.85 : 1));
        const bins = TERM_ORDER.map((f) =>
          f === 'potentialRatio' ? prBin : f === 'improvementShare' ? isBin : OTHER_BIN[f]!
        );
        cells.set(`${y}|${bins.join(',')}|${basis}`, { bins, basis, exposure, events: e });
        exposureMonths += exposure;
        if (basis === 1) events.permit += e;
        else events.record += e;
      }
    }
  }
  return {
    cells,
    years,
    parcelYears: Math.round(exposureMonths / 12),
    parcelYearsExcluded: 0,
    parcelYearsExcludedByYear: {},
    exposureMonths,
    events,
    eventsOffPanel: 0,
    eventsCovered: 0,
    maxAtRisk: { potentialRatio: 25, storiesGap: 4 },
    mask: {
      exposure: [0, 0, 0, 0, 0, 0, 0],
      events: [0, 0, 0, 0, 0, 0, 0],
      anyExposure: 0,
      anyEvents: 0
    }
  };
}

/** A parcel whose raw bins are the panel's, with the given potentialRatio. */
function parcel(potentialRatio: number): Record<FeatureId, number> {
  const f = {} as Record<FeatureId, number>;
  for (const id of TERM_ORDER) f[id] = INITIAL_EDGES[id][OTHER_BIN[id] ?? 0];
  f.potentialRatio = potentialRatio;
  f.improvementShare = 0.3;
  return f;
}

const FZP: FzpApplication = { features: (i) => parcel([0, 2.5, 25][i]), hostable: [0, 1, 2] };
const NO_CTX = { permitOnlyPre2015: { fired: 0, of: 0 } };

describe('fitInitiation on the decoupled-hostable panel shape (V28 regression)', () => {
  const panel = hostableShapePanel();

  it('has the reappraisal shape: ~60% potentialRatio-0 exposure before 2023, ~5% after', () => {
    const exp0 = [0, 0];
    const expAll = [0, 0];
    for (const [key, c] of panel.cells) {
      const late = Number(key.slice(0, 4)) >= 2023 ? 1 : 0;
      expAll[late] += c.exposure;
      if (c.bins[0] === 0) exp0[late] += c.exposure;
    }
    expect(exp0[0] / expAll[0]).toBeCloseTo(0.6, 2);
    expect(exp0[1] / expAll[1]).toBeCloseTo(0.05, 2);
    const total = panel.events.record + panel.events.permit;
    expect(total).toBeGreaterThanOrEqual(LIVE_CAL.initMinEvents as number);
    expect(panel.events.permit).toBeGreaterThan(0);
  });

  const { model, report } = fitInitiation(panel, LIVE_CAL, FZP, NO_CTX);

  it('back-casts each detection basis within 2% of observed, both non-zero (V28)', () => {
    expect(backcastGate(report).ok).toBe(true);
    for (const b of report.backcast.byBasis) {
      expect(b.observed).toBeGreaterThan(0);
      expect(b.predicted).toBeGreaterThan(0);
      expect(Math.abs(b.predicted - b.observed)).toBeLessThanOrEqual(0.02 * b.observed);
    }
  });

  it('has a sane intercept and basis coefficient', () => {
    // monthly base hazard ~ 3e-5: logit about -10.4
    expect(model.intercept).toBeGreaterThan(-15);
    expect(model.intercept).toBeLessThan(-5);
    expect(Math.abs(report.basis as number)).toBeLessThan(2);
    expect(report.iterations).toBeLessThanOrEqual(100);
  });

  it('potentialRatio 0 gets a small positive hazard, below the high-ratio bins', () => {
    const term = model.terms.find((t) => t.feature === 'potentialRatio');
    expect(term?.bins[0]).toBe(0);
    for (const c of term?.coef ?? []) expect(Number.isFinite(c)).toBe(true);
    const h0 = initiationHazard(model, parcel(0));
    const hHigh = initiationHazard(model, parcel(25));
    expect(h0).toBeGreaterThan(0);
    expect(h0).toBeLessThan(hHigh);
    expect(report.fzpPerYear).toBeGreaterThan(0);
    expect(report.impliedSteadyState).toBeGreaterThan(0);
  });

  it('the method states the potentialRatio 0 treatment (the bottom bin, a fitted hazard)', () => {
    const edges = model.terms.find((t) => t.feature === 'potentialRatio')?.bins ?? [];
    expect(model.provenance.method).toContain(
      `potentialRatio 0 (the density-capped base envelope yields no units) is a value, not missing: it takes the bottom potentialRatio bin [0, ${edges[1]}) and that bin's fitted hazard`
    );
  });
});
