// Policy-timeline Task 16: which policy sets each lot's story limit in a compiled frame, against
// today's `limitSources` + `ownerOf` (`levers/source.ts`).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { protectedRows } from '$lib/sim/levers/resolve';
import { limitSources, ownerOf } from '$lib/sim/levers/source';
import {
  compileLevers,
  customQuery,
  DEFAULT_POLICY,
  queryKey,
  ruleQueries,
  type CustomBrush,
  type SimPolicy,
  type ZoningRule
} from '$lib/sim-page/policy';
import type { Effect, Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
import { upgradePolicy } from '$lib/timeline/upgrade';
import type { Day } from '$lib/timelapse/time';
import { compileTimeline } from './compile';
import type { PolicyFrame, PolicyTimeline } from './frame';
import { limitsAt, limitsOf, type FrameLimits, type PolicyLimitOwner } from './limits';
import { miniCompileCtx } from './test/compile-fixtures';
import { miniDoc, span } from './test/fixtures';

const W = 12;
const CTX = miniCompileCtx({ windowMonths: W });
const ASOF: Day = CTX.input.asOf;
const CAL = CTX.input.calibration;
const COUNT = CTX.layers.parcels.count;
const rows = Array.from({ length: COUNT }, (_, i) => i);
const rowOf = (id: ParcelId) => CTX.layers.parcels.index.get(id)!;

// ---- lots (as roundtrip.spec.ts; District-1 lots have FZP 4 stories) ----

const stroke = (lng: number, radiusM: number) => ({
  path: [[lng, 37.7] as [number, number]],
  radiusM
});
const PAINT_A: CustomBrush = {
  id: 'paint-a',
  kind: 'paint',
  strokes: [stroke(-122.4, 50)],
  stories: 7
};
const ERASE: CustomBrush = { id: 'erase', kind: 'erase', strokes: [stroke(-122.41, 60)] };
const PAINT_B: CustomBrush = {
  id: 'paint-b',
  kind: 'paint',
  strokes: [stroke(-122.42, 70)],
  stories: 9
};
const PAINT_P: CustomBrush = {
  id: 'paint-p',
  kind: 'paint',
  strokes: [stroke(-122.43, 80)],
  stories: 8
};

const RULE_METRO: ZoningRule = {
  id: 'metro',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: [
    { maxM: 402, stories: 9 },
    { maxM: 805, stories: 6 }
  ]
};
const RULE_BUS: ZoningRule = {
  id: 'bus',
  kind: 'transit',
  stopTypes: ['frequentBus'],
  bands: [{ maxM: 402, stories: 12 }]
};
/** Metro's inner band at 9 under another id: ties metro where both name a lot. */
const RULE_TIE: ZoningRule = { ...RULE_METRO, id: 'tie', bands: [{ maxM: 402, stories: 9 }] };
/** At FZP (4) on the inner band, below it (3) on the outer. */
const RULE_LOW: ZoningRule = {
  ...RULE_METRO,
  id: 'low',
  bands: [
    { maxM: 402, stories: 4 },
    { maxM: 805, stories: 3 }
  ]
};

const [m805, m402] = ruleQueries(RULE_METRO).map(queryKey);
const LOTS: Record<string, ParcelId[]> = {
  [m805]: ['0026T001A', '2999A001', '3512005', '3600014'],
  [m402]: ['0026T001A', '2999A001'],
  [queryKey(ruleQueries(RULE_BUS)[0])]: ['2999A001', '3600014'],
  [queryKey(customQuery(PAINT_A))]: ['2999A001', '2999A013', '3512005', '3600014', '3600016'],
  [queryKey(customQuery(ERASE))]: ['2999A013', '3600014'],
  [queryKey(customQuery(PAINT_B))]: ['3512005', '3600016', '0026T002'],
  [queryKey(customQuery(PAINT_P))]: ['0026T009', '2999A009', '3512014']
};
const lots = (k: string) => LOTS[k];

const doc3 = (patch: Partial<SimPolicy>): SimPolicy => ({
  ...structuredClone(DEFAULT_POLICY),
  ...patch
});

// ---- the two paths ----

function compileDoc(doc: SimPolicy4): PolicyTimeline {
  const c = compileTimeline(doc, LOTS, CTX, 'plan');
  expect(c.step(Infinity)).toBe(true);
  return c.result();
}

function upgraded(p: SimPolicy): SimPolicy4 {
  return reconcilePolicy4(upgradePolicy(p, ASOF), CAL, ASOF).doc;
}

/**
 * Today's answer for row `row`: `ownerOf(limitSources(...))` over `compileLevers(p, lots)`, whose
 * rule edits carry the rule id, with the upgrade's policy ids (a rule's id; `painted` for paint).
 */
function today(p: SimPolicy): (row: number) => FrameLimits {
  const levers = compileLevers(p, lots)!;
  const prot = protectedRows(CTX.layers, levers.protect, ASOF);
  const s = limitSources(CTX.layers, levers, prot);
  const mask = new Uint8Array(COUNT);
  for (const r of prot) mask[r] = 1;
  return (row) => {
    const o = ownerOf(s, row);
    const owner: PolicyLimitOwner =
      o.kind === 'paint'
        ? { kind: 'paint', policy: 'painted' }
        : o.kind === 'rule'
          ? { kind: 'rule', ruleId: o.ruleId, policy: o.ruleId }
          : { kind: 'fzp' };
    return { owner, protected: mask[row] === 1 };
  };
}

const PARITY: { name: string; p: SimPolicy }[] = [
  { name: 'two rules on overlapping lots', p: doc3({ rules: [RULE_METRO, RULE_BUS] }) },
  { name: 'a tie: the first maximum wins', p: doc3({ rules: [RULE_METRO, RULE_TIE] }) },
  { name: 'a rule at or below FZP', p: doc3({ rules: [RULE_LOW] }) },
  { name: 'paint over a rule', p: doc3({ rules: [RULE_BUS], custom: [PAINT_A, ERASE, PAINT_B] }) },
  {
    name: 'protections over rules and paint',
    p: doc3({
      rules: [RULE_METRO, RULE_BUS],
      custom: [PAINT_A, ERASE, PAINT_B, PAINT_P],
      protect: { rentControl: true, historic: true, newerThanYears: 15 }
    })
  }
];

// ---- schema 4 documents built directly ----

const pol = (
  id: string,
  where: Policy['where'],
  what: Effect,
  from = 1,
  to: number | null = null
) =>
  ({
    id,
    label: id,
    preset: null,
    on: true,
    where,
    spans: [span(ASOF, from, to, what)]
  }) satisfies Policy;
const transit = (id: string, r: ZoningRule, from = 1, to: number | null = null) =>
  pol(id, { tag: 'transit', stopTypes: r.stopTypes }, { tag: 'bands', bands: r.bands }, from, to);
const painted = (id: string, brushes: CustomBrush[], from = 1, to: number | null = null) =>
  pol(id, { tag: 'painted' }, { tag: 'brushes', brushes }, from, to);

describe('limitsAt: parity with today', () => {
  for (const c of PARITY) {
    it(c.name, () => {
      const doc = upgraded(c.p);
      // the upgrade keeps each rule's id as its policy id
      expect(doc.kinds.zoning.filter((x) => x.where.tag === 'transit').map((x) => x.id)).toEqual(
        c.p.rules.map((r) => r.id)
      );
      const t = compileDoc(doc);
      const want = today(c.p);
      for (const m of [1, W]) {
        const f = t.frameAt(m);
        for (const r of rows) expect(limitsAt(f, r), `${c.name}, row ${r}`).toEqual(want(r));
      }
    });
  }

  it('the parity cases are not vacuous', () => {
    const kinds = new Set<string>();
    let protectedOverOther = 0;
    let atOrBelowFzp = 0;
    for (const c of PARITY) {
      const want = today(c.p);
      for (const r of rows) {
        const o = want(r).owner;
        kinds.add(o.kind === 'rule' ? `rule:${o.ruleId}` : o.kind);
      }
      const levers = compileLevers(c.p, lots)!;
      const open = limitSources(CTX.layers, levers, new Int32Array(0));
      for (const r of rows)
        if (want(r).protected && ownerOf(open, r).kind !== 'fzp') protectedOverOther++;
    }
    expect([...kinds].sort()).toEqual(['fzp', 'paint', 'rule:bus', 'rule:metro']);
    expect(protectedOverOther).toBeGreaterThan(0);
    // the low rule names lots and owns none of them
    const low = today(doc3({ rules: [RULE_LOW] }));
    for (const id of LOTS[m805]) if (low(rowOf(id)).owner.kind === 'fzp') atOrBelowFzp++;
    expect(atOrBelowFzp).toBe(LOTS[m805].length);
    // the tie: metro is first, both name the inner band's lots at 9
    const tie = today(doc3({ rules: [RULE_METRO, RULE_TIE] }));
    expect(tie(rowOf('0026T001A')).owner).toEqual({
      kind: 'rule',
      ruleId: 'metro',
      policy: 'metro'
    });
  });
});

describe('limitsAt: paint', () => {
  it('two painted policies naming one lot: the lower in the list wins', () => {
    const t = compileDoc(miniDoc(painted('upper', [PAINT_A]), painted('lower', [PAINT_B])));
    const f = t.frameAt(1);
    // 3512005 and 3600016 are in both
    for (const id of ['3512005', '3600016', '0026T002'])
      expect(limitsAt(f, rowOf(id))).toEqual({
        owner: { kind: 'paint', policy: 'lower' },
        protected: false
      });
    for (const id of ['2999A001', '2999A013', '3600014'])
      expect(limitsAt(f, rowOf(id)).owner).toEqual({ kind: 'paint', policy: 'upper' });
    // swapped
    const s = compileDoc(miniDoc(painted('lower', [PAINT_B]), painted('upper', [PAINT_A])));
    expect(limitsAt(s.frameAt(1), rowOf('3512005')).owner).toEqual({
      kind: 'paint',
      policy: 'upper'
    });
  });

  it('an erase removes only its own policy’s paint', () => {
    const t = compileDoc(miniDoc(painted('a', [PAINT_A]), painted('e', [PAINT_B, ERASE])));
    // ERASE names 2999A013 and 3600014, painted by `a` only
    expect(limitsAt(t.frameAt(1), rowOf('2999A013')).owner).toEqual({
      kind: 'paint',
      policy: 'a'
    });
  });
});

describe('limitsAt: frame objects (the conductor’s condition)', () => {
  it('content-equal frames from two documents keep their own owners', () => {
    const a = compileDoc(miniDoc(transit('alpha', RULE_BUS)));
    const b = compileDoc(miniDoc(transit('beta', RULE_BUS)));
    const fa = a.frameAt(3);
    const fb = b.frameAt(3);
    expect(fa.id).toBe(fb.id);
    expect(fa.view).toBe(fb.view);
    expect(fa).not.toBe(fb);
    const r = rowOf('2999A001');
    expect(limitsAt(fa, r).owner).toEqual({ kind: 'rule', ruleId: 'alpha', policy: 'alpha' });
    expect(limitsAt(fb, r).owner).toEqual({ kind: 'rule', ruleId: 'beta', policy: 'beta' });
  });

  it('the same document compiled twice hands out different frame objects', () => {
    const doc = miniDoc(transit('alpha', RULE_BUS));
    const a = compileDoc(doc);
    const b = compileDoc(doc);
    expect(a.frameAt(1).id).toBe(b.frameAt(1).id);
    expect(a.frameAt(1)).not.toBe(b.frameAt(1));
  });

  it('resume: a frame held from an older timeline keeps that timeline’s owners', () => {
    const k = 6;
    const a = compileDoc(miniDoc(transit('alpha', RULE_BUS)));
    const held = a.frameAt(8);
    const b = compileDoc(
      miniDoc(transit('alpha', RULE_BUS, 1, k - 1), transit('beta', RULE_BUS, k))
    );
    const r = rowOf('3600014');
    const rule = (id: string) => ({ kind: 'rule', ruleId: id, policy: id });
    for (let m = 1; m <= W; m++)
      expect(limitsAt(b.frameAt(m), r).owner, `month ${m}`).toEqual(rule(m < k ? 'alpha' : 'beta'));
    // equal content: the frame id does not change at k, the attribution does
    expect(b.changes()).toEqual([]);
    expect(b.frameAt(8).id).toBe(held.id);
    expect(limitsAt(held, r).owner).toEqual(rule('alpha'));
  });

  it('months sharing a zoning state share one attribution', () => {
    const t = compileDoc(miniDoc(transit('alpha', RULE_BUS), painted('p', [PAINT_A], 4)));
    const r = rowOf('3600014');
    // months 1 to 3: one state; 4 on: another
    expect(limitsAt(t.frameAt(1), r).owner).toBe(limitsAt(t.frameAt(3), r).owner);
    expect(limitsAt(t.frameAt(4), r).owner).toBe(limitsAt(t.frameAt(W), r).owner);
    expect(limitsAt(t.frameAt(3), r).owner).toEqual({
      kind: 'rule',
      ruleId: 'alpha',
      policy: 'alpha'
    });
    expect(limitsAt(t.frameAt(4), r).owner).toEqual({ kind: 'paint', policy: 'p' });
    for (const x of rows) expect(limitsAt(t.frameAt(5), x)).toEqual(limitsAt(t.frameAt(W), x));
  });
});

describe('limitsOf and errors', () => {
  it('limitsOf by parcel id equals limitsAt by its row; an unknown parcel is null', () => {
    const p = PARITY[PARITY.length - 1].p;
    const f = compileDoc(upgraded(p)).frameAt(1);
    for (const [id, r] of CTX.layers.parcels.index) expect(limitsOf(f, id)).toEqual(limitsAt(f, r));
    expect(limitsOf(f, 'NO-SUCH-LOT' as ParcelId)).toBeNull();
  });

  it('an out-of-range row or a frame no compile made throws RangeError', () => {
    const f = compileDoc(miniDoc(transit('alpha', RULE_BUS))).frameAt(1);
    expect(() => limitsAt(f, -1)).toThrow(RangeError);
    expect(() => limitsAt(f, COUNT)).toThrow(RangeError);
    expect(() => limitsAt(f, 0.5)).toThrow(RangeError);
    const copy: PolicyFrame = { ...f };
    expect(() => limitsAt(copy, 0)).toThrow(RangeError);
    expect(() => limitsOf(copy, '2999A001' as ParcelId)).toThrow(RangeError);
  });
});
