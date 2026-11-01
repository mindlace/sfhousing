// GPU test of HeightFogLayer (sim map overlays plan 2, Task 3): a standalone deck over a 128×64
// canvas, top-down, as stage-bar-layer.gpu.svelte.spec.ts. A flat fog is the 'height-fog' token
// over the ground, two cells meet without a crack or a double blend, and the fog depth-tests
// against the buildings drawn before it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Deck, MapView, type Layer, type MapViewState, type Material } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { FOG_LAYER_ID, HeightFogLayer, heightFogLayer } from './fog-layer';
import type { FogGrid, FogInstances } from './grid';
import { TOKENS, hexToRgba } from '../palette';
import { localFrame } from '$lib/generator/geo';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';

type Rgb = [number, number, number];

const CW = 128;
const CH = 64;
const CENTRE: [number, number] = [-122.42, 37.77];
/** 15 m east of CENTRE: inside the same fog cell, clear of the centre box. */
const OFFSET: [number, number] = localFrame(CENTRE).to(15, 0) as [number, number];
/** The clear colour (opaque magenta): unlike the fog token, so "nothing drawn" is visible. */
const BG: Rgb = [255, 0, 255];
/** Per-channel tolerance (0–255) for an opaque pixel: unlit flat colour, rounding only. */
const TOL = 2;
/** A blended pixel adds the blend's own rounding (8-bit source alpha, rounded result). */
const TOL_BLEND = TOL + 1;
/** The flat fog's height in the tests, metres. */
const FLAT_H = 30;

/** `c` at alpha `a` over BG (deck's SRC_ALPHA, ONE_MINUS_SRC_ALPHA). */
const over = (c: Rgb, a: number): Rgb => c.map((v, i) => a * v + (1 - a) * BG[i]) as Rgb;
/** `top` at alpha `a` over `under`. */
const mix = (under: Rgb, top: Rgb, a: number): Rgb =>
  under.map((v, i) => a * top[i] + (1 - a) * v) as Rgb;

/**
 * A 4×2-cell grid of 40 m cells around CENTRE: CENTRE sits in the middle of column 1 and of
 * row 0, so the canvas centre is a cell interior and the column-1/2 boundary is 20 m east.
 */
const CELL_M = 40;
const D_LNG = CELL_M / M_PER_DEG_LNG;
const D_LAT = CELL_M / M_PER_DEG_LAT;
const GRID: FogGrid = {
  west: CENTRE[0] - 1.5 * D_LNG,
  south: CENTRE[1] - 0.5 * D_LAT,
  dLng: D_LNG,
  dLat: D_LAT,
  cols: 4,
  rows: 2,
  heightM: new Float32Array(5 * 3)
};

/** As GRID, but CENTRE 40 m north of the south edge: the row 0/1 boundary is 10 m south of it. */
const GRID_NS: FogGrid = { ...GRID, south: CENTRE[1] - 1.25 * D_LAT };
/** As GRID with 400 m cells, for zoom 11.5 (≈ 21 m/px): CENTRE mid-cell, the canvas centre inside. */
const GRID_Z11: FogGrid = {
  ...GRID,
  west: CENTRE[0] - 15 * D_LNG,
  south: CENTRE[1] - 5 * D_LAT,
  dLng: 10 * D_LNG,
  dLat: 10 * D_LAT
};

/** `g`'s cells as FogInstances with every corner `h` metres. */
function flat(h: number, g: FogGrid = GRID): FogInstances {
  const GRID = g;
  const count = GRID.cols * GRID.rows;
  const anchors = new Float64Array(2 * count);
  const corners = new Float32Array(4 * count).fill(h);
  for (let r = 0; r < GRID.rows; r++)
    for (let c = 0; c < GRID.cols; c++) {
      const k = r * GRID.cols + c;
      anchors[2 * k] = GRID.west + c * GRID.dLng;
      anchors[2 * k + 1] = GRID.south + r * GRID.dLat;
    }
  return { count, anchors, corners };
}

/**
 * An unlit extruded 16 m square box centred on `at`, `heightM` tall, packed as the generated
 * controller packs a part (binary positions, a closed clockwise ring, `_normalize: false`).
 */
function solidBox(at: [number, number], heightM: number, rgb: Rgb): Layer {
  const f = localFrame(at);
  const ring = [
    [-8, -8],
    [-8, 8],
    [8, 8],
    [8, -8],
    [-8, -8]
  ].flatMap(([x, y]) => f.to(x, y));
  return new SolidPolygonLayer({
    id: `box-${heightM}`,
    data: {
      length: 1,
      startIndices: new Uint32Array([0]),
      attributes: { getPolygon: { value: new Float64Array(ring), size: 2 } }
    },
    extruded: true,
    _normalize: false,
    _windingOrder: 'CW',
    material: { unlit: true } as Material,
    getElevation: heightM,
    getFillColor: [...rgb, 255]
  } as ConstructorParameters<typeof SolidPolygonLayer>[0]) as unknown as Layer;
}

/**
 * Top-down at z17 (≈ 0.47 m/px). The camera altitude is raised from deck's 1.5 viewport heights
 * (≈ 45 m here) to 6 (≈ 181 m) so the 60 m roof is below it.
 */
const VIEW_STATE: MapViewState & { altitude: number } = {
  longitude: CENTRE[0],
  latitude: CENTRE[1],
  zoom: 17,
  pitch: 0,
  bearing: 0,
  altitude: 6
};

describe('HeightFogLayer on the GPU', () => {
  let canvas: HTMLCanvasElement;
  let deck: Deck<MapView>;
  let gl: WebGL2RenderingContext;
  const errors: Error[] = [];

  function linkStatuses(): string[] {
    return (deck.props.layers as Layer[]).flatMap((l) =>
      l.getModels().map((m) => String((m.pipeline as { linkStatus?: string }).linkStatus))
    );
  }

  /** Sets the layers, waits until deck has initialised and linked them all, then reads back. */
  async function render(layers: Layer[], viewState: MapViewState = VIEW_STATE) {
    deck.setProps({ layers, viewState });
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
    deck.redraw('test');
    const buf = new Uint8Array(CW * CH * 4);
    gl.readPixels(0, 0, CW, CH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return {
      /** The pixel whose centre is nearest (x, y) in canvas px (top-left origin). */
      at(x: number, y: number): Rgb {
        const i = 4 * ((CH - 1 - Math.floor(y)) * CW + Math.floor(x));
        return [buf[i], buf[i + 1], buf[i + 2]];
      }
    };
  }

  /** Canvas px of a ground point. */
  const toPx = (ll: [number, number]): [number, number] => {
    const [x, y] = deck.getViewports()[0].project(ll);
    return [x, y];
  };
  /** The pixel column on the boundary between columns 1 and 2 of `g`, at the flat fog's height. */
  const edgeX = (g: FogGrid) =>
    deck.getViewports()[0].project([g.west + 2 * g.dLng, CENTRE[1], FLAT_H])[0];

  /** The pixel row on the boundary between rows 0 and 1 of `g`, at the flat fog's height. */
  const edgeY = (g: FogGrid) =>
    deck.getViewports()[0].project([CENTRE[0], g.south + g.dLat, FLAT_H])[1];

  const expectPixel = (got: Rgb, want: Rgb, tol: number) =>
    expect(
      Math.max(...got.map((v, i) => Math.abs(v - want[i]))),
      `got rgb(${got.join(',')}) want rgb(${want.map(Math.round).join(',')})`
    ).toBeLessThanOrEqual(tol);

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
        layers: [],
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
  });

  afterAll(() => {
    deck?.finalize();
    canvas?.remove();
  });

  it.each(['light', 'dark'] as const)(
    '%s: a flat fog is the token over the ground',
    async (theme) => {
      const px = await render([heightFogLayer(flat(30), GRID, theme)]);
      const [r, g, b, a] = hexToRgba(TOKENS[theme]['height-fog']);
      expectPixel(px.at(64, 32), over([r, g, b], a / 255), TOL_BLEND);
      expect(errors).toEqual([]);
    }
  );

  it('no crack or double blend on a shared cell edge', async () => {
    const px = await render([heightFogLayer(flat(30), GRID, 'light')]);
    const edge = px.at(edgeX(GRID), 32); // the column on the boundary between two cells
    expectPixel(edge, px.at(64, 32), 1);
    expect(errors).toEqual([]);
  });

  it('no crack or double blend on a shared row edge', async () => {
    const px = await render([heightFogLayer(flat(30, GRID_NS), GRID_NS, 'light')]);
    const y = edgeY(GRID_NS);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(CH);
    expectPixel(px.at(64, y), px.at(64, 32), 1);
    expect(errors).toEqual([]);
  });

  // Below zoom 12 deck projects without offsets and drops the low part: the corner offset must
  // reach the high part there, or every quad collapses to a point and nothing draws.
  it('zoom 11.5: a flat fog is the token over the ground', async () => {
    const px = await render([heightFogLayer(flat(30, GRID_Z11), GRID_Z11, 'light')], {
      ...VIEW_STATE,
      zoom: 11.5
    } as MapViewState);
    const [r, g, b, a] = hexToRgba(TOKENS.light['height-fog']);
    expectPixel(px.at(64, 32), over([r, g, b], a / 255), TOL_BLEND);
    expect(errors).toEqual([]);
  });

  it('a new layer with new data redraws from that data', async () => {
    const all = flat(30);
    /** GRID's cell in column `c` of row 0, alone. */
    const cell = (c: number): FogInstances => ({
      count: 1,
      anchors: all.anchors.slice(2 * c, 2 * c + 2),
      corners: all.corners.slice(4 * c, 4 * c + 4)
    });
    // Column 1 holds CENTRE; column 3 is 60–100 m east of it, off the canvas.
    const [r, g, b, a] = hexToRgba(TOKENS.light['height-fog']);
    const before = await render([heightFogLayer(cell(1), GRID, 'light')]);
    expectPixel(before.at(64, 32), over([r, g, b], a / 255), TOL_BLEND);
    const after = await render([heightFogLayer(cell(3), GRID, 'light')]);
    expectPixel(after.at(64, 32), BG, 0);
    expect(errors).toEqual([]);
  });

  it('a roof above the fog is clear; a roof below shows through', async () => {
    const roof: Rgb = [200, 80, 40];
    const tall = solidBox(CENTRE, 60, roof),
      low = solidBox(OFFSET, 10, roof);
    const px = await render([tall, low, heightFogLayer(flat(30), GRID, 'light')]);
    expectPixel(px.at(...toPx(CENTRE)), roof, TOL);
    const [r, g, b, a] = hexToRgba(TOKENS.light['height-fog']);
    expectPixel(px.at(...toPx(OFFSET)), mix(roof, [r, g, b], a / 255), TOL_BLEND);
    expect(errors).toEqual([]);
  });

  it('is `sim-height-fog`, not pickable, depth tested but not written', () => {
    const layer = heightFogLayer(flat(30), GRID, 'light');
    expect(layer).toBeInstanceOf(HeightFogLayer);
    expect(layer.id).toBe(FOG_LAYER_ID);
    expect(FOG_LAYER_ID).toBe('sim-height-fog');
    expect(layer.props.pickable).toBe(false);
    expect(layer.props.parameters).toMatchObject({
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
      cullMode: 'none'
    });
  });
});
