// GPU test of HaloLayer: a standalone deck over a 96×96 canvas, top-down on one anchor. Each
// sampled pixel must match `evalHalo`, the CPU reference: the mark's diamond, in the accent, with
// its 1 px land edge, shown or not.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Deck, MapView, type Layer, type MapViewState } from '@deck.gl/core';
import { HaloLayer } from './halo-layer';
import { evalHalo, type HaloAttrs } from './halos';
import { MARK_AREA_ZOOM, MARK_PX } from './constants';
import type { TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';
import { OPEN_DAY, type Day } from '$lib/timelapse/time';

const CW = 96;
const CH = 96;
const CENTRE: [number, number] = [-122.42, 37.77];
/** The event day. */
const D = 21000;
/** The clear colour (opaque magenta): unlike every halo token, so "nothing drawn" is visible. */
const BG: Rgb = [255, 0, 255];
/** Per-channel tolerance (0–255) for opaque pixels. */
const TOL = 2;
/** Blended pixels add the blend's own rounding (alpha written at 8 bits, then the result). */
const TOL_BLEND = TOL + 1;

type Rgb = [number, number, number];
const tok = (theme: Theme, name: TokenName): Rgb =>
  hexToRgba(TOKENS[theme][name]).slice(0, 3) as Rgb;

const MARK: HaloAttrs = {
  projectId: 'gpu',
  anchor: CENTRE,
  day: D - 100,
  until: OPEN_DAY,
  areaFrom: OPEN_DAY // never its square's one diamond
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

  function halos(data: HaloAttrs[]): HaloLayer {
    return new HaloLayer({ data, clock });
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
        layers: [halos([MARK])],
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
    await show([halos([MARK])]);
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

  it.each(['light', 'dark'] as const)(
    'a mark draws in tl-halo-policy from its first stage day, not before (%s)',
    (theme) => {
      const policy = tok(theme, 'tl-halo-policy');
      const land = tok(theme, 'land');
      const got: string[] = [];
      const want: string[] = [];
      render(MARK.day - 1, theme);
      expect(evalHalo(MARK, MARK.day - 1)).toBe(false);
      expect(drawnBox()).toBeNull();
      render(MARK.day, theme);
      expect(evalHalo(MARK, MARK.day)).toBe(true);
      got.push(check('centre', at(0.5), policy, TOL));
      // Just inside the tip: the 1 px land edge.
      got.push(check('edge', at(MARK_PX / 2 - 1.2), land, TOL));
      got.push(check('outside', at(MARK_PX / 2 + 3), BG, TOL));
      for (const l of ['centre', 'edge', 'outside']) want.push(`${l}: ok`);
      expect(got).toEqual(want);
      render(D + 5000, theme);
      expect(drawnBox()).not.toBeNull();
      expect(errors).toEqual([]);
    }
  );

  it('a mark draws at zoom 14 and not at 13.9 before its areaFrom', async () => {
    const policy = tok('light', 'tl-halo-policy');
    const zoomTo = (zoom: number) => deck.setProps({ viewState: { ...VIEW_STATE, zoom } });
    try {
      const got: string[] = [];
      const want: string[] = [];
      await show([halos([MARK])]);
      for (const zoom of [MARK_AREA_ZOOM, 13.9]) {
        zoomTo(zoom);
        deck.redraw('zoom');
        await nextFrame();
        render(D);
        const e = evalHalo(MARK, D, zoom);
        expect(e).toBe(zoom >= MARK_AREA_ZOOM);
        got.push(check(`${zoom}`, at(0.5), e ? policy : BG, TOL));
        want.push(`${zoom}: ok`);
      }
      expect(got).toEqual(want);
    } finally {
      zoomTo(VIEW_STATE.zoom);
    }
    expect(errors).toEqual([]);
  });

  it("a mark draws at 13.9 from its areaFrom (its square's one diamond)", async () => {
    const area: HaloAttrs = { ...MARK, areaFrom: D };
    const policy = tok('light', 'tl-halo-policy');
    const zoomTo = (zoom: number) => deck.setProps({ viewState: { ...VIEW_STATE, zoom } });
    try {
      const got: string[] = [];
      const want: string[] = [];
      zoomTo(13.9);
      await show([halos([area])]);
      for (const day of [D - 1, D, D + 5000]) {
        render(day);
        const e = evalHalo(area, day, 13.9);
        expect(e).toBe(day >= D);
        got.push(check(`${day}`, at(0.5), e ? policy : BG, TOL));
        want.push(`${day}: ok`);
      }
      expect(got).toEqual(want);
    } finally {
      zoomTo(VIEW_STATE.zoom);
    }
    expect(errors).toEqual([]);
  });
});
