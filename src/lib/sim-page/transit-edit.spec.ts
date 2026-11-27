import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STORIES_MAX, STORIES_MIN } from '$lib/plan/constants';
import { STOP_TYPES, type StopType } from '$lib/sim/levers/brushes';
import {
  DEFAULT_BANDS,
  DEFAULT_POLICY,
  bandProblem,
  type SimPolicy,
  type TransitBand,
  type ZoningRule
} from './policy';
import { ruleTarget } from './brush-summary';
import { OPEN_LIMITS } from '$lib/game/limits';
import { limitsWith } from '$lib/timeline/test/limits';
import {
  MAX_BANDS,
  NEW_BAND_STEP_M,
  OPEN_CAP,
  OPEN_REACH_M,
  REACH_MAX_M,
  type TransitCap,
  addBand,
  capOf,
  distanceRange,
  layerName,
  layerTop,
  newLayer,
  reachMaxM,
  removeBand,
  replaceRule,
  ruleCap,
  setBandDistance,
  setBandStories,
  storiesRange,
  toggleStop
} from './transit-edit';

const rule = (bands: TransitBand[], stopTypes: StopType[] = ['metro']): ZoningRule => ({
  id: 'r',
  kind: 'transit',
  stopTypes,
  bands
});

const cap: TransitCap = { stops: new Set(['metro']), bands: 2, stories: 8, reachM: 805 };

describe('transit-edit caps', () => {
  it('OPEN_CAP and capOf', () => {
    expect(OPEN_CAP).toEqual({
      stops: new Set(STOP_TYPES),
      bands: 3,
      stories: STORIES_MAX,
      reachM: OPEN_REACH_M
    });
    expect(capOf(OPEN_LIMITS)).toBe(OPEN_CAP);
    expect(capOf(limitsWith({ whole: true }))).toBe(OPEN_CAP);
    expect(capOf(limitsWith({ stops: new Set(['metro']) }))).toEqual({
      stops: new Set(['metro']),
      bands: MAX_BANDS,
      stories: STORIES_MAX,
      reachM: OPEN_REACH_M
    });
  });

  it('reach is a walking distance per class of stop', () => {
    expect(REACH_MAX_M).toEqual({
      regionalRail: 1200,
      metro: 1200,
      rapidBus: 800,
      frequentBus: 800
    });
    expect(reachMaxM(['regionalRail'])).toBe(1200);
    expect(reachMaxM(['metro'])).toBe(1200);
    expect(reachMaxM(['rapidBus', 'frequentBus'])).toBe(800);
    expect(reachMaxM(['metro', 'frequentBus'])).toBe(800);
    expect(reachMaxM([])).toBe(1200);
    expect(ruleCap(OPEN_CAP, ['rapidBus']).reachM).toBe(800);
    expect(ruleCap({ ...OPEN_CAP, reachM: 500 }, ['metro']).reachM).toBe(500);
    const rail = rule([{ maxM: 402, stories: 6 }], ['regionalRail']);
    expect(setBandDistance(rail, 0, 5000, ruleCap(OPEN_CAP, rail.stopTypes)).bands[0].maxM).toBe(
      1200
    );
    const bus = rule([{ maxM: 402, stories: 6 }], ['rapidBus']);
    expect(setBandDistance(bus, 0, 5000, ruleCap(OPEN_CAP, bus.stopTypes)).bands[0].maxM).toBe(800);
  });

  it('a stored value past the maximum stays when another field changes', () => {
    const stored = rule([{ maxM: 3219, stories: 8 }], ['regionalRail']);
    const c = ruleCap(OPEN_CAP, stored.stopTypes);
    expect(setBandStories(stored, 0, 10, c).bands).toEqual([{ maxM: 3219, stories: 10 }]);
  });

  it('stories stop at the cap', () => {
    const r = rule([{ maxM: 402, stories: 6 }], ['metro']);
    expect(storiesRange(r.bands, 0, cap).max).toBe(8);
    expect(setBandStories(r, 0, 12, cap).bands[0].stories).toBe(8);
  });

  it('the outermost distance stops at the cap', () => {
    const r = rule([{ maxM: 402, stories: 6 }], ['metro']);
    expect(distanceRange(r.bands, 0, cap).max).toBe(805);
    expect(setBandDistance(r, 0, 2000, cap).bands[0].maxM).toBe(805);
  });

  it('+ Band stops at the cap', () => {
    expect(addBand(rule([{ maxM: 402, stories: 6 }]), cap)!.bands[1].maxM).toBe(804);
    expect(addBand(rule([{ maxM: 805, stories: 6 }]), cap)).toBeNull();
    expect(
      addBand(
        rule([
          { maxM: 100, stories: 6 },
          { maxM: 300, stories: 4 }
        ]),
        cap
      )
    ).toBeNull();
  });

  it('a stop type outside the cap can be turned off, never on', () => {
    expect(toggleStop(rule([{ maxM: 402, stories: 6 }]), 'rapidBus', cap)).toBeNull();
    expect(
      toggleStop(rule([{ maxM: 402, stories: 6 }], ['regionalRail', 'metro']), 'regionalRail', cap)!
        .stopTypes
    ).toEqual(['metro']);
  });
});

describe('transit-edit', () => {
  it('the outer stepper stops at the inner height, the inner at the outer', () => {
    const r = rule([
      { maxM: 402, stories: 6 },
      { maxM: 805, stories: 4 }
    ]);
    expect(storiesRange(r.bands, 1)).toEqual({ min: STORIES_MIN, max: 6 });
    expect(storiesRange(r.bands, 0)).toEqual({ min: 4, max: STORIES_MAX });
    expect(setBandStories(r, 1, 9).bands[1].stories).toBe(6);
    expect(setBandStories(r, 0, 2).bands[0].stories).toBe(4);
  });

  it('distances stay strictly between their neighbours and never collide', () => {
    const r = rule([
      { maxM: 402, stories: 6 },
      { maxM: 805, stories: 4 },
      { maxM: 1200, stories: 2 }
    ]);
    expect(distanceRange(r.bands, 1)).toEqual({ min: 403, max: 1199 });
    expect(setBandDistance(r, 1, 402).bands[1].maxM).toBe(403);
    expect(setBandDistance(r, 2, 99_999).bands[2].maxM).toBe(OPEN_REACH_M);
    expect(setBandDistance(r, 0, 0).bands[0].maxM).toBe(1);
  });

  it('rounds distances and stories to whole numbers and ignores NaN', () => {
    const r = rule(DEFAULT_BANDS);
    expect(setBandDistance(r, 0, 300.6).bands[0].maxM).toBe(301);
    expect(setBandStories(r, 0, 7.4).bands[0].stories).toBe(7);
    expect(setBandDistance(r, 0, NaN).bands).toEqual(DEFAULT_BANDS);
    expect(setBandStories(r, 1, NaN).bands).toEqual(DEFAULT_BANDS);
    expect(setBandStories(r, 0, Infinity).bands[0].stories).toBe(STORIES_MAX);
    expect(setBandStories(r, 1, -Infinity).bands[1].stories).toBe(STORIES_MIN);
    // An index that names no band changes nothing.
    expect(setBandDistance(r, 5, 900).bands).toEqual(DEFAULT_BANDS);
  });

  it('every edit result satisfies bandProblem', () => {
    // A monotone rule: 1-3 distinct distances ascending, stories non-increasing.
    const ruleArb = fc
      .record({
        dists: fc.uniqueArray(fc.integer({ min: 1, max: OPEN_REACH_M }), {
          minLength: 1,
          maxLength: MAX_BANDS
        }),
        stories: fc.array(fc.integer({ min: STORIES_MIN, max: STORIES_MAX }), {
          minLength: MAX_BANDS,
          maxLength: MAX_BANDS
        }),
        stops: fc.uniqueArray(fc.constantFrom(...STOP_TYPES), { minLength: 1 })
      })
      .map(({ dists, stories, stops }) => {
        const ds = [...dists].sort((a, b) => a - b);
        const ss = stories.slice(0, ds.length).sort((a, b) => b - a);
        return rule(
          ds.map((maxM, i) => ({ maxM, stories: ss[i] })),
          STOP_TYPES.filter((t) => stops.includes(t))
        );
      });
    const num = fc.oneof(
      fc.integer({ min: -100, max: 100_000 }),
      fc.double({ min: -1e6, max: 1e6, noNaN: true }),
      fc.constantFrom(NaN, Infinity, -Infinity, 0, 1, 80, 81, OPEN_REACH_M)
    );
    const idx = fc.integer({ min: -1, max: 4 });
    const edit = fc.oneof(
      fc.tuple(fc.constant('stories' as const), idx, num),
      fc.tuple(fc.constant('distance' as const), idx, num),
      fc.tuple(fc.constant('add' as const), idx, num),
      fc.tuple(fc.constant('remove' as const), idx, num),
      fc.tuple(fc.constant('toggle' as const), fc.integer({ min: 0, max: 3 }), num)
    );
    expect(() =>
      fc.assert(
        fc.property(ruleArb, fc.array(edit, { maxLength: 40 }), (start, edits) => {
          let r = start;
          for (const [kind, i, n] of edits) {
            let next: ZoningRule | null;
            if (kind === 'stories') next = setBandStories(r, i, n);
            else if (kind === 'distance') next = setBandDistance(r, i, n);
            else if (kind === 'add') next = addBand(r);
            else if (kind === 'remove') next = removeBand(r, i);
            else next = toggleStop(r, STOP_TYPES[i]);
            if (next === null) continue;
            r = next;
            if (bandProblem(r.bands) !== null) return false;
            if (r.stopTypes.length === 0) return false;
            if (r.bands.length < 1 || r.bands.length > MAX_BANDS) return false;
            for (const b of r.bands) {
              if (!Number.isInteger(b.maxM) || b.maxM < 1) return false;
              if (!Number.isInteger(b.stories)) return false;
              if (b.stories < STORIES_MIN || b.stories > STORIES_MAX) return false;
            }
            const sorted = r.bands.every((b, k) => k === 0 || b.maxM > r.bands[k - 1].maxM);
            if (!sorted) return false;
          }
          return true;
        }),
        { numRuns: 500 }
      )
    ).not.toThrow();
  });

  it('addBand steps out at the same height; null at three bands or at the cap', () => {
    const r = rule(DEFAULT_BANDS);
    const added = addBand(r)!;
    expect(added.bands).toEqual([
      ...DEFAULT_BANDS,
      { maxM: Math.min(805 + NEW_BAND_STEP_M, OPEN_REACH_M), stories: 4 }
    ]);
    expect(bandProblem(added.bands)).toBeNull();
    expect(addBand(added)).toBeNull();
    const atCap = rule([{ maxM: OPEN_REACH_M, stories: 3 }]);
    expect(addBand(atCap)).toBeNull();
    // Close to the cap: the new band lands on the cap, not past it.
    const near = addBand(rule([{ maxM: OPEN_REACH_M - 10, stories: 3 }]))!;
    expect(near.bands.at(-1)).toEqual({ maxM: OPEN_REACH_M, stories: 3 });
  });

  it('removeBand refuses the last band', () => {
    const r = rule(DEFAULT_BANDS);
    expect(removeBand(r, 0)!.bands).toEqual([DEFAULT_BANDS[1]]);
    expect(removeBand(r, 1)!.bands).toEqual([DEFAULT_BANDS[0]]);
    expect(removeBand(rule([{ maxM: 402, stories: 6 }]), 0)).toBeNull();
    expect(removeBand(r, 7)).toBeNull();
  });

  it('toggleStop refuses to turn off the last stop type and keeps STOP_TYPES order', () => {
    expect(toggleStop(rule(DEFAULT_BANDS, ['metro']), 'metro')).toBeNull();
    expect(toggleStop(rule(DEFAULT_BANDS, ['metro']), 'regionalRail')!.stopTypes).toEqual([
      'regionalRail',
      'metro'
    ]);
    expect(
      toggleStop(rule(DEFAULT_BANDS, ['regionalRail', 'metro']), 'regionalRail')!.stopTypes
    ).toEqual(['metro']);
    expect(toggleStop(rule(DEFAULT_BANDS, ['metro']), 'frequentBus')!.stopTypes).toEqual([
      'metro',
      'frequentBus'
    ]);
  });

  it('names a layer from its stops and swatches its tallest band', () => {
    expect(layerName(rule(DEFAULT_BANDS, ['metro']))).toBe('Near Muni Metro');
    expect(layerTop(rule(DEFAULT_BANDS))).toBe(6);
    expect(
      layerTop(
        rule([
          { maxM: 805, stories: 4 },
          { maxM: 402, stories: 6 }
        ])
      )
    ).toBe(6);
    expect(ruleTarget(rule(DEFAULT_BANDS, ['regionalRail', 'metro']))).toBe(
      'regional rail and Muni Metro'
    );
  });

  it('newLayer is rail and Muni Metro at the default bands, with its own id', () => {
    const a = newLayer();
    const b = newLayer();
    expect(a.kind).toBe('transit');
    expect(a.stopTypes).toEqual(['regionalRail', 'metro']);
    expect(a.bands).toEqual(DEFAULT_BANDS);
    expect(a.bands).not.toBe(DEFAULT_BANDS);
    expect(a.id).not.toBe(b.id);
    expect(layerName(a)).toBe('Near regional rail and Muni Metro');
  });

  it('an unsorted saved rule is returned innermost first by any edit', () => {
    const r = rule([
      { maxM: 805, stories: 4 },
      { maxM: 402, stories: 6 }
    ]);
    const sorted = [
      { maxM: 402, stories: 6 },
      { maxM: 805, stories: 4 }
    ];
    expect(setBandStories(r, 0, 6).bands).toEqual(sorted);
    expect(setBandDistance(r, 1, 900).bands).toEqual([sorted[0], { maxM: 900, stories: 4 }]);
    expect(addBand(r)!.bands.map((b) => b.maxM)).toEqual([402, 805, OPEN_REACH_M]);
    expect(removeBand(r, 0)!.bands).toEqual([sorted[1]]);
    expect(toggleStop(r, 'regionalRail')!.bands).toEqual(sorted);
  });

  it('replaceRule swaps the rule with the same id, keeps order, and leaves other rules alone', () => {
    const a = { ...rule(DEFAULT_BANDS), id: 'a' };
    const b = { ...rule(DEFAULT_BANDS), id: 'b' };
    const c = { ...rule(DEFAULT_BANDS), id: 'c' };
    const p: SimPolicy = { ...DEFAULT_POLICY, rules: [a, b, c] };
    const nb = setBandStories(b, 0, 5);
    const out = replaceRule(p, nb);
    expect(out.rules).toEqual([a, nb, c]);
    expect(out.rules[0]).toBe(a);
    expect(out.rules[2]).toBe(c);
    expect(out.custom).toBe(p.custom);
    expect(p.rules[1]).toBe(b);
    // An id that matches nothing changes no rule.
    expect(replaceRule(p, { ...nb, id: 'zzz' }).rules).toEqual([a, b, c]);
  });
});
