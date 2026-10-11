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
  swathDrawPath,
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

describe('swathDrawPath', () => {
  type P = [number, number];
  const R = 20; // kept spacing 10 m
  // Plan-plane metres per degree, so the fixtures are laid out in metres around C.
  const mx = project(C[0] + 1, C[1])[0] - project(C[0], C[1])[0];
  const my = project(C[0], C[1] + 1)[1] - project(C[0], C[1])[1];
  const at = (dx: number, dy: number): P => [C[0] + dx / mx, C[1] + dy / my];
  const polar = (d: number, deg: number): P =>
    at(d * Math.cos((deg * Math.PI) / 180), d * Math.sin((deg * Math.PI) / 180));

  it('leaves paths with no sharp turn unchanged', () => {
    expect(swathDrawPath([], R)).toEqual([]);
    expect(swathDrawPath([C], R)).toEqual([C]);
    expect(swathDrawPath([at(-60, 0), C], R)).toEqual([at(-60, 0), C]);
    const gentle = [at(-60, 0), C, polar(15, 45), at(10.6, 40)]; // two 45° turns
    expect(swathDrawPath(gentle, R)).toEqual(gentle);
    const tailOn = [at(-60, 0), C, polar(0.1, 30)]; // a live tail turning gently
    expect(swathDrawPath(tailOn, R)).toEqual(tailOn);
  });

  it('does not draw a live tail that turns sharply back', () => {
    for (const deg of [70, 150, 180, 250]) {
      expect(swathDrawPath([at(-60, 0), C, polar(0.1, deg)], R)).toEqual([at(-60, 0), C]);
      expect(swathDrawPath([at(-60, 0), C, polar(9.9, deg)], R)).toEqual([at(-60, 0), C]);
    }
  });

  it('keeps a sharply turning last point that is a spacing or more away (a kept point)', () => {
    const out = swathDrawPath([at(-60, 0), C, polar(10.5, 175)], R);
    expect(out[out.length - 1]).toEqual(polar(10.5, 175));
  });

  it('splits the longer segment at a sharp vertex so both sides are equally long', () => {
    const path: P[] = [at(-60, 0), C, polar(12, 170)];
    const out = swathDrawPath(path, R);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual(path[0]);
    expect(out[2]).toEqual(C);
    expect(out[3]).toEqual(path[2]);
    expect(distM(out[1], C)).toBeCloseTo(distM(C, path[2]), 6);
    expect(out[1][1]).toBeCloseTo(C[1], 9); // on the first segment
  });

  it('splits the following segment when it is the longer one', () => {
    const path: P[] = [at(-12, 0), C, at(-50, 5)];
    const out = swathDrawPath(path, R);
    expect(out).toHaveLength(4);
    expect(out.slice(0, 2)).toEqual(path.slice(0, 2));
    expect(distM(C, out[2])).toBeCloseTo(distM(path[0], C), 6);
    expect(out[3]).toEqual(path[2]);
  });

  it('keeps every other input point, in order, and does not mutate its input', () => {
    const path: P[] = [at(-40, 0), C, at(-20, 2), at(-19, 30), at(-60, 31), at(-59.9, 31.1)];
    const copy = path.map((p) => [...p]);
    const out = swathDrawPath(path, R);
    expect(path).toEqual(copy);
    expect(out[out.length - 1]).toEqual(path[4]); // the sharp 0.14 m tail is not drawn
    let j = 0;
    for (const p of out) if (j < path.length && p[0] === path[j][0] && p[1] === path[j][1]) j++;
    expect(j).toBe(path.length - 1);
  });

  it('is what buildOverlayLayers draws, while the swath it is given stays as sampled', () => {
    const { L, made } = fakeCtors();
    const k = polar(16, 170);
    const swath: P[] = [at(-60, 0), C, k, [k[0] + 0.1 / mx, k[1]]]; // the tail backs up 0.1 m
    buildOverlayLayers(L, { ...base, swath, radiusM: R });
    const p = made.find((m) => m.props.id === 'brush-swath')!.props;
    expect(p.data).toEqual([swathDrawPath(swath, R)]);
    expect((p.data as P[][])[0]).toHaveLength(4); // tail dropped, one split point added
    expect(swath).toHaveLength(4);
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
