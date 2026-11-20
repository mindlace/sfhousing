// GPU test of HaloLayer: a standalone deck over a 96×96 canvas, top-down on one anchor. Each
// sampled pixel must match `evalHalo`, the CPU reference: the ring's radius and alpha, the
// stage's colour, and the mark's diamond.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Deck, MapView, type Layer, type MapViewState } from '@deck.gl/core';
import { HaloLayer } from './halo-layer';
import { HALO_KIND, evalHalo, type HaloAttrs } from './halos';
import { HALO_DAYS, HALO_R_PX, HALO_STILL_R_PX, MARK_PX } from './constants';
import type { TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';
import { OPEN_DAY, type Day } from '$lib/timelapse/time';

const CW = 96;
const CH = 96;
const CENTRE: [number, number] = [-122.42, 37.77];
/** The event day. */
const D = 21000;
/** A ring's radius at birth. */
const HALO_R_PX_0 = HALO_R_PX[0];
/** The clear colour (opaque magenta): unlike every halo token, so "nothing drawn" is visible. */
const BG: Rgb = [255, 0, 255];
/** Per-channel tolerance (0–255) for opaque pixels. */
const TOL = 2;
/** Blended pixels add the blend's own rounding (alpha written at 8 bits, then the result). */
const TOL_BLEND = TOL + 1;

type Rgb = [number, number, number];
const tok = (theme: Theme, name: TokenName): Rgb =>
  hexToRgba(TOKENS[theme][name]).slice(0, 3) as Rgb;
/** `c` at alpha `a` over BG (deck's SRC_ALPHA, ONE_MINUS_SRC_ALPHA). */
const over = (c: Rgb, a: number): Rgb => c.map((v, i) => a * v + (1 - a) * BG[i]) as Rgb;

const KIND_TOKEN: Record<0 | 1 | 2, TokenName> = {
  [HALO_KIND.approved]: 'tl-halo-approved',
  [HALO_KIND.started]: 'tl-halo-started',
  [HALO_KIND.completed]: 'tl-halo-complete'
};

function ring(kind: 0 | 1 | 2, policy = false): HaloAttrs {
  const until = D + HALO_DAYS;
  return { projectId: 'gpu', anchor: CENTRE, day: D, until, areaFrom: until, kind, policy };
}
const MARK: HaloAttrs = {
  projectId: 'gpu',
  anchor: CENTRE,
  day: D - 100,
  until: OPEN_DAY,
  areaFrom: OPEN_DAY, // never its square's one diamond
  kind: HALO_KIND.mark,
  policy: true
};

const VIEW_STATE: MapViewState = {
  longitude: CENTRE[0],
  latitude: CENTRE[1],
  zoom: 17,
  pitch: 0,
  bearing: 0
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

describe('HaloLayer on the GPU', () => {
  let canvas: HTMLCanvasElement;
  let deck: Deck<MapView>;
  let gl: WebGL2RenderingContext;
  const errors: Error[] = [];
  const clock: TimelineClock = { day: D, theme: 'light' };

  function halos(data: HaloAttrs[], reduced = false, ringMinZoom?: number): HaloLayer {
    return new HaloLayer({
      data,
      clock,
      reduced,
      ...(ringMinZoom === undefined ? {} : { ringMinZoom })
    });
  }

  function linkStatuses(): string[] {
    return (deck.props.layers as Layer[]).flatMap((l) =>
      l.getModels().map((m) => String((m.pipeline as { linkStatus?: string }).linkStatus))
    );
  }

  /** Sets the layers, then waits a frame at a time until deck has initialised and linked them. */
  async function show(layers: Layer[]) {
    deck.setProps({ layers });
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
        layers: [halos([ring(HALO_KIND.started)])],
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
    await show([halos([ring(HALO_KIND.started)])]);
  });

  afterAll(() => {
    deck?.finalize();
    canvas?.remove();
  });

  /** The anchor in canvas px (top-left origin). */
  const anchor = () => deck.getViewports()[0].project([...CENTRE, 0]);

  /** The pixel holding canvas point (x, y) (top-left origin). */
  function readAt(x: number, y: number): Rgb {
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(x), CH - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  }
  /** The pixel `dx`, `dy` px from the anchor. */
  const at = (dx: number, dy = 0) => {
    const [ax, ay] = anchor();
    return readAt(ax + dx, ay + dy);
  };

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

  const near = (got: Rgb, want: Rgb, tol: number) =>
    Math.max(...got.map((v, i) => Math.abs(v - want[i]))) <= tol;
  const check = (label: string, got: Rgb, want: Rgb, tol = TOL_BLEND) =>
    near(got, want, tol)
      ? `${label}: ok`
      : `${label}: got rgb(${got.join(',')}) want rgb(${want.map(Math.round).join(',')})`;

  /** The four points on the ring at radius `r`, and one inside and one outside it. */
  function ringCases(label: string, r: number, colour: Rgb, alpha: number): [string, Rgb, Rgb][] {
    const c = over(colour, alpha);
    return [
      [`${label} east`, at(r), c],
      [`${label} west`, at(-r), c],
      [`${label} north`, at(0, -r), c],
      [`${label} south`, at(0, r), c],
      [`${label} inside`, at(r - 3), BG],
      [`${label} outside`, at(r + 3), BG]
    ];
  }

  it('draws a ring of the radius evalHalo gives, in the stage colour, at ages 0, 365 and 729', async () => {
    const got: string[] = [];
    const want: string[] = [];
    for (const kind of [HALO_KIND.approved, HALO_KIND.started, HALO_KIND.completed] as const) {
      const h = ring(kind);
      await show([halos([h])]);
      for (const age of [0, 365, 729]) {
        render(D + age);
        const e = evalHalo(h, D + age, false);
        expect(e.visible).toBe(true);
        for (const [label, g, w] of ringCases(
          `kind ${kind} age ${age}`,
          e.radiusPx,
          tok('light', KIND_TOKEN[kind]),
          e.alpha
        )) {
          got.push(check(label, g, w));
          want.push(`${label}: ok`);
        }
        if (age < 729) {
          const box = drawnBox()!;
          // The 2 px stroke is centred on the radius: the box spans about 2 · (r + 1).
          expect(Math.abs(box[2] - box[0] + 1 - 2 * (e.radiusPx + 1))).toBeLessThanOrEqual(2);
        }
      }
    }
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('draws nothing at age HALO_DAYS or before the event day', async () => {
    await show([halos([ring(HALO_KIND.started)])]);
    render(D - 1);
    expect(drawnBox()).toBeNull();
    render(D + HALO_DAYS);
    expect(drawnBox()).toBeNull();
    render(D);
    expect(drawnBox()).not.toBeNull();
    expect(errors).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`a policy project's ring is in tl-halo-policy, and its mark shows from its first stage day (${theme})`, async () => {
      const h = ring(HALO_KIND.approved, true);
      await show([halos([h, MARK])]);
      const policy = tok(theme, 'tl-halo-policy');
      const land = tok(theme, 'land');
      render(MARK.day - 1, theme);
      expect(drawnBox()).toBeNull();
      const got: string[] = [];
      const want: string[] = [];
      const push = (label: string, g: Rgb, w: Rgb, tol = TOL) => {
        got.push(check(label, g, w, tol));
        want.push(`${label}: ok`);
      };
      for (const day of [MARK.day, D + 365]) {
        render(day, theme);
        push(`${day} mark fill`, at(0.5), policy);
        // A pixel centred 3.5 px east of the anchor lies within 1 px of the diamond's edge.
        push(`${day} mark edge`, at(3.5), land);
        push(`${day} beyond the mark`, at(MARK_PX / 2 + 1.5, -(MARK_PX / 2 + 1.5)), BG);
      }
      const e = evalHalo(h, D + 365, false);
      for (const [label, g, w] of ringCases('policy ring', e.radiusPx, policy, e.alpha))
        push(label, g, w, TOL_BLEND);
      expect(got).toEqual(want);
      expect(errors).toEqual([]);
    });
  }

  it('reduced: the same radius and alpha at ages 0 and 729', async () => {
    const h = ring(HALO_KIND.completed);
    await show([halos([h], true)]);
    const got: string[] = [];
    const want: string[] = [];
    for (const age of [0, 729]) {
      render(D + age);
      const e = evalHalo(h, D + age, true);
      expect(e).toEqual({ visible: true, radiusPx: HALO_STILL_R_PX, alpha: 1 });
      for (const [label, g, w] of ringCases(
        `age ${age}`,
        e.radiusPx,
        tok('light', 'tl-halo-complete'),
        1
      )) {
        got.push(check(label, g, w, TOL));
        want.push(`${label}: ok`);
      }
    }
    expect(got).toEqual(want);
    render(D + HALO_DAYS);
    expect(drawnBox()).toBeNull();
    expect(errors).toEqual([]);
  });

  it('with ringMinZoom 14, a ring and a mark draw at zoom 14 and not at 13.9', async () => {
    const h = ring(HALO_KIND.started);
    const policy = tok('light', 'tl-halo-policy');
    const colour = tok('light', 'tl-halo-started');
    const zoomTo = (zoom: number) => deck.setProps({ viewState: { ...VIEW_STATE, zoom } });
    try {
      const got: string[] = [];
      const want: string[] = [];
      const push = (label: string, g: Rgb, w: Rgb, tol = TOL_BLEND) => {
        got.push(check(label, g, w, tol));
        want.push(`${label}: ok`);
      };
      for (const zoom of [14, 13.9]) {
        zoomTo(zoom);
        await show([halos([h, MARK], false, 14)]);
        render(D);
        const e = evalHalo(h, D, false, zoom, 14);
        expect(e.visible).toBe(zoom >= 14);
        // The ring's east point: the stage colour at 14, nothing at 13.9.
        push(`${zoom} ring`, at(HALO_R_PX_0), e.visible ? colour : BG);
        expect(evalHalo(MARK, D, false, zoom, 14).visible).toBe(zoom >= 14);
        push(`${zoom} mark`, at(0.5), zoom >= 14 ? policy : BG, TOL);
      }
      // Without the prop the gate is off: a ring and a mark at 13.9.
      await show([halos([h, MARK])]);
      render(D);
      push('no gate ring', at(HALO_R_PX_0), colour);
      push('no gate mark', at(0.5), policy, TOL);
      expect(got).toEqual(want);
    } finally {
      zoomTo(VIEW_STATE.zoom);
    }
    expect(errors).toEqual([]);
  });

  it("with ringMinZoom 14, a mark draws at 13.9 from its areaFrom (its square's one diamond)", async () => {
    const area: HaloAttrs = { ...MARK, areaFrom: D };
    const policy = tok('light', 'tl-halo-policy');
    const zoomTo = (zoom: number) => deck.setProps({ viewState: { ...VIEW_STATE, zoom } });
    try {
      const got: string[] = [];
      const want: string[] = [];
      zoomTo(13.9);
      await show([halos([area], false, 14)]);
      for (const day of [D - 1, D, D + 5000]) {
        render(day);
        const e = evalHalo(area, day, false, 13.9, 14);
        expect(e.visible).toBe(day >= D);
        got.push(check(`${day}`, at(0.5), e.visible ? policy : BG, TOL));
        want.push(`${day}: ok`);
      }
      expect(got).toEqual(want);
    } finally {
      zoomTo(VIEW_STATE.zoom);
    }
    expect(errors).toEqual([]);
  });
});
