// The lot dots: every lot your zoning changes, filled, over a halo.
import { describe, expect, it } from 'vitest';
import { parse, wcagContrast } from 'culori';
import type { Layer } from '@deck.gl/core';
import { TOKENS, type TokenName } from '$lib/map/palette';
import type { OverlayCtors } from '$lib/brush/overlay';
import type { LotRole } from './policy';
import { LOT_COLORS, LOT_EDGE, lotOverlayLayers } from './lot-overlay';

type Fake = Layer & { props: Record<string, unknown> };

function fakeCtors(): OverlayCtors {
  const mk = () =>
    class {
      props: Record<string, unknown>;
      id: string;
      constructor(props: Record<string, unknown>) {
        this.props = props;
        this.id = props.id as string;
      }
    } as unknown as new (props: Record<string, unknown>) => Layer;
  return { ScatterplotLayer: mk(), PathLayer: mk() };
}

const roles = new Map<string, LotRole>([
  ['a', 'changed'],
  ['b', 'changed'],
  ['nopoint', 'changed']
]);
const points = (id: string): [number, number] | undefined =>
  id === 'nopoint' ? undefined : [-122.42, 37.76];

describe('lotOverlayLayers', () => {
  it('gives one layer of filled dots plus the halo, and no protected layer', () => {
    const layers = lotOverlayLayers(fakeCtors(), roles, points, false) as Fake[];
    expect(layers.map((l) => l.id)).toEqual(['sim-lots-halo', 'sim-lots']);
    const [halo, dots] = layers;
    expect(halo.props.data).toHaveLength(2);
    expect(dots.props.data).toHaveLength(2);
    expect(dots.props.radiusMinPixels).toBe(2);
    expect(dots.props.filled).toBe(true);
    expect(dots.props.stroked).toBe(true);
    expect(dots.props.getLineColor).toEqual([...LOT_EDGE.light.outline, 255]);
    expect(halo.props.getLineColor).toEqual([...LOT_EDGE.light.halo, 255]);
    expect(halo.props.getLineWidth as number).toBeGreaterThan(dots.props.getLineWidth as number);
    expect(dots.props.getFillColor).toEqual([...LOT_COLORS.light.changed, 255]);
  });

  it("keeps today's raise blue for changed lots, lighter in dark mode", () => {
    expect(LOT_COLORS.light.changed).toEqual([29, 78, 216]);
    const [, dots] = lotOverlayLayers(fakeCtors(), roles, points, true) as Fake[];
    expect(dots.props.getFillColor).toEqual([...LOT_COLORS.dark.changed, 255]);
  });
});

const rgb = ([r, g, b]: [number, number, number]) => ({
  mode: 'rgb' as const,
  r: r / 255,
  g: g / 255,
  b: b / 255
});

/** Every map colour a dot can sit on: the basemap, existing and replaced buildings, the
 *  generated buildings and the timelapse ghosts. */
const UNDER: TokenName[] = [
  'land',
  'water',
  'park',
  'road',
  'roadMinor',
  'existing',
  'replaced',
  'gen-adu',
  'gen-plex',
  'gen-walkup',
  'gen-podium',
  'gen-midrise',
  'gen-tower',
  'tl-ghost-planning',
  'tl-ghost-permit',
  'tl-ghost-ready',
  'tl-ghost-dying'
];

describe('lot dot contrast (WCAG 1.4.11)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const { outline, halo } = LOT_EDGE[theme];
    it(`${theme}: the outline is ≥ 3:1 against its halo`, () => {
      expect(wcagContrast(rgb(outline), rgb(halo))).toBeGreaterThanOrEqual(3);
    });
    for (const token of UNDER) {
      it(`${theme}: the outline or the halo is ≥ 3:1 against ${token}`, () => {
        const under = parse(TOKENS[theme][token])!;
        const best = Math.max(wcagContrast(rgb(outline), under), wcagContrast(rgb(halo), under));
        expect(best).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
