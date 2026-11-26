import { describe, expect, it } from 'vitest';
import type { TransitBand } from '$lib/sim-page/policy';
import { OPEN_REACH_M } from '$lib/sim-page/transit-edit';
import type { StopType } from '$lib/sim/levers/brushes';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import { baselineFixture, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import { addPolicy, type AddChoice } from '$lib/timeline/add';
import { parsePolicy4 } from '$lib/timeline/parse4';
import {
  DEFAULT_POLICY4,
  type Policy,
  type PolicyKind,
  type Span,
  type SimPolicy4
} from '$lib/timeline/policy4';
import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
import { setOn } from '$lib/timeline/spans';
import { LADDER_YEARS } from './catalogue/ladder-years';
import { NODES } from './catalogue/nodes';
import { buyAndApply, type Played } from './catalogue/play';
import { applyGrant, GAME_TRANSIT_ID, type GrantCtx } from './grant';
import { limitsOf, OPEN_LIMITS, runnable, type Limits } from './limits';
import { NEW_GAME, type NodeId } from './state';
import { buy, type Branch, type Grant } from './tree';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const calNoFunding: Calibration = { ...miniCal, market: undefined, baselineFunding: undefined };
const asOf = cal.asOf;
const day1 = monthFirstDay(asOf, 1);
const addCtx = { w: { asOf, months: WINDOW_MONTHS }, month: 1, cal };

const { id: _id, ...ownPool } = fundingOnly().pools[0];
const fundChoice: AddChoice = { kind: 'money', what: 'fund', pool: ownPool };

/** Limits with nothing bought, then `over`. */
function lim(over: Partial<Limits> = {}): Limits {
  return {
    ...OPEN_LIMITS,
    open: false,
    presets: new Set(),
    measures: new Set(),
    stops: new Set(),
    bands: 0,
    stories: 0,
    reachM: 0,
    custom: false,
    ...over
  };
}

const ctxOf = (limits: Limits, c: Calibration = cal): GrantCtx => ({ cal: c, limits });

const b = (maxM: number, stories: number): TransitBand => ({ maxM, stories });

/** The game's transit rule with one span from month 1, or `spans`. */
function gameRule(stopTypes: StopType[], bands: TransitBand[], on = true, spans?: Span[]): Policy {
  return {
    id: GAME_TRANSIT_ID,
    label: 'Transit rule',
    preset: null,
    on,
    where: { tag: 'transit', stopTypes },
    spans: spans ?? [{ from: day1, to: null, what: { tag: 'bands', bands } }]
  };
}

const withZoning = (...zoning: Policy[]): SimPolicy4 => ({
  ...DEFAULT_POLICY4,
  kinds: { ...DEFAULT_POLICY4.kinds, zoning }
});

const bandsOf = (doc: SimPolicy4, span = 0): TransitBand[] => {
  const what = doc.kinds.zoning.find((p) => p.id === GAME_TRANSIT_ID)!.spans[span].what;
  return what.tag === 'bands' ? what.bands : [];
};

const SB423: Grant = { tag: 'preset', preset: 'sb423Clock' };
const BOND: Grant = { tag: 'measure', preset: 'housing-bond' };
const sb423Limits = () => lim({ presets: new Set(['sb423Clock']) });
const bondLimits = () => lim({ measures: new Set(['housing-bond']) });
const transitLimits = (over: Partial<Limits>) =>
  lim({ stops: new Set<StopType>(['regionalRail']), bands: 1, stories: 4, reachM: 402, ...over });

describe('applyGrant', () => {
  it('GAME_TRANSIT_ID is game-transit', () => {
    expect(GAME_TRANSIT_ID).toBe('game-transit');
  });

  it('a preset grant on an empty document adds one permitting policy, on, from month 1', () => {
    const doc = applyGrant(DEFAULT_POLICY4, SB423, ctxOf(sb423Limits()));
    expect(doc.kinds.permitting).toHaveLength(1);
    const p = doc.kinds.permitting[0];
    expect(p.preset).toBe('sb423Clock');
    expect(p.on).toBe(true);
    expect(p.spans).toHaveLength(1);
    expect(p.spans[0]).toMatchObject({ from: day1, to: null });
  });

  it('a measure grant adds what addPolicy adds at month 1, paid from month 1', () => {
    const doc = applyGrant(DEFAULT_POLICY4, BOND, ctxOf(bondLimits()));
    const choice: AddChoice = { kind: 'money', what: 'preset', preset: 'housing-bond' };
    expect(doc).toEqual(addPolicy(DEFAULT_POLICY4, choice, addCtx).doc);
    const fund = doc.kinds.money.flatMap((p) => p.spans).find((s) => s.what.tag === 'fund');
    expect(fund?.what.tag === 'fund' && fund.what.pool?.inflows[0]).toEqual({
      kind: 'once',
      day: day1,
      dollars: expect.any(Number)
    });
  });

  it('a preset or measure already on returns the same document', () => {
    const permit = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'permitting', what: 'preset', preset: 'sb423Clock' },
      addCtx
    ).doc;
    expect(applyGrant(permit, SB423, ctxOf(sb423Limits()))).toBe(permit);
    const money = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'money', what: 'preset', preset: 'housing-bond' },
      addCtx
    ).doc;
    expect(applyGrant(money, BOND, ctxOf(bondLimits()))).toBe(money);
  });

  it('with every policy naming it off, the first is switched on and keeps its spans', () => {
    const choice: AddChoice = { kind: 'permitting', what: 'preset', preset: 'sb423Clock' };
    let doc = addPolicy(DEFAULT_POLICY4, choice, addCtx).doc;
    doc = addPolicy(doc, choice, addCtx).doc;
    for (const p of doc.kinds.permitting) doc = setOn(doc, 'permitting', p.id, false);
    const [first, second] = doc.kinds.permitting;
    const out = applyGrant(doc, SB423, ctxOf(sb423Limits()));
    expect(out.kinds.permitting).toHaveLength(2);
    expect(out.kinds.permitting[0].on).toBe(true);
    expect(out.kinds.permitting[0].id).toBe(first.id);
    expect(out.kinds.permitting[0].spans).toBe(first.spans);
    expect(out.kinds.permitting[1]).toBe(second);
    expect(out.kinds.permitting[1].on).toBe(false);
  });

  it('a measure edited to preset null gets a new policy beside it', () => {
    const added = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'money', what: 'preset', preset: 'housing-bond' },
      addCtx
    ).doc;
    expect(added.kinds.money).toHaveLength(1);
    const edited: Policy = { ...added.kinds.money[0], preset: null };
    const doc: SimPolicy4 = { ...added, kinds: { ...added.kinds, money: [edited] } };
    const out = applyGrant(doc, BOND, ctxOf(bondLimits()));
    expect(out.kinds.money).toHaveLength(2);
    expect(out.kinds.money[0]).toBe(edited);
    expect(out.kinds.money[1].preset).toBe('housing-bond');
    expect(out.kinds.money[1].on).toBe(true);
  });

  it('a preset grant leaves a policy with a custom edit outside the limits and adds a new one', () => {
    const added = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'permitting', what: 'preset', preset: 'sb423Clock' },
      addCtx
    ).doc;
    const p = added.kinds.permitting[0];
    const what = p.spans[0].what;
    if (what.tag !== 'timing') throw new Error('expected a timing span');
    const timer = what.set.presetTimers[0];
    expect(timer).toBeDefined();
    const custom: Policy = {
      ...p,
      on: false,
      spans: [
        { ...p.spans[0], what: { tag: 'timing', set: { ...what.set, edits: [{ ...timer }] } } }
      ]
    };
    const doc: SimPolicy4 = { ...added, kinds: { ...added.kinds, permitting: [custom] } };
    const limits = sb423Limits();
    const out = applyGrant(doc, SB423, ctxOf(limits));
    expect(out.kinds.permitting).toHaveLength(2);
    expect(out.kinds.permitting[0]).toBe(custom);
    expect(out.kinds.permitting[0].on).toBe(false);
    const made = out.kinds.permitting[1];
    expect(made.preset).toBe('sb423Clock');
    expect(made.on).toBe(true);
    expect(made.spans).toHaveLength(1);
    expect(made.spans[0]).toMatchObject({ from: day1, to: null });
    expect(runnable(out, limits).kinds.permitting).toEqual([made]);
  });

  it('a first stop grant after the game rule was removed makes it with every stop bought', () => {
    const limits = lim({
      stops: new Set<StopType>(['regionalRail', 'metro']),
      bands: 1,
      stories: 4,
      reachM: 402
    });
    const out = applyGrant(DEFAULT_POLICY4, { tag: 'stop', stop: 'metro' }, ctxOf(limits));
    const rules = out.kinds.zoning.filter((p) => p.id === GAME_TRANSIT_ID);
    expect(rules).toHaveLength(1);
    expect(rules[0].where).toEqual({ tag: 'transit', stopTypes: ['regionalRail', 'metro'] });
    expect(bandsOf(out)).toEqual([b(402, 4)]);
    expect(rules[0].on).toBe(true);
  });

  it('a measure on a calibration without money returns the same document', () => {
    expect(applyGrant(DEFAULT_POLICY4, BOND, ctxOf(bondLimits(), calNoFunding))).toBe(
      DEFAULT_POLICY4
    );
  });

  it('a measure past the pool limit returns the same document', () => {
    let doc = DEFAULT_POLICY4;
    for (let i = 0; i < FINANCE_LIMITS.pools; i++) doc = addPolicy(doc, fundChoice, addCtx).doc;
    expect(applyGrant(doc, BOND, ctxOf(bondLimits()))).toBe(doc);
  });

  it('the first stop grant appends game-transit with that stop and one band at the limits', () => {
    const zoned = addPolicy(DEFAULT_POLICY4, { kind: 'zoning', what: 'transit' }, addCtx).doc;
    const out = applyGrant(zoned, { tag: 'stop', stop: 'regionalRail' }, ctxOf(transitLimits({})));
    expect(out.kinds.zoning).toHaveLength(2);
    expect(out.kinds.zoning[0]).toBe(zoned.kinds.zoning[0]);
    expect(out.kinds.zoning[1]).toEqual({
      id: 'game-transit',
      label: 'Transit rule',
      preset: null,
      on: true,
      where: { tag: 'transit', stopTypes: ['regionalRail'] },
      spans: [{ from: day1, to: null, what: { tag: 'bands', bands: [{ maxM: 402, stories: 4 }] } }]
    });
  });

  it('a later stop grant adds its stop in STOP_TYPES order and switches the rule on', () => {
    const doc = withZoning(gameRule(['metro'], [b(402, 4)], false));
    const limits = transitLimits({ stops: new Set<StopType>(['regionalRail', 'metro']) });
    const out = applyGrant(doc, { tag: 'stop', stop: 'regionalRail' }, ctxOf(limits));
    expect(out.kinds.zoning).toHaveLength(1);
    expect(out.kinds.zoning[0].where).toEqual({
      tag: 'transit',
      stopTypes: ['regionalRail', 'metro']
    });
    expect(out.kinds.zoning[0].on).toBe(true);
  });

  it('a stories grant raises the innermost band and the bands at its stories', () => {
    const doc = withZoning(gameRule(['metro'], [b(402, 8), b(805, 8), b(1207, 4)]));
    const limits = transitLimits({ bands: 3, stories: 12, reachM: 1207 });
    const out = applyGrant(doc, { tag: 'stories', max: 12 }, ctxOf(limits));
    expect(bandsOf(out)).toEqual([b(402, 12), b(805, 12), b(1207, 4)]);
  });

  it('a stories cap not above the innermost band changes nothing', () => {
    const doc = withZoning(gameRule(['metro'], [b(402, 40), b(805, 20)]));
    const limits = transitLimits({ bands: 2, stories: 12, reachM: 805 });
    expect(applyGrant(doc, { tag: 'stories', max: 12 }, ctxOf(limits))).toBe(doc);
  });

  it('a reach grant moves the outermost band out and leaves one already there', () => {
    const limits = transitLimits({ bands: 2, stories: 6, reachM: OPEN_REACH_M });
    const grant: Grant = { tag: 'reach', maxM: OPEN_REACH_M };
    const doc = withZoning(gameRule(['metro'], [b(402, 6), b(805, 4)], false));
    const out = applyGrant(doc, grant, ctxOf(limits));
    expect(bandsOf(out)).toEqual([b(402, 6), b(OPEN_REACH_M, 4)]);
    expect(out.kinds.zoning[0].on).toBe(true);
    const there = withZoning(gameRule(['metro'], [b(402, 6), b(OPEN_REACH_M, 4)]));
    expect(applyGrant(there, grant, ctxOf(limits))).toBe(there);
  });

  it('a bands grant adds a band 402 m beyond when the reach allows', () => {
    const doc = withZoning(gameRule(['metro'], [b(402, 6)]));
    const limits = transitLimits({ bands: 2, stories: 6, reachM: OPEN_REACH_M });
    const out = applyGrant(doc, { tag: 'bands', max: 2 }, ctxOf(limits));
    expect(bandsOf(out)).toEqual([b(402, 6), b(804, 6)]);
  });

  it('a bands grant with no room beyond splits the outermost band at the midpoint', () => {
    const doc = withZoning(gameRule(['metro'], [b(805, 8)]));
    const two = applyGrant(
      doc,
      { tag: 'bands', max: 2 },
      ctxOf(transitLimits({ bands: 2, stories: 8, reachM: 805 }))
    );
    expect(bandsOf(two)).toEqual([b(403, 8), b(805, 8)]);
    const three = applyGrant(
      two,
      { tag: 'bands', max: 3 },
      ctxOf(transitLimits({ bands: 3, stories: 8, reachM: 805 }))
    );
    expect(bandsOf(three)).toEqual([b(403, 8), b(604, 8), b(805, 8)]);
  });

  it('a bands grant that cannot split returns the same document', () => {
    const doc = withZoning(gameRule(['metro'], [b(402, 8), b(403, 8)]));
    const limits = transitLimits({ bands: 3, stories: 8, reachM: 403 });
    expect(applyGrant(doc, { tag: 'bands', max: 3 }, ctxOf(limits))).toBe(doc);
  });

  it('a zoning grant after the rule was removed makes it again with every stop bought', () => {
    const limits = lim({
      stops: new Set<StopType>(['regionalRail', 'metro']),
      bands: 1,
      stories: 8,
      reachM: 805
    });
    const out = applyGrant(DEFAULT_POLICY4, { tag: 'stories', max: 8 }, ctxOf(limits));
    const rules = out.kinds.zoning.filter((p) => p.id === GAME_TRANSIT_ID);
    expect(rules).toHaveLength(1);
    expect(rules[0].where).toEqual({ tag: 'transit', stopTypes: ['regionalRail', 'metro'] });
    expect(bandsOf(out)).toEqual([b(805, 8)]);
  });

  it('a step grant with no stop bought and no rule returns the same document', () => {
    const limits = lim();
    for (const grant of [
      { tag: 'stories', max: 8 },
      { tag: 'reach', maxM: 805 },
      { tag: 'bands', max: 2 }
    ] as Grant[])
      expect(applyGrant(DEFAULT_POLICY4, grant, ctxOf(limits))).toBe(DEFAULT_POLICY4);
  });

  it('a grant edits every span of a rule split into two spans', () => {
    const mid = monthFirstDay(asOf, 61);
    const rule = gameRule(['metro'], [], true, [
      { from: day1, to: mid - 1, what: { tag: 'bands', bands: [b(402, 6)] } },
      { from: mid, to: null, what: { tag: 'bands', bands: [b(402, 8), b(805, 4)] } }
    ]);
    const doc = withZoning(rule);
    const limits = transitLimits({ bands: 2, stories: 12, reachM: 805 });
    const out = applyGrant(doc, { tag: 'stories', max: 12 }, ctxOf(limits));
    expect(bandsOf(out, 0)).toEqual([b(402, 12)]);
    expect(bandsOf(out, 1)).toEqual([b(402, 12), b(805, 4)]);
    expect(out.kinds.zoning[0].spans.map((s) => [s.from, s.to])).toEqual([
      [day1, mid - 1],
      [mid, null]
    ]);
  });

  it('a zoning grant changes nothing when another policy holds the id game-transit', () => {
    const painted: Policy = {
      id: GAME_TRANSIT_ID,
      label: 'Painted zoning',
      preset: null,
      on: true,
      where: { tag: 'painted' },
      spans: [{ from: day1, to: null, what: { tag: 'brushes', brushes: [] } }]
    };
    const doc = withZoning(painted);
    const limits = transitLimits({ bands: 3, stories: 12, reachM: 1609 });
    for (const grant of [
      { tag: 'stop', stop: 'metro' },
      { tag: 'stories', max: 12 },
      { tag: 'reach', maxM: 1609 },
      { tag: 'bands', max: 3 }
    ] as Grant[])
      expect(applyGrant(doc, grant, ctxOf(limits))).toBe(doc);
  });

  it('a hands grant returns the same document', () => {
    const doc = withZoning(gameRule(['metro'], [b(402, 6)]));
    for (const grant of [
      { tag: 'hands', what: 'radius', value: 64 },
      { tag: 'hands', what: 'linger', value: 8000 },
      { tag: 'hands', what: 'auto' }
    ] as Grant[])
      expect(applyGrant(doc, grant, ctxOf(OPEN_LIMITS))).toBe(doc);
  });
});

/** One entry per level of each node, in catalogue order. */
const CATALOGUE_ORDER: NodeId[] = NODES.flatMap((n) => n.levels.map(() => n.id));

const BRANCHES: Branch[] = ['permitting', 'zoning', 'money', 'hands'];

/** The catalogue order, then each branch's levels first and the rest in catalogue order. */
const ORDERS: { name: string; order: NodeId[] }[] = [
  { name: 'catalogue', order: CATALOGUE_ORDER },
  ...BRANCHES.map((branch) => {
    const mine = new Set(NODES.filter((n) => n.branch === branch).map((n) => n.id));
    return {
      name: `${branch} first`,
      order: [
        ...CATALOGUE_ORDER.filter((id) => mine.has(id)),
        ...CATALOGUE_ORDER.filter((id) => !mine.has(id))
      ]
    };
  })
];

interface Step {
  where: string;
  prev: Played;
  next: Played;
  grant: Grant;
}

/** Every step of `order` from `doc`, each the first remaining entry `buyAndApply` accepts. */
function playOrder(name: string, order: NodeId[], doc: SimPolicy4): Step[] {
  let p: Played = {
    state: {
      ...NEW_GAME,
      phase: 'runs',
      rung: LADDER_YEARS.length,
      units: { home: Number.MAX_SAFE_INTEGER }
    },
    doc
  };
  const remaining = [...order];
  const steps: Step[] = [];
  while (remaining.length > 0) {
    const i = remaining.findIndex((id) => buy(p.state, id).ok);
    if (i < 0) throw new Error(`${name}: none of ${remaining.join(', ')} can be bought`);
    const id = remaining[i];
    const r = buy(p.state, id);
    const next = buyAndApply(p, id, cal);
    if (!r.ok || next === null) throw new Error(`${name}: ${id} was refused`);
    const where = `${name} #${steps.length + 1}: ${id} level ${next.state.bought[id]}`;
    steps.push({ where, prev: p, next, grant: r.grant });
    remaining.splice(i, 1);
    p = next;
  }
  return steps;
}

const playAll = (doc: SimPolicy4): Step[] =>
  ORDERS.flatMap(({ name, order }) => playOrder(name, order, doc));

const KINDS: PolicyKind[] = ['zoning', 'permitting', 'money'];

describe('played through the tree', () => {
  it('every result parses, reconciles to itself and runs under the limits after the purchase', () => {
    const steps = playAll(DEFAULT_POLICY4);
    expect(steps).toHaveLength(ORDERS.length * CATALOGUE_ORDER.length);
    for (const { where, next } of steps) {
      const { doc, state } = next;
      expect(
        () => parsePolicy4(JSON.parse(JSON.stringify(doc)), { asOf }),
        `${where} parses`
      ).not.toThrow();
      expect(reconcilePolicy4(doc, cal, asOf).doc, `${where} reconciles`).toEqual(doc);
      expect(runnable(doc, limitsOf(state)), `${where} runs`).toBe(doc);
    }
  });

  it('no grant removes a policy or touches one other than its own, the game rule or a counted one', () => {
    let start = addPolicy(DEFAULT_POLICY4, { kind: 'zoning', what: 'paint' }, addCtx).doc;
    start = addPolicy(start, { kind: 'zoning', what: 'protect', category: 'historic' }, addCtx).doc;
    start = addPolicy(start, fundChoice, addCtx).doc;
    const own = KINDS.flatMap((kind) => start.kinds[kind].map((p) => ({ kind, p })));
    expect(own).toHaveLength(3);
    const steps = playAll(start);
    const touched: string[] = [];
    for (const { where, prev, next, grant } of steps) {
      for (const { kind, p } of own)
        expect(
          next.doc.kinds[kind].find((q) => q.id === p.id),
          `${where} keeps ${p.id}`
        ).toEqual(p);
      for (const kind of KINDS) {
        const before = prev.doc.kinds[kind];
        const after = next.doc.kinds[kind];
        expect(after.length, `${where} ${kind}`).toBeGreaterThanOrEqual(before.length);
        for (const q of before) {
          const now = after.find((x) => x.id === q.id);
          expect(now, `${where} keeps ${q.id}`).toBeDefined();
          if (now === q) continue;
          const counted =
            (grant.tag === 'preset' || grant.tag === 'measure') && q.preset === grant.preset;
          if (q.id !== GAME_TRANSIT_ID && !counted) touched.push(`${where} touched ${q.id}`);
        }
      }
    }
    expect(touched).toEqual([]);
  });

  it('applying a grant again to its own result returns the same document', () => {
    for (const { where, next, grant } of playAll(DEFAULT_POLICY4))
      expect(
        applyGrant(next.doc, grant, { cal, limits: limitsOf(next.state) }),
        `${where} again`
      ).toBe(next.doc);
  });
});
