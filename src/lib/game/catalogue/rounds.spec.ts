import { describe, expect, it } from 'vitest';
import { storiesFromFt } from '../../../../pipeline/lib/heights';
import type { Selector, Policy } from '$lib/timeline/policy4';
import {
  bandsText,
  CATALOGUE,
  entryOf,
  keyIds,
  keyOf,
  keyOfId,
  ROUNDS,
  roundEntries,
  rulesText,
  type RoundEntry
} from './rounds';

function pol(id: string, where: Selector, preset: string | null): Policy {
  return { id, label: id, preset, on: true, where, spans: [] };
}

describe('the round catalogue', () => {
  it("twelve policies, three per round, in the spec's rounds", () => {
    expect(CATALOGUE.map((e) => [e.key, e.round])).toEqual([
      ['transit-rail', 1],
      ['sb423-clock', 1],
      ['housing-bond', 1],
      ['transit-metro', 2],
      ['benchmark-permits', 2],
      ['general-revenue', 2],
      ['transit-bus', 3],
      ['revolving-fund', 3],
      ['federal-support', 3],
      ['no-discretionary', 4],
      ['public-bank', 4],
      ['state-double', 4]
    ]);
    expect(ROUNDS).toBe(4);
    expect([1, 2, 3, 4].map((r) => roundEntries(r).length)).toEqual([3, 3, 3, 3]);
  });

  it('fixed transit values: SB 79 Tier 1, Tier 2, and the bus rule', () => {
    const z = (k: string) => entryOf(k) as Extract<RoundEntry, { kind: 'zoning' }>;
    expect(z('transit-rail').stopTypes).toEqual(['regionalRail']);
    expect(z('transit-rail').bands).toEqual([
      { maxM: 402, ft: 75, stories: 7 },
      { maxM: 805, ft: 65, stories: 6 }
    ]);
    expect(z('transit-metro').bands).toEqual([
      { maxM: 402, ft: 65, stories: 6 },
      { maxM: 805, ft: 55, stories: 5 }
    ]);
    expect(z('transit-bus').stopTypes).toEqual(['rapidBus', 'frequentBus']);
    expect(z('transit-bus').bands).toEqual([
      { maxM: 300, ft: 55, stories: 5 },
      { maxM: 600, ft: 45, stories: 4 }
    ]);
    for (const e of CATALOGUE)
      if (e.kind === 'zoning') for (const b of e.bands) expect(b.stories).toBe(storiesFromFt(b.ft));
  });

  it('the transit lines say "what if SB 79\'s default tiers applied"', () => {
    for (const k of ['transit-rail', 'transit-metro', 'transit-bus'])
      expect(entryOf(k)!.line).toMatch(/^What if SB 79's default tiers applied/);
  });

  it('presets: the version 2 node ids map to their presets', () => {
    expect(
      CATALOGUE.filter((e) => e.kind !== 'zoning').map((e) => [
        e.key,
        (e as { preset: string }).preset
      ])
    ).toEqual([
      ['sb423-clock', 'sb423Clock'],
      ['housing-bond', 'housing-bond'],
      ['benchmark-permits', 'benchmarkPermits'],
      ['general-revenue', 'general-revenue'],
      ['revolving-fund', 'revolving-fund'],
      ['federal-support', 'federal-support'],
      ['no-discretionary', 'noDiscretionary'],
      ['public-bank', 'public-bank'],
      ['state-double', 'state-double']
    ]);
  });

  it('keyOf', () => {
    expect(keyOf(pol('transit-rail', { tag: 'transit', stopTypes: ['regionalRail'] }, null))).toBe(
      'transit-rail'
    );
    expect(keyOf(pol('transit-rail', { tag: 'painted' }, null))).toBeNull();
    expect(keyOf(pol('timing', { tag: 'routes' }, 'sb423Clock'))).toBe('sb423-clock');
    expect(keyOf(pol('timing', { tag: 'routes' }, null))).toBeNull();
    expect(keyOf(pol('fund', { tag: 'fund', pool: 'p' }, 'housing-bond'))).toBe('housing-bond');
    expect(keyOf(pol('fund', { tag: 'fund', pool: 'p' }, 'state-off'))).toBeNull();
    // The id first: an edited money policy (preset null) keeps the key its id names.
    expect(keyOf(pol('housing-bond', { tag: 'fund', pool: 'p' }, null))).toBe('housing-bond');
    expect(keyOf(pol('housing-bond-2', { tag: 'terms' }, null))).toBe('housing-bond');
    expect(keyOf(pol('no-discretionary', { tag: 'routes' }, 'observed'))).toBe('no-discretionary');
  });

  it('keyOfId: the key an id names, for a selector of its kind only', () => {
    expect(keyOfId(pol('housing-bond', { tag: 'fund', pool: 'p' }, null))).toBe('housing-bond');
    expect(keyOfId(pol('state-double-3', { tag: 'baseline' }, null))).toBe('state-double');
    expect(keyOfId(pol('sb423-clock', { tag: 'routes' }, null))).toBe('sb423-clock');
    expect(keyOfId(pol('fund', { tag: 'fund', pool: 'p' }, 'housing-bond'))).toBeNull();
    expect(keyOfId(pol('housing-bond', { tag: 'routes' }, null))).toBeNull();
    expect(keyOfId(pol('housing-bond', { tag: 'transit', stopTypes: [] }, null))).toBeNull();
    // Transit keeps the exact id.
    expect(keyOfId(pol('transit-rail-2', { tag: 'transit', stopTypes: [] }, null))).toBeNull();
  });

  it('keyIds', () => {
    expect(keyIds('housing-bond', 1, new Set())).toEqual(['housing-bond']);
    expect(keyIds('housing-bond', 3, new Set(['housing-bond-2']))).toEqual([
      'housing-bond',
      'housing-bond-3',
      'housing-bond-4'
    ]);
  });

  it('bandsText and rulesText', () => {
    const rail = entryOf('transit-rail')!;
    expect(
      bandsText(
        [
          { maxM: 402, stories: 7 },
          { maxM: 805, stories: 6 }
        ],
        rail
      )
    ).toBe('75 ft within 402 m, 65 ft from 402 to 805 m');
    expect(
      bandsText(
        [
          { maxM: 402, stories: 12 },
          { maxM: 1200, stories: 6 }
        ],
        rail
      )
    ).toBe('12 stories within 402 m, 6 stories from 402 to 1,200 m');
    expect(rulesText(entryOf('benchmark-permits')!)).toBe('permit review takes 134 days, not 280');
  });
});
