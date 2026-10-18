// SizeModel (spec §4.8): snapping, r > 1, bucket merging, fallback.
import { describe, expect, it } from 'vitest';
import { FILL_LEVELS } from '../../../src/lib/data/scenario-codec';
import { parseCalibration } from '../../../src/lib/timelapse/model';
import small from '../../../src/lib/timelapse/fixtures/calibration-small.json';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import { sizeModel } from '../../lib/fzp-cal/size';
import type { NormHistory } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import type { Calibration, Day, Provenance, Stage } from '../../../src/lib/timelapse/types';

const d = isoToDay;
const ASOF = d('2026-09-30');

function hist(
  id: string,
  eff: Partial<Record<Stage, Day>>,
  stories: number | null,
  base: number | null
): NormHistory {
  const end = { kind: 'open', lastObserved: ASOF } as const;
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
      unitsAt: {},
      existingUnits: 0,
      storiesProposed: stories,
      baseStoriesAtFiling: base,
      sources: [],
      quality: []
    }
  };
}

/** `n` histories filed in 2020 with base stories `base` and proposed stories `stories`. */
function group(prefix: string, n: number, stories: number, base: number): NormHistory[] {
  return Array.from({ length: n }, (_, i) =>
    hist(`${prefix}${i}`, { filed: d('2020-03-01') }, stories, base)
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

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('sizeModel: snapping on the F = 5 grid', () => {
  it('snaps r to the nearest fill level, ties going up', () => {
    const cases: [number, number, number][] = [
      [12, 20, 1], // r = 0.6 -> 0.5 (index 1)
      [5, 8, 2], // r = 0.625: tie between 0.5 and 0.75 -> 0.75 (index 2)
      [1, 20, 0], // r = 0.05 -> lowest level
      [18, 20, 3], // r = 0.9 -> 0.9
      [20, 20, 4] // r = 1 -> 1
    ];
    for (const [stories, base, index] of cases) {
      const norm = group('a', 3, stories, base);
      const { size } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
      const probs = size.byEnvelope.find((b) => base <= b.maxStoriesUpTo)!.probs;
      expect(probs[index]).toBe(1);
    }
  });

  it('snaps the 0.25 / 0.5 tie (r = 0.375) up to 0.5', () => {
    const { size } = sizeModel(group('a', 3, 3, 8), ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(size.byEnvelope[0].probs).toEqual([0, 1, 0, 0, 0]);
  });

  it('maps r > 1 to fill 1 and counts it in overEnvelope, stated in the method', () => {
    const norm = [...group('a', 2, 10, 10), ...group('b', 1, 14, 10)]; // r = 1.4 once
    const { size, overEnvelope } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(overEnvelope).toEqual({ fired: 1, of: 3 });
    expect(size.byEnvelope.at(-1)!.probs).toEqual([0, 0, 0, 0, 1]);
    expect(size.provenance.method).toContain(
      'r > 1, mostly density-bonus projects, counted as fill 1: 1 of 3'
    );
  });

  it('does not count r = 1 as over the envelope', () => {
    const { overEnvelope } = sizeModel(group('a', 3, 10, 10), ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(overEnvelope).toEqual({ fired: 0, of: 3 });
  });
});

describe('sizeModel: measurement population', () => {
  it('uses only histories whose first record is in [2015-01-01, asOf] with both stories >= 1', () => {
    const norm = [
      ...group('ok', 3, 5, 10),
      hist('old', { filed: d('2014-12-31') }, 10, 10),
      hist('late', { filed: ASOF + 1 }, 10, 10),
      hist('nostory', { filed: d('2020-01-01') }, null, 10),
      hist('nobase', { filed: d('2020-01-01') }, 10, null),
      hist('zero', { filed: d('2020-01-01') }, 0, 10),
      hist('zerobase', { filed: d('2020-01-01') }, 10, 0),
      hist('nodays', {}, 10, 10)
    ];
    const { size, overEnvelope } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(overEnvelope.of).toBe(3);
    expect(size.provenance.n).toBe(3);
  });

  it('takes the first record as the earliest entered day of any stage', () => {
    const norm = [
      hist('p', { preApplication: d('2016-01-01'), filed: d('2017-01-01') }, 5, 10),
      hist('q', { filed: d('2015-01-01') }, 5, 10),
      hist('r', { permitFiled: d('2019-01-01'), filed: d('2014-06-01') }, 5, 10)
    ];
    const { overEnvelope } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(overEnvelope.of).toBe(2);
  });
});

describe('sizeModel: buckets, merging and rounding', () => {
  it('assigns a history to the first bucket whose edge is >= its base stories', () => {
    const norm = [
      ...group('a', 2, 4, 4), // edge 4
      ...group('b', 2, 5, 5), // edge 6
      ...group('c', 2, 8, 8), // edge 8
      ...group('d', 2, 12, 12), // edge 12
      ...group('e', 2, 30, 30) // edge 999
    ];
    const { size } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(size.byEnvelope.map((b) => b.maxStoriesUpTo)).toEqual([4, 6, 8, 12, 999]);
    for (const b of size.byEnvelope) expect(b.probs).toEqual([0, 0, 0, 0, 1]);
    expect(size.fillLevels).toEqual([...FILL_LEVELS]);
  });

  it('merges a thin (here, empty) bucket into its lower neighbour', () => {
    // sizeMinN = 2 (fixture): edge 6 has 1 history, edges 8 and 12 none: all merge into edge 4
    const norm = [...group('a', 3, 2, 4), ...group('b', 1, 6, 6), ...group('c', 3, 30, 30)];
    const { size } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(size.byEnvelope.map((b) => b.maxStoriesUpTo)).toEqual([12, 999]);
    // merged bucket: three at r = 0.5, one at r = 1
    expect(size.byEnvelope[0].probs).toEqual([0, 0.75, 0, 0, 0.25]);
  });

  it('merges a thin first bucket into its upper neighbour', () => {
    const norm = [...group('a', 1, 2, 4), ...group('b', 3, 6, 6), ...group('c', 3, 30, 30)];
    const { size } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    // edge 4 (1 history) joins edge 6 (3); the empty edges 8 and 12 join that group
    expect(size.byEnvelope.map((b) => b.maxStoriesUpTo)).toEqual([12, 999]);
    expect(size.byEnvelope[0].probs).toEqual([0, 0.25, 0, 0, 0.75]);
  });

  it('carries a thin first bucket through further thin buckets until the group is big enough', () => {
    const cal = { ...FIXTURE_CAL, sizeMinN: 3 };
    const norm = [
      ...group('a', 1, 4, 4),
      ...group('b', 1, 6, 6),
      ...group('c', 3, 8, 8),
      ...group('e', 3, 12, 12),
      ...group('d', 3, 40, 40)
    ];
    const { size } = sizeModel(norm, ASOF, cal, FILL_LEVELS);
    expect(size.byEnvelope.map((b) => b.maxStoriesUpTo)).toEqual([8, 12, 999]);
    expect(size.byEnvelope[0].probs).toEqual([0, 0, 0, 0, 1]);
  });

  it('merges a thin last bucket into the one below, ending at 999', () => {
    const norm = [...group('a', 4, 10, 10), ...group('b', 1, 30, 30)];
    const { size } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(size.byEnvelope.map((b) => b.maxStoriesUpTo)).toEqual([999]);
  });

  it('rounds probs to 6 decimals and adds the residual to the largest so they sum to 1', () => {
    // one history each at r = 0.25, 0.5, 0.75: thirds
    const norm = [...group('a', 1, 1, 4), ...group('b', 1, 2, 4), ...group('c', 1, 3, 4)];
    const { size } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    const probs = size.byEnvelope[0].probs;
    expect(probs).toEqual([0.333334, 0.333333, 0.333333, 0, 0]);
    expect(Math.round(sum(probs) * 1e6)).toBe(1_000_000);
  });

  it('is deterministic under input order', () => {
    const norm = [...group('a', 3, 5, 10), ...group('b', 4, 9, 10), ...group('c', 2, 14, 10)];
    const a = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    const b = sizeModel([...norm].reverse(), ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('sizeModel: tier and fallback', () => {
  it('is tier 2 with n and window, noting baseStoriesAtFiling is a tier-3 proxy', () => {
    const { size } = sizeModel(group('a', 5, 5, 10), ASOF, FIXTURE_CAL, FILL_LEVELS);
    checkProvenance(size.provenance);
    expect(size.provenance.tier).toBe(2);
    expect(size.provenance.n).toBe(5);
    expect(size.provenance.window).toEqual(['2015-01-01', '2026-09-30']);
    expect(size.provenance.method).toContain('tier-3 proxy');
  });

  it('falls back to a point mass at fill 1, tier 3, below sizeMinN histories', () => {
    const { size, overEnvelope } = sizeModel(group('a', 29, 5, 10), ASOF, LIVE_CAL, FILL_LEVELS);
    expect(size.byEnvelope).toEqual([{ maxStoriesUpTo: 999, probs: [0, 0, 0, 0, 1] }]);
    checkProvenance(size.provenance);
    expect(size.provenance.tier).toBe(3);
    expect(size.provenance.method).toContain('29');
    expect(overEnvelope).toEqual({ fired: 0, of: 29 });
  });

  it('falls back with no histories at all', () => {
    const { size } = sizeModel([], ASOF, FIXTURE_CAL, FILL_LEVELS);
    expect(size.provenance.tier).toBe(3);
    expect(size.byEnvelope).toHaveLength(1);
  });
});

describe('sizeModel: output passes parseCalibration', () => {
  it('fits into the calibration-small fixture', () => {
    const norm = [...group('a', 5, 5, 10), ...group('b', 4, 9, 10), ...group('c', 3, 30, 30)];
    const { size } = sizeModel(norm, ASOF, FIXTURE_CAL, FILL_LEVELS);
    const cal = { ...(small as unknown as Calibration), size };
    expect(parseCalibration(JSON.parse(JSON.stringify(cal))).size.byEnvelope.length).toBe(
      size.byEnvelope.length
    );
  });
});
