import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { NEW_GAME } from './state';
import { CATALOGUE, ROUNDS } from './catalogue/rounds';
import { V2_KEYS, V2_LADDER_YEARS, upgradeV2 } from './upgrade';

const T = '2026-11-02T00:00:00.000Z';
const T2 = '2026-11-20T00:00:00.000Z';

type V2 = Record<string, unknown>;

/** A version 2 state as the old build wrote it, in the runs with one run played. */
function v2(over: V2 = {}): V2 {
  return {
    v: 2,
    phase: 'runs',
    firstWinAt: T,
    bought: {},
    units: { home: 120 },
    rung: 0,
    met: [],
    side: {},
    runs: 1,
    last: null,
    ...over
  };
}

const met = (rung: number, reachedOn: number, at = T) => ({
  rung,
  reachedOn,
  datasetVersion: 'fixture-0',
  at
});

describe('upgradeV2', () => {
  it('the version 2 ladder years', () => {
    expect(V2_LADDER_YEARS).toEqual([2060, 2055, 2045, 2040]);
  });

  it("the keys a bought node maps to are the catalogue's permitting and money keys", () => {
    const keys = CATALOGUE.filter((e) => e.kind !== 'zoning').map((e) => e.key);
    expect([...V2_KEYS]).toEqual([...keys].sort());
    expect(ROUNDS).toBe(V2_LADDER_YEARS.length);
  });

  it('an opening state is NEW_GAME with its firstWinAt', () => {
    expect(
      upgradeV2(v2({ phase: 'opening', firstWinAt: null, runs: 0, units: {}, bought: {} }))
    ).toEqual(NEW_GAME);
    expect(upgradeV2(v2({ phase: 'opening', firstWinAt: T, runs: 0 }))).toEqual({
      ...NEW_GAME,
      firstWinAt: T
    });
  });

  it('no run played: round 0 and nothing else', () => {
    expect(upgradeV2(v2({ runs: 0, bought: { 'sb423-clock': 1 } }))).toEqual({
      ...NEW_GAME,
      phase: 'runs',
      firstWinAt: T
    });
  });

  it('rung 1 with rungs 0 and 1 met: round 2, the 2060 target, the bought keys, two wins', () => {
    const r = upgradeV2(
      v2({
        rung: 1,
        runs: 4,
        bought: { 'sb423-clock': 1, 'stop-rail': 1, 'hands-radius': 2, 'housing-bond': 1 },
        met: [met(0, dayFromUtc(2061, 3, 17)), met(1, dayFromUtc(2058, 8, 2), T2)]
      })
    );
    expect(r).toEqual({
      v: 3,
      phase: 'runs',
      firstWinAt: T,
      round: 2,
      target: dayFromUtc(2060, 12, 1),
      editable: ['housing-bond', 'sb423-clock'],
      wins: [
        {
          round: 0,
          goalMonth: dayFromUtc(2061, 3, 1),
          beat: null,
          at: T,
          datasetVersion: 'fixture-0'
        },
        {
          round: 1,
          goalMonth: dayFromUtc(2058, 8, 1),
          beat: dayFromUtc(2060, 12, 1),
          at: T2,
          datasetVersion: 'fixture-0'
        }
      ],
      finished: false,
      own: true
    });
  });

  it('a run played with no rung met: no target, no wins', () => {
    const r = upgradeV2(v2({ rung: 0, runs: 3 }));
    expect(r).toMatchObject({ round: 1, target: null, wins: [], own: true, finished: false });
  });

  it('rung 4 met: round 4 and finished, the 2040 target', () => {
    const r = upgradeV2(
      v2({
        rung: 4,
        runs: 9,
        met: [0, 1, 2, 3, 4].map((rung) => met(rung, dayFromUtc(2035, 1, 9)))
      })
    );
    expect(r).toMatchObject({
      round: 4,
      finished: true,
      target: dayFromUtc(2040, 12, 1),
      own: true
    });
    expect(r?.wins.map((w) => w.beat)).toEqual([
      null,
      dayFromUtc(2060, 12, 1),
      dayFromUtc(2055, 12, 1),
      dayFromUtc(2045, 12, 1),
      dayFromUtc(2040, 12, 1)
    ]);
  });

  it('is lenient: a malformed last, units or side still upgrades; extra fields are ignored', () => {
    const r = upgradeV2(
      v2({
        rung: 1,
        met: [met(0, dayFromUtc(2061, 3, 17))],
        last: { rung: 'nope' },
        units: 'lots',
        side: null,
        extra: { anything: true }
      })
    );
    expect(r).toMatchObject({ round: 2, wins: [{ round: 0 }] });
  });

  it.each([
    ['no bought object', { bought: undefined }],
    ['bought an array', { bought: [] }],
    ['a bad phase', { phase: 'won' }],
    ['runs without a first win', { firstWinAt: null }],
    ['a bad firstWinAt', { firstWinAt: 'soon' }],
    ['a fractional rung', { rung: 1.5 }],
    ['negative runs', { runs: -1 }],
    ['met not an array', { met: {} }],
    ['a partial met entry', { met: [{ rung: 0 }] }]
  ])('null with %s', (_name, over) => {
    expect(upgradeV2(v2(over))).toBeNull();
  });
});
