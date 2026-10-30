// The lot dots: user-layer lots filled by mode, protected lots as an outlined ring.
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
  ['a', 'raise'],
  ['b', 'lower'],
  ['c', 'set'],
  ['d', 'protected'],
  ['e', 'raise'],
  ['nopoint', 'raise']
]);
const points = (id: string): [number, number] | undefined =>
  id === 'nopoint' ? undefined : [-122.42, 37.76];

describe('lotOverlayLayers', () => {
  it('gives a halo, a user-layer layer and a protected layer with the lots per role', () => {
    const layers = lotOverlayLayers(fakeCtors(), roles, points, false) as Fake[];
    expect(layers.map((l) => l.id)).toEqual(['sim-lots-halo', 'sim-lots', 'sim-lots-protected']);
    const [halo, user, prot] = layers;
    expect(halo.props.data).toHaveLength(5);
    const userData = user.props.data as { role: LotRole }[];
    const protData = prot.props.data as { role: LotRole }[];
    expect(userData.map((d) => d.role).sort()).toEqual(['lower', 'raise', 'raise', 'set']);
    expect(protData).toHaveLength(1);
    expect(user.props.radiusMinPixels).toBe(2);
    expect(prot.props.radiusMinPixels).toBe(2);
    // user lots are filled by mode; protected lots are an outlined ring
    expect(user.props.filled).toBe(true);
    expect(user.props.stroked).toBe(true);
    expect(user.props.getLineColor).toEqual([...LOT_EDGE.light.outline, 255]);
    expect(halo.props.getLineColor).toEqual([...LOT_EDGE.light.halo, 255]);
    expect(halo.props.getLineWidth as number).toBeGreaterThan(user.props.getLineWidth as number);
    const fill = user.props.getFillColor as (d: { role: LotRole }) => number[];
    expect(fill({ role: 'lower' }).slice(0, 3)).toEqual(LOT_COLORS.light.lower);
    expect(prot.props.stroked).toBe(true);
    expect(prot.props.filled).toBe(false);
  });

  it('uses the dark palette in dark mode', () => {
    const [, user] = lotOverlayLayers(fakeCtors(), roles, points, true) as Fake[];
    const fill = user.props.getFillColor as (d: { role: LotRole }) => number[];
    expect(fill({ role: 'raise' }).slice(0, 3)).toEqual(LOT_COLORS.dark.raise);
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
