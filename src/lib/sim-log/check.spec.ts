import { describe, expect, it } from 'vitest';
import { OBSERVED_TIMING } from '$lib/sim-page/timing';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { checkRuleset } from './check';
import {
  bandsW,
  doc,
  first,
  last,
  open,
  painted,
  routes,
  ruleset,
  span,
  transit
} from './test/fixtures';

const ok = (p: SimPolicy4, name?: string) => ({ ...ruleset(p, name), datasetVersion: null });

describe('checkRuleset', () => {
  it('passes a valid ruleset', () => {
    expect(checkRuleset(ok(doc([transit('z1')])))).toBeNull();
  });

  it('names the field parsePolicy4 names', () => {
    const bad = doc([
      transit('z1', [span(first(1), last(6), bandsW()), span(first(3), null, bandsW())])
    ]);
    expect(checkRuleset(ok(bad))?.path).toBe('policy.kinds.zoning[0].spans[1].from');
  });

  it('names a bad sim name', () => {
    expect(checkRuleset(ok(doc(), ' x'))?.path).toBe('name');
  });

  it('a retired preset still checks', () => {
    const set = { ...structuredClone(OBSERVED_TIMING.current), preset: 'ceqaInfill' };
    const p = doc([], [{ ...routes('p1', [open({ tag: 'timing', set })]), preset: 'ceqaInfill' }]);
    expect(checkRuleset(ok(p))).toBeNull();
  });

  it('refuses a ruleset over the size limit', () => {
    // Six strokes of 2,000 points serialize (quantized) to about 277 KB, over MAX_PLAN_BYTES
    // (262,144).
    const many = Array.from({ length: 6 }, (_, i) => ({
      path: Array.from(
        { length: 2000 },
        (_, k) => [-122.4 + k * 1e-6, 37.7 + i * 1e-6] as [number, number]
      ),
      radiusM: 50
    }));
    const brushes = [{ id: 'b1', kind: 'paint', strokes: many, stories: 5 }];
    const p = doc([painted('z2', [open({ tag: 'brushes', brushes })])]);
    expect(checkRuleset(ok(p))?.message).toMatch(/larger than/);
  });
});
