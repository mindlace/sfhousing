import { describe, expect, it } from 'vitest';
import { differenceCiede2000, hsl, lab, parse } from 'culori';
import {
  TOKENS,
  TIMELINE_LEGEND,
  colorFor,
  GEN_RGBA,
  tokenCss,
  timelineTokenCss,
  type TokenName
} from './palette';
import { TYPOLOGY_ORDER } from './types';

const de = differenceCiede2000();
function luminance(hex: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('palette (U4)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every typology has a colour`, () => {
      for (const t of TYPOLOGY_ORDER) expect(colorFor('user', t, theme)).toHaveLength(4);
      expect(GEN_RGBA[theme]).toHaveLength(6);
    });
    it(`${theme}: ΔE2000(gen, existing) ≥ 20`, () => {
      for (const t of TYPOLOGY_ORDER) {
        const d = de(parse(TOKENS[theme][`gen-${t}`])!, parse(TOKENS[theme].existing)!);
        expect(d, t).toBeGreaterThanOrEqual(20);
      }
    });
    it(`${theme}: ground contrast strictly increases with typology order`, () => {
      const cs = TYPOLOGY_ORDER.map((t) => contrast(TOKENS[theme][`gen-${t}`], TOKENS[theme].land));
      for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeGreaterThan(cs[i - 1]);
    });
    it(`${theme}: the access ramp's contrast with land strictly increases`, () => {
      const cs = ([1, 2, 3, 4, 5] as const).map((k) =>
        contrast(TOKENS[theme][`transit-access-${k}`], TOKENS[theme].land)
      );
      for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeGreaterThan(cs[i - 1]);
    });
    it(`${theme}: stop classes are distinct (ΔE2000 ≥ 20)`, () => {
      const ids = ['transit-bus', 'transit-rail', 'transit-regional'] as const;
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const d = de(parse(TOKENS[theme][ids[i]])!, parse(TOKENS[theme][ids[j]])!);
          expect(d, `${ids[i]} vs ${ids[j]}`).toBeGreaterThanOrEqual(20);
        }
    });
    it(`${theme}: stop markers keep 3:1 contrast with land`, () => {
      for (const id of ['transit-bus', 'transit-rail', 'transit-regional'] as const)
        expect(contrast(TOKENS[theme][id], TOKENS[theme].land), id).toBeGreaterThanOrEqual(3);
    });
  }
  it('all three sources share the typology colour; unknown throws', () => {
    expect(colorFor('pipeline', 'plex', 'light')).toEqual(colorFor('user', 'plex', 'light'));
    expect(colorFor('scenario', 'plex', 'light')).toEqual(colorFor('user', 'plex', 'light'));
    expect(() => colorFor('bogus' as never, 'plex', 'light')).toThrow(/unsupported source/);
  });
  it('spec hex values are verbatim', () => {
    expect(TOKENS.light.existing).toBe('#D6D0C4');
    expect(TOKENS.dark['gen-tower']).toBe('#F0A752');
  });
});

describe('timeline tokens', () => {
  const GHOSTS = [
    'tl-ghost-planning',
    'tl-ghost-permit',
    'tl-ghost-ready',
    'tl-ghost-dying'
  ] as const;
  const FILLS = ['tl-bar-likely', 'tl-bar-uncertain', 'tl-bar-unlikely', 'tl-bar-dead'] as const;
  const L = (hex: string) => lab(parse(hex)!)!.l;

  it('spec §4.6 hex values are verbatim', () => {
    expect(TOKENS.light['tl-ghost-planning']).toBe('#9DB0FF');
    expect(TOKENS.dark['tl-bar-dead']).toBe('#8F8A80');
    expect(TOKENS.light['tl-bar-track']).toBe('#FFFFFF');
    expect(TOKENS.dark['tl-bar-edge']).toBe('#A9A59C');
    expect(TOKENS.light['tl-ghost-dying']).toBe('#D84A4A');
    expect(TOKENS.dark['tl-bar-likely']).toBe('#81C784');
  });
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every tl-* token exists as a hex colour`, () => {
      for (const id of [...GHOSTS, ...FILLS, 'tl-bar-track', 'tl-bar-edge'] as const)
        expect(TOKENS[theme][id], id).toMatch(/^#[0-9A-F]{6}$/);
    });
    it(`${theme}: bar fills keep 3:1 contrast with the track`, () => {
      for (const id of FILLS)
        expect(
          contrast(TOKENS[theme][id], TOKENS[theme]['tl-bar-track']),
          id
        ).toBeGreaterThanOrEqual(3);
    });
    it(`${theme}: bar edge keeps 3:1 contrast with the track`, () => {
      expect(
        contrast(TOKENS[theme]['tl-bar-edge'], TOKENS[theme]['tl-bar-track'])
      ).toBeGreaterThanOrEqual(3);
    });
    it(`${theme}: ghost hues are in [220, 240]`, () => {
      for (const id of GHOSTS.slice(0, 3)) {
        const h = hsl(parse(TOKENS[theme][id])!)!.h!;
        expect(h, id).toBeGreaterThanOrEqual(220);
        expect(h, id).toBeLessThanOrEqual(240);
      }
    });
    it(`${theme}: ghost tints are ΔE2000 ≥ 20 from existing`, () => {
      for (const id of GHOSTS) {
        const d = de(parse(TOKENS[theme][id])!, parse(TOKENS[theme].existing)!);
        expect(d, id).toBeGreaterThanOrEqual(20);
      }
    });
  }
  it('light: ghost lightness strictly decreases planning -> permit -> ready', () => {
    const ls = (['tl-ghost-planning', 'tl-ghost-permit', 'tl-ghost-ready'] as const).map((id) =>
      L(TOKENS.light[id])
    );
    expect(ls[1]).toBeLessThan(ls[0]);
    expect(ls[2]).toBeLessThan(ls[1]);
  });
  it('dark: ghost lightness strictly increases planning -> permit -> ready', () => {
    const ls = (['tl-ghost-planning', 'tl-ghost-permit', 'tl-ghost-ready'] as const).map((id) =>
      L(TOKENS.dark[id])
    );
    expect(ls[1]).toBeGreaterThan(ls[0]);
    expect(ls[2]).toBeGreaterThan(ls[1]);
  });
});

describe('TIMELINE_LEGEND', () => {
  const byId = (id: string) => TIMELINE_LEGEND.find((e) => e.id === id)!;

  it('has the §4.6 ids in order, unique', () => {
    const ids = TIMELINE_LEGEND.map((e) => e.id);
    expect(ids).toEqual([
      'planning',
      'permit',
      'ready',
      'building',
      'complete',
      'stopped',
      'chance',
      'bar-stopped'
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every token exists in both themes', () => {
    for (const e of TIMELINE_LEGEND)
      for (const t of e.tokens) {
        expect(TOKENS.light[t as TokenName], `${e.id}/${t} light`).toBeTypeOf('string');
        expect(TOKENS.dark[t as TokenName], `${e.id}/${t} dark`).toBeTypeOf('string');
      }
  });
  it('kinds and labels are verbatim', () => {
    expect(TIMELINE_LEGEND.map((e) => e.kind)).toEqual([
      'ghost',
      'ghost',
      'ghost',
      'solid',
      'solid',
      'ghost',
      'bar',
      'bar'
    ]);
    expect(TIMELINE_LEGEND.map((e) => e.label)).toEqual([
      'Proposed: in Planning review',
      'Approved: in permit review',
      'Permit issued',
      'Under construction (solid floors are built)',
      'Completed (colour shows building type)',
      'Stopped: withdrawn, disapproved, cancelled or expired',
      'Bar colour: chance of finishing, low to high',
      'Bar: project stopped'
    ]);
    expect(byId('stopped').label).toBe('Stopped: withdrawn, disapproved, cancelled or expired');
  });
  it('token lists match the spec', () => {
    expect(byId('planning').tokens).toEqual(['tl-ghost-planning']);
    expect(byId('permit').tokens).toEqual(['tl-ghost-permit']);
    expect(byId('ready').tokens).toEqual(['tl-ghost-ready']);
    expect(byId('building').tokens).toEqual(['tl-ghost-ready', 'gen-walkup']);
    expect(byId('complete').tokens).toEqual(TYPOLOGY_ORDER.map((t) => `gen-${t}`));
    expect(byId('stopped').tokens).toEqual(['tl-ghost-dying']);
    expect(byId('chance').tokens).toEqual(['tl-bar-unlikely', 'tl-bar-uncertain', 'tl-bar-likely']);
    expect(byId('bar-stopped').tokens).toEqual(['tl-bar-dead']);
  });
});

// The body of SimMap's DEFAULT_TOKENS_CSS (between <style> and </style>) as rendered by the code
// before the helper existed. This literal is dda6252's output, which is unchanged at 0784133.
// Pinned byte for byte (spec §4.6.1, AC15).
const DEFAULT_TOKENS_BODY =
  '.sim-map { --map-land: #F3EFE6; --map-water: #C7D3D6; --map-park: #E2E4D3; ' +
  '--map-road: #FFFFFF; --map-road-minor: #EAE5DA; --map-label: #5E5A52; ' +
  '--map-existing: #D6D0C4; --map-replaced: #E3DACA; ' +
  '--map-highlight: rgba(255,255,255,0.45); --map-chunk-loading: #8A8478; ' +
  '--map-chunk-error: #B3261E; --map-gen-adu: #E9A487; --map-gen-plex: #E08A68; ' +
  '--map-gen-walkup: #D2704E; --map-gen-podium: #BF5A3A; --map-gen-midrise: #A3472C; ' +
  '--map-gen-tower: #84371F; --map-transit-access-1: #E4EEF3; ' +
  '--map-transit-access-2: #BED7E3; --map-transit-access-3: #8DB9CF; ' +
  '--map-transit-access-4: #5596B5; --map-transit-access-5: #2C6E8F; ' +
  '--map-transit-bus: #5F6B66; --map-transit-rail: #7B3FA0; ' +
  '--map-transit-regional: #1F5FBF; --map-transit-stroke: #FFFFFF; ' +
  '--map-tl-ghost-planning: #9DB0FF; --map-tl-ghost-permit: #6F86F0; ' +
  '--map-tl-ghost-ready: #4257D6; --map-tl-ghost-dying: #D84A4A; ' +
  '--map-tl-bar-track: #FFFFFF; --map-tl-bar-edge: #5E5A52; ' +
  '--map-tl-bar-likely: #2E7D32; --map-tl-bar-uncertain: #B26A00; ' +
  '--map-tl-bar-unlikely: #C62828; ' +
  '--map-tl-bar-dead: #8A8478 } ' +
  '@media (prefers-color-scheme: dark) { .sim-map { --map-land: #1C1D1F; ' +
  '--map-water: #10181C; --map-park: #1F2420; --map-road: #2C2E31; ' +
  '--map-road-minor: #252729; --map-label: #A9A59C; --map-existing: #3B3D41; ' +
  '--map-replaced: #2A2B2E; --map-highlight: rgba(255,255,255,0.30); ' +
  '--map-chunk-loading: #8F8A80; --map-chunk-error: #F2B8B5; --map-gen-adu: #6E3B22; ' +
  '--map-gen-plex: #8A4A28; --map-gen-walkup: #A65C2E; --map-gen-podium: #C27236; ' +
  '--map-gen-midrise: #DB8B42; --map-gen-tower: #F0A752; ' +
  '--map-transit-access-1: #1E2A31; --map-transit-access-2: #24414F; ' +
  '--map-transit-access-3: #2D5D72; --map-transit-access-4: #3A7F9C; ' +
  '--map-transit-access-5: #5BA6C6; --map-transit-bus: #A3ADA6; ' +
  '--map-transit-rail: #C59BE0; --map-transit-regional: #7FB2FF; ' +
  '--map-transit-stroke: #111214; --map-tl-ghost-planning: #5466B8; ' +
  '--map-tl-ghost-permit: #7D90F0; --map-tl-ghost-ready: #AEBBFF; ' +
  '--map-tl-ghost-dying: #FF6E6E; --map-tl-bar-track: #2C2E31; ' +
  '--map-tl-bar-edge: #A9A59C; --map-tl-bar-likely: #81C784; ' +
  '--map-tl-bar-uncertain: #FFB74D; --map-tl-bar-unlikely: #FF8A80; ' +
  '--map-tl-bar-dead: #8F8A80 } }';

describe('tokenCss / timelineTokenCss (spec §4.6.1)', () => {
  const kebab = (n: string) => n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const ALL = Object.keys(TOKENS.light) as TokenName[];
  const expected = new Set<TokenName>([
    ...ALL.filter((n) => n.startsWith('tl-')),
    ...TIMELINE_LEGEND.flatMap((e) => e.tokens)
  ]);
  const declared = (block: string) =>
    [...block.matchAll(/--map-([a-z0-9-]+): ([^;}]+)/g)].map((m) => [m[1], m[2].trim()]);
  const split = (css: string) => {
    const at = css.indexOf(' @media (prefers-color-scheme: dark) { ');
    return { light: css.slice(0, at), dark: css.slice(at) };
  };

  it('tokenCss over every token and .sim-map reproduces the pinned DEFAULT_TOKENS_CSS body', () => {
    expect(tokenCss('.sim-map', ALL)).toBe(DEFAULT_TOKENS_BODY);
  });

  it('declares every tl-* and legend-named token exactly once, and nothing else', () => {
    const css = timelineTokenCss('.x');
    const { light, dark } = split(css);
    const want = ALL.filter((n) => expected.has(n)).map(kebab);
    expect(declared(light).map(([n]) => n)).toEqual(want);
    expect(declared(dark).map(([n]) => n)).toEqual(want);
    expect(new Set(want).size).toBe(want.length);
    // the superset is exactly: every tl-* token plus the six gen-* typology tokens
    expect(want.filter((n) => !n.startsWith('tl-'))).toEqual(TYPOLOGY_ORDER.map((t) => `gen-${t}`));
    expect(want.filter((n) => n.startsWith('tl-'))).toEqual(ALL.filter((n) => n.startsWith('tl-')));
    expect(css).not.toContain('--map-land');
    expect(css).not.toContain('--map-transit-');
  });

  it('puts light values in the first block and dark values under prefers-color-scheme: dark', () => {
    const { light, dark } = split(timelineTokenCss('.x'));
    expect(light.startsWith('.x { ')).toBe(true);
    expect(light.endsWith(' }')).toBe(true);
    expect(dark.startsWith(' @media (prefers-color-scheme: dark) { .x { ')).toBe(true);
    expect(dark.endsWith(' } }')).toBe(true);
    expect(light).not.toContain('@media');
    for (const [n, v] of declared(light)) {
      expect(v, n).toBe(TOKENS.light[n as TokenName]);
    }
    for (const [n, v] of declared(dark)) {
      expect(v, n).toBe(TOKENS.dark[n as TokenName]);
    }
  });

  it('is identical across calls and scoped to the selector as given', () => {
    expect(timelineTokenCss('.x')).toBe(timelineTokenCss('.x'));
    const css = timelineTokenCss('#legend > ul');
    expect(css.startsWith('#legend > ul { ')).toBe(true);
    expect(css.match(/#legend > ul \{/g)).toHaveLength(2);
    expect(css).not.toContain('<style');
  });

  it('throws a TypeError for an empty selector or one containing { } < ;', () => {
    for (const bad of ['', '  ', '\t\n', '.a{', '.a}', 'a { b', '</style>', '.a;b', '.a<b']) {
      expect(() => timelineTokenCss(bad), JSON.stringify(bad)).toThrow(TypeError);
      expect(() => timelineTokenCss(bad), JSON.stringify(bad)).toThrow(/selector/);
    }
  });
});
