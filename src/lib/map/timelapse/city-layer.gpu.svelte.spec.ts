// GPU test of CityLayer: a standalone deck over a 96×96 canvas, top-down. Each sampled pixel
// must match `evalCity`, the CPU reference: a merged ring's radius, alpha and tone in view below
// the handover zoom, nothing in view from it, an edge glow toward an anchor off view, the reveal
// window at both ends, and the policy record's accent and second stroke.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Deck, MapView, type Layer, type MapViewState } from '@deck.gl/core';
import { CityLayer } from './city-layer';
import {
  CITY_KIND,
  CITY_KIND_TOKEN,
  blockOutside,
  cityBlock,
  cityEdgePx,
  cityGroup,
  cityRadiusPx,
  citySquare,
  edgeOf,
  evalCity,
  type CityAttrs,
  type Clip
} from './city';
import { CITY_EDGE_DAYS, CITY_POLICY_INSET_PX, CITY_RING_DAYS } from './constants';
import type { TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';
import type { Day } from '$lib/timelapse/time';

const CW = 96;
const CH = 96;
const CENTRE: [number, number] = [-122.42, 37.77];
/** Metres per degree of longitude at CENTRE. */
const M_LNG = 111_195 * Math.cos((CENTRE[1] * Math.PI) / 180);
/** The record's day. */
const D = 21000;
/** The clear colour (opaque magenta): unlike every halo token, so "nothing drawn" is visible. */
const BG: Rgb = [255, 0, 255];
const TOL = 2;
const TOL_BLEND = TOL + 1;

type Rgb = [number, number, number];
const tok = (theme: Theme, name: TokenName): Rgb =>
  hexToRgba(TOKENS[theme][name]).slice(0, 3) as Rgb;
const over = (c: Rgb, a: number): Rgb => c.map((v, i) => a * v + (1 - a) * BG[i]) as Rgb;

/** A record of `kind` and `homes`, `eastM` metres east of CENTRE. */
function rec(kind: 0 | 1 | 2 | 3, homes = 200, eastM = 0): CityAttrs {
  const anchor: [number, number] = [CENTRE[0] + eastM / M_LNG, CENTRE[1]];
  return { anchor, day: D, homes, kind, square: citySquare(cityGroup(...anchor)) };
}

const VIEW_STATE: MapViewState = {
  longitude: CENTRE[0],
  latitude: CENTRE[1],
  zoom: 13,
  pitch: 0,
  bearing: 0
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

describe('CityLayer on the GPU', () => {
  let canvas: HTMLCanvasElement;
  let deck: Deck<MapView>;
  let gl: WebGL2RenderingContext;
  const errors: Error[] = [];
  const clock: TimelineClock = { day: D, theme: 'light' };

  const city = (data: CityAttrs[], reduced = false) => new CityLayer({ data, clock, reduced });

  function linkStatuses(): string[] {
    return (deck.props.layers as Layer[]).flatMap((l) =>
      l.getModels().map((m) => String((m.pipeline as { linkStatus?: string }).linkStatus))
    );
  }

  async function show(layers: Layer[], zoom = VIEW_STATE.zoom) {
    deck.setProps({ layers, viewState: { ...VIEW_STATE, zoom } });
    const live = () =>
      (deck as unknown as { layerManager: { getLayers(): Layer[] } }).layerManager.getLayers();
    const ready = () =>
      live().length === layers.length &&
      layers.every((l) => live().includes(l)) &&
      layers.every((l) => l.state != null && l.getModels().length > 0) &&
      !linkStatuses().includes('pending');
    for (let i = 0; i < 200 && !ready(); i++) {
      deck.redraw('link');
      await nextFrame();
    }
    expect(ready()).toBe(true);
    await nextFrame();
  }

  function render(day: Day, theme: Theme = 'light') {
    clock.day = day;
    clock.theme = theme;
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
          onError: (e: Error) => {
            errors.push(e);
          }
        },
        views: new MapView({ clear: true, clearColor: [...BG, 255] }),
        viewState: VIEW_STATE,
        controller: false,
        layers: [city([rec(CITY_KIND.started)])],
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
    await show([city([rec(CITY_KIND.started)])]);
  });

  afterAll(() => {
    deck?.finalize();
    canvas?.remove();
  });

  const vp = () => deck.getViewports()[0];
  /** A lng/lat point in clip space, as the shader projects it. */
  function clipOf(p: [number, number]): Clip {
    const [x, y] = vp().project([p[0], p[1], 0]);
    // A top-down view is affine: NDC from canvas px, w = 1.
    return [(2 * x) / CW - 1, 1 - (2 * y) / CH, 1];
  }
  const blockOf = (c: CityAttrs): Clip[] => {
    const [w, s, e, n] = cityBlock(c.square);
    return [clipOf([w, s]), clipOf([e, s]), clipOf([w, n]), clipOf([e, n])];
  };
  /** evalCity for `c` on this view. */
  const cpu = (c: CityAttrs, t: Day, zoom: number, reduced = false) =>
    evalCity(c, t, zoom, clipOf(c.anchor), reduced, blockOf(c));

  function readAt(x: number, y: number): Rgb {
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(x), CH - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  }
  const anchorPx = (c: CityAttrs) => vp().project([...c.anchor, 0]);
  const at = (c: CityAttrs, dx: number, dy = 0) => {
    const [ax, ay] = anchorPx(c);
    return readAt(ax + dx, ay + dy);
  };

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

  const near = (got: Rgb, want: Rgb, tol: number) =>
    Math.max(...got.map((v, i) => Math.abs(v - want[i]))) <= tol;
  const check = (label: string, got: Rgb, want: Rgb, tol = TOL_BLEND) =>
    near(got, want, tol)
      ? `${label}: ok`
      : `${label}: got rgb(${got.join(',')}) want rgb(${want.map(Math.round).join(',')})`;

  /** Collects labelled pixel checks; compare `got` with `want` once at the end. */
  function checks() {
    const got: string[] = [];
    const want: string[] = [];
    const push = (label: string, g: Rgb, w: Rgb, tol = TOL_BLEND) => {
      got.push(check(label, g, w, tol));
      want.push(`${label}: ok`);
    };
    return { got, want, push };
  }

  it('below zoom 14, draws a ring of the radius evalCity gives, in the stage tone, at ages 0 and 182', async () => {
    const { got, want, push } = checks();
    for (const kind of [CITY_KIND.approved, CITY_KIND.started, CITY_KIND.completed] as const) {
      const c = rec(kind);
      await show([city([c])], 13.99);
      for (const age of [0, 182]) {
        render(D + age);
        const e = cpu(c, D + age, 13.99);
        expect(e.mode).toBe('ring');
        const colour = over(tok('light', CITY_KIND_TOKEN[kind]), e.alpha);
        const r = e.sizePx;
        const l = `kind ${kind} age ${age}`;
        push(`${l} east`, at(c, r), colour);
        push(`${l} west`, at(c, -r), colour);
        push(`${l} north`, at(c, 0, -r), colour);
        push(`${l} south`, at(c, 0, r), colour);
        push(`${l} inside`, at(c, r - 3), BG);
        push(`${l} outside`, at(c, r + 3), BG);
        const box = drawnBox()!;
        expect(Math.abs(box[2] - box[0] + 1 - 2 * (r + 1))).toBeLessThanOrEqual(2);
      }
    }
    expect(got).toEqual(want);
    // The end of the window is exclusive (its last day, faded to 1/365, is in the reduced test).
    render(D + CITY_RING_DAYS);
    expect(drawnBox()).toBeNull();
    expect(errors).toEqual([]);
  });

  it('draws nothing in view at zoom 14', async () => {
    const c = rec(CITY_KIND.started);
    await show([city([c])], 14);
    for (const age of [0, 182]) {
      render(D + age);
      expect(cpu(c, D + age, 14).mode).toBe('none');
      expect(drawnBox()).toBeNull();
    }
    expect(errors).toEqual([]);
  });

  it('an anchor off the right edge draws a half-disc on the right edge in its tone, until CITY_EDGE_DAYS', async () => {
    // 3 km east: off the view (about 1.5 km across at zoom 13).
    const c = rec(CITY_KIND.completed, 200, 3000);
    await show([city([c])]);
    const { got, want, push } = checks();
    const colour = tok('light', 'tl-halo-complete');
    for (const age of [0, 91]) {
      render(D + age);
      const e = cpu(c, D + age, 13);
      expect(e.mode).toBe('edge');
      expect(e.sizePx).toBe(cityEdgePx(200));
      // The edge point: on the right edge, at the anchor's height.
      const ex = ((e.at[0] + 1) / 2) * CW;
      const ey = ((1 - e.at[1]) / 2) * CH;
      expect(ex).toBe(CW);
      const r = e.sizePx;
      const fill = over(colour, e.alpha);
      push(`age ${age} edge`, readAt(ex - 0.5, ey), fill);
      push(`age ${age} inner rim`, readAt(ex - r + 1.5, ey), fill);
      push(`age ${age} beyond`, readAt(ex - r - 1.5, ey), BG);
      push(`age ${age} above`, readAt(ex - 0.5, ey - r - 1.5), BG);
      // Half of the disc falls off the canvas: the box spans r px wide and 2r tall.
      const box = drawnBox()!;
      expect(Math.abs(box[2] - box[0] + 1 - r)).toBeLessThanOrEqual(2);
      expect(Math.abs(box[3] - box[1] + 1 - 2 * r)).toBeLessThanOrEqual(2);
    }
    expect(got).toEqual(want);
    render(D + CITY_EDGE_DAYS);
    expect(cpu(c, D + CITY_EDGE_DAYS, 13).mode).toBe('none');
    expect(drawnBox()).toBeNull();
    // Both ends of the window, still (reduced) so the last day is at full strength.
    await show([city([c], true)]);
    for (const [age, mode] of [
      [-1, 'none'],
      [0, 'edge'],
      [CITY_EDGE_DAYS - 1, 'edge'],
      [CITY_EDGE_DAYS, 'none']
    ] as const) {
      render(D + age);
      expect(cpu(c, D + age, 13, true).mode).toBe(mode);
      if (mode === 'edge') push(`still ${age}`, readAt(CW - 0.5, CH / 2), colour, TOL);
      else expect(drawnBox()).toBeNull();
    }
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('from zoom 14, an edge glow only for a square wholly outside the view by one square', async () => {
    // 600 m east: off the view at zoom 14 (about 725 m across), but its margin block reaches
    // into it, so a project of the square may ring on screen: no glow from 14, a glow below.
    const nearby = rec(CITY_KIND.started, 200, 600);
    // 5 km east: the block is wholly outside.
    const far = rec(CITY_KIND.approved, 200, 5000);
    for (const zoom of [13.99, 14]) {
      await show([city([nearby])], zoom);
      render(D);
      expect(edgeOf(clipOf(nearby.anchor))).not.toBeNull();
      expect(blockOutside(blockOf(nearby))).toBe(false);
      const e = cpu(nearby, D, zoom);
      expect(e.mode).toBe(zoom < 14 ? 'edge' : 'none');
      if (zoom < 14) expect(drawnBox()).not.toBeNull();
      else expect(drawnBox()).toBeNull();
    }
    await show([city([far])], 14);
    render(D);
    expect(blockOutside(blockOf(far))).toBe(true);
    expect(cpu(far, D, 14).mode).toBe('edge');
    const { got, want, push } = checks();
    push('far glow', readAt(CW - 0.5, CH / 2 + 0.5), tok('light', 'tl-halo-approved'), TOL);
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`a policy record draws in tl-halo-policy, its ring doubled and its glow with a land rim (${theme})`, async () => {
      const policy = tok(theme, 'tl-halo-policy');
      const land = tok(theme, 'land');
      const ring = rec(CITY_KIND.policy, 200);
      const glow = rec(CITY_KIND.policy, 200, 3000);
      await show([city([ring, glow], true)]);
      render(D, theme);
      const { got, want, push } = checks();
      const r = cityRadiusPx(200);
      const inner = r - CITY_POLICY_INSET_PX;
      // West of the anchor: the glow sits on the right edge.
      push('ring outer', at(ring, -r), policy, TOL);
      push('ring inner', at(ring, -inner), policy, TOL);
      push('ring gap', at(ring, -(inner + 2)), BG, TOL);
      push('ring inside', at(ring, -(inner - 3)), BG, TOL);
      const e = cpu(glow, D, 13, true);
      const ey = ((1 - e.at[1]) / 2) * CH;
      const g = e.sizePx;
      push('glow fill', readAt(CW - 0.5, ey), policy, TOL);
      // The land rim, 1 px wide, ends CITY_POLICY_INSET_PX inside the disc's edge: the pixel
      // centred half a pixel within it is land, those a pixel either side the accent.
      const rim = g - CITY_POLICY_INSET_PX - 0.5;
      push('glow rim', readAt(CW - rim, ey), land, TOL);
      push('glow outside the rim', readAt(CW - rim - 2, ey), policy, TOL);
      push('glow inside the rim', readAt(CW - rim + 2, ey), policy, TOL);
      expect(got).toEqual(want);
      expect(errors).toEqual([]);
    });
  }

  it('reduced: the same radius and full alpha at ages 0 and 364', async () => {
    const c = rec(CITY_KIND.started, 120);
    await show([city([c], true)]);
    const { got, want, push } = checks();
    for (const age of [0, 364]) {
      render(D + age);
      const e = cpu(c, D + age, 13, true);
      expect(e).toMatchObject({ mode: 'ring', sizePx: cityRadiusPx(120), alpha: 1 });
      push(`age ${age} east`, at(c, e.sizePx), tok('light', 'tl-halo-started'), TOL);
      push(`age ${age} north`, at(c, 0, -e.sizePx), tok('light', 'tl-halo-started'), TOL);
    }
    expect(got).toEqual(want);
    render(D + CITY_RING_DAYS);
    expect(drawnBox()).toBeNull();
    expect(errors).toEqual([]);
  });

  it('draws nothing before its day', async () => {
    const inView = rec(CITY_KIND.started);
    const off = rec(CITY_KIND.approved, 200, 3000);
    await show([city([inView, off])]);
    render(D - 1);
    expect(cpu(inView, D - 1, 13).mode).toBe('none');
    expect(cpu(off, D - 1, 13).mode).toBe('none');
    expect(drawnBox()).toBeNull();
    render(D - 0.01);
    expect(drawnBox()).toBeNull();
    render(D);
    expect(drawnBox()).not.toBeNull();
    expect(errors).toEqual([]);
  });
});
