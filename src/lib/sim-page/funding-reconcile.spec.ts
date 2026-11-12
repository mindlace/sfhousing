// reconcileFunding: what a loaded policy's funding keeps and drops against the calibration it
// will run on (finance-levers spec section 4.5).
import { describe, expect, it } from 'vitest';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Programme } from '$lib/timelapse/types';
import { baselineFixture, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { reconcileFunding } from './funding-reconcile';
import { DEFAULT_POLICY } from './policy';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const empty = (): FinanceLevers => structuredClone(DEFAULT_POLICY.funding);
const prog = (over: Partial<Programme>): Programme => ({
  ...fundingOnly().programmes[0],
  ...over
});

describe('reconcileFunding', () => {
  it('returns the input object and an empty report when nothing changes', () => {
    const f = fundingOnly();
    const r = reconcileFunding(f, cal);
    expect(r.funding).toBe(f);
    expect(r.report).toEqual({ droppedScales: [], droppedProgrammes: [], unusable: false });
  });

  it('drops a scale on a pool the data lacks, keeping the others', () => {
    const f = fundingOnly();
    const from = 12345;
    f.baselineScale.push({ pool: 'nope', from, scale: 2 });
    const r = reconcileFunding(f, cal);
    expect(r.report.droppedScales).toEqual([{ pool: 'nope', from }]);
    expect(r.funding.baselineScale.map((s) => s.pool)).toEqual(['state']);
    expect(r.funding).not.toBe(f);
  });

  it('drops a programme on a baseline pool the data lacks', () => {
    const f = fundingOnly();
    f.programmes.push(prog({ id: 'p-x', label: 'X', pool: 'nope' }));
    const r = reconcileFunding(f, cal);
    expect(r.report.droppedProgrammes).toEqual([
      { id: 'p-x', label: 'X', pool: 'nope', reason: 'pool', term: null }
    ]);
    expect(r.funding.programmes.map((p) => p.id)).toEqual(['u-prog-1']);
  });

  it('never drops a programme on an added pool for its pool', () => {
    const f = fundingOnly();
    f.pools = [];
    const r = reconcileFunding(f, cal);
    expect(r.report.droppedProgrammes).toEqual([]);
    expect(r.funding).toBe(f);
  });

  it('drops a guarantee with no typed cut for its missing term', () => {
    const f = fundingOnly();
    f.programmes.push(
      prog({
        id: 'u-g',
        label: 'G',
        instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 }
      })
    );
    const r = reconcileFunding(f, cal);
    expect(r.report.droppedProgrammes).toEqual([
      { id: 'u-g', label: 'G', pool: 'u-pool-1', reason: 'term', term: 'guaranteeRateCut' }
    ]);
    const typed = { ...f, terms: { guaranteeRateCut: 0.01 } };
    expect(reconcileFunding(typed, cal).funding).toBe(typed);
  });

  it('is unusable with no market and non-default funding', () => {
    const { market: _m, ...noMarket } = cal;
    void _m;
    const r = reconcileFunding(fundingOnly(), noMarket as Calibration);
    expect(r.report.unusable).toBe(true);
  });

  it('is unusable with no baselineFunding and non-default funding', () => {
    const { baselineFunding: _b, ...none } = cal;
    void _b;
    const r = reconcileFunding(fundingOnly(), none as Calibration);
    // the scale on 'state' is dropped, the added pool and programme stay
    expect(r.report.unusable).toBe(true);
    expect(r.report.droppedScales).toHaveLength(1);
  });

  it('is not unusable when only drops left the default funding', () => {
    const { baselineFunding: _b, ...none } = cal;
    void _b;
    const f = empty();
    f.baselineScale.push({ pool: 'state', from: 12345, scale: 2 });
    const r = reconcileFunding(f, none as Calibration);
    expect(r.report.droppedScales).toHaveLength(1);
    expect(r.report.unusable).toBe(false);
  });
});
