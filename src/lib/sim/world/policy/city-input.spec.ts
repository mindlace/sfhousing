// Policy-timeline S13 addition: a frame's city inputs (`cityInputAt`), against what the old
// host hands `createCityBuild` and `createLidBuild` (`scenario-host.ts` `cityOf`, `lidStep`).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { toLngLat } from '$lib/generator/geo';
import { createCityBuild, type CityModel, type CityResult } from '$lib/map/height/city';
import { createLidBuild, type LidLot } from '$lib/map/height/lids';
import { countableMask } from '$lib/map/height/room';
import type { HeightLids } from '$lib/map/height/types';
import type { BBox } from '$lib/plan/geometry';
import { resolveEnvelopes } from '$lib/sim/levers/resolve';
import { limitSources, type LimitSources } from '$lib/sim/levers/source';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
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
import type { Day } from '$lib/timelapse/time';
import { compileTimeline } from './compile';
import type { PolicyFrame, PolicyTimeline } from './frame';
import { cityInputAt, type FrameCityInput } from './limits';
import { miniCompileCtx } from './test/compile-fixtures';
import { miniDoc, span } from './test/fixtures';

const W = 12;
/** The month the paint, the second rule and the protections start. */
const K = 5;
const CTX = miniCompileCtx({ windowMonths: W });
const ASOF: Day = CTX.input.asOf;
const PARCELS = CTX.layers.parcels;
const COUNT = PARCELS.count;

// ---- lots (as limits.spec.ts) ----

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
const BRUSHES = [PAINT_A, ERASE, PAINT_B, PAINT_P];

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

// ---- the document: metro from month 1; bus, paint and protections from month K ----

const pol = (id: string, where: Policy['where'], what: Effect, from = 1) =>
  ({
    id,
    label: id,
    preset: null,
    on: true,
    where,
    spans: [span(ASOF, from, null, what)]
  }) satisfies Policy;
const transit = (r: ZoningRule, from = 1) =>
  pol(r.id, { tag: 'transit', stopTypes: r.stopTypes }, { tag: 'bands', bands: r.bands }, from);

const DOC: SimPolicy4 = miniDoc(
  transit(RULE_METRO),
  transit(RULE_BUS, K),
  pol('painted', { tag: 'painted' }, { tag: 'brushes', brushes: BRUSHES }, K),
  pol('rc', { tag: 'category', category: 'rentControl' }, { tag: 'protect', years: null }, K),
  pol('hist', { tag: 'category', category: 'historic' }, { tag: 'protect', years: null }, K),
  pol('newer', { tag: 'category', category: 'newerThan' }, { tag: 'protect', years: 15 }, K)
);

/** The old host's lever state before and from month K. */
const BEFORE: SimPolicy = { ...structuredClone(DEFAULT_POLICY), rules: [RULE_METRO] };
const AFTER: SimPolicy = {
  ...structuredClone(DEFAULT_POLICY),
  rules: [RULE_METRO, RULE_BUS],
  custom: BRUSHES,
  protect: { rentControl: true, historic: true, newerThanYears: 15 }
};

function compileDoc(doc: SimPolicy4): PolicyTimeline {
  const c = compileTimeline(doc, LOTS, CTX, 'plan');
  expect(c.step(Infinity)).toBe(true);
  return c.result();
}

/** The old host's `cityOf` inputs for `p` (`scenario-host.ts`). */
function oldHost(p: SimPolicy): FrameCityInput {
  const levers = compileLevers(p, lots)!;
  const r = resolveEnvelopes(CTX.layers, levers, ASOF);
  return {
    stories: r.plan.table.stories,
    countable: countableMask(r.plan.table, PARCELS.eligible, r.plan.needs, r.protectedRows),
    sources: limitSources(CTX.layers, levers, r.protectedRows)
  };
}

function plain(c: FrameCityInput) {
  return {
    stories: [...c.stories],
    countable: [...c.countable],
    source: [...c.sources.source],
    ruleIds: [...c.sources.ruleIds]
  };
}

const differ = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
};

function city(c: FrameCityInput): CityResult {
  const b = createCityBuild({
    rev: 1,
    labelPoint: PARCELS.labelPoint,
    lotAreaM2: PARCELS.lotAreaM2,
    existingStories: PARCELS.existingStories,
    stories: c.stories,
    countable: c.countable,
    sources: c.sources
  });
  expect(b.step(Infinity, () => 0)).toBe(true);
  return b.result();
}

/** The mini city's lots as lid lots, as `lidLots` builds them, and a bbox around them. */
function lidScene(): { lots: LidLot[]; bbox: BBox } {
  const out: LidLot[] = [];
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rec of miniCity().records.values()) {
    const row = PARCELS.index.get(rec.id);
    if (row === undefined) continue;
    out.push({ row, rings: rec.polygon.map((ring) => toLngLat(ring, rec.labelPoint)) });
    const [lng, lat] = rec.labelPoint;
    [w, s, e, n] = [Math.min(w, lng), Math.min(s, lat), Math.max(e, lng), Math.max(n, lat)];
  }
  return { lots: out, bbox: [w, s, e, n] };
}

function lids(c: FrameCityInput, model: CityModel): HeightLids {
  const { lots: lotList, bbox } = lidScene();
  const b = createLidBuild({
    limitsRev: 1,
    sourceIds: c.sources.ruleIds,
    bbox,
    lots: lotList,
    stories: c.stories,
    sources: c.sources.source,
    model
  });
  expect(b.step(Infinity, () => 0)).toBe(true);
  const l = b.result();
  expect(l.pieces.stories.length).toBeGreaterThan(0);
  return l;
}

describe('cityInputAt: the old host’s city inputs', () => {
  const t = compileDoc(DOC);
  const cases: [number, SimPolicy][] = [
    [1, BEFORE],
    [K - 1, BEFORE],
    [K, AFTER],
    [W, AFTER]
  ];

  it('stories, countable and sources equal the old host’s, before and after the change', () => {
    for (const [m, p] of cases)
      expect(plain(cityInputAt(t.frameAt(m))), `month ${m}`).toEqual(plain(oldHost(p)));
  });

  it('the case is not vacuous', () => {
    const b = oldHost(BEFORE);
    const a = oldHost(AFTER);
    expect(differ(b.stories, a.stories)).toBe(true);
    expect(differ(b.countable, a.countable)).toBe(true);
    expect(differ(b.sources.source, a.sources.source)).toBe(true);
    expect(b.sources.ruleIds).toEqual(['metro']);
    expect(a.sources.ruleIds).toEqual(['metro', 'bus']);
    // a protected lot that paint or a rule would otherwise raise reads FZP
    const levers = compileLevers(AFTER, lots)!;
    const r = resolveEnvelopes(CTX.layers, levers, ASOF);
    expect(r.protectedRows.length).toBeGreaterThan(0);
    const raised = [...r.protectedRows].filter(
      (i) => r.unprotected.table.stories[i] !== r.plan.table.stories[i]
    );
    expect(raised.length).toBeGreaterThan(0);
    for (const i of r.protectedRows) expect(a.countable[i]).toBe(0);
  });

  it('the city build and lid build give the old host’s result', () => {
    for (const [m, p] of cases) {
      const got = city(cityInputAt(t.frameAt(m)));
      const want = city(oldHost(p));
      expect(got.model, `month ${m}`).toEqual(want.model);
      expect(got.city, `month ${m}`).toEqual(want.city);
      expect(lids(cityInputAt(t.frameAt(m)), got.model), `month ${m}`).toEqual(
        lids(oldHost(p), want.model)
      );
    }
    // before and after build different cities and lids
    const [b, a] = [cityInputAt(t.frameAt(1)), cityInputAt(t.frameAt(W))];
    const [cb, ca] = [city(b), city(a)];
    expect(cb.model).not.toEqual(ca.model);
    expect(lids(b, cb.model)).not.toEqual(lids(a, ca.model));
  });

  it('stories equal the frame view’s envelopeStories', () => {
    for (const m of [1, K, W]) {
      const f = t.frameAt(m);
      expect([...cityInputAt(f).stories], `month ${m}`).toEqual([
        ...f.view.parcels.envelopeStories
      ]);
    }
  });

  it('memoised per zoning state: by reference, one object for the months sharing it', () => {
    const a = cityInputAt(t.frameAt(1));
    expect(cityInputAt(t.frameAt(1))).toBe(a);
    expect(cityInputAt(t.frameAt(K - 1))).toBe(a);
    const b = cityInputAt(t.frameAt(K));
    expect(b).not.toBe(a);
    expect(cityInputAt(t.frameAt(W))).toBe(b);
    expect(a.stories).toHaveLength(COUNT);
    expect(a.countable).toHaveLength(COUNT);
    expect(a.sources.source).toHaveLength(COUNT);
  });
});

describe('cityInputAt: frame objects', () => {
  it('a frame no compile made throws RangeError', () => {
    const f = compileDoc(DOC).frameAt(1);
    const copy: PolicyFrame = { ...f };
    expect(() => cityInputAt(copy)).toThrow(RangeError);
  });

  it('content-equal frames of two compiles resolve per frame object', () => {
    const a = compileDoc(DOC);
    const b = compileDoc(DOC);
    for (const m of [1, W]) {
      const fa = a.frameAt(m);
      const fb = b.frameAt(m);
      expect(fa.id).toBe(fb.id);
      expect(fa).not.toBe(fb);
      const ca = cityInputAt(fa);
      const cb = cityInputAt(fb);
      expect(ca).not.toBe(cb);
      expect(plain(ca)).toEqual(plain(cb));
    }
  });

  it('a preFzp compile reads FZP, as limitsAt', () => {
    const c = compileTimeline(miniDoc(), LOTS, CTX, 'preFzp');
    expect(c.step(Infinity)).toBe(true);
    const got = cityInputAt(c.result().frameAt(1));
    expect(plain(got)).toEqual(plain(oldHost(structuredClone(DEFAULT_POLICY))));
    const fzp: LimitSources = got.sources;
    expect(fzp.ruleIds).toEqual([]);
  });
});
