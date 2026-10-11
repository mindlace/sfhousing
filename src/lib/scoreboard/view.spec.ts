import { describe, expect, it } from 'vitest';
import { score } from './accumulator';
import { building, parcel } from './score-fixtures';
import { M1_TARGETS } from './targets';
import type { Score } from './types';
import {
  announcement,
  BADGE,
  barText,
  fillPercent,
  footnoteLead,
  meterValueText,
  neighborhoodRows,
  oldPlanNote,
  primaryTarget,
  remainderText,
  secondaryText,
  tickPercent,
  trackMax,
  viewState,
  type ScoreStatus
} from './view';

function withNet(net: number, hood = 'Mission'): Score {
  const p = parcel('9000001', 0, hood);
  return score(net > 0 ? [[p, building(p, net, true)]] : [], M1_TARGETS);
}

const status = (s: Partial<ScoreStatus> = {}): ScoreStatus => ({
  pendingChunks: 0,
  failedChunks: 0,
  complete: true,
  datasetVersion: '2026-10-10-abcdef12',
  builtAt: '2026-10-10T12:00:00Z',
  mode: 'max',
  ...s
});

describe('badge', () => {
  it('M1 max mode reads "Theoretical max buildout"', () => {
    expect(BADGE.max).toBe('Theoretical max buildout');
  });
});

describe('track and bars (§4.4 progress bar)', () => {
  it('track is max(1, ceil(maxFraction·2)/2) over all targets', () => {
    expect(trackMax(withNet(0).targets)).toBe(1);
    expect(trackMax(withNet(41035).targets)).toBe(1); // 0.5
    expect(trackMax(withNet(82069).targets)).toBe(1); // exactly 1
    expect(trackMax(withNet(82070).targets)).toBe(1.5);
    expect(trackMax(withNet(147724).targets)).toBe(2); // 1.8 → 2
    expect(trackMax(withNet(164138).targets)).toBe(2); // exactly 2.0
  });

  it('tick sits at 100% of target, fill at the fraction, never clamped', () => {
    expect(tickPercent(1)).toBe(100);
    expect(tickPercent(2)).toBe(50);
    expect(fillPercent(1.8, 2)).toBe(90);
    expect(fillPercent(1, 1)).toBe(100);
    expect(fillPercent(-0.1, 1)).toBe(0); // drawn from 0
  });

  it('remainder: under target "to go", at/over "over target"', () => {
    expect(remainderText(80000, 82069)).toBe('2,069 to go');
    expect(remainderText(82069, 82069)).toBe('0 over target');
    expect(remainderText(147724, 82069)).toBe('65,655 over target');
    expect(remainderText(-5, 82069)).toBe('82,074 to go');
  });

  it('meter valuetext is "{pct} of {label}"', () => {
    // 147725/82069 = 1.800009 (147724 would be 1.79999 → '179%')
    expect(meterValueText(withNet(147725).targets[0])).toBe('180% of RHNA 2023–2031');
  });
});

describe('neighborhoods', () => {
  it('sorts by net descending, ties by name (en)', () => {
    expect(neighborhoodRows({ Bayview: 5, Mission: 9, 'Noe Valley': 5, Excelsior: 12 })).toEqual([
      { name: 'Excelsior', net: 12 },
      { name: 'Mission', net: 9 },
      { name: 'Bayview', net: 5 },
      { name: 'Noe Valley', net: 5 }
    ]);
  });

  it('empty record → no rows', () => {
    expect(neighborhoodRows({})).toEqual([]);
  });
});

describe('viewState (§4.4 states)', () => {
  it('empty: no changed parcels and nothing pending', () => {
    expect(viewState(withNet(0), status())).toMatchObject({ empty: true, updating: false });
    expect(viewState(withNet(0), status({ pendingChunks: 2 })).empty).toBe(false);
    expect(viewState(withNet(3), status()).empty).toBe(false);
  });

  it('updating: chunks pending or latest diff incomplete', () => {
    expect(viewState(withNet(3), status({ pendingChunks: 1 })).updating).toBe(true);
    expect(viewState(withNet(3), status({ complete: false })).updating).toBe(true);
    expect(viewState(withNet(3), status()).updating).toBe(false);
  });

  it('failed: any failed chunk', () => {
    expect(viewState(withNet(3), status({ failedChunks: 1 })).failed).toBe(true);
  });

  it('old plan: planDatasetVersion set and different', () => {
    expect(viewState(withNet(3), status({ planDatasetVersion: 'fixture-0' })).oldPlan).toBe(true);
    expect(
      viewState(withNet(3), status({ planDatasetVersion: '2026-10-10-abcdef12' })).oldPlan
    ).toBe(false);
    expect(viewState(withNet(3), status()).oldPlan).toBe(false);
  });
});

describe('text', () => {
  it('primary target is matched by id, not position or identity', () => {
    const s = withNet(10);
    const swapped: Score = { ...s, targets: [s.targets[1], structuredClone(s.targets[0])] };
    expect(primaryTarget(swapped)?.target.id).toBe('rhna');
    expect(primaryTarget({ ...s, targets: [] })).toBeUndefined();
  });

  it('announcement: "Net new homes {net}, {pct} of RHNA"', () => {
    expect(announcement(withNet(41035))).toBe('Net new homes 41,035, 50% of RHNA');
    expect(announcement(withNet(0))).toBe('Net new homes 0, 0% of RHNA');
  });

  it('mobile bar text, compact at ≥ 100,000', () => {
    expect(barText(withNet(8))).toBe('8 net new homes · 0.0% of RHNA');
    expect(barText(withNet(123456))).toBe('123.5K net new homes · 150% of RHNA');
  });

  it('secondary line: "{gross} built · {demolished} replaced · {parcelsChanged} parcels changed"', () => {
    const p = parcel('9000002', 3, 'Mission');
    const s = score([[p, building(p, 12, true)]], M1_TARGETS);
    expect(secondaryText(s)).toBe('12 built · 3 replaced · 1 parcels changed');
  });

  it('footnote lead: "Data {v} · built {YYYY-MM-DD}"; omits built when unknown', () => {
    expect(footnoteLead(status())).toBe('Data 2026-10-10-abcdef12 · built 2026-10-10');
    expect(footnoteLead(status({ builtAt: '' }))).toBe('Data 2026-10-10-abcdef12');
  });

  it('old plan note', () => {
    expect(oldPlanNote(status({ planDatasetVersion: 'fixture-0' }))).toBe(
      'plan made on data fixture-0, recalculated on current data'
    );
  });
});
