// RevisionModel (spec §4.9): the two pair types, the ratio clamp, pooling and fallback.
import { describe, expect, it } from 'vitest';
import { parseCalibration } from '../../../src/lib/timelapse/model';
import small from '../../../src/lib/timelapse/fixtures/calibration-small.json';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import { REVISION_EDGES, revisionModel } from '../../lib/fzp-cal/revision';
import type { CalProfile, NormHistory } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import type {
  Calibration,
  Day,
  ProjectHistory,
  Provenance,
  Stage
} from '../../../src/lib/timelapse/types';

const d = isoToDay;
const ASOF = d('2026-09-30');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function hist(
  id: string,
  eff: Partial<Record<Stage, Day>>,
  unitsAt: ProjectHistory['unitsAt'],
  complete = false
): NormHistory {
  const end: ProjectHistory['end'] = complete
    ? { kind: 'complete', day: eff.complete ?? d('2024-01-01') }
    : { kind: 'open', lastObserved: ASOF };
  return {
    id,
    pathway: 'discretionary',
    parcelIds: [],
    eff,
    end,
    purgeCensored: false,
    src: {
      id,
      pathway: 'discretionary',
      parcelIds: [],
      entered: eff,
      end,
      unitsAt,
      existingUnits: 0,
      storiesProposed: null,
      baseStoriesAtFiling: null,
      sources: [],
      quality: []
    }
  };
}

/** A PRJ-then-permit history: filed 2018, permitFiled 2019. */
function pf(id: string, filedUnits: number, permitUnits: number): NormHistory {
  return hist(
    id,
    { filed: d('2018-01-01'), permitFiled: d('2019-01-01') },
    { filed: filedUnits, permitFiled: permitUnits }
  );
}

/** A completed history: permitFiled 2019, permitIssued 2020, complete 2023 (no PRJ units). */
function done(id: string, permitUnits: number, completeUnits: number): NormHistory {
  return hist(
    id,
    {
      filed: d('2018-01-01'),
      permitFiled: d('2019-01-01'),
      permitIssued: d('2020-01-01'),
      construction: d('2021-01-01'),
      complete: d('2023-01-01')
    },
    { permitFiled: permitUnits, complete: completeUnits },
    true
  );
}

function checkProvenance(p: Provenance): void {
  expect(p.label.length).toBeGreaterThan(0);
  expect(p.method.length).toBeGreaterThan(0);
  expect(p.sources.length).toBeGreaterThan(0);
  for (const s of p.sources) expect(s.url.startsWith('https:')).toBe(true);
  if (p.tier <= 2) {
    expect(p.n).toBeDefined();
    expect(p.window).toBeDefined();
  }
}

const at = (r: ReturnType<typeof revisionModel>['revision'], stage: Stage) =>
  r.at.find((a) => a.stage === stage)!;

describe('REVISION_EDGES', () => {
  it('are the spec edges and include 1', () => {
    expect(REVISION_EDGES).toEqual([0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3]);
  });
});

describe('revisionModel: pair types', () => {
  it('has two entries in order: permitFiled then permitIssued', () => {
    const { revision } = revisionModel([pf('a', 10, 10)], ASOF, FIXTURE_CAL);
    expect(revision.at.map((a) => a.stage)).toEqual(['permitFiled', 'permitIssued']);
  });

  it('permitFiled pairs: unitsAt.filed to unitsAt.permitFiled; probability = revised / pairs', () => {
    const norm = [pf('a', 10, 10), pf('b', 10, 12), pf('c', 20, 20), pf('d', 8, 4)];
    const { revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    expect(at(revision, 'permitFiled').probability).toBe(0.5);
  });

  it('permitIssued pairs: unitsAt.permitFiled to unitsAt.complete, completed projects only', () => {
    const open = hist(
      'open',
      { filed: d('2018-01-01'), permitFiled: d('2019-01-01'), complete: d('2023-01-01') },
      { permitFiled: 10, complete: 20 }
    );
    const norm = [done('a', 10, 10), done('b', 10, 15), open];
    const { revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    expect(at(revision, 'permitIssued').probability).toBe(0.5);
  });

  it('counts a pair only when both counts are >= 1', () => {
    const norm = [pf('a', 0, 5), pf('b', 5, 0), pf('c', 4, 8), pf('d', 4, 4)];
    const { revision, clamp } = revisionModel(norm, ASOF, FIXTURE_CAL);
    expect(at(revision, 'permitFiled').probability).toBe(0.5);
    expect(clamp.of).toBe(1);
  });

  it('counts a pair only when the later stage was entered in [2015-01-01, asOf]', () => {
    const early = hist(
      'early',
      { filed: d('2013-01-01'), permitFiled: d('2014-12-31') },
      { filed: 4, permitFiled: 8 }
    );
    const late = hist(
      'late',
      { filed: d('2025-01-01'), permitFiled: ASOF + 1 },
      { filed: 4, permitFiled: 8 }
    );
    const { revision, clamp } = revisionModel([early, late], ASOF, FIXTURE_CAL);
    expect(clamp.of).toBe(0);
    expect(at(revision, 'permitFiled').probability).toBe(0);
    const edge = hist(
      'edge',
      { filed: d('2014-01-01'), permitFiled: d('2015-01-01') },
      { filed: 4, permitFiled: 8 }
    );
    expect(revisionModel([edge], ASOF, FIXTURE_CAL).clamp.of).toBe(1);
  });

  it('permitIssued pair: a completed history with complete before 2015 is not counted, within is', () => {
    const at = (id: string, completeDay: Day) =>
      hist(
        id,
        {
          filed: d('2012-01-01'),
          permitFiled: d('2013-01-01'),
          permitIssued: d('2013-06-01'),
          construction: d('2013-09-01'),
          complete: completeDay
        },
        { permitFiled: 4, complete: 8 },
        true
      );
    expect(revisionModel([at('old', d('2014-12-31'))], ASOF, FIXTURE_CAL).clamp.of).toBe(0);
    expect(revisionModel([at('in', d('2015-01-01'))], ASOF, FIXTURE_CAL).clamp.of).toBe(1);
    expect(revisionModel([at('after', ASOF + 1)], ASOF, FIXTURE_CAL).clamp.of).toBe(0);
  });

  it('permitIssued pair: the end day stands in when a completed history has no complete day', () => {
    const eff: Partial<Record<Stage, Day>> = {
      filed: d('2018-01-01'),
      permitFiled: d('2019-01-01'),
      permitIssued: d('2020-01-01')
    };
    const make = (id: string, endDay: Day): NormHistory => {
      const h = hist(id, eff, { permitFiled: 4, complete: 8 }, true);
      return { ...h, end: { kind: 'complete', day: endDay } };
    };
    expect(revisionModel([make('in', d('2023-01-01'))], ASOF, FIXTURE_CAL).clamp.of).toBe(1);
    expect(revisionModel([make('old', d('2014-01-01'))], ASOF, FIXTURE_CAL).clamp.of).toBe(0);
  });

  it('permitIssued pair: skipped when permitIssued is the first stage', () => {
    const first = hist(
      'first',
      { permitIssued: d('2020-01-01'), complete: d('2023-01-01') },
      { permitFiled: 4, complete: 8 },
      true
    );
    expect(revisionModel([first], ASOF, FIXTURE_CAL).clamp.of).toBe(0);
  });

  it('rounds probability to 6 decimals', () => {
    const norm = [pf('a', 10, 5), pf('b', 10, 10), pf('c', 10, 10)];
    const cal: CalProfile = { ...FIXTURE_CAL, revMinN: 3 };
    expect(at(revisionModel(norm, ASOF, cal).revision, 'permitFiled').probability).toBe(0.333333);
  });

  it('never revises a first stage', () => {
    // a project whose first stage is permitFiled has no earlier stage to compare
    const first = hist('first', { permitFiled: d('2019-01-01') }, { filed: 4, permitFiled: 8 });
    const { clamp } = revisionModel([first], ASOF, FIXTURE_CAL);
    expect(clamp.of).toBe(0);
  });
});

describe('revisionModel: ratios and the clamp', () => {
  it('bins a 1-to-5 resize in the last bin [2, 3] (clamped to exactly 3)', () => {
    const { revision, clamp } = revisionModel([pf('a', 1, 5), pf('b', 4, 4)], ASOF, FIXTURE_CAL);
    const probs = at(revision, 'permitFiled').ratio.probs;
    expect(probs).toHaveLength(9);
    expect(probs[8]).toBe(1);
    expect(clamp).toEqual({ fired: 1, of: 1, sample: ['a:permitFiled'] });
  });

  it('fires the clamp on a 10-to-1 resize and lands it in [0.25, 0.5)', () => {
    const { revision, clamp } = revisionModel([pf('a', 10, 1), pf('b', 4, 4)], ASOF, FIXTURE_CAL);
    const probs = at(revision, 'permitFiled').ratio.probs;
    expect(probs[0]).toBe(1);
    expect(clamp).toEqual({ fired: 1, of: 1, sample: ['a:permitFiled'] });
  });

  it('does not fire the clamp on ratios exactly at 0.25 or 3', () => {
    const norm = [pf('a', 4, 1), pf('b', 2, 6), pf('c', 4, 5)];
    const { clamp, revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    expect(clamp).toEqual({ fired: 0, of: 3, sample: [] });
    const probs = at(revision, 'permitFiled').ratio.probs;
    expect(probs[0]).toBeCloseTo(1 / 3, 5);
    expect(probs[8]).toBeCloseTo(1 / 3, 5);
    expect(probs[6]).toBeCloseTo(1 / 3, 5); // 1.25 falls in [1.25, 1.5)
  });

  it('bins shrink and grow separably at edge 1', () => {
    const norm = [pf('a', 10, 9), pf('b', 10, 11), pf('c', 10, 5)];
    const { revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    const { probs } = at(revision, 'permitFiled').ratio;
    expect(probs[3]).toBeCloseTo(1 / 3, 5); // 0.9 in [0.9, 1)
    expect(probs[5]).toBeCloseTo(1 / 3, 5); // 1.1 in [1.1, 1.25)
    expect(probs[1]).toBeCloseTo(1 / 3, 5); // 0.5 in [0.5, 0.75)
    expect(probs[4]).toBe(0);
  });

  it('counts clamped pairs of both types, sample sorted as <id>:<stage>', () => {
    const norm = [pf('z', 10, 1), done('b', 1, 5), pf('c', 10, 10), done('a', 10, 1)];
    const { clamp } = revisionModel(norm, ASOF, FIXTURE_CAL);
    // pairs: z (permitFiled), c (permitFiled, unchanged), b and a (permitIssued)
    expect(clamp.of).toBe(3);
    expect(clamp.fired).toBe(3);
    expect(clamp.sample).toEqual(['a:permitIssued', 'b:permitIssued', 'z:permitFiled']);
  });

  it('each entry has the edges, probs summing to 1 and a probability in [0, 1]', () => {
    const norm = [pf('a', 10, 3), pf('b', 10, 7), pf('c', 10, 13), pf('d', 7, 7)];
    const { revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    for (const a of revision.at) {
      expect(a.ratio.edges).toEqual(REVISION_EDGES);
      expect(Math.round(sum(a.ratio.probs) * 1e6)).toBe(1_000_000);
      expect(a.probability).toBeGreaterThanOrEqual(0);
      expect(a.probability).toBeLessThanOrEqual(1);
    }
  });
});

describe('revisionModel: carried-back earlier counts (partner ruling, sc.revision.carried-excluded)', () => {
  /** `h` as project-records writes it when Ruling U1 carried a later count back to filing. */
  const carriedQ = (h: NormHistory, rule = 'pr.units.split-filed'): NormHistory => ({
    ...h,
    src: { ...h.src, quality: [rule] }
  });

  it('leaves a carried history out of the permitFiled pair; the same history uncarried counts', () => {
    const base = [pf('a', 10, 20), pf('b', 10, 10)];
    const withCarried = revisionModel([...base, carriedQ(pf('c', 8, 8))], ASOF, FIXTURE_CAL);
    // c is not counted as unrevised: 1 revised of 2 pairs
    expect(at(withCarried.revision, 'permitFiled').probability).toBe(0.5);
    expect(withCarried.revision.provenance.n).toBe(2);
    const uncarried = revisionModel([...base, pf('c', 8, 8)], ASOF, FIXTURE_CAL);
    expect(at(uncarried.revision, 'permitFiled').probability).toBe(0.333333);
    expect(uncarried.revision.provenance.n).toBe(3);
    expect(uncarried.carried).toEqual({ fired: 0, of: 3, sample: [] });
  });

  it('computes the ratio histogram and the clamp without the carried pair', () => {
    const carried = carriedQ(pf('c', 1, 5), 'pr.units.filed-zero');
    const { revision, clamp } = revisionModel(
      [pf('a', 10, 5), pf('b', 10, 5), carried],
      ASOF,
      FIXTURE_CAL
    );
    const probs = at(revision, 'permitFiled').ratio.probs;
    expect(probs[1]).toBe(1); // a's and b's 0.5 only
    expect(probs[8]).toBe(0); // c's clamped 5x is not binned
    expect(clamp).toEqual({ fired: 0, of: 2, sample: [] });
  });

  it("keeps a carried history's permitIssued pair, which uses no carried count", () => {
    const h = hist(
      'c',
      {
        filed: d('2018-01-01'),
        permitFiled: d('2019-01-01'),
        permitIssued: d('2020-01-01'),
        construction: d('2021-01-01'),
        complete: d('2023-01-01')
      },
      { filed: 8, permitFiled: 8, complete: 12 },
      true
    );
    const norm = [carriedQ(h), done('d', 10, 10)];
    const { revision, carried } = revisionModel(norm, ASOF, FIXTURE_CAL);
    expect(at(revision, 'permitIssued').probability).toBe(0.5);
    expect(carried).toEqual({ fired: 1, of: 3, sample: ['c:permitFiled'] });
  });

  it('tallies excluded pairs of the windowed pairs before the exclusion, sorted <id>:<stage>', () => {
    const early = carriedQ(
      hist(
        'early',
        { filed: d('2013-01-01'), permitFiled: d('2014-06-01') },
        { filed: 4, permitFiled: 4 }
      )
    );
    const norm = [
      carriedQ(pf('z', 6, 6)),
      pf('a', 10, 12),
      carriedQ(pf('m', 3, 3), 'pr.units.filed-zero'),
      early
    ];
    const { carried, revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    expect(carried).toEqual({ fired: 2, of: 3, sample: ['m:permitFiled', 'z:permitFiled'] });
    expect(revision.provenance.method).toContain(
      '2 pairs with a carried-back earlier home count excluded (partner ruling; rule sc.revision.carried-excluded)'
    );
  });
});

describe('revisionModel: pooling and fallback', () => {
  const cal: CalProfile = { ...FIXTURE_CAL, revMinN: 3 };

  it('an entry below revMinN pairs uses all pairs pooled', () => {
    // permitFiled: 3 pairs (1 revised, 0.5x); permitIssued: 2 pairs (both revised, 2x)
    const norm = [
      pf('a', 10, 10),
      pf('b', 10, 10),
      pf('c', 10, 5),
      done('d', 10, 20),
      done('e', 10, 20)
    ];
    const { revision } = revisionModel(norm, ASOF, cal);
    const own = at(revision, 'permitFiled');
    const pooled = at(revision, 'permitIssued');
    expect(own.probability).toBe(0.333333);
    expect(pooled.probability).toBe(0.6); // 5 pairs, 3 revised
    expect(pooled.ratio.probs[1]).toBeCloseTo(1 / 3, 5); // 0.5
    expect(pooled.ratio.probs[8]).toBeCloseTo(2 / 3, 5); // 2.0 in [2, 3]
    expect(revision.provenance.tier).toBe(2);
    expect(revision.provenance.method).toContain('pooled');
  });

  it('pooled pairs also below revMinN: probability 0, tier 4, no revision evidence', () => {
    const { revision } = revisionModel([pf('a', 10, 20), done('b', 10, 20)], ASOF, cal);
    for (const a of revision.at) {
      expect(a.probability).toBe(0);
      expect(Math.round(sum(a.ratio.probs) * 1e6)).toBe(1_000_000);
    }
    checkProvenance(revision.provenance);
    expect(revision.provenance.tier).toBe(4);
    expect(revision.provenance.method).toContain('no revision evidence');
  });

  it('with no histories every probability is 0 and the clamp reports 0 of 0', () => {
    const { revision, clamp, carried } = revisionModel([], ASOF, LIVE_CAL);
    expect(revision.at.map((a) => a.probability)).toEqual([0, 0]);
    expect(clamp).toEqual({ fired: 0, of: 0, sample: [] });
    expect(carried).toEqual({ fired: 0, of: 0, sample: [] });
  });
});

describe('revisionModel: provenance and output', () => {
  it('is tier 2 with n (pairs) and window, naming the attribution and the clamp', () => {
    const norm = [pf('a', 10, 20), pf('b', 10, 10), done('c', 10, 20), done('d', 10, 10)];
    const { revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    checkProvenance(revision.provenance);
    expect(revision.provenance.tier).toBe(2);
    expect(revision.provenance.n).toBe(4);
    expect(revision.provenance.window).toEqual(['2015-01-01', '2026-09-30']);
    expect(revision.provenance.method).toContain('sc.revision.ratio-clamp');
    expect(revision.provenance.method).toContain('permitIssued');
  });

  it('is deterministic under input order', () => {
    const norm = [pf('a', 10, 20), pf('b', 10, 1), done('c', 10, 20), done('d', 10, 10)];
    const a = revisionModel(norm, ASOF, FIXTURE_CAL);
    const b = revisionModel([...norm].reverse(), ASOF, FIXTURE_CAL);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('fits into the calibration-small fixture and passes parseCalibration', () => {
    const norm = [pf('a', 10, 20), pf('b', 10, 1), done('c', 10, 20), done('d', 10, 10)];
    const { revision } = revisionModel(norm, ASOF, FIXTURE_CAL);
    const cal = { ...(small as unknown as Calibration), revision };
    expect(parseCalibration(JSON.parse(JSON.stringify(cal))).revision.at).toHaveLength(2);
  });
});
