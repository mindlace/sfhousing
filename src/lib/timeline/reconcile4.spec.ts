import { describe, expect, it } from 'vitest';
import { baselineFixture, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { OBSERVED_TIMING, resolvePreset, type TimingSet } from '$lib/sim-page/timing';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Programme } from '$lib/timelapse/types';
import { DEFAULT_POLICY4, type Effect, type Policy, type SimPolicy4 } from './policy4';
import { programmeTermGaps, reconcilePolicy4 } from './reconcile4';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};

const F = fundingOnly();
const pool = F.pools[0];
const grant: Programme = F.programmes[0];
const guarantee = (id: string, poolId = 'u-pool-1'): Programme => ({
  ...grant,
  id,
  label: id,
  pool: poolId,
  instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 }
});

const pol = (
  id: string,
  where: Policy['where'],
  spans: Policy['spans'],
  over: Partial<Policy> = {}
): Policy => ({ id, label: id, preset: null, on: true, where, spans, ...over });
const span = (from: number, to: number | null, what: Effect) => ({ from, to, what });
const money = (...m: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning: [], permitting: [], money: m }
});
const fundPool = (programmes: Programme[], ranges: [number, number | null][] = [[1000, null]]) =>
  pol(
    'fund-u-pool-1',
    { tag: 'fund', pool: 'u-pool-1' },
    ranges.map(([from, to]) => span(from, to, { tag: 'fund', pool, programmes }))
  );
const fundBaseline = (poolId: string, programmes: Programme[]) =>
  pol(`fund-${poolId}`, { tag: 'fund', pool: poolId }, [
    span(1000, null, { tag: 'fund', pool: null, programmes })
  ]);
const termsPolicy = (id: string, from: number, to: number | null, cut: number) =>
  pol(id, { tag: 'terms' }, [span(from, to, { tag: 'terms', terms: { guaranteeRateCut: cut } })]);

const timingSet = (preset: 'benchmarkPermits' | 'observed'): TimingSet =>
  resolvePreset(preset, cal);
const permitting = (set: TimingSet, id = 'timing', on = true, preset: string | null = set.preset) =>
  pol(
    id,
    { tag: 'routes' },
    [span(1000, 1999, { tag: 'timing', set }), span(2000, null, { tag: 'timing', set })],
    {
      on,
      preset
    }
  );

function fixtures(): Record<string, SimPolicy4> {
  return {
    empty: DEFAULT_POLICY4,
    money: money(
      pol('baseline', { tag: 'baseline' }, [
        span(1000, null, { tag: 'scales', entries: F.baselineScale })
      ]),
      fundPool([grant]),
      termsPolicy('terms', 1000, null, 0.01),
      fundBaseline('state', [guarantee('g-state', 'state')])
    ),
    permitting: {
      schema: 4,
      kinds: {
        zoning: [],
        permitting: [
          permitting(timingSet('benchmarkPermits')),
          permitting(timingSet('observed'), 'timing-saved', false)
        ],
        money: []
      }
    }
  };
}

describe('reconcilePolicy4 money', () => {
  it('drops a programme naming an unknown baseline pool, from every span, and reports it', () => {
    const g = { ...grant, id: 'p-x', label: 'X', pool: 'nope' };
    const d = money(
      pol('fund-nope', { tag: 'fund', pool: 'nope' }, [
        span(1000, 1999, { tag: 'fund', pool: null, programmes: [g] }),
        span(2000, null, { tag: 'fund', pool: null, programmes: [g] })
      ])
    );
    const r = reconcilePolicy4(d, cal);
    expect(r.report.funding.droppedProgrammes).toEqual([
      { id: 'p-x', label: 'X', pool: 'nope', reason: 'pool', term: null }
    ]);
    for (const s of r.doc.kinds.money[0].spans) {
      expect(s.what.tag === 'fund' && s.what.programmes).toEqual([]);
    }
  });

  it('drops a scale entry on an unknown pool from every span and reports it', () => {
    const entries = [
      { pool: 'state', from: 1500, scale: 2 },
      { pool: 'nope', from: 1600, scale: 3 }
    ];
    const d = money(
      pol('baseline', { tag: 'baseline' }, [
        span(1000, 1999, { tag: 'scales', entries }),
        span(2000, null, { tag: 'scales', entries })
      ])
    );
    const r = reconcilePolicy4(d, cal);
    expect(r.report.funding.droppedScales).toEqual([{ pool: 'nope', from: 1600 }]);
    for (const s of r.doc.kinds.money[0].spans) {
      expect(s.what.tag === 'scales' && s.what.entries.map((e) => e.pool)).toEqual(['state']);
    }
  });

  it('drops a guarantee with no typed cut, and keeps it when an on terms policy types it', () => {
    const bare = reconcilePolicy4(money(fundPool([guarantee('u-g')])), cal);
    expect(bare.report.funding.droppedProgrammes).toEqual([
      {
        id: 'u-g',
        label: 'u-g',
        pool: 'u-pool-1',
        reason: 'term',
        term: 'guaranteeRateCut'
      }
    ]);
    const d = money(fundPool([guarantee('u-g')]), termsPolicy('t', 500, null, 0.01));
    const kept = reconcilePolicy4(d, cal);
    expect(kept.doc).toBe(d);
    expect(kept.report.funding.droppedProgrammes).toEqual([]);
  });

  it('drops it when the terms policy ends before the last span, and when that one is off', () => {
    const f = fundPool(
      [guarantee('u-g')],
      [
        [1000, 1999],
        [2000, 2999]
      ]
    );
    const ends = money(f, termsPolicy('t', 500, 1999, 0.01));
    expect(programmeTermGaps(ends)).toEqual([
      {
        path: 'kinds.money[0].spans[1].what.programmes[0]',
        programme: 'u-g',
        term: 'guaranteeRateCut'
      }
    ]);
    const r = reconcilePolicy4(ends, cal);
    expect(r.report.funding.droppedProgrammes.map((d) => d.reason)).toEqual(['term']);
    expect(programmeTermGaps(r.doc)).toEqual([]);

    const off = money(f, { ...termsPolicy('t', 500, null, 0.01), on: false });
    expect(programmeTermGaps(off)).toHaveLength(2);
  });

  it('checks an off fund policy against the on terms policies', () => {
    const off = { ...fundPool([guarantee('u-g')]), on: false };
    const r = reconcilePolicy4(money(off), cal);
    expect(r.report.funding.droppedProgrammes).toHaveLength(1);
  });

  it('lets the lower policy win a key typed twice', () => {
    const d = money(
      fundPool([guarantee('u-g')]),
      pol('t1', { tag: 'terms' }, [span(1000, null, { tag: 'terms', terms: {} })]),
      termsPolicy('t2', 1000, null, 0.02)
    );
    expect(programmeTermGaps(d)).toEqual([]);
  });

  it('drops as today and is unusable when the data has no baselineFunding', () => {
    const { baselineFunding: _b, ...rest } = cal;
    void _b;
    const d = money(
      pol('baseline', { tag: 'baseline' }, [
        span(1000, null, { tag: 'scales', entries: [{ pool: 'nope', from: 1, scale: 2 }] })
      ]),
      fundPool([grant]),
      fundBaseline('state', [{ ...grant, id: 'p-s', pool: 'state' }])
    );
    const r = reconcilePolicy4(d, rest as Calibration);
    expect(r.report.funding.droppedScales).toEqual([{ pool: 'nope', from: 1 }]);
    expect(r.report.funding.droppedProgrammes.map((x) => x.id)).toEqual(['p-s']);
    expect(r.report.funding.unusable).toBe(true);
    expect(reconcilePolicy4(r.doc, rest as Calibration).doc).toBe(r.doc);
    expect(reconcilePolicy4(DEFAULT_POLICY4, rest as Calibration).report.funding.unusable).toBe(
      false
    );
  });

  it('is not unusable when the drops left every money policy empty', () => {
    const { baselineFunding: _b, ...rest } = cal;
    void _b;
    const d = money(
      pol('baseline', { tag: 'baseline' }, [
        span(1000, null, { tag: 'scales', entries: [{ pool: 'nope', from: 1, scale: 2 }] })
      ]),
      fundBaseline('state', [{ ...grant, id: 'p-s', pool: 'state' }])
    );
    const r = reconcilePolicy4(d, rest as Calibration);
    expect(r.report.funding.droppedScales).toHaveLength(1);
    expect(r.report.funding.unusable).toBe(false);
  });
});

describe('reconcilePolicy4 permitting', () => {
  it('re-fits a preset layer that no longer matches, in every span, reporting the policy', () => {
    const set = timingSet('benchmarkPermits');
    const stale: TimingSet = {
      ...set,
      presetTimers: set.presetTimers.map((t) => ({ ...t, scale: 0.3 }))
    };
    const d = {
      ...DEFAULT_POLICY4,
      kinds: { ...DEFAULT_POLICY4.kinds, permitting: [permitting(stale)] }
    };
    const r = reconcilePolicy4(d, cal);
    expect(r.report.timing).toHaveLength(2);
    for (const t of r.report.timing) {
      expect(t.policy).toBe('timing');
      expect(t.change).toEqual({
        set: 'current',
        kind: 'preset-refit',
        preset: 'benchmarkPermits'
      });
    }
    for (const s of r.doc.kinds.permitting[0].spans) {
      expect(s.what.tag === 'timing' && s.what.set.presetTimers).toEqual(set.presetTimers);
    }
  });

  it("labels an off policy's changes 'saved'", () => {
    const set = timingSet('benchmarkPermits');
    const stale: TimingSet = { ...set, presetTimers: [] };
    const d = {
      ...DEFAULT_POLICY4,
      kinds: { ...DEFAULT_POLICY4.kinds, permitting: [permitting(stale, 't', false)] }
    };
    const r = reconcilePolicy4(d, cal);
    expect(r.report.timing.every((t) => t.change.set === 'saved')).toBe(true);
    expect(r.report.timing.length).toBeGreaterThan(0);
  });

  it('follows preset-unavailable to observed in the policy field', () => {
    // a preset id the code no longer offers
    const gone = 'retired' as TimingSet['preset'];
    const set: TimingSet = { ...structuredClone(OBSERVED_TIMING.current), preset: gone };
    const d = {
      ...DEFAULT_POLICY4,
      kinds: { ...DEFAULT_POLICY4.kinds, permitting: [permitting(set)] }
    };
    const r = reconcilePolicy4(d, cal);
    expect(r.report.timing.map((t) => t.change.kind)).toEqual([
      'preset-unavailable',
      'preset-unavailable'
    ]);
    expect(r.doc.kinds.permitting[0].preset).toBe('observed');
    for (const s of r.doc.kinds.permitting[0].spans) {
      expect(s.what.tag === 'timing' && s.what.set.preset).toBe('observed');
    }
  });
});

describe('reconcilePolicy4 identity', () => {
  it('returns an already-reconciled document as the same object, with an empty report', () => {
    for (const [name, d] of Object.entries(fixtures())) {
      const r = reconcilePolicy4(d, cal);
      expect(r.doc, name).toBe(d);
      expect(r.report, name).toEqual({
        timing: [],
        funding: { droppedScales: [], droppedProgrammes: [], unusable: false }
      });
    }
  });

  it('reconciling the result again gives the same object and an empty report', () => {
    const g = { ...grant, id: 'p-x', pool: 'nope' };
    const dirty: SimPolicy4 = {
      schema: 4,
      kinds: {
        zoning: [],
        permitting: [
          permitting({ ...timingSet('benchmarkPermits'), presetTimers: [] }),
          permitting(
            {
              ...structuredClone(OBSERVED_TIMING.current),
              preset: 'retired' as TimingSet['preset']
            },
            'x'
          )
        ],
        money: [
          fundBaseline('nope', [g]),
          fundPool([guarantee('u-g'), grant]),
          pol('baseline', { tag: 'baseline' }, [
            span(1000, null, { tag: 'scales', entries: [{ pool: 'nope', from: 1, scale: 2 }] })
          ])
        ]
      }
    };
    for (const d of [...Object.values(fixtures()), dirty]) {
      const once = reconcilePolicy4(d, cal);
      const twice = reconcilePolicy4(once.doc, cal);
      expect(twice.doc).toBe(once.doc);
      expect(twice.report).toEqual({
        timing: [],
        funding: { droppedScales: [], droppedProgrammes: [], unusable: false }
      });
    }
    expect(reconcilePolicy4(dirty, cal).doc).not.toBe(dirty);
  });

  it('does not mutate its input', () => {
    const d = fixtures().money;
    const before = JSON.stringify(d);
    reconcilePolicy4(d, cal);
    expect(JSON.stringify(d)).toBe(before);
  });
});
