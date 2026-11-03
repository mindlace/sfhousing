import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import type { OverlayCtors } from '$lib/brush/overlay';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { TOKENS, hexToRgba } from '$lib/map/palette';
import type { LotOutlines } from '$lib/sim/outlines';
import type { LotOutlinesResult } from '$lib/sim/scenario/types';
import { paintedOutlineLayers } from './outline-layers';

type Pt = [number, number];
const CENTRE: Pt = [-122.4194, 37.7749];

/** A closed square of side `sideM` metres, as lng/lat. */
function squareRing(c: Pt, sideM: number): Pt[] {
  const dx = sideM / M_PER_DEG_LNG;
  const dy = sideM / M_PER_DEG_LAT;
  return [
    [c[0], c[1]],
    [c[0] + dx, c[1]],
    [c[0] + dx, c[1] + dy],
    [c[0], c[1] + dy],
    [c[0], c[1]]
  ];
}

const FAKE_L = {
  ScatterplotLayer: class {},
  PathLayer: class {
    id: string;
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
      this.id = props.id as string;
    }
  }
} as unknown as OverlayCtors;

const ring = squareRing(CENTRE, 100);
const ONE_LOT: Extract<LotOutlinesResult, { ok: true }> = {
  ok: true,
  lots: ['a'],
  ringLot: Uint32Array.from([0]),
  starts: Uint32Array.from([0, ring.length]),
  positions: Float64Array.from(ring.flat()),
  missing: 0
};

describe('paintedOutlineLayers', () => {
  it('takes a plain LotOutlines (an opLots outline), with the same layer', () => {
    const plain: LotOutlines = {
      lots: ONE_LOT.lots,
      ringLot: ONE_LOT.ringLot,
      starts: ONE_LOT.starts,
      positions: ONE_LOT.positions
    };
    type Props = { props: { id: string; data: unknown[]; getColor: unknown } };
    const a = paintedOutlineLayers(FAKE_L, plain, 'light') as unknown as Props[];
    const b = paintedOutlineLayers(FAKE_L, ONE_LOT, 'light') as unknown as Props[];
    expect(a).toHaveLength(1);
    expect(a[0].props.id).toBe(b[0].props.id);
    expect(a[0].props.data).toEqual(b[0].props.data);
    expect(a[0].props.getColor).toEqual(b[0].props.getColor);
  });

  it('one path layer in the painted-outline token, per theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const layers = paintedOutlineLayers(FAKE_L, ONE_LOT, theme);
      expect(layers).toHaveLength(1);
      const l = layers[0] as Layer & { props: Record<string, unknown> };
      expect(l.id).toBe('sim-painted-outline');
      expect(l.props.getColor).toEqual(hexToRgba(TOKENS[theme]['painted-outline']));
      expect(l.props.getWidth).toBe(2);
    }
  });

  it('draws nothing for no rings', () => {
    const none = {
      ...ONE_LOT,
      lots: [],
      starts: Uint32Array.from([0]),
      ringLot: new Uint32Array()
    };
    expect(paintedOutlineLayers(FAKE_L, none, 'light')).toEqual([]);
  });
});
