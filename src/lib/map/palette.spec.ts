import { describe, expect, it } from 'vitest';
import { differenceCiede2000, hsl, lab, parse } from 'culori';
import { TOKENS, TIMELINE_LEGEND, colorFor, GEN_RGBA, type TokenName } from './palette';
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
