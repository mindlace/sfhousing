import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import { TOKENS } from './palette';
import {
  buildStyle,
  themePaintDiff,
  BUILDINGS_LAYER,
  OVERLAY_ANCHOR,
  FONT_RENAME,
  rewriteFont,
  firstSymbolLayerId,
  TRANSIT_ACCESS_LAYER,
  TRANSIT_ACCESS_SOURCE,
  TRANSIT_STOP_LAYERS,
  TRANSIT_STOPS_SOURCE
} from './style';
import type { Theme } from './types';

const raw = JSON.parse(readFileSync('e2e/fixtures/data/fixture-0/manifest.json', 'utf8')) as Record<
  string,
  unknown
>;
const base: Manifest = parseManifest(raw);
const withSprite: Manifest = parseManifest({ ...raw, sprite: '/data/fixture-0/sprite' });
const themes: Theme[] = ['light', 'dark'];

function fontStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => fontStrings(x, out));
  return out;
}

describe('buildStyle (U7)', () => {
  for (const [label, m] of [
    ['plain', base],
    ['with sprite', withSprite]
  ] as const) {
    for (const theme of themes) {
      describe(`${label} / ${theme}`, () => {
        const style = buildStyle(m, theme);
        const ids = style.layers.map((l) => l.id);

        it('has no sprite, uses manifest glyphs and sources', () => {
          expect(style.sprite).toBeUndefined();
          expect(style.glyphs).toBe(m.glyphs);
          const src = style.sources as Record<string, Record<string, unknown>>;
          expect(src.protomaps.url).toBe('pmtiles://' + m.basemapTiles);
          expect(src.buildings.url).toBe('pmtiles://' + m.buildingsTiles);
          expect(src.buildings.promoteId).toEqual({ buildings: 'parcelId' });
        });

        it('drops pois and icon layers', () => {
          expect(ids).not.toContain('pois');
          const icons = style.layers.filter(
            (l) => (l as { layout?: Record<string, unknown> }).layout?.['icon-image'] !== undefined
          );
          expect(icons).toEqual([]);
          expect(ids.filter((i) => i === 'buildings')).toEqual([]);
        });

        it('has only renamed, space-free fonts', () => {
          let n = 0;
          for (const l of style.layers) {
            const tf = (l as { layout?: Record<string, unknown> }).layout?.['text-font'];
            if (tf === undefined) continue;
            for (const s of fontStrings(tf)) {
              if (['case', 'literal', 'get', '<=', 'min_zoom'].includes(s)) continue;
              n++;
              expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
              expect(Object.values(FONT_RENAME)).toContain(s);
            }
          }
          expect(n).toBeGreaterThan(0);
        });

        it('draws existing-buildings from the tokens', () => {
          const l = style.layers.find((x) => x.id === BUILDINGS_LAYER) as {
            minzoom: number;
            paint: Record<string, unknown>;
          };
          expect(l.minzoom).toBe(12);
          const color = JSON.stringify(l.paint['fill-extrusion-color']);
          expect(color).toContain(TOKENS[theme].existing);
          expect(color).toContain(TOKENS[theme].replaced);
          expect(color).toContain('["boolean",["feature-state","replaced"],false]');
        });

        it('orders the stack', () => {
          const last = style.layers[style.layers.length - 1] as {
            id: string;
            layout: Record<string, unknown>;
          };
          expect(last.id).toBe(OVERLAY_ANCHOR);
          expect(last.layout.visibility).toBe('none');
          const b = ids.indexOf(BUILDINGS_LAYER);
          expect(b).toBeGreaterThan(0);
          const symbols = style.layers.filter((l) => l.type === 'symbol');
          expect(symbols.length).toBeGreaterThan(0);
          for (const s of symbols) expect(ids.indexOf(s.id)).toBeGreaterThan(b);
          expect(ids.slice(b + 1, b + 4)).toEqual([
            'chunk-fill',
            'chunk-loading-line',
            'chunk-error-line'
          ]);
        });
      });
    }
  }
});

describe('themePaintDiff (U7)', () => {
  const diff = themePaintDiff(base);
  for (const t of themes) {
    const other: Theme = t === 'light' ? 'dark' : 'light';
    it(`turns ${other} into ${t}`, () => {
      expect(diff[t].length).toBeGreaterThan(0);
      expect(diff[t].map((p) => p[0])).toContain(BUILDINGS_LAYER);
      expect(diff[t].map((p) => p[0])).toContain('background');
      const style = JSON.parse(JSON.stringify(buildStyle(base, other))) as ReturnType<
        typeof buildStyle
      >;
      for (const [id, prop, value] of diff[t]) {
        const layer = style.layers.find((l) => l.id === id) as {
          paint?: Record<string, unknown>;
        };
        layer.paint ??= {};
        if (value === null) delete layer.paint[prop];
        else layer.paint[prop] = JSON.parse(JSON.stringify(value));
      }
      const want = buildStyle(base, t);
      expect(style.layers.map((l) => [l.id, (l as { paint?: unknown }).paint ?? {}])).toEqual(
        want.layers.map((l) => [l.id, (l as { paint?: unknown }).paint ?? {}])
      );
    });
  }
});

describe('firstSymbolLayerId', () => {
  for (const theme of themes) {
    it(`returns the first label layer of the ${theme} style`, () => {
      const style = buildStyle(base, theme);
      const id = firstSymbolLayerId(style);
      const i = style.layers.findIndex((l) => l.id === id);
      expect(style.layers[i].type).toBe('symbol');
      expect(style.layers.slice(0, i).some((l) => l.type === 'symbol')).toBe(false);
      expect(i).toBeGreaterThan(style.layers.findIndex((l) => l.id === 'chunk-error-line'));
    });
  }

  it('is undefined for a style without symbol layers (or without a style)', () => {
    const style = buildStyle(base, 'light');
    expect(
      firstSymbolLayerId({ ...style, layers: style.layers.filter((l) => l.type !== 'symbol') })
    ).toBeUndefined();
    expect(firstSymbolLayerId(undefined)).toBeUndefined();
  });
});

describe('rewriteFont', () => {
  it('throws on an unknown font and renames expression literals', () => {
    expect(() => rewriteFont(['Noto Sans Bold'], true)).toThrow(/unknown text-font/);
    expect(
      rewriteFont(
        ['case', ['literal', ['Noto Sans Medium']], ['literal', ['Noto Sans Regular']]],
        false
      )
    ).toEqual(['case', ['literal', ['NotoSans-Medium']], ['literal', ['NotoSans-Regular']]]);
  });
});

describe('transit layers', () => {
  const rest = { ...raw };
  delete rest.transit;
  const noTransit: Manifest = parseManifest(rest);
  const withTransit: Manifest = base;

  it('the fixture manifest names transit; the stripped one does not', () => {
    expect(withTransit.transit).toBe('/data/fixture-0/transit.json');
    expect(noTransit.transit).toBeUndefined();
  });

  for (const theme of themes) {
    it(`${theme}: are absent when the manifest has no transit`, () => {
      const s = buildStyle(noTransit, theme);
      expect(Object.keys(s.sources)).not.toContain(TRANSIT_STOPS_SOURCE);
      expect(Object.keys(s.sources)).not.toContain(TRANSIT_ACCESS_SOURCE);
      expect(s.layers.some((l) => l.id.startsWith('transit-'))).toBe(false);
    });

    it(`${theme}: put the access fill under buildings and the stops above the labels, hidden`, () => {
      const s = buildStyle(withTransit, theme);
      const ids = s.layers.map((l) => l.id);
      const src = s.sources as Record<string, { type: string }>;
      expect(src[TRANSIT_ACCESS_SOURCE].type).toBe('geojson');
      expect(src[TRANSIT_STOPS_SOURCE].type).toBe('geojson');
      expect(ids.indexOf(TRANSIT_ACCESS_LAYER)).toBeGreaterThan(0);
      expect(ids.indexOf(TRANSIT_ACCESS_LAYER)).toBeLessThan(ids.indexOf(BUILDINGS_LAYER));
      const lastLabel = ids.lastIndexOf(s.layers.filter((l) => l.type === 'symbol').at(-1)!.id);
      for (const id of TRANSIT_STOP_LAYERS) expect(ids.indexOf(id)).toBeGreaterThan(lastLabel);
      expect(ids.at(-1)).toBe(OVERLAY_ANCHOR);
      for (const id of [TRANSIT_ACCESS_LAYER, ...TRANSIT_STOP_LAYERS]) {
        const l = s.layers.find((x) => x.id === id) as { layout?: { visibility?: string } };
        expect(l.layout?.visibility, id).toBe('none');
      }
      expect(firstSymbolLayerId(s)).toBe(firstSymbolLayerId(buildStyle(noTransit, theme)));
    });

    it(`${theme}: filter stops by class with the spec's zoom thresholds`, () => {
      const s = buildStyle(withTransit, theme);
      const got = TRANSIT_STOP_LAYERS.map((id) => {
        const l = s.layers.find((x) => x.id === id) as {
          minzoom?: number;
          filter: unknown;
          source: string;
          paint: Record<string, unknown>;
        };
        expect(l.source).toBe(TRANSIT_STOPS_SOURCE);
        return [l.minzoom, l.filter, l.paint['circle-color']];
      });
      const t = TOKENS[theme];
      expect(got).toEqual([
        [15, ['==', ['get', 'cls'], 'bus'], t['transit-bus']],
        [13, ['==', ['get', 'cls'], 'rail'], t['transit-rail']],
        [undefined, ['==', ['get', 'cls'], 'regional-rail'], t['transit-regional']]
      ]);
    });
  }

  it('theme-diff the transit paint', () => {
    const d = themePaintDiff(withTransit);
    expect(d.dark.some(([id]) => id === TRANSIT_ACCESS_LAYER)).toBe(true);
    for (const id of TRANSIT_STOP_LAYERS) expect(d.dark.some(([x]) => x === id)).toBe(true);
  });
});
