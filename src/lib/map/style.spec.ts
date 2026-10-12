import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
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
  buildingsSource,
  existingBuildingsLayer
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
    ['legacy', { ...base, buildingRoofs: undefined }],
    ['with roofs', base],
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
          expect(src.buildings.promoteId).toEqual({
            buildings: label === 'legacy' ? 'parcelId' : 'pieceId'
          });
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

describe('buildingsSource promotion', () => {
  it('uses parcel ids for an unknown roof schema even with roof URLs present', () => {
    const manifest = parseManifest({
      ...raw,
      buildingRoofs: { ...base.buildingRoofs, schemaVersion: 2 }
    });
    expect(buildingsSource(manifest).promoteId).toEqual({ buildings: 'parcelId' });
  });

  it('uses piece ids for schema 1 without requiring roof index availability', () => {
    expect(buildingsSource(base).promoteId).toEqual({ buildings: 'pieceId' });
  });
});

// Evaluate the emitted expressions with MapLibre's parser to verify actual solid visibility.
describe('existing building solid visibility', () => {
  for (const theme of themes) {
    for (const [label, state, height, floor, color] of [
      ['fallback', {}, 12, 2, TOKENS[theme].existing],
      ['replaced', { replaced: true }, 0, 0, TOKENS[theme].replaced],
      ['roof ready', { roofReady: true }, 0, 0, TOKENS[theme].existing],
      ['replaced roof', { replaced: true, roofReady: true }, 0, 0, TOKENS[theme].replaced],
      ['deactivated', { replaced: false, roofReady: false }, 12, 2, TOKENS[theme].existing]
    ] as const) {
      it(`${theme} / ${label} keeps footprint styling while suppressing the appropriate solid`, () => {
        const layer = existingBuildingsLayer(theme) as { paint: Record<string, unknown> };
        for (const [property, expected] of [
          ['fill-extrusion-height', height],
          ['fill-extrusion-base', floor],
          ['fill-extrusion-color', color]
        ] as const) {
          const parsed = createExpression(layer.paint[property], property);
          expect(parsed.result).toBe('success');
          if (parsed.result !== 'success') throw new Error('invalid building paint expression');
          expect(
            parsed.value.evaluate(
              { zoom: 16 },
              { type: 'Polygon', properties: { heightM: 12, baseM: 2 } },
              state
            )
          ).toBe(expected);
        }
      });
    }

    it(`${theme} / unmatched fallback retains the default height and flat base`, () => {
      const layer = existingBuildingsLayer(theme) as { paint: Record<string, unknown> };
      for (const [property, expected] of [
        ['fill-extrusion-height', 6],
        ['fill-extrusion-base', 0]
      ] as const) {
        const parsed = createExpression(layer.paint[property], property);
        expect(parsed.result).toBe('success');
        if (parsed.result !== 'success') throw new Error('invalid building paint expression');
        expect(
          parsed.value.evaluate(
            { zoom: 16 },
            { type: 'Polygon', properties: { parcelId: null } },
            {}
          )
        ).toBe(expected);
      }
    });
  }
});
