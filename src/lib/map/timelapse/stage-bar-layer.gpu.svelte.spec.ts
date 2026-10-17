// GPU test of StageBarLayer (spec §6 `stage-bar-layer.gpu`): a standalone deck over a 128×64
// canvas, top-down on the bars' anchor. Each sampled pixel must match `barColor(evalBar(…))`, the
// CPU reference, evaluated on the chance the texture holds (8-bit quantised, Task 5 review b).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Deck, MapView, type Layer, type MapViewState, type Material } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { StageBarLayer } from './stage-bar-layer';
import { barColor, barSizePx, evalBar } from './bars';
import {
  BAR_MIN_ZOOM,
  BAR_OFFSET_PX,
  COMPLETE_FADE_DAYS,
  COMPLETE_HOLD_DAYS,
  DYING_HOLD_DAYS
} from './constants';
import { typicalDays } from './encode';
import { chanceRow, packChanceTexture, type ChanceTexture } from './lookups';
import type { BarAttrs, BarEval, TimelineClock, TimelineLookups } from './types';
import { CHANCE_LEN, timelineLookups } from '../fixtures/timeline-lookups';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';
import { localFrame } from '$lib/generator/geo';
import { DYING_DAYS, MONTH_DAYS, OPEN_DAY, monthsIn, type Day } from '$lib/timelapse/time';
import { PATHWAYS, type Stage } from '$lib/timelapse/types';

const CW = 128;
const CH = 64;
const CENTRE: [number, number] = [-122.42, 37.77];
const ANCHOR: [number, number, number] = [...CENTRE, 20];
/** Base day; stage days below are offsets from it. */
const B = 20000;
/** The clear colour (opaque magenta): unlike every bar token, so "nothing drawn" is visible. */
const BG: Rgb = [255, 0, 255];
/**
 * Per-channel tolerance (0–255). Ruling (Task 5 review b): ±2 against `barColor` on the
 * quantised chance. Opaque pixels need no more: the GPU ramp and sRGB encode differ from the CPU
 * by under 1 before rounding.
 */
const TOL = 2;
/**
 * Half-alpha pixels add the blend's own rounding: the source alpha is written at 8 bits and the
 * blended result is rounded again, at most 1 more per channel.
 */
const TOL_BLEND = TOL + 1;

type Rgb = [number, number, number];
type BarStage = Exclude<Stage, 'complete'>;
const rgb = (hex: string): Rgb => hexToRgba(hex).slice(0, 3) as Rgb;
const tok = (theme: Theme, name: TokenName): Rgb => rgb(TOKENS[theme][name]);
/** `c` at alpha `a` over BG (deck's SRC_ALPHA, ONE_MINUS_SRC_ALPHA). */
const over = (c: Rgb, a: number): Rgb => c.map((v, i) => a * v + (1 - a) * BG[i]) as Rgb;

/** The permitOnly/permitFiled chance by month: one value in each ramp interval, in turn. */
const ALT = [0.05, 0.3, 0.6, 0.9];
function withPermitFiled(value: (m: number) => number): TimelineLookups['chance'] {
  return {
    ...timelineLookups.chance,
    permitOnly: {
      ...timelineLookups.chance.permitOnly,
      permitFiled: Float32Array.from({ length: CHANCE_LEN }, (_, m) => value(m))
    }
  };
}
const L: TimelineLookups = {
  chance: withPermitFiled((m) => ALT[m % 4]),
  typicalMonths: timelineLookups.typicalMonths
};
/** `l` with every chance rounded to 8 bits, as the r8unorm texture holds it. */
function quantised(l: TimelineLookups): TimelineLookups {
  const chance: TimelineLookups['chance'] = { discretionary: {}, streamlined: {}, permitOnly: {} };
  for (const p of PATHWAYS)
    for (const [stage, values] of Object.entries(l.chance[p]) as [BarStage, Float32Array][])
      chance[p][stage] = values.map((c) => Math.round(c * 255) / 255);
  return { chance, typicalMonths: l.typicalMonths };
}
const LQ = quantised(L);
const TEX = packChanceTexture(L.chance);

/** A hand-made bar at ANCHOR (fields as `buildBars` gives them; §4.4). */
function makeBar(
  pathway: (typeof PATHWAYS)[number],
  segs: [BarStage, Day][],
  endKind: 0 | 1 | 2,
  endDay: Day = OPEN_DAY,
  minZoom = BAR_MIN_ZOOM
): BarAttrs {
  const pi = PATHWAYS.indexOf(pathway);
  const completeDay = endKind === 1 ? endDay : OPEN_DAY;
  const barEnd =
    endKind === 2
      ? endDay + DYING_DAYS
      : endKind === 1
        ? completeDay + COMPLETE_HOLD_DAYS + COMPLETE_FADE_DAYS
        : OPEN_DAY;
  return {
    projectId: `gpu-${pathway}-${endKind}`,
    parcelId: 'gpu',
    units: 10,
    pathway: pi,
    anchor: ANCHOR,
    from: segs[0][1],
    to: barEnd,
    barEnd,
    endDay,
    endKind,
    completeDay,
    segCount: segs.length,
    segEntry: segs.map(([, d]) => d),
    segTypicalDays: segs.map(([st]) => typicalDays(L, pathway, st)),
    segRow: segs.map(([st]) => chanceRow(pi, st)),
    minZoom
  };
}

/** Open permitOnly bar with a PPA: 4 segments, a long permitFiled (the second) from E1. */
const E1 = B + 100;
const P = makeBar(
  'permitOnly',
  [
    ['preApplication', B],
    ['permitFiled', E1],
    ['permitIssued', B + 8000],
    ['construction', B + 8400]
  ],
  0
);
/** Discretionary bar that exits in permitFiled on B + 250 (5 segments, the last two unentered). */
const D = makeBar(
  'discretionary',
  [
    ['filed', B],
    ['entitled', B + 100],
    ['permitFiled', B + 200],
    ['permitIssued', OPEN_DAY],
    ['construction', OPEN_DAY]
  ],
  2,
  B + 250
);
/** permitOnly bar without a PPA that completes on B + 600. */
const C = makeBar(
  'permitOnly',
  [
    ['permitFiled', B],
    ['permitIssued', B + 100],
    ['construction', B + 200]
  ],
  1,
  B + 600
);

const VIEW_STATE: MapViewState = {
  longitude: CENTRE[0],
  latitude: CENTRE[1],
  zoom: 17,
  pitch: 0,
  bearing: 0
};

describe('StageBarLayer on the GPU', () => {
  let canvas: HTMLCanvasElement;
  let deck: Deck<MapView>;
  let gl: WebGL2RenderingContext;
  const errors: Error[] = [];
  const clock: TimelineClock = { day: E1, theme: 'light' };

  function bars(data: BarAttrs[], chance: ChanceTexture = TEX): StageBarLayer {
    return new StageBarLayer({ data, chance, clock });
  }

  /** Each layer model's pipeline link status (luma WEBGLRenderPipeline). */
  function linkStatuses(): string[] {
    return (deck.props.layers as Layer[]).flatMap((l) =>
      l.getModels().map((m) => String((m.pipeline as { linkStatus?: string }).linkStatus))
    );
  }

  /**
   * Sets the layers, then waits until deck has matched and initialised every one (it does so on
   * its next animation frame) and every pipeline has linked (as the Task 8 test does).
   */
  async function show(layers: Layer[]) {
    deck.setProps({ layers });
    // The layers deck currently draws (`layerManager` is protected in deck's types).
    const live = () =>
      (deck as unknown as { layerManager: { getLayers(): Layer[] } }).layerManager.getLayers();
    const ready = () =>
      live().length === layers.length &&
      layers.every((l) => live().includes(l)) &&
      layers.every((l) => l.state != null && l.getModels().length > 0) &&
      !linkStatuses().includes('pending');
    for (let i = 0; i < 200 && !ready(); i++) {
      deck.redraw('link');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(ready()).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
  }

  function render(day: Day, zoom = 17, theme: Theme = 'light') {
    clock.day = day;
    clock.theme = theme;
    deck.setProps({ viewState: { ...VIEW_STATE, zoom } });
    deck.redraw('test');
  }

  beforeAll(async () => {
    canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = CH;
    canvas.style.width = `${CW}px`;
    canvas.style.height = `${CH}px`;
    document.body.appendChild(canvas);
    await new Promise<void>((resolve) => {
      let loaded = false;
      deck = new Deck<MapView>({
        canvas,
        width: CW,
        height: CH,
        useDevicePixels: false,
        deviceProps: {
          webgl: { preserveDrawingBuffer: true },
          // luma 9.4 reports shader compile and link failures here, not through deck's onError.
          onError: (e: Error) => {
            errors.push(e);
          }
        },
        views: new MapView({ clear: true, clearColor: [...BG, 255] }),
        viewState: VIEW_STATE,
        controller: false,
        layers: [bars([P])],
        onError: (e) => {
          errors.push(e);
        },
        onLoad: () => {
          loaded = true;
        },
        onAfterRender: () => {
          if (loaded) resolve();
        }
      });
    });
    gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    await show([bars([P])]);
  });

  afterAll(() => {
    deck?.finalize();
    canvas?.remove();
  });

  /** The pixel whose centre is nearest (x, y) in canvas px (top-left origin). */
  function readAt(x: number, y: number): Rgb {
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(x), CH - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  }

  /** Bounding box [x0, y0, x1, y1] (inclusive, top-left origin) of every non-BG pixel. */
  function drawnBox(): number[] | null {
    const px = new Uint8Array(CW * CH * 4);
    gl.readPixels(0, 0, CW, CH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let box: number[] | null = null;
    for (let row = 0; row < CH; row++)
      for (let x = 0; x < CW; x++) {
        const i = 4 * (row * CW + x);
        if (Math.max(...BG.map((v, c) => Math.abs(px[i + c] - v))) <= TOL) continue;
        const y = CH - 1 - row;
        box = box
          ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
          : [x, y, x, y];
      }
    return box;
  }

  /** The bar's screen rectangle at `zoom` (§4.4.1): left, top, width, height in canvas px. */
  function barRect(zoom: number) {
    const [ax, ay] = deck.getViewports()[0].project(ANCHOR);
    const { w, h } = barSizePx(zoom);
    return { left: ax - w / 2, top: ay - BAR_OFFSET_PX - h, w, h };
  }

  /** The pixel `dx` px right of the bar's left edge, on its middle row (`dy` from its top). */
  function barPixel(zoom: number, dx: number, dy?: number): Rgb {
    const r = barRect(zoom);
    return readAt(r.left + dx, r.top + (dy ?? r.h / 2));
  }

  const near = (got: Rgb, want: Rgb, tol = TOL) =>
    Math.max(...got.map((v, i) => Math.abs(v - want[i]))) <= tol;
  /** "label: ok" when `got` is within `tol` of `want`, else the full mismatch (for toEqual). */
  const check = (label: string, got: Rgb, want: Rgb, tol = TOL) =>
    near(got, want, tol)
      ? `${label}: ok`
      : `${label}: got rgb(${got.join(',')}) want rgb(${want.map(Math.round).join(',')})`;
  const fillRgb = (e: BarEval, theme: Theme) => barColor(e, theme).slice(0, 3) as Rgb;

  it('packs the bars as the GPU expects (sanity of the hand-made goldens)', () => {
    const e = evalBar(P, LQ, E1 + 10, 17);
    expect(e.visible).toBe(true);
    expect(e.segCount).toBe(4);
    expect(e.fill).toBeGreaterThanOrEqual(0.25);
    expect(e.fill).toBeLessThan(0.5);
    expect(TEX.width).toBe(CHANCE_LEN);
    const r = barRect(17);
    expect(r.left).toBeGreaterThan(2);
    expect(r.left + r.w).toBeLessThan(CW - 2);
    expect(r.top).toBeGreaterThan(2);
  });

  for (const zoom of [16, 17]) {
    const { w, h } = barSizePx(zoom);
    it(`draws a ${w}×${h} px bar ${BAR_OFFSET_PX} px above the anchor (z${zoom})`, () => {
      render(E1 + 10, zoom);
      const r = barRect(zoom);
      expect(drawnBox()).toEqual([
        Math.round(r.left),
        Math.round(r.top),
        Math.round(r.left + r.w) - 1,
        Math.round(r.top + r.h) - 1
      ]);
      expect(errors).toEqual([]);
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    it(`second of 4 segments: ramp fill, track, border and separators (${theme})`, () => {
      const got: string[] = [];
      const want: string[] = [];
      const seen = new Set<string>();
      for (const day of [E1 + 10, E1 + 40, E1 + 70, E1 + 100]) {
        render(day, 17, theme);
        const e = evalBar(P, LQ, day, 17);
        const { w, h } = barSizePx(17);
        const cases: [string, Rgb, Rgb][] = [
          ['fill at the left quarter', barPixel(17, w / 8), fillRgb(e, theme)],
          ['track at the right end', barPixel(17, w - 2.5), tok(theme, 'tl-bar-track')],
          ['top border', barPixel(17, (3 * w) / 8, 0.5), tok(theme, 'tl-bar-edge')],
          ['bottom border', barPixel(17, (3 * w) / 8, h - 0.5), tok(theme, 'tl-bar-edge')],
          ['left border', barPixel(17, 0.5), tok(theme, 'tl-bar-edge')],
          ['right border', barPixel(17, w - 0.5), tok(theme, 'tl-bar-edge')],
          ...[1, 2, 3].map(
            (i) =>
              [`separator ${i}`, barPixel(17, (i * w) / 4 + 0.5), tok(theme, 'tl-bar-edge')] as [
                string,
                Rgb,
                Rgb
              ]
          )
        ];
        for (const [label, g, wnt] of cases) {
          got.push(check(`${day - E1} ${label}`, g, wnt));
          want.push(`${day - E1} ${label}: ok`);
        }
        seen.add(String(e.chance));
      }
      expect(got).toEqual(want);
      // The four days read four months, one chance in each ramp interval.
      expect(seen.size).toBe(4);
      expect(errors).toEqual([]);
    });
  }

  it('the fill ends where evalBar puts it (open, capped, frozen, complete)', async () => {
    const cases: [BarAttrs, Day][] = [
      [P, E1],
      [P, E1 + 30],
      [P, E1 + 120],
      [P, E1 + 2000], // capped at 0.9 of the segment
      [D, B + 270], // frozen at the exit day
      [C, B + 650] // complete: full
    ];
    const got: string[] = [];
    const want: string[] = [];
    for (const [b, day] of cases) {
      await show([bars([b])]);
      render(day);
      const e = evalBar(b, LQ, day, 17);
      const r = barRect(17);
      const fill = fillRgb(e, 'light');
      const track = tok('light', 'tl-bar-track');
      // Every interior column of the middle row except the separators.
      for (let x = Math.round(r.left) + 1; x < Math.round(r.left + r.w) - 1; x++) {
        const centre = x + 0.5 - r.left;
        if (isSeparator(centre, r.w, b.segCount)) continue;
        const px = readAt(x + 0.5, r.top + r.h / 2);
        const cls = near(px, fill) ? 'fill' : near(px, track) ? 'track' : `rgb(${px.join(',')})`;
        got.push(`${b.projectId} ${day - B} x${x}: ${cls}`);
        want.push(`${b.projectId} ${day - B} x${x}: ${centre < e.fill * r.w ? 'fill' : 'track'}`);
      }
    }
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  /** A pixel centre `c` px from the left lies on a separator: the column right of a boundary. */
  function isSeparator(c: number, w: number, n: number): boolean {
    for (let i = 1; i < n; i++) {
      const r = c - (i * w) / n;
      if (r >= 0 && r < 1) return true;
    }
    return false;
  }

  it('months in stage step on integer days around k = 1, 16 and 240, and clamp after', async () => {
    await show([bars([P])]);
    const got: string[] = [];
    const want: string[] = [];
    const steps: string[] = [];
    for (const k of [1, 16, 240]) {
      const below = Math.ceil(E1 + k * MONTH_DAYS) - 1;
      const at = Math.ceil(E1 + k * MONTH_DAYS);
      steps.push(`${k}: ${monthsIn(E1, below)} ${monthsIn(E1, at)}`);
      const colours: Rgb[] = [];
      for (const day of [below, at]) {
        render(day);
        const e = evalBar(P, LQ, day, 17);
        const px = barPixel(17, barSizePx(17).w / 8);
        colours.push(px);
        got.push(check(`k${k} day ${day - E1}`, px, fillRgb(e, 'light')));
        want.push(`k${k} day ${day - E1}: ok`);
      }
      // Each pair crosses ramp intervals, so the test tells the two months apart.
      expect(near(colours[0], colours[1], 4 * TOL)).toBe(false);
    }
    // Past the table's 241 entries the last month (240) is read.
    const late = E1 + Math.ceil(300 * MONTH_DAYS);
    render(late);
    got.push(
      check('k300', barPixel(17, barSizePx(17).w / 8), fillRgb(evalBar(P, LQ, late, 17), 'light'))
    );
    want.push('k300: ok');
    expect(steps).toEqual(['1: 0 1', '16: 15 16', '240: 239 240']);
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('draws nothing below the zoom ramp and half alpha in the middle of it', async () => {
    await show([bars([P])]);
    render(E1 + 10, 14);
    expect(evalBar(P, LQ, E1 + 10, 14).visible).toBe(false);
    expect(drawnBox()).toBeNull();
    render(E1 + 10, BAR_MIN_ZOOM - 0.25);
    const e = evalBar(P, LQ, E1 + 10, BAR_MIN_ZOOM - 0.25);
    expect(e.alpha).toBeCloseTo(0.5, 6);
    const w = barSizePx(BAR_MIN_ZOOM - 0.25).w;
    expect(
      check('half', barPixel(BAR_MIN_ZOOM - 0.25, w / 8), over(fillRgb(e, 'light'), 0.5), TOL_BLEND)
    ).toBe('half: ok');
    // A decluttered bar (minZoom 17.5) is gated at its own zoom.
    await show([bars([{ ...P, minZoom: 17.5 }])]);
    render(E1 + 10, 17);
    expect(drawnBox()).toBeNull();
    render(E1 + 10, 17.25);
    const g = evalBar({ ...P, minZoom: 17.5 }, LQ, E1 + 10, 17.25);
    expect(g.alpha).toBeCloseTo(0.5, 6);
    expect(check('gated half', barPixel(17.25, 6), over(fillRgb(g, 'light'), 0.5), TOL_BLEND)).toBe(
      'gated half: ok'
    );
    expect(errors).toEqual([]);
  });

  it('an exited bar fills in tl-bar-dead, fades with the ghost, then hides', async () => {
    await show([bars([D])]);
    const { w } = barSizePx(17);
    const dead = tok('light', 'tl-bar-dead');
    const track = tok('light', 'tl-bar-track');
    const hold = B + 250 + 20;
    render(hold);
    expect(evalBar(D, LQ, hold, 17)).toMatchObject({ dead: true, alpha: 1 });
    expect(check('hold fill', barPixel(17, w / 10), dead)).toBe('hold fill: ok');
    expect(check('hold track', barPixel(17, w - 2.5), track)).toBe('hold track: ok');
    // Halfway through the fade after the 90-day hold.
    const fade = B + 250 + DYING_HOLD_DAYS + (DYING_DAYS - DYING_HOLD_DAYS) / 2;
    render(fade);
    expect(evalBar(D, LQ, fade, 17).alpha).toBeCloseTo(0.5, 9);
    expect(check('fade fill', barPixel(17, w / 10), over(dead, 0.5), TOL_BLEND)).toBe(
      'fade fill: ok'
    );
    expect(check('fade track', barPixel(17, w - 2.5), over(track, 0.5), TOL_BLEND)).toBe(
      'fade track: ok'
    );
    render(D.to);
    expect(evalBar(D, LQ, D.to, 17).visible).toBe(false);
    expect(drawnBox()).toBeNull();
    expect(errors).toEqual([]);
  });

  it('a completed bar is full in tl-bar-likely, holds, fades, then hides', async () => {
    await show([bars([C])]);
    const { w } = barSizePx(17);
    const likely = tok('light', 'tl-bar-likely');
    render(B + 650);
    expect(evalBar(C, LQ, B + 650, 17)).toMatchObject({ fill: 1, alpha: 1, chance: null });
    expect(check('right end', barPixel(17, w - 2.5), likely)).toBe('right end: ok');
    const fade = B + 600 + COMPLETE_HOLD_DAYS + COMPLETE_FADE_DAYS / 2;
    render(fade);
    expect(evalBar(C, LQ, fade, 17).alpha).toBeCloseTo(0.5, 9);
    expect(check('fade', barPixel(17, w / 8), over(likely, 0.5), TOL_BLEND)).toBe('fade: ok');
    render(C.to);
    expect(drawnBox()).toBeNull();
    expect(errors).toEqual([]);
  });

  it('re-uploads the chance texture when `chance` changes identity, and only then', async () => {
    await show([bars([P])]);
    const day = E1 + 10;
    const { w } = barSizePx(17);
    render(day);
    const before = barPixel(17, w / 8);
    expect(check('before', before, fillRgb(evalBar(P, LQ, day, 17), 'light'))).toBe('before: ok');
    const layer0 = deck.props.layers[0] as StageBarLayer;
    const tex0 = layer0.state.chanceTexture;
    expect(tex0).toBeTruthy();

    // A new layer instance with the same chance object keeps the texture.
    await show([bars([P])]);
    expect((deck.props.layers[0] as StageBarLayer).state.chanceTexture).toBe(tex0);

    const chance2 = withPermitFiled(() => 0.6);
    const l2 = quantised({ chance: chance2, typicalMonths: L.typicalMonths });
    await show([bars([P], packChanceTexture(chance2))]);
    const tex1 = (deck.props.layers[0] as StageBarLayer).state.chanceTexture;
    expect(tex1).not.toBe(tex0);
    expect(tex0?.destroyed).toBe(true);
    render(day);
    const after = barPixel(17, w / 8);
    expect(check('after', after, fillRgb(evalBar(P, l2, day, 17), 'light'))).toBe('after: ok');
    expect(near(before, after, 4 * TOL)).toBe(false);
    // Removing the layer destroys its texture.
    await show([]);
    expect(tex1?.destroyed).toBe(true);
    expect(errors).toEqual([]);
  });

  it('an absent chance row reads as 0, as on the CPU (ruling R7)', async () => {
    // streamlined/preApplication is absent from the fixture lookups (its texture row is 0).
    expect(L.chance.streamlined.preApplication).toBeUndefined();
    const S = makeBar(
      'streamlined',
      [
        ['preApplication', B],
        ['filed', B + 5000],
        ['entitled', B + 5100],
        ['permitFiled', B + 5200],
        ['permitIssued', B + 5300],
        ['construction', B + 5400]
      ],
      0
    );
    await show([bars([S])]);
    const day = B + 400;
    render(day);
    const e = evalBar(S, LQ, day, 17);
    expect(e.chance).toBe(0);
    const px = barPixel(17, barSizePx(17).w / 12);
    expect(check('absent row', px, fillRgb(e, 'light'))).toBe('absent row: ok');
    expect(errors).toEqual([]);
  });

  // Top-down at z17 a 40 m square centred on the anchor covers the whole bar (≈ 23 × 9 m).
  const FRAME = localFrame(CENTRE);
  const BLOCK = [
    [-20, -20],
    [-20, 20],
    [20, 20],
    [20, -20]
  ].map(([x, y]) => FRAME.to(x, y));
  const BLOCK_RGB: Rgb = [0, 0, 0];
  function block(id: string, heightM: number) {
    return new SolidPolygonLayer({
      id,
      data: [{ polygon: BLOCK }],
      extruded: heightM > 0,
      material: { unlit: true } as Material,
      getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
      getElevation: heightM,
      getFillColor: [...BLOCK_RGB, 255]
    });
  }

  it('tests depth (a nearer roof hides it) but writes none (later ground covers it)', async () => {
    const day = E1 + 10;
    const { w } = barSizePx(17);
    const e = evalBar(P, LQ, day, 17);
    const results: string[] = [];
    // A 30 m roof drawn first is nearer than the 20 m anchor: the bar fails the depth test. (The
    // camera sits 1.5 viewport heights up: 1.5 · 64 px · 0.472 m/px ≈ 45 m at z17 here.)
    await show([block('roof-30', 30), bars([P])]);
    render(day);
    results.push(check('under a 30 m roof', barPixel(17, w / 8), BLOCK_RGB));
    // A 10 m roof is farther than the anchor: the bar draws over it.
    await show([block('roof-10', 10), bars([P])]);
    render(day);
    results.push(check('over a 10 m roof', barPixel(17, w / 8), fillRgb(e, 'light')));
    // Ground drawn after the bar: had the bar written depth, the farther ground would fail.
    await show([bars([P]), block('ground', 0)]);
    render(day);
    results.push(check('ground drawn later', barPixel(17, w / 8), BLOCK_RGB));
    expect(results).toEqual([
      'under a 30 m roof: ok',
      'over a 10 m roof: ok',
      'ground drawn later: ok'
    ]);
    expect(errors).toEqual([]);
  });

  it('is `timeline-bars`, not pickable, and binds 11 attribute locations', async () => {
    const layer = new StageBarLayer({ data: [P], chance: TEX, clock, pickable: true });
    expect(layer.id).toBe('timeline-bars');
    expect(layer.props.pickable).toBe(false);
    expect(layer.props.parameters).toMatchObject({ depthWriteEnabled: false });
    await show([layer]);
    render(E1 + 10);
    const r = barRect(17);
    expect(deck.pickObject({ x: r.left + r.w / 8, y: r.top + r.h / 2 })).toBeNull();
    const locations = layer
      .getAttributeManager()!
      .getBufferLayouts()
      .flatMap((b) => b.attributes?.map((a) => a.attribute) ?? [b.name]);
    expect(locations.sort()).toEqual(
      [
        'instanceAnchor',
        'instanceAnchor64Low',
        'instanceTimes',
        'instanceMeta',
        'instanceSegEntryA',
        'instanceSegEntryB',
        'instanceSegTypicalA',
        'instanceSegTypicalB',
        'instanceSegRowA',
        'instanceSegRowB'
      ].sort()
    );
    // Plus the quad's `positions`: 11 of WebGL2's guaranteed 16.
    expect(linkStatuses().filter((s) => s !== 'success')).toEqual([]);
    expect(errors).toEqual([]);
  });
});
