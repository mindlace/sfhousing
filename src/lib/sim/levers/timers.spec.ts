import { describe, expect, it } from 'vitest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import {
  cumulativeTotal,
  eventualProbabilities,
  parseCalibration,
  typicalMonths
} from '$lib/timelapse/model';
import {
  EXIT_ORDER,
  PATHWAYS,
  pathwayStages,
  type Calibration,
  type Pathway,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import miniCalibrationJson from '../scenario/fixtures/mini-calibration.json';
import fixture0CalibrationJson from '../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import {
  DISAPPROVAL_NEGLIGIBLE,
  disapprovedShare,
  isIdentity,
  rescaleTransition,
  routeSharesOp,
  scaleTable,
  timersOp,
  type StageScale
} from './timers';
import { MAX_SCALE, MIN_SCALE, type TimedStage, type TimerEdit } from './types';

type Tabled = Exclude<Stage, 'complete'>;

const CALIBRATIONS: [string, () => Calibration][] = [
  ['mini-calibration', () => parseCalibration(structuredClone(miniCalibrationJson) as unknown)],
  [
    'fixture-0 calibration',
    () => parseCalibration(structuredClone(fixture0CalibrationJson) as unknown)
  ]
];
const SCALES = [0.05, 0.25, 0.5, 2, 4, 10];

/** Every (pathway, stage) the calibration has a transition for. */
function cells(cal: Calibration): [Pathway, Tabled][] {
  const out: [Pathway, Tabled][] = [];
  for (const p of PATHWAYS)
    for (const s of pathwayStages(p))
      if (s !== 'complete' && cal.transitions[p][s] !== undefined) out.push([p, s]);
  return out;
}

function withTransition(cal: Calibration, p: Pathway, s: Tabled, t: Transition): Calibration {
  return {
    ...cal,
    transitions: { ...cal.transitions, [p]: { ...cal.transitions[p], [s]: t } }
  };
}

/** Where C crosses 0.5 inside median month m0, linear between whole months. */
function medianCrossing(t: Transition, m0: number): number {
  const a = cumulativeTotal(t, m0 - 1);
  const b = cumulativeTotal(t, m0);
  return m0 - 1 + (0.5 - a) / (b - a);
}

// The parcels are never read by these ops; a sentinel checks they pass through untouched.
const PARCELS = { count: 0 } as unknown as ScenarioParcels;

describe('rescaleTransition', () => {
  for (const [name, load] of CALIBRATIONS) {
    describe(name, () => {
      const cal = load();
      for (const [p, s] of cells(cal)) {
        const t = cal.transitions[p][s]!;
        for (const sc of SCALES) {
          it(`${p}.${s} ×${sc}: parses, keeps the shares, scales the median`, () => {
            const r = rescaleTransition(t, sc);
            const next = withTransition(cal, p, s, r);
            expect(() => parseCalibration(structuredClone(next))).not.toThrow();

            const before = eventualProbabilities(t, 0);
            const after = eventualProbabilities(r, 0);
            expect(Math.abs(after.advance - before.advance)).toBeLessThan(1e-9);
            for (const reason of EXIT_ORDER) {
              const b = before.exit[reason] ?? 0;
              const a = after.exit[reason] ?? 0;
              expect(Math.abs(a - b), reason).toBeLessThan(1e-9);
            }

            if (Math.round(t.months * sc) <= 240) {
              // typicalMonths reports the whole month m0 the median falls in, i.e. the ceiling of
              // the crossing. The rescale moves the crossing x* inside (m0 - 1, m0], so the scaled
              // median is ceil(s x*), which can sit up to s below s m0. Test against s x*.
              const m0 = typicalMonths(cal)[p][s]!;
              const m1 = typicalMonths(next)[p][s]!;
              expect(Math.abs(m1 - Math.round(sc * medianCrossing(t, m0)))).toBeLessThanOrEqual(1);
            }
          });
        }
      }
    });
  }

  it('returns the transition itself at s = 1', () => {
    const t = CALIBRATIONS[0][1]().transitions.discretionary.filed!;
    expect(rescaleTransition(t, 1)).toBe(t);
  });

  it('notes the rescale in both provenances', () => {
    const t = CALIBRATIONS[0][1]().transitions.discretionary.filed!;
    const r = rescaleTransition(t, 0.5);
    expect(r.provenance.method).toBe(`${t.provenance.method}; time-rescaled ×0.5 (policy lever)`);
    expect(r.tailProvenance.method).toBe(
      `${t.tailProvenance.method}; time-rescaled ×0.5 (policy lever)`
    );
    expect(r.provenance.tier).toBe(t.provenance.tier);
  });
});

const filed = { pathway: 'discretionary', stage: 'filed' } as const;

describe('scaleTable', () => {
  const edits: TimerEdit[] = [
    { ...filed, scale: 0.5, reach: 'new' },
    { ...filed, scale: 0.8, reach: 'all' }
  ];

  it("in flight takes the product of the 'all' edits only", () => {
    expect(scaleTable(edits, 'inFlight').discretionary.filed).toBeCloseTo(0.8, 12);
  });

  it('new projects take the product of every edit', () => {
    expect(scaleTable(edits, 'new').discretionary.filed).toBeCloseTo(0.4, 12);
  });

  it('leaves unedited stages absent', () => {
    const t = scaleTable(edits, 'new');
    expect(t.streamlined).toEqual({});
    expect(Object.keys(t.discretionary)).toEqual(['filed']);
  });

  it('clamps a product to [MIN_SCALE, MAX_SCALE]', () => {
    const twice = (scale: number): TimerEdit[] => [
      { ...filed, scale, reach: 'all' },
      { ...filed, scale, reach: 'new' }
    ];
    expect(scaleTable(twice(MIN_SCALE), 'new').discretionary.filed).toBe(MIN_SCALE);
    expect(scaleTable(twice(MAX_SCALE), 'new').discretionary.filed).toBe(MAX_SCALE);
    expect(scaleTable(twice(MAX_SCALE), 'inFlight').discretionary.filed).toBe(MAX_SCALE);
  });

  it('isIdentity holds for no edits and for unit products, not for a real scale', () => {
    expect(isIdentity(scaleTable([], 'new'))).toBe(true);
    expect(isIdentity(scaleTable(edits, 'inFlight'))).toBe(false);
    const unit: TimerEdit[] = [
      { ...filed, scale: 2, reach: 'new' },
      { ...filed, scale: 0.5, reach: 'new' }
    ];
    expect(isIdentity(scaleTable(unit, 'new'))).toBe(true);
    expect(isIdentity(scaleTable(unit, 'inFlight'))).toBe(true);
  });
});

describe('timersOp', () => {
  const cal = CALIBRATIONS[0][1]();
  const scale = (p: Pathway, s: TimedStage, x: number): StageScale => ({
    discretionary: {},
    streamlined: {},
    permitOnly: {},
    [p]: { [s]: x }
  });

  it('rescales only the scaled transition and passes the parcels through', () => {
    const out = timersOp(scale('streamlined', 'entitled', 2))(cal, PARCELS);
    expect(out.parcels).toBe(PARCELS);
    expect(out.cal).not.toBe(cal);
    expect(out.cal.transitions.streamlined.entitled).toEqual(
      rescaleTransition(cal.transitions.streamlined.entitled!, 2)
    );
    for (const [p, s] of cells(cal)) {
      if (p === 'streamlined' && s === 'entitled') continue;
      expect(out.cal.transitions[p][s]).toBe(cal.transitions[p][s]);
    }
    expect(out.cal.pathwayForNew).toBe(cal.pathwayForNew);
    expect(() => parseCalibration(structuredClone(out.cal))).not.toThrow();
  });

  it('is a no-op for a stage the pathway never visits (permitOnly + filed)', () => {
    const out = timersOp(scale('permitOnly', 'filed', 0.5))(cal, PARCELS);
    expect(out.cal).toBe(cal);
    expect(out.parcels).toBe(PARCELS);
  });

  it('returns the calibration itself under the identity scale', () => {
    expect(timersOp(scaleTable([], 'new'))(cal, PARCELS).cal).toBe(cal);
  });
});

describe('routeSharesOp', () => {
  const cal = CALIBRATIONS[0][1]();

  it('normalises the shares and keeps the provenance', () => {
    const out = routeSharesOp({ discretionary: 0, streamlined: 2, permitOnly: 2 })(cal, PARCELS);
    expect(out.cal.pathwayForNew.discretionary).toBe(0);
    expect(out.cal.pathwayForNew.streamlined).toBe(0.5);
    expect(out.cal.pathwayForNew.permitOnly).toBe(0.5);
    expect(out.cal.pathwayForNew.provenance).toEqual(cal.pathwayForNew.provenance);
    expect(out.cal.transitions).toBe(cal.transitions);
    expect(out.parcels).toBe(PARCELS);
    expect(() => parseCalibration(structuredClone(out.cal))).not.toThrow();
  });

  it('is the identity for null', () => {
    const out = routeSharesOp(null)(cal, PARCELS);
    expect(out.cal).toBe(cal);
    expect(out.parcels).toBe(PARCELS);
  });
});

describe('disapprovedShare', () => {
  const cal = CALIBRATIONS[0][1]();

  it('equals a hand fold of eventualProbabilities over pathwayStages', () => {
    const got = disapprovedShare(cal);
    for (const p of PATHWAYS) {
      let reach = 1;
      let sum = 0;
      for (const stage of pathwayStages(p).filter((s) => s !== 'preApplication')) {
        const t = cal.transitions[p][stage as Tabled];
        if (!t) continue;
        const e = eventualProbabilities(t, 0);
        sum += reach * (e.exit.disapproved ?? 0);
        reach *= e.advance;
      }
      expect(Math.abs(got[p] - sum)).toBeLessThan(1e-12);
    }
    expect(PATHWAYS.some((p) => got[p] > 0)).toBe(true);
  });

  it('is 0 for every pathway when no stage can be disapproved', () => {
    const zeroed = structuredClone(cal);
    for (const p of PATHWAYS) {
      for (const t of Object.values(zeroed.transitions[p])) {
        delete t.exit.disapproved;
        delete t.tail.exit.disapproved;
      }
    }
    const got = disapprovedShare(zeroed);
    for (const p of PATHWAYS) expect(got[p]).toBe(0);
  });

  it('exports the 1% threshold of ruling 3', () => {
    expect(DISAPPROVAL_NEGLIGIBLE).toBe(0.01);
  });
});
