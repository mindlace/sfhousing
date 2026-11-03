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
import {
  BAND_MAX_M,
  MAX_BANDS,
  NEW_BAND_STEP_M,
  addBand,
  distanceRange,
  layerName,
  layerTop,
  newLayer,
  removeBand,
  replaceRule,
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
    expect(setBandDistance(r, 2, 99_999).bands[2].maxM).toBe(BAND_MAX_M);
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
        dists: fc.uniqueArray(fc.integer({ min: 1, max: BAND_MAX_M }), {
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
      fc.constantFrom(NaN, Infinity, -Infinity, 0, 1, 80, 81, BAND_MAX_M)
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
    expect(added.bands).toEqual([...DEFAULT_BANDS, { maxM: 805 + NEW_BAND_STEP_M, stories: 4 }]);
    expect(bandProblem(added.bands)).toBeNull();
    expect(addBand(added)).toBeNull();
    const atCap = rule([{ maxM: BAND_MAX_M, stories: 3 }]);
    expect(addBand(atCap)).toBeNull();
    // Close to the cap: the new band lands on the cap, not past it.
    const near = addBand(rule([{ maxM: BAND_MAX_M - 10, stories: 3 }]))!;
    expect(near.bands.at(-1)).toEqual({ maxM: BAND_MAX_M, stories: 3 });
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
    expect(addBand(r)!.bands.map((b) => b.maxM)).toEqual([402, 805, 1207]);
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
