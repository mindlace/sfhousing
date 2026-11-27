// The round panel's text and the gift's explainers (pure).
import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import { offerThrough } from './offer';
import { giftItems, roundPanel } from './round-panel';
import { takeWin } from './rounds';
import { NEW_GAME, type GameState } from './state';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const d = (y: number, m: number) => dayFromUtc(y, m, 1);
const LEGAL = dayFromUtc(2066, 9, 30);
const win = (round: number, goalMonth: number | null, beat: number | null, y = 2060) => ({
  round,
  goalMonth: goalMonth === null ? null : d(y, goalMonth),
  beat: beat === null ? null : d(y + 1, beat),
  at: '2026-11-26T00:00:00.000Z',
  datasetVersion: 'fixture-0'
});
const state = (over: Partial<GameState>): GameState => ({
  ...NEW_GAME,
  phase: 'runs',
  ...over
});
const withRound = (round: number, on: string[] = []): SimPolicy4 => {
  const doc = offerThrough(DEFAULT_POLICY4, round, cal);
  const flip = (p: { id: string; preset: string | null; on: boolean }) =>
    on.includes(p.id) || (p.preset !== null && on.includes(p.preset)) ? { ...p, on: true } : p;
  return {
    ...doc,
    kinds: {
      zoning: doc.kinds.zoning.map(flip),
      permitting: doc.kinds.permitting.map(flip),
      money: doc.kinds.money.map(flip)
    }
  } as SimPolicy4;
};

describe('roundPanel', () => {
  it('round 0: no policies yet, nothing earlier', () => {
    expect(roundPanel(state({ round: 0 }), DEFAULT_POLICY4, LEGAL)).toEqual({
      title: 'Current law',
      items: ['No policies yet'],
      earlier: []
    });
  });

  it("round 1 lists the round's policies with their rules as set, off marked", () => {
    const data = roundPanel(state({ round: 1 }), withRound(1, ['transit-rail']), LEGAL);
    expect(data.title).toBe('Round 1');
    expect(data.items).toEqual([
      'Taller near BART and Caltrain: 75 ft within 402 m, 65 ft from 402 to 805 m',
      'SB 423 clock (off): streamlined approvals meet the state deadline',
      'Housing bond (off): a City bond for affordable homes, repaid over 20 years'
    ]);
  });

  it('a policy missing from the document reads as off', () => {
    const data = roundPanel(state({ round: 1 }), DEFAULT_POLICY4, LEGAL);
    expect(data.items.every((i) => i.includes(' (off)'))).toBe(true);
    expect(data.items).toHaveLength(3);
  });

  it('shows the rules as the policy is set, not the catalogue values', () => {
    const doc = withRound(1, ['transit-rail']);
    const edited: SimPolicy4 = {
      ...doc,
      kinds: {
        ...doc.kinds,
        zoning: doc.kinds.zoning.map((p) => ({
          ...p,
          spans: p.spans.map((s) => ({
            ...s,
            what: { tag: 'bands' as const, bands: [{ maxM: 500, stories: 9 }] }
          }))
        }))
      }
    };
    const data = roundPanel(state({ round: 1 }), edited, LEGAL);
    expect(data.items[0]).toBe('Taller near BART and Caltrain: 9 stories within 500 m');
  });

  it('earlier rounds read what was achieved, newest first', () => {
    const s = state({
      round: 3,
      wins: [win(0, 10, null, 2062), win(1, 6, 10, 2060), win(2, 3, 6, 2058)]
    });
    const data = roundPanel(s, withRound(3), LEGAL);
    expect(data.earlier).toEqual([
      'Round 2: goal reached Mar 2058, 1 yr 3 mo earlier',
      'Round 1: goal reached Jun 2060, 1 yr 4 mo earlier',
      'Baseline: Oct 2062'
    ]);
  });

  it('a win with no month to beat has no "earlier"', () => {
    const s = state({ round: 2, wins: [win(0, 10, null, 2062), win(1, 6, null)] });
    expect(roundPanel(s, withRound(2), LEGAL).earlier).toEqual([
      'Round 1: goal reached Jun 2060',
      'Baseline: Oct 2062'
    ]);
  });

  it('a baseline past the window reads "after" the legal deadline', () => {
    const s = state({ round: 1, wins: [win(0, null, null)] });
    expect(roundPanel(s, withRound(1), LEGAL).earlier).toEqual(['Baseline: after Sep 2066']);
  });

  it('a finished game shows every policy, no list, and what was achieved', () => {
    const s = state({ round: 4, finished: true, wins: [win(4, 6, 10, 2060)] });
    expect(roundPanel(s, withRound(4), LEGAL)).toEqual({
      title: 'Every policy',
      items: [],
      earlier: ['Round 4: goal reached Jun 2060, 1 yr 4 mo earlier']
    });
  });
});

describe('giftItems', () => {
  const taken = (s: GameState, on: string[] = []) =>
    takeWin(s, {
      goalMonth: d(2060, 6),
      on: new Set(on),
      datasetVersion: 'fixture-0',
      at: '2026-11-26T00:00:00.000Z'
    });

  it('a round-0 win gives the three round-1 explainers, with fixed rules for zoning', () => {
    const before = state({ round: 0 });
    const items = giftItems(before, taken(before));
    expect(items.map((i) => i.title)).toEqual([
      'Taller near BART and Caltrain',
      'SB 423 clock',
      'Housing bond'
    ]);
    expect(items[0]).toEqual({
      title: 'Taller near BART and Caltrain',
      line: "What if SB 79's default tiers applied near BART and Caltrain: Tier 1 heights.",
      rules: '75 ft within 402 m, 65 ft from 402 to 805 m.'
    });
    expect(items[1].line).toBe('Streamlined approvals meet the state deadline.');
    expect(items[1].rules).toBe('');
  });

  it('the win of the last round finishes the game: one explainer for every policy', () => {
    const before = state({ round: 4 });
    expect(giftItems(before, taken(before))).toEqual([
      { title: 'Every policy', line: 'Every lever is yours to add and edit.', rules: '' }
    ]);
  });

  it('a win in a finished game has none', () => {
    const before = state({ round: 4, finished: true });
    expect(giftItems(before, taken(before))).toEqual([]);
  });
});
