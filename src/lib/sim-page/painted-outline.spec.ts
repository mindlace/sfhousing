import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import type { OverlayCtors } from '$lib/brush/overlay';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { TOKENS, hexToRgba } from '$lib/map/palette';
import type { LotOutlinesResult } from '$lib/sim/scenario/types';
import { dashRing, paintedOutlineLayers } from './painted-outline';

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
function pathLengthM(path: Pt[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++)
    m += Math.hypot(
      (path[i][0] - path[i - 1][0]) * M_PER_DEG_LNG,
      (path[i][1] - path[i - 1][1]) * M_PER_DEG_LAT
    );
  return m;
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

describe('dashRing', () => {
  it('dashes a 100 m square into dash and gap lengths along its edges', () => {
    const d = dashRing(squareRing(CENTRE, 100), 4, 3);
    expect(d.length).toBe(Math.floor(400 / 7) + 1);
    for (const dash of d.slice(0, -1)) expect(pathLengthM(dash)).toBeCloseTo(4, 1);
  });

  it('a dash that crosses a corner keeps the corner vertex', () => {
    // dashes start at 0, 7, ..., 98: the one from 98 m to 102 m bends at the corner (100 m)
    const d = dashRing(squareRing(CENTRE, 100), 4, 3);
    const bent = d[14];
    expect(bent.length).toBe(3);
    expect(pathLengthM(bent)).toBeCloseTo(4, 1);
  });

  it('closes an open ring', () => {
    const open = squareRing(CENTRE, 100).slice(0, -1);
    expect(dashRing(open, 4, 3).length).toBe(Math.floor(400 / 7) + 1);
  });
});

describe('paintedOutlineLayers', () => {
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
