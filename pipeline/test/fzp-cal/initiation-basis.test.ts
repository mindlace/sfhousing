// Initiation detection basis: record (F >= 2015) vs permit (raw first filing P) (spec §4.6).
import { describe, expect, it } from 'vitest';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import {
  INITIAL_EDGES,
  TERM_ORDER,
  backcastGate,
  fitInitiation,
  mergeBins,
  type FzpApplication
} from '../../lib/fzp-cal/initiation';
import {
  PANEL_FEATURES,
  firstFiledDays,
  initiationEvents,
  monthIndex,
  type FitCell,
  type PanelResult
} from '../../lib/fzp-cal/panel';
import { CalibrationError, type NormHistory, type PermitRow } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import { mulberry32 } from '../../../src/lib/generator/seed';
import { exp, log } from '../../../src/lib/timelapse/math';
import { initiationHazard } from '../../../src/lib/timelapse/model';
import type { Day, FeatureId, ProjectHistory, Stage } from '../../../src/lib/timelapse/types';

const d = isoToDay;
const m = (iso: string) => monthIndex(d(iso));
const noArea = () => 0;

function hist(
  id: string,
  entered: Partial<Record<Stage, Day>>,
  eff: Partial<Record<Stage, Day>> = entered
): NormHistory {
  const end: ProjectHistory['end'] = { kind: 'open', lastObserved: d('2026-09-30') };
  return {
    id,
    pathway: 'discretionary',
    parcelIds: ['A'],
    eff: { ...eff },
    end,
    purgeCensored: false,
    src: {
      id,
      pathway: 'discretionary',
      parcelIds: ['A'],
      entered,
      end,
      unitsAt: { filed: 10 },
      existingUnits: 0,
      storiesProposed: null,
      baseStoriesAtFiling: null,
      sources: [],
      quality: []
    }
  };
}

let seq = 0;
function permit(over: Partial<PermitRow>): PermitRow {
  seq++;
  return {
    permit_number: `P${seq}`,
    project_id: null,
    prj_record_id: null,
    dva_record_id: null,
    prx_case_no: null,
    da: null,
    parcel_ids: [],
    proposed_units: 50,
    site_permit: true,
    status: 'filed',
    live: true,
    superseded: false,
    filed_day: null,
    issued_day: null,
    construction_day: null,
    complete_day: null,
    status_day: null,
    ...over
  };
}

describe('firstFiledDays', () => {
  it('takes the minimum non-null filed_day per project, superseded refiles included', () => {
    const p = firstFiledDays([
      permit({ project_id: 'h', filed_day: d('2012-06-01') }),
      permit({ project_id: 'h', filed_day: d('2010-02-01'), superseded: true, live: false }),
      permit({ project_id: 'h', filed_day: null }),
      permit({ project_id: 'g', filed_day: null }),
      permit({ project_id: null, filed_day: d('2001-01-01') })
    ]);
    expect(p.get('h')).toBe(d('2010-02-01'));
    expect(p.has('g')).toBe(false);
    expect(p.size).toBe(1);
  });
});

describe('detection basis', () => {
  it('F >= 2015-01-01 is basis record with the event at F', () => {
    const ev = initiationEvents(
      [hist('h', { filed: d('2015-01-01') })],
      new Map([['h', d('2013-01-01')]]),
      noArea
    );
    expect(ev.timeline.get('A')?.[m('2015-01-01')]).toBe(1);
    expect(ev.timeline.get('A')?.[m('2013-01-01')]).toBe(0);
  });

  it('F < 2015 is basis permit with the event at P; months between F and P are at risk', () => {
    const ev = initiationEvents(
      [hist('h', { filed: d('2010-05-01') })],
      new Map([['h', d('2012-02-15')]]),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(t[m('2010-05-01')]).toBe(0);
    expect(t[m('2012-01-01')]).toBe(0);
    expect(t[m('2012-02-01')]).toBe(2);
    expect(t[m('2012-03-01')]).toBe(-1);
  });

  it('IA-11: two filings 2011-03-01 and 2012-06-01, permitFiled clamped to 2012-09-01', () => {
    const permits = [
      permit({ project_id: 'h', filed_day: d('2012-06-01') }),
      permit({ project_id: 'h', filed_day: d('2011-03-01') })
    ];
    const ev = initiationEvents(
      [hist('h', { permitFiled: d('2012-09-01') })],
      firstFiledDays(permits),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(t[m('2011-03-01')]).toBe(2);
    expect(t[m('2011-02-01')]).toBe(0);
    expect(t[m('2011-04-01')]).toBe(-1);
    expect(t[m('2012-09-01')]).toBe(-1);
  });

  it('a superseded refile filed earliest still sets P', () => {
    const permits = [
      permit({ project_id: 'h', filed_day: d('2013-07-01') }),
      permit({ project_id: 'h', filed_day: d('2009-11-20'), superseded: true, live: false })
    ];
    const ev = initiationEvents(
      [hist('h', { filed: d('2009-01-01') })],
      firstFiledDays(permits),
      noArea
    );
    expect(ev.timeline.get('A')?.[m('2009-11-01')]).toBe(2);
    expect(ev.timeline.get('A')?.[m('2013-07-01')]).toBe(-1);
  });

  it('no permit row before 2015: no event and no coverage', () => {
    const ev = initiationEvents([hist('h', { filed: d('2010-05-01') })], new Map(), noArea);
    expect(ev.noPermit).toBe(1);
    expect(Array.from(ev.timeline.get('A') ?? []).every((v) => v === 0)).toBe(true);
  });

  it('a P before the panel gives no event month and coverage from the panel start', () => {
    const ev = initiationEvents(
      [hist('h', { filed: d('2004-05-01') })],
      new Map([['h', d('2005-03-01')]]),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(ev.outOfRange).toBe(1);
    expect(Array.from(t).every((v) => v === -1)).toBe(true);
  });

  it('F is read from the raw entered days: an imputed earlier filed day does not move it', () => {
    // Raw: entitled 2014-03 then permitFiled 2016-02; gap imputation set eff.filed = entitled.
    const raw = { entitled: d('2014-03-01'), permitFiled: d('2016-02-01') };
    const ev = initiationEvents(
      [hist('h', raw, { ...raw, filed: d('2014-03-01') })],
      new Map([['h', d('2016-01-10')]]),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(t[m('2016-02-01')]).toBe(1);
    expect(t[m('2016-01-01')]).toBe(0);
    expect(t[m('2014-03-01')]).toBe(0);
  });
});

// ---- Task 13: bins, the fit with the measurement-basis term, back-cast and plausibility ----

const FEATURE_RAW: Record<FeatureId, number[]> = {
  potentialRatio: [1, 3],
  existingUnits: [1],
  lotAreaM2: [2],
  yearBuilt: [3],
  storiesGap: [1, 3],
  improvementShare: [2],
  rentControlLikely: [0],
  landUseClass: [1]
};
const TRUE_INTERCEPT = -4.5;
const TRUE_PR = 0.6; // potentialRatio high vs low
const TRUE_SG = 0.4; // storiesGap high vs low
const TRUE_BASIS = 0.7; // permit-era measurement offset

/** Features whose raw bins are `bins` (each bin's lower edge). */
function featuresOf(bins: number[]): Record<FeatureId, number> {
  const f = {} as Record<FeatureId, number>;
  TERM_ORDER.forEach((id, t) => (f[id] = INITIAL_EDGES[id][bins[t]]));
  return f;
}

/** A simulated panel: 2007..2025, permit basis (+0.7) before 2015, `perCell` months per cell. */
function simPanel(perCell: number, seed = 0x5eed): PanelResult {
  const rnd = mulberry32(seed);
  const cells = new Map<string, FitCell>();
  const events = { record: 0, permit: 0 };
  let exposureMonths = 0;
  const years: number[] = [];
  for (let y = 2007; y <= 2025; y++) {
    years.push(y);
    const basis: 0 | 1 = y < 2015 ? 1 : 0;
    for (const pr of FEATURE_RAW.potentialRatio) {
      for (const sg of FEATURE_RAW.storiesGap) {
        const bins = TERM_ORDER.map((f) =>
          f === 'potentialRatio' ? pr : f === 'storiesGap' ? sg : FEATURE_RAW[f][0]
        );
        const z =
          TRUE_INTERCEPT + (pr === 3 ? TRUE_PR : 0) + (sg === 3 ? TRUE_SG : 0) + basis * TRUE_BASIS;
        const q = 1 / (1 + exp(-z));
        let e = 0;
        for (let k = 0; k < perCell; k++) if (rnd() < q) e++;
        cells.set(`${y}|${bins.join(',')}|${basis}`, { bins, basis, exposure: perCell, events: e });
        exposureMonths += perCell;
        if (basis === 1) events.permit += e;
        else events.record += e;
      }
    }
  }
  return {
    cells,
    years,
    parcelYears: exposureMonths / 12,
    parcelYearsExcluded: 3,
    parcelYearsExcludedByYear: { 2007: 3 },
    exposureMonths,
    events,
    eventsOffPanel: 0,
    eventsCovered: 0,
    maxAtRisk: { potentialRatio: 4, storiesGap: 4 },
    mask: {
      exposure: [10, 0, 0, 0, 0, 0, 0],
      events: [1, 0, 0, 0, 0, 0, 0],
      anyExposure: 10,
      anyEvents: 1
    }
  };
}

/** Three FZP parcels: one inside historical support, two beyond it (potentialRatio, storiesGap). */
const FZP_BASE = featuresOf(TERM_ORDER.map((f) => FEATURE_RAW[f][0]));
const FZP_FEATURES = [
  FZP_BASE,
  { ...FZP_BASE, potentialRatio: 50 },
  { ...FZP_BASE, storiesGap: 9 }
];
const fzpApp: FzpApplication = { features: (i) => FZP_FEATURES[i], hostable: [2, 0, 1] };

describe('mergeBins', () => {
  it('the highest thin bin merges downward, repeatedly', () => {
    expect(mergeBins([0, 1, 2, 3], [20, 15, 3, 2], 10, false)).toEqual({
      edges: [0, 1],
      map: [0, 1, 1, 1]
    });
  });

  it('then the bottom bin merges upward', () => {
    expect(mergeBins([0, 1, 2], [3, 20, 20], 10, false)).toEqual({
      edges: [0, 2],
      map: [0, 0, 1]
    });
  });

  it('a thin middle bin merges downward too', () => {
    expect(mergeBins([0, 1, 2, 3], [20, 4, 20, 20], 10, false)).toEqual({
      edges: [0, 2, 3],
      map: [0, 0, 1, 2]
    });
  });

  it('a categorical feature is returned unchanged', () => {
    expect(mergeBins([0, 1, 2, 3, 4, 5], [0, 1, 0, 50, 0, 2], 10, true)).toEqual({
      edges: [0, 1, 2, 3, 4, 5],
      map: [0, 1, 2, 3, 4, 5]
    });
  });

  it('TERM_ORDER is the panel feature order', () => {
    expect(TERM_ORDER).toEqual([...PANEL_FEATURES]);
  });
});

const NO_CTX = { permitOnlyPre2015: { fired: 0, of: 0 } };

describe('fitInitiation', () => {
  const panel = simPanel(30_000);
  const { model, report } = fitInitiation(panel, LIVE_CAL, fzpApp, NO_CTX);
  const term = (f: FeatureId) => {
    const t = model.terms.find((x) => x.feature === f);
    if (!t) throw new Error(`no term ${f}`);
    return t;
  };

  it('publishes intercept and bin coefficients only: the basis coefficient is not shipped', () => {
    expect(Object.keys(model)).toEqual(['kind', 'intercept', 'terms', 'provenance']);
    expect(model.terms.map((t) => t.feature)).toEqual(TERM_ORDER);
    for (const t of model.terms) expect(Object.keys(t)).toEqual(['feature', 'bins', 'coef']);
    expect(model.provenance.tier).toBe(2);
    expect(model.provenance.window).toEqual(['2007-01-01', '2025-12-31']);
    expect(model.provenance.n).toBe(panel.events.record + panel.events.permit);
    expect(model.provenance.method).toContain(
      'this is not a market adjustment; basis coefficient = '
    );
    expect(model.provenance.method).toContain(String(report.basis));
  });

  it('publishes the merged edges', () => {
    expect(term('potentialRatio').bins).toEqual([0, 2]);
    expect(term('storiesGap').bins).toEqual([-100, 2]);
    expect(term('existingUnits').bins).toEqual([0]);
    expect(term('rentControlLikely').bins).toEqual([0, 1]);
    expect(term('landUseClass').bins).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('recovers the feature coefficients within 0.05 with a +0.7 permit-era basis offset', () => {
    const pr = term('potentialRatio').coef;
    const sg = term('storiesGap').coef;
    expect(Math.abs(pr[1] - pr[0] - TRUE_PR)).toBeLessThan(0.05);
    expect(Math.abs(sg[1] - sg[0] - TRUE_SG)).toBeLessThan(0.05);
    expect(Math.abs((report.basis as number) - TRUE_BASIS)).toBeLessThan(0.05);
    // The published level is the record basis (first Planning record).
    const p = initiationHazard(model, FZP_BASE);
    expect(Math.abs(log(p / (1 - p)) - TRUE_INTERCEPT)).toBeLessThan(0.05);
  });

  it('rounds coefficients to 6 significant digits', () => {
    for (const v of [model.intercept, ...model.terms.flatMap((t) => t.coef)]) {
      expect(v === 0 || Number(v.toPrecision(6)) === v).toBe(true);
    }
  });

  it('backcastGate passes per basis on the fitted data', () => {
    expect(report.backcast.byBasis.map((b) => b.basis)).toEqual([0, 1]);
    expect(backcastGate(report).ok).toBe(true);
    const bad = structuredClone(report);
    bad.backcast.byBasis[1].predicted = bad.backcast.byBasis[1].observed * 1.03;
    const g = backcastGate(bad);
    expect(g.ok).toBe(false);
    expect(g.detail).toContain('permit');
  });

  it('implied per-year totals equal the hand sum of published hazard x exposure', () => {
    let hand = 0;
    let obs2020 = 0;
    for (const [key, c] of panel.cells) {
      if (!key.startsWith('2020|')) continue;
      hand += c.exposure * initiationHazard(model, featuresOf(c.bins));
      obs2020 += c.events;
    }
    expect(report.impliedPerYear[2020]).toBeCloseTo(hand, 9);
    expect(Object.keys(report.impliedPerYear)).toHaveLength(19);
    expect(report.impliedSteadyState).toBeCloseTo(report.impliedPerYear[2025], 9);
    expect(report.observedPerYear[2020]).toBe(obs2020);
  });

  it('topEffects lists every term by coefficient range, descending', () => {
    expect(report.topEffects).toHaveLength(8);
    for (let i = 1; i < report.topEffects.length; i++) {
      expect(report.topEffects[i - 1].range).toBeGreaterThanOrEqual(report.topEffects[i].range);
    }
    expect(report.topEffects[0].feature).toBe('potentialRatio');
  });

  it('FZP expected filings, the historical mean and the extrapolation share', () => {
    const h = FZP_FEATURES.map((f) => initiationHazard(model, f));
    expect(report.fzpPerYear).toBeCloseTo(12 * (h[0] + h[1] + h[2]), 9);
    const total = panel.events.record + panel.events.permit;
    expect(report.historicalMean).toBeCloseTo(total / 19, 9);
    expect(report.fzpRatio).toBeCloseTo(report.fzpPerYear / report.impliedSteadyState, 9);
    expect(report.fzpWarning).toBe(true); // 3 parcels file far fewer than the panel's mean
    expect(report.extrapolation.parcels).toBe(2);
    expect(report.extrapolation.parcelShare).toBeCloseTo(2 / 3, 9);
    expect(report.extrapolation.filingsShare).toBeCloseTo((h[1] + h[2]) / (h[0] + h[1] + h[2]), 9);
  });

  it('hold-out: the fit through 2022 predicts 2023-2025', () => {
    const ho = report.holdOut;
    if (!ho || !('rows' in ho)) throw new Error('no hold-out rows');
    expect(ho.rows.map((r) => r.year)).toEqual([2023, 2024, 2025]);
    expect(Math.abs(ho.predicted / ho.observed - 1)).toBeLessThan(0.1);
  });

  it('per-bin observed and exposure sum to the totals; mask shares', () => {
    const pr = report.terms.find((t) => t.feature === 'potentialRatio');
    expect(pr?.bins.map((b) => b.lo)).toEqual([0, 2]);
    const total = panel.events.record + panel.events.permit;
    expect(pr?.bins.reduce((a, b) => a + b.events, 0)).toBe(total);
    expect(pr?.bins.reduce((a, b) => a + b.exposure, 0)).toBe(panel.exposureMonths);
    expect(report.mask.exposureShare[0]).toBeCloseTo(10 / panel.exposureMonths, 12);
    expect(report.mask.eventShare[0]).toBeCloseTo(1 / total, 12);
    expect(report.parcelYearsExcluded).toBe(3);
    expect(report.parcelYearsExcludedByYear).toEqual({ 2007: 3 });
  });

  it('is deterministic: a second run is byte-identical', () => {
    expect(JSON.stringify(fitInitiation(simPanel(30_000), LIVE_CAL, fzpApp, NO_CTX))).toBe(
      JSON.stringify({ model, report })
    );
  });

  it('live: fewer than INIT_MIN_EVENTS events is a CalibrationError', () => {
    const small = simPanel(50);
    expect(small.events.record + small.events.permit).toBeLessThan(100);
    expect(() => fitInitiation(small, LIVE_CAL, fzpApp, NO_CTX)).toThrow(CalibrationError);
  });

  it('fixture: the fixed high-hazard tier-4 model, report from the panel counts', () => {
    const small = simPanel(50);
    const { model: fm, report: fr } = fitInitiation(small, FIXTURE_CAL, fzpApp, NO_CTX);
    expect(fm.kind).toBe('logit-monthly');
    expect(fm.terms).toEqual([]);
    expect(fm.intercept).toBe(Number(log(0.05 / 0.95).toPrecision(6)));
    expect(fm.provenance.tier).toBe(4);
    expect(fm.provenance.label).toBe(
      'fixture: high hazard so simulated starts appear within the e2e horizon'
    );
    expect(fr.mode).toBe('fixture');
    expect(fr.basis).toBeNull();
    expect(fr.events.total).toBe(small.events.record + small.events.permit);
    expect(fr.fzpPerYear).toBeCloseTo(3 * 12 * initiationHazard(fm, FZP_BASE), 9);
  });
});

describe('fitInitiation review minors (Task 13 review, folded into Task 16)', () => {
  /** `panel` with every cell of one basis removed. */
  function withoutBasis(panel: PanelResult, basis: 0 | 1): PanelResult {
    const cells = new Map([...panel.cells].filter(([, c]) => c.basis !== basis));
    return {
      ...panel,
      cells,
      events: basis === 1 ? { ...panel.events, permit: 0 } : { ...panel.events, record: 0 }
    };
  }

  it('live: a detection basis with no data is a CalibrationError', () => {
    const panel = simPanel(30_000);
    for (const b of [0, 1] as const) {
      expect(() => fitInitiation(withoutBasis(panel, b), LIVE_CAL, fzpApp, NO_CTX)).toThrow(
        'initiation: one detection basis has no data'
      );
    }
  });

  it('fixture: no basis guard (the back-cast gate is live-only)', () => {
    const { report } = fitInitiation(withoutBasis(simPanel(50), 1), FIXTURE_CAL, fzpApp, NO_CTX);
    expect(report.events.permit).toBe(0);
  });

  it('method tags RIDGE_LAMBDA and MIN_BIN_EVENTS tier 4 and names permitOnlyPre2015', () => {
    const ctx = { permitOnlyPre2015: { fired: 7, of: 40 } };
    const { model } = fitInitiation(simPanel(30_000), LIVE_CAL, fzpApp, ctx);
    expect(model.provenance.method).toContain('RIDGE_LAMBDA = 1 (tier 4)');
    expect(model.provenance.method).toContain('MIN_BIN_EVENTS = 10 (tier 4)');
    expect(model.provenance.method).toContain('n = 7 of 40 (calibration.method.permitOnlyPre2015)');
  });

  it('shipped method prints a non-finite at-risk maximum as "none", never Infinity or NaN', () => {
    const p = simPanel(30_000);
    const empty = {
      ...p,
      maxAtRisk: { potentialRatio: -Infinity, storiesGap: Number.NaN }
    };
    const { model } = fitInitiation(empty, LIVE_CAL, fzpApp, NO_CTX);
    expect(model.provenance.method).not.toMatch(/Infinity|NaN/);
    expect(model.provenance.method).toContain('at-risk maximum (none, none)');
  });
});
