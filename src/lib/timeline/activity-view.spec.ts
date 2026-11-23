import { describe, expect, it } from 'vitest';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, TierUnits } from '$lib/timelapse/types';
import type { TimelineView } from '$lib/sim/world/score/types';
import { moneyFigureAt } from '$lib/fzp/money-view';
import { allowedAt } from '$lib/game/allowed';
import { addChoices } from './add';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from './policy4';
import {
  ACTIVITY_COPY,
  activityTotals,
  eventText,
  moneyInForce,
  startersFor
} from './activity-view';
import type { ActivityEvent } from './activity';
import { STAGE_KEY } from '$lib/map/key/rows';
import { dayFromUtc } from '$lib/fzp/time';
import { chunk, cut, statics } from './test/fixtures';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const calNoMoney: Calibration = { ...miniCal, market: undefined, baselineFunding: undefined };

const view = (pools?: string[]): TimelineView =>
  viewOfLog(
    logFilled(
      logCompiled(EMPTY_LOG, statics({ lastIndex: 23, finance: !!pools })),
      chunk(0, 24, { pools })
    )
  )!;

const tier = (k: number): TierUnits => ({
  veryLow: k,
  low: 2 * k,
  moderate: 3 * k,
  aboveModerate: 100 * k,
  unrecorded: 4
});

const OFF = { provisional: false, inForce: false, moneyInForce: false };

const fund = (on: boolean, spans: boolean): Policy => ({
  id: 'm1',
  label: 'A housing bond',
  preset: 'housing-bond',
  on,
  where: { tag: 'fund', pool: 'u-pool-1' },
  spans: spans ? [{ from: 0, to: null, what: { tag: 'fund', pool: null, programmes: [] } }] : []
});
const withMoney = (p: Policy): SimPolicy4 => ({
  ...DEFAULT_POLICY4,
  kinds: { ...DEFAULT_POLICY4.kinds, money: [p] }
});

describe('activityTotals', () => {
  it('activityTotals is null at today, while provisional and past the filled month', () => {
    const v = view();
    expect(activityTotals(null, { index: 3, atToday: false }, OFF)).toBeNull();
    expect(activityTotals(v, { index: 0, atToday: true }, OFF)).toBeNull();
    expect(activityTotals(v, { index: 3, atToday: false }, { ...OFF, provisional: true })).toBe(
      null
    );
    expect(activityTotals(cut(v, 5), { index: 6, atToday: false }, OFF)).toBeNull();
    expect(activityTotals(cut(v, 5), { index: 5, atToday: false }, OFF)).not.toBeNull();
  });

  it('reads rows[i]: approved entitledNew, completed completedNet, stopped exitedUnits', () => {
    const v = view();
    const t = activityTotals(v, { index: 7, atToday: false }, OFF)!;
    expect(t.approved).toBe(v.rows[7].entitledNew);
    expect(t.completed).toBe(v.rows[7].completedNet);
    expect(t.stopped).toBe(v.rows[7].exitedUnits);
    // The fixture's literal values, so the test does not only restate the reads.
    expect([t.approved, t.completed, t.stopped]).toEqual([23, 22, 1]);
  });

  it('affordable counts completed tiers from today, without the baseline', () => {
    const v = view();
    expect(activityTotals(v, { index: 2, atToday: false }, OFF)!.affordable).toBeNull();
    const tiers = { ...v, tiers: v.rows.map((_, k) => tier(k)) };
    // veryLow + low + moderate + unrecorded at month 5: 5 + 10 + 15 + 4.
    expect(activityTotals(tiers, { index: 5, atToday: false }, OFF)!.affordable).toBe(34);
  });

  it('effect only in force; cost only while a Public money policy is on with a span', () => {
    const v = view(['u-pool-1']);
    const at = { index: 6, atToday: false };
    const none = activityTotals(v, at, OFF)!;
    expect(none.effect).toBeNull();
    expect(none.cost).toBeNull();
    const inForce = activityTotals(v, at, { ...OFF, inForce: true })!;
    expect(inForce.effect).toBe(v.planEffect[6].completedNetNew);
    expect(inForce.cost).toBeNull();
    const money = activityTotals(v, at, { ...OFF, inForce: true, moneyInForce: true })!;
    expect(money.cost).toEqual({
      spent: v.money!.publicSpent[6],
      perAddedHome: moneyFigureAt(v.money!, 6).perAddedHome.all
    });
    expect(money.cost!.spent).toBe(700);
    // A view without money has no cost to show, policy or not.
    expect(activityTotals(view(), at, { ...OFF, inForce: true, moneyInForce: true })!.cost).toBe(
      null
    );
  });
});

describe('moneyInForce', () => {
  it('moneyInForce: an off money policy or one with no span is not in force', () => {
    expect(moneyInForce(DEFAULT_POLICY4)).toBe(false);
    expect(moneyInForce(withMoney(fund(false, true)))).toBe(false);
    expect(moneyInForce(withMoney(fund(true, false)))).toBe(false);
    expect(moneyInForce(withMoney(fund(true, true)))).toBe(true);
    // A zoning policy alone is not public money.
    const zoningOnly: SimPolicy4 = {
      ...DEFAULT_POLICY4,
      kinds: {
        ...DEFAULT_POLICY4.kinds,
        zoning: [{ ...fund(true, true), id: 'z', where: { tag: 'painted' } }]
      }
    };
    expect(moneyInForce(zoningOnly)).toBe(false);
  });
});

describe('startersFor', () => {
  it('startersFor: three when offered; a calibration without money gives two', () => {
    const s = startersFor(cal, DEFAULT_POLICY4);
    expect(s.map((x) => x.text)).toEqual([
      'Taller near transit',
      'SB 423 approval clock',
      'A housing bond'
    ]);
    expect(s.map((x) => x.label)).toEqual([
      'Transit rule',
      'SB 423 approval clock',
      'A housing bond'
    ]);
    expect(s.map((x) => x.choice)).toEqual([
      { kind: 'zoning', what: 'transit' },
      { kind: 'permitting', what: 'preset', preset: 'sb423Clock' },
      { kind: 'money', what: 'preset', preset: 'housing-bond' }
    ]);
    // Each is what the add menu offers, under the menu's own label.
    for (const x of s) {
      const offered = addChoices(x.choice.kind, cal, DEFAULT_POLICY4);
      expect(offered).toContainEqual({ choice: x.choice, label: x.label });
    }
    expect(startersFor(calNoMoney, DEFAULT_POLICY4).map((x) => x.text)).toEqual([
      'Taller near transit',
      'SB 423 approval clock'
    ]);
  });

  it('only what the level allows', () => {
    expect(startersFor(cal, DEFAULT_POLICY4, allowedAt(2))).toEqual([]);
    expect(startersFor(cal, DEFAULT_POLICY4, allowedAt(3)).map((x) => x.text)).toEqual([
      'SB 423 approval clock'
    ]);
  });
});

describe('copy', () => {
  it('every ACTIVITY_COPY string and starter text is under 12 words, with no RHNA or FZP', () => {
    const texts = [
      ...Object.values(ACTIVITY_COPY),
      ...startersFor(cal, DEFAULT_POLICY4).map((s) => s.text)
    ];
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) {
      expect(t.split(/\s+/).length).toBeLessThan(12);
      expect(t).not.toMatch(/RHNA|FZP/);
    }
    expect(ACTIVITY_COPY).toEqual({
      heading: 'Activity',
      details: 'Details',
      tryOne: 'Try one:',
      play: 'Press Play to see what gets built.',
      approved: 'Approved in new projects',
      completed: 'Completed',
      stopped: 'Stopped',
      affordable: 'Affordable',
      effect: 'From your policy',
      spent: 'All public money spent',
      perHome: 'Per added home',
      noneAdded: 'no homes added yet',
      latest: 'Latest',
      noEvents: 'No stage changes yet.',
      policyMark: '◆',
      underPolicy: 'Under your policy'
    });
  });
});

describe('eventText', () => {
  const day = dayFromUtc(2031, 3, 14);
  const ev = (kind: ActivityEvent['kind'], homes = 120): ActivityEvent => ({
    row: 4,
    kind,
    day,
    homes,
    lngLat: [-122.42, 37.76],
    policy: false
  });

  it('eventText: the key\'s stage word, "120 homes", "Mission", "Mar 2031"; no place: null', () => {
    expect(eventText(ev('started'), 'Mission')).toEqual({
      stage: 'Building',
      homes: '120 homes',
      place: 'Mission',
      when: 'Mar 2031'
    });
    expect(eventText(ev('approved'), null)).toEqual({
      stage: 'Approved',
      homes: '120 homes',
      place: null,
      when: 'Mar 2031'
    });
    expect(eventText(ev('completed', 1), null).homes).toBe('1 home');
    expect(eventText(ev('completed', 1200), null).homes).toBe('1,200 homes');
    // The map key's own words, so the two cannot drift.
    const key = Object.fromEntries(STAGE_KEY.map((r) => [r.id, r.label]));
    expect(eventText(ev('approved'), null).stage).toBe(key.approved);
    expect(eventText(ev('started'), null).stage).toBe(key.building);
    expect(eventText(ev('completed'), null).stage).toBe(key.completed);
  });
});
