// The lot dots: user-layer lots filled by mode, protected lots as an outlined ring.
import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import type { OverlayCtors } from '$lib/brush/overlay';
import type { LotRole } from './policy';
import { LOT_COLORS, lotOverlayLayers } from './lot-overlay';

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
  it('gives a user-layer layer and a protected layer with the lots per role', () => {
    const layers = lotOverlayLayers(fakeCtors(), roles, points, false) as Fake[];
    expect(layers.map((l) => l.id)).toEqual(['sim-lots', 'sim-lots-protected']);
    const [user, prot] = layers;
    const userData = user.props.data as { role: LotRole }[];
    const protData = prot.props.data as { role: LotRole }[];
    expect(userData.map((d) => d.role).sort()).toEqual(['lower', 'raise', 'raise', 'set']);
    expect(protData).toHaveLength(1);
    expect(user.props.radiusMinPixels).toBe(2);
    expect(prot.props.radiusMinPixels).toBe(2);
    // user lots are filled by mode; protected lots are an outlined ring
    expect(user.props.filled).toBe(true);
    const fill = user.props.getFillColor as (d: { role: LotRole }) => number[];
    expect(fill({ role: 'lower' }).slice(0, 3)).toEqual(LOT_COLORS.light.lower);
    expect(prot.props.stroked).toBe(true);
    expect(prot.props.filled).toBe(false);
  });

  it('uses the dark palette in dark mode', () => {
    const [user] = lotOverlayLayers(fakeCtors(), roles, points, true) as Fake[];
    const fill = user.props.getFillColor as (d: { role: LotRole }) => number[];
    expect(fill({ role: 'raise' }).slice(0, 3)).toEqual(LOT_COLORS.dark.raise);
  });
});
