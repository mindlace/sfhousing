// GPU test of CityLayer: a standalone deck over a 384×128 canvas, top-down unless a case pitches
// or rotates the camera. Each sampled pixel
// must match `evalCity`, the CPU reference: a merged ring's radius, alpha and tone in view below
// the handover zoom, nothing in view from it, an edge glow toward an anchor off view, the reveal
// window at both ends, and the policy record's accent and second stroke.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Deck,
  MapView,
  type Layer,
  type MapViewState,
  type WebMercatorViewport
} from '@deck.gl/core';
import { CityLayer } from './city-layer';
import {
  CITY_KIND,
  CITY_KIND_TOKEN,
  cityEdgePx,
  cityRadiusPx,
  cityForward,
  edgeOf,
  evalCity,
  halfDiagM,
  type CityAttrs,
  type CityView,
  type Clip
} from './city';
import {
  CITY_EDGE_DAYS,
  CITY_GLOW_REACH,
  CITY_POLICY_INSET_PX,
  CITY_RING_DAYS,
  CITY_RING_FLOOR_PX
} from './constants';
import type { TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';
import type { Day } from '$lib/timelapse/time';

/**
 * A wide canvas, as /sim's map is wide (1280 × 451): a glow's range is a few view
 * half-diagonals, and on a pitched camera the ground behind it starts about 3.2 view heights
 * away, so only a wide view has both in reach.
 */
const CW = 384;
const CH = 128;
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

/** Metres per degree of latitude. */
const M_LAT = 111_195;

/** A record of `kind` and `homes`, `eastM` metres east and `northM` north of CENTRE. */
function rec(kind: 0 | 1 | 2 | 3, homes = 200, eastM = 0, northM = 0): CityAttrs {
  const anchor: [number, number] = [CENTRE[0] + eastM / M_LNG, CENTRE[1] + northM / M_LAT];
  return { anchor, day: D, homes, kind };
}
/** A record at a ground point. */
const recAt = (kind: 0 | 1 | 2 | 3, anchor: [number, number], homes = 200): CityAttrs => ({
  anchor,
  day: D,
  homes,
  kind
});

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

  const NO_INSET: [number, number, number, number] = [0, 0, 0, 0];
  const city = (data: CityAttrs[], reduced = false, edgeInset = NO_INSET) =>
    new CityLayer({ data, clock, reduced, edgeInset });

  function linkStatuses(): string[] {
    return (deck.props.layers as Layer[]).flatMap((l) =>
      l.getModels().map((m) => String((m.pipeline as { linkStatus?: string }).linkStatus))
    );
  }

  async function show(layers: Layer[], zoom = VIEW_STATE.zoom, camera: Partial<MapViewState> = {}) {
    deck.setProps({ layers, viewState: { ...VIEW_STATE, zoom, ...camera } });
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
  /** The view at zoom 16 flat, as the CPU sees it (for distances only; no render). */
  const viewOfZoom16 = (): CityView => {
    const v = vp() as unknown as WebMercatorViewport;
    return {
      zoom: 16,
      viewPx: [CW, CH],
      inset: NO_INSET,
      centre: CENTRE,
      pxPerMeter: 2 ** 16 * v.distanceScales.unitsPerMeter[0],
      focalW: 1,
      forward: cityForward(0, CENTRE[1])
    };
  };
  /**
   * A lng/lat point in clip space, as the shader projects it (viewProjectionMatrix ·
   * projectPosition): w is not 1 under a pitched camera, and is negative behind it.
   */
  function clipOf(p: [number, number]): Clip {
    const v = vp();
    const [x, y, z] = v.projectPosition([p[0], p[1], 0]);
    const m = v.viewProjectionMatrix as number[];
    const q = [x, y, z, 1];
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r] += m[c * 4 + r] * q[c];
    return [o[0], o[1], o[3]];
  }
  /** The CityView the shader reads from deck's viewport: its centre, scale, size and inset. */
  function viewOf(zoom: number, inset: CityView['inset'] = NO_INSET): CityView {
    const v = vp() as unknown as WebMercatorViewport;
    const centre: [number, number] = [v.longitude, v.latitude];
    return {
      zoom,
      viewPx: [CW, CH],
      inset,
      centre,
      pxPerMeter: v.scale * v.distanceScales.unitsPerMeter[0],
      focalW: clipOf(centre)[2],
      forward: cityForward(v.bearing, v.latitude)
    };
  }
  /** evalCity for `c` on this view. */
  const cpu = (
    c: CityAttrs,
    t: Day,
    zoom: number,
    reduced = false,
    inset: CityView['inset'] = NO_INSET
  ) => {
    const view = viewOf(zoom, inset);
    const [a, b] = c.anchor;
    const fwd = clipOf([a + view.forward[0], b + view.forward[1]]);
    return evalCity(c, t, view, clipOf(c.anchor), reduced, fwd);
  };
  /** Canvas px of an NDC point. */
  const ndcPx = ([x, y]: [number, number]) => [((x + 1) / 2) * CW, ((1 - y) / 2) * CH];
  /** The ground point under canvas px (x, y) on this view. */
  const groundAt = (x: number, y: number) => vp().unproject([x, y]) as [number, number];

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
    // 3 km east: off the view (about 2.9 km across at zoom 13), in the glow's range (4.6 km).
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
      const e = cpu(c, D + age, 13, true);
      if (mode === 'edge') push(`still ${age}`, readAt(CW - 0.5, CH / 2), over(colour, e.alpha));
      else expect(drawnBox()).toBeNull();
    }
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  for (const pitch of [0, 55]) {
    it(`from zoom 14 an edge glow only beyond the view widened by a project ring's reach (pitch ${pitch})`, async () => {
      const camera = { pitch };
      // Find the ground points on this view first: 10 px past the right edge (inside the
      // margin), 40 px past it (beyond), and 300 m past the edge (the old rule's silent band).
      await show([city([])], 16, camera);
      const inside = recAt(CITY_KIND.started, groundAt(CW + 10, CH / 2));
      const beyond = recAt(CITY_KIND.started, groundAt(CW + 40, CH / 2));
      const edge = groundAt(CW, CH / 2);
      const km = recAt(CITY_KIND.started, [edge[0] + 300 / M_LNG, edge[1]]);
      const { got, want, push } = checks();
      const tone = tok('light', 'tl-halo-started');
      for (const [c, label] of [
        [inside, 'inside'],
        [beyond, 'beyond'],
        [km, '300 m']
      ] as const) {
        for (const zoom of [13.99, 14, 16]) {
          await show([city([c])], zoom, camera);
          render(D);
          const e = cpu(c, D, zoom);
          if (zoom === 16) {
            // Every case is off view at 16; only the margin decides.
            expect(edgeOf(clipOf(c.anchor))).not.toBeNull();
            expect(e.mode).toBe(label === 'inside' ? 'none' : 'edge');
          }
          if (e.mode === 'edge') {
            const [ex, ey] = ndcPx(e.at);
            push(`${label} at ${zoom}`, readAt(Math.min(ex, CW - 0.5), ey), over(tone, e.alpha));
          } else if (e.mode === 'ring') {
            // Below 14 at a zoomed-out view the point is in view: its merged ring draws.
            expect(zoom).toBeLessThan(14);
            expect(drawnBox()).not.toBeNull();
          } else {
            expect(drawnBox()).toBeNull();
          }
        }
      }
      expect(got).toEqual(want);
      expect(errors).toEqual([]);
    });
  }

  it('pitch 55: an anchor 4 km south (behind the camera) glows on the bottom edge', async () => {
    const c = rec(CITY_KIND.approved, 200, 0, -4000);
    await show([city([c])], 13, { pitch: 55 });
    render(D);
    expect(clipOf(c.anchor)[2]).toBeLessThan(0);
    const e = cpu(c, D, 13);
    expect(e.mode).toBe('edge');
    expect(e.at[1]).toBe(-1);
    const [ex] = ndcPx(e.at);
    const { got, want, push } = checks();
    push('bottom', readAt(ex, CH - 0.5), over(tok('light', 'tl-halo-approved'), e.alpha));
    push('not the top', readAt(ex, 0.5), BG, TOL);
    expect(got).toEqual(want);
    const box = drawnBox()!;
    expect(box[3]).toBe(CH - 1);
    expect(box[1]).toBeGreaterThan(CH / 2);
    expect(errors).toEqual([]);
  });

  it('zoom 16, pitch 55, bearing 90: 500 m north glows on the left, 500 m west (behind) on the bottom', async () => {
    const camera = { pitch: 55, bearing: 90 };
    const { got, want, push } = checks();
    for (const [c, label] of [
      [rec(CITY_KIND.completed, 200, 0, 500), 'north'],
      [rec(CITY_KIND.completed, 200, -500), 'west']
    ] as const) {
      await show([city([c])], 16, camera);
      render(D);
      const e = cpu(c, D, 16);
      expect(e.mode).toBe('edge');
      if (label === 'north') expect(e.at[0]).toBe(-1);
      else {
        expect(clipOf(c.anchor)[2]).toBeLessThan(0);
        expect(e.at[1]).toBe(-1);
      }
      const [ex, ey] = ndcPx(e.at);
      const x = Math.min(Math.max(ex, 0.5), CW - 0.5);
      const y = Math.min(Math.max(ey, 0.5), CH - 0.5);
      push(label, readAt(x, y), over(tok('light', 'tl-halo-complete'), e.alpha));
      const box = drawnBox()!;
      if (label === 'north') expect(box[0]).toBe(0);
      else expect(box[3]).toBe(CH - 1);
    }
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('pitch 55: an in-view anchor near the top draws its ring at its projected point', async () => {
    await show([city([])], 13, { pitch: 55 });
    const c = recAt(CITY_KIND.started, groundAt(CW / 2 + 10, 30), 10);
    await show([city([c])], 13, { pitch: 55 });
    render(D);
    const clip = clipOf(c.anchor);
    expect(Math.abs(clip[2] - 1)).toBeGreaterThan(0.05);
    const e = cpu(c, D, 13);
    expect(e.mode).toBe('ring');
    const [px, py] = ndcPx(e.at);
    const [ax, ay] = anchorPx(c);
    expect(Math.abs(px - ax)).toBeLessThan(0.01);
    expect(Math.abs(py - ay)).toBeLessThan(0.01);
    const r = e.sizePx;
    const { got, want, push } = checks();
    const tone = tok('light', 'tl-halo-started');
    push('east', at(c, r), over(tone, e.alpha));
    push('west', at(c, -r), over(tone, e.alpha));
    push('south', at(c, 0, r), over(tone, e.alpha));
    push('centre', at(c, 0), BG, TOL);
    push('outside', at(c, r + 3), BG, TOL);
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('a ring is no wider than half its square on screen; near the floor it fades, then draws nothing', async () => {
    const c = rec(CITY_KIND.started, 200, 0, 0);
    const { got, want, push } = checks();
    const tone = tok('light', 'tl-halo-started');
    // Flat: the square's half-width is about 26.5 px at 12, 6.6 at 10, 3.3 at 9, 1.7 at 8.
    for (const zoom of [12, 10, 9, 8]) {
      await show([city([c], true)], zoom);
      render(D);
      const e = cpu(c, D, zoom, true);
      if (zoom === 8) {
        expect(e.mode).toBe('none');
        expect(drawnBox()).toBeNull();
        continue;
      }
      expect(e.mode).toBe('ring');
      expect(e.sizePx).toBeLessThan(cityRadiusPx(200));
      if (zoom === 9) {
        expect(e.sizePx).toBe(CITY_RING_FLOOR_PX);
        expect(e.alpha).toBeGreaterThan(0.2);
        expect(e.alpha).toBeLessThan(0.7);
      } else expect(e.alpha).toBe(1);
      push(`${zoom} east`, at(c, e.sizePx), over(tone, e.alpha));
      push(`${zoom} north`, at(c, 0, -e.sizePx), over(tone, e.alpha));
      push(`${zoom} outside`, at(c, e.sizePx + 3), BG, TOL);
    }
    // Pitched: a ring toward the horizon is smaller than one near the camera, as drawn.
    await show([city([])], 13, { pitch: 55 });
    const nearer = recAt(CITY_KIND.started, groundAt(CW / 4, CH - 30), 200);
    const farther = recAt(CITY_KIND.started, groundAt((3 * CW) / 4, 30), 200);
    await show([city([nearer, farther], true)], 13, { pitch: 55 });
    render(D);
    const n = cpu(nearer, D, 13, true);
    const f = cpu(farther, D, 13, true);
    expect(f.sizePx).toBeLessThan(n.sizePx);
    push('nearer', at(nearer, n.sizePx), over(tone, n.alpha));
    push('farther', at(farther, f.sizePx), over(tone, f.alpha));
    push('farther outside', at(farther, f.sizePx + 3), BG, TOL);
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('a glow has a range: CITY_GLOW_REACH view half-diagonals; fainter toward it', async () => {
    // Zoom 16, flat: the half-diagonal is about 190 m, so the reach is about 570 m.
    const reachM = CITY_GLOW_REACH * halfDiagM(viewOfZoom16());
    const { got, want, push } = checks();
    const tone = tok('light', 'tl-halo-approved');
    for (const [east, mode] of [
      [0.5 * reachM, 'edge'],
      [0.97 * reachM, 'edge'],
      [1.03 * reachM, 'none']
    ] as const) {
      const c = rec(CITY_KIND.approved, 10, east);
      await show([city([c], true)], 16);
      render(D);
      const e = cpu(c, D, 16, true);
      expect(e.mode).toBe(mode);
      if (mode === 'none') {
        expect(drawnBox()).toBeNull();
        continue;
      }
      push(`${Math.round(east)} m`, readAt(CW - 0.5, CH / 2), over(tone, e.alpha));
    }
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('a glow sits on the inset rectangle: 40 px above the bottom with a bottom inset of 40', async () => {
    const c = rec(CITY_KIND.completed, 10, 0, -600);
    const inset: [number, number, number, number] = [0, 0, 40, 0];
    await show([city([c], true, inset)], 15);
    render(D);
    const e = cpu(c, D, 15, true, inset);
    expect(e.mode).toBe('edge');
    const [ex, ey] = ndcPx(e.at);
    expect(ey).toBeCloseTo(CH - 40, 6);
    const { got, want, push } = checks();
    const tone = tok('light', 'tl-halo-complete');
    push('on the inset edge', readAt(ex, ey - 0.5), over(tone, e.alpha));
    push('below it', readAt(ex, CH - 0.5), BG, TOL);
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
      const r = cpu(ring, D, 13, true).sizePx;
      const inner = r - CITY_POLICY_INSET_PX;
      // West of the anchor: the glow sits on the right edge.
      push('ring outer', at(ring, -r), policy, TOL);
      push('ring inner', at(ring, -inner), policy, TOL);
      push('ring gap', at(ring, -(inner + 2)), BG, TOL);
      push('ring inside', at(ring, -(inner - 3)), BG, TOL);
      const e = cpu(glow, D, 13, true);
      const ey = ((1 - e.at[1]) / 2) * CH;
      const g = e.sizePx;
      const a = e.alpha;
      push('glow fill', readAt(CW - 0.5, ey), over(policy, a));
      // The land rim, 1 px wide, ends CITY_POLICY_INSET_PX inside the disc's edge: the pixel
      // centred half a pixel within it is land, those a pixel either side the accent.
      const rim = g - CITY_POLICY_INSET_PX - 0.5;
      push('glow rim', readAt(CW - rim, ey), over(land, a));
      push('glow outside the rim', readAt(CW - rim - 2, ey), over(policy, a));
      push('glow inside the rim', readAt(CW - rim + 2, ey), over(policy, a));
      expect(got).toEqual(want);
      expect(errors).toEqual([]);
    });
  }

  it('reduced: the same radius and full alpha at ages 0 and CITY_RING_DAYS - 1', async () => {
    const c = rec(CITY_KIND.started, 120);
    await show([city([c], true)]);
    const { got, want, push } = checks();
    for (const age of [0, CITY_RING_DAYS - 1]) {
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
