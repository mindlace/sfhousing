import { describe, expect, it } from 'vitest';
import { parse, wcagContrast } from 'culori';
import type { Layer } from '@deck.gl/core';
import { project } from '$lib/plan';
import { TOKENS } from '$lib/map/palette';
import {
  BRUSH_COLORS,
  buildOverlayLayers,
  dashedCircle,
  metersPerPixel,
  type OverlayCtors,
  type OverlayInput
} from './overlay';

type Captured = { kind: 'scatter' | 'path'; props: Record<string, unknown> };

function fakeCtors(): { L: OverlayCtors; made: Captured[] } {
  const made: Captured[] = [];
  const mk = (kind: Captured['kind']) =>
    class {
      props: Record<string, unknown>;
      id: string;
      constructor(props: Record<string, unknown>) {
        this.props = props;
        this.id = props.id as string;
        made.push({ kind, props });
      }
    } as unknown as new (props: Record<string, unknown>) => Layer;
  return { L: { ScatterplotLayer: mk('scatter'), PathLayer: mk('path') }, made };
}

const C: [number, number] = [-122.4194, 37.7749];
const base: OverlayInput = {
  tool: 'paint',
  ring: C,
  radiusM: 30,
  swath: null,
  metersPerPixel: 1,
  dark: false
};

function distM(a: [number, number], b: [number, number]): number {
  const [ax, ay] = project(a[0], a[1]);
  const [bx, by] = project(b[0], b[1]);
  return Math.hypot(ax - bx, ay - by);
}

describe('metersPerPixel', () => {
  it('is 78271.517 m at the equator, zoom 0', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
  });

  it('halves per zoom level and shrinks with cos(lat)', () => {
    expect(metersPerPixel(0, 1)).toBeCloseTo(78271.517 / 2, 2);
    expect(metersPerPixel(60, 0)).toBeCloseTo(78271.517 / 2, 1);
  });
});

describe('dashedCircle', () => {
  it('returns 32 two-point dashes whose vertices sit on the radius (±0.5%)', () => {
    const paths = dashedCircle(C, 50);
    expect(paths).toHaveLength(32);
    for (const p of paths) {
      expect(p).toHaveLength(2);
      for (const v of p) {
        const d = distM(C, v);
        expect(Math.abs(d - 50) / 50).toBeLessThan(0.005);
      }
    }
  });

  it('takes n vertices → n/2 dashes', () => {
    expect(dashedCircle(C, 10, 16)).toHaveLength(8);
  });
});

describe('buildOverlayLayers', () => {
  it('draws nothing with no ring and no swath', () => {
    const { L, made } = fakeCtors();
    expect(buildOverlayLayers(L, { ...base, ring: null, swath: null })).toEqual([]);
    expect(made).toHaveLength(0);
  });

  it('draws the paint ring as a stroked metres ScatterplotLayer with a 4 px minimum', () => {
    const { L, made } = fakeCtors();
    const layers = buildOverlayLayers(L, base);
    expect(layers).toHaveLength(1);
    expect(made[0].kind).toBe('scatter');
    const p = made[0].props;
    expect(p.id).toBe('brush-ring');
    expect(p.data).toEqual([C]);
    expect((p.getPosition as (d: unknown) => unknown)(C)).toBe(C);
    expect(p.getRadius).toBe(30);
    expect(p.radiusUnits).toBe('meters');
    expect(p.radiusMinPixels).toBe(4);
    expect(p.stroked).toBe(true);
    expect(p.filled).toBe(false);
    expect(p.lineWidthUnits).toBe('pixels');
    expect(p.getLineWidth).toBe(2);
    expect(p.getLineColor).toEqual([...BRUSH_COLORS.light.paint, 255]);
  });

  it('uses the dark palette when dark', () => {
    const { L, made } = fakeCtors();
    buildOverlayLayers(L, { ...base, dark: true });
    expect(made[0].props.getLineColor).toEqual([...BRUSH_COLORS.dark.paint, 255]);
  });

  it('draws the erase ring as a dashed PathLayer of 32 paths', () => {
    const { L, made } = fakeCtors();
    buildOverlayLayers(L, { ...base, tool: 'erase' });
    expect(made[0].kind).toBe('path');
    const p = made[0].props;
    expect(p.id).toBe('brush-ring');
    expect(p.data as unknown[]).toHaveLength(32);
    expect(p.widthUnits).toBe('pixels');
    expect(p.getWidth).toBe(2);
    expect(p.getColor).toEqual([...BRUSH_COLORS.light.erase, 255]);
    const first = (p.data as [number, number][][])[0];
    expect((p.getPath as (d: unknown) => unknown)(first)).toBe(first);
    expect(Math.abs(distM(C, first[0]) - 30) / 30).toBeLessThan(0.005);
  });

  it('grows the erase ring to 4 px when the radius is smaller on screen', () => {
    const { L, made } = fakeCtors();
    buildOverlayLayers(L, { ...base, tool: 'erase', radiusM: 5, metersPerPixel: 10 });
    const first = (made[0].props.data as [number, number][][])[0];
    expect(Math.abs(distM(C, first[0]) - 40) / 40).toBeLessThan(0.005);
  });

  it('draws the swath 2·r metres wide at 25% opacity, under the ring', () => {
    const { L, made } = fakeCtors();
    const swath: [number, number][] = [C, [C[0] + 0.001, C[1]]];
    const layers = buildOverlayLayers(L, { ...base, swath });
    expect(layers.map((l) => l.id)).toEqual(['brush-swath', 'brush-ring']);
    const p = made.find((m) => m.props.id === 'brush-swath')!.props;
    expect(p.data).toEqual([swath]);
    expect((p.getPath as (d: unknown) => unknown)(swath)).toBe(swath);
    expect(p.widthUnits).toBe('meters');
    expect(p.getWidth).toBe(60);
    expect(p.capRounded).toBe(true);
    expect(p.jointRounded).toBe(true);
    expect(p.opacity).toBe(0.25);
    expect(p.getColor).toEqual([...BRUSH_COLORS.light.paint, 255]);
  });

  it('draws a one-point stamp swath as [p, p]', () => {
    const { L, made } = fakeCtors();
    buildOverlayLayers(L, { ...base, tool: 'erase', ring: null, swath: [C] });
    expect(made).toHaveLength(1);
    expect(made[0].props.data).toEqual([[C, C]]);
    expect(made[0].props.getColor).toEqual([...BRUSH_COLORS.light.erase, 255]);
  });

  it('never uses a generated- or rising- layer id', () => {
    const { L } = fakeCtors();
    for (const tool of ['paint', 'erase'] as const) {
      const layers = buildOverlayLayers(L, { ...base, tool, swath: [C] });
      for (const l of layers) expect(l.id).not.toMatch(/^(generated|rising)-/);
    }
  });
});

describe('BRUSH_COLORS', () => {
  // WCAG 1.4.11: the ring must reach 3:1 against the base map's land and building fills.
  const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;
  for (const theme of ['light', 'dark'] as const) {
    for (const tool of ['paint', 'erase'] as const) {
      it(`${theme} ${tool} is ≥ 3:1 against land, existing and replaced`, () => {
        for (const token of ['land', 'existing', 'replaced'] as const) {
          const ratio = wcagContrast(rgb(BRUSH_COLORS[theme][tool]), parse(TOKENS[theme][token])!);
          expect(ratio, `${token}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});
