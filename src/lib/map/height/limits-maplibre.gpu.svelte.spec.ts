// GPU test of HeightLimitsLayer against a real MapLibre fill-extrusion (height-lids plan, Task 11;
// spec "Depth against existing buildings"). A 256×160 MapLibre map with the tinyLimits() lots
// holds two existing-colour boxes in the 4-story region north of the street: a 40 m box, taller
// than the 13.8 m lid, and a 10 m one under it. The limits layer draws in an interleaved
// MapLibreOverlay before the first symbol layer, as SimMap does. Pitched 60° looking north, each
// scene renders with the limits layer and without it, and the pixels are compared: the tall box's
// face and a rim behind it are unchanged, the low roof and open ground under the lid are tinted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deck, Layer } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { TOKENS, hexToRgba } from '../palette';
import { firstSymbolLayerId } from '../style';
import { heightLimitsLayer } from './limits-layer';
import { tinyLimits, toLngLat } from './test/fixtures';
import type { HeightLids } from './types';

type Rgb = [number, number, number];
type Px = [number, number];

const CW = 256;
const CH = 160;
/** Dark theme: the light glaze over dark buildings shows most where it is (or is not) drawn. */
const THEME = 'dark' as const;
const BG = TOKENS[THEME].land;
const LABELS = 'labels';

const TINY = tinyLimits();
/** Plan metres (x east, y north) of the boxes, inside the north block (y 80.96–141.92). */
const TALL = { x0: 2, y0: 84, x1: 14, y1: 92, h: 40 };
const LOW = { x0: 15, y0: 96, x1: 22, y1: 106, h: 10 };

function boxFeature(b: typeof TALL) {
  const ring = [
    toLngLat(b.x0, b.y0),
    toLngLat(b.x1, b.y0),
    toLngLat(b.x1, b.y1),
    toLngLat(b.x0, b.y1),
    toLngLat(b.x0, b.y0)
  ];
  return {
    type: 'Feature' as const,
    properties: { heightM: b.h },
    geometry: { type: 'Polygon' as const, coordinates: [ring] }
  };
}

const style: StyleSpecification = {
  version: 8,
  sources: {
    boxes: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [boxFeature(TALL), boxFeature(LOW)] }
    }
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': BG } },
    {
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'boxes',
      paint: {
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-base': 0,
        'fill-extrusion-color': TOKENS[THEME].existing,
        'fill-extrusion-opacity': 0.92
      }
    },
    // A label layer that draws nothing, so the overlay has a first symbol layer to go before.
    { id: LABELS, type: 'symbol', source: 'boxes', layout: {} }
  ]
};

/** Looking north from south of the boxes: the tall box stands between the camera and the lid. */
const CENTRE = toLngLat(10, 100);
const CAMERA = { center: CENTRE, zoom: 16.5, pitch: 60, bearing: 0 };

interface Frame {
  at(p: Px): Rgb;
}

const diff = (a: Rgb, b: Rgb) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

describe('HeightLimitsLayer depth against a MapLibre fill-extrusion, pitched 60°', () => {
  let host: HTMLDivElement;
  let map: MapLibreMap;
  let overlay: MapLibreOverlay;
  const errors: unknown[] = [];
  let withLids: Frame;
  let without: Frame;

  const deck = () => (overlay as unknown as { _deck: Deck })._deck;
  const live = () =>
    (deck() as unknown as { layerManager: { getLayers(): Layer[] } }).layerManager.getLayers();

  /** Canvas px of a point at height z metres, through deck's viewport (which follows the map). */
  const toPx = (ll: [number, number], z = 0): Px => {
    const [x, y] = deck().getViewports()[0].project([ll[0], ll[1], z]);
    return [x, y];
  };

  const idle = () =>
    new Promise<void>((r) => {
      map.once('idle', () => r());
      map.triggerRepaint();
    });

  /** Sets the overlay's layers, waits until every drawn layer is linked and the map idles, reads. */
  async function render(layers: Layer[]): Promise<Frame> {
    const beforeId = firstSymbolLayerId(map.getStyle());
    expect(beforeId).toBe(LABELS);
    overlay.setProps({ layers: layers.map((l) => l.clone({ beforeId } as never)) });
    const ready = () => {
      const all = live();
      if (all.filter((l) => !l.parent).length !== layers.length) return false;
      return all
        .filter((l) => !l.isComposite)
        .every(
          (l) =>
            l.state != null &&
            l.getModels().length > 0 &&
            l
              .getModels()
              .every((m) => (m.pipeline as { linkStatus?: string }).linkStatus !== 'pending')
        );
    };
    for (let i = 0; i < 200 && !ready(); i++) await idle();
    expect(ready()).toBe(true);
    await idle();
    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    const buf = new Uint8Array(CW * CH * 4);
    gl.readPixels(0, 0, CW, CH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return {
      at([x, y]) {
        if (!(x >= 0 && x < CW && y >= 0 && y < CH))
          throw new Error(`(${x}, ${y}) is off the canvas`);
        const i = 4 * ((CH - 1 - Math.floor(y)) * CW + Math.floor(x));
        return [buf[i], buf[i + 1], buf[i + 2]];
      }
    };
  }

  /** Canvas px of the point of `piece`'s rims nearest `ll`. */
  const rimPx = (lids: HeightLids, piece: number, ll: [number, number]): Px => {
    const { starts, positions: p, piece: owner } = lids.rims;
    let best: [number, number, number] = [0, 0, 0];
    let bestD = Infinity;
    for (let k = 0; k + 1 < starts.length; k++) {
      if (owner[k] !== piece) continue;
      for (let v = starts[k]; v < starts[k + 1]; v++) {
        const q: [number, number, number] = [p[3 * v], p[3 * v + 1], p[3 * v + 2]];
        const d = Math.hypot((q[0] - ll[0]) * M_PER_DEG_LNG, (q[1] - ll[1]) * M_PER_DEG_LAT);
        if (d < bestD) [best, bestD] = [q, d];
      }
    }
    return toPx([best[0], best[1]], best[2]);
  };

  // The tall box's south face, 11 m above the lid: the lid lies behind it along the ray.
  const tallBoxFacePx = () => toPx(toLngLat((TALL.x0 + TALL.x1) / 2, TALL.y0), 25);
  // The low box's roof, 3.8 m under the lid.
  const lowRoofPx = () => toPx(toLngLat((LOW.x0 + LOW.x1) / 2, (LOW.y0 + LOW.y1) / 2), LOW.h);
  // The north edge of the 4-story region, behind the tall box.
  const rimBehindTallPx = () => rimPx(TINY.lids, 0, toLngLat(6, 141.92));
  // The street, open ground under the lid that spans it.
  const groundPx = () => toPx(toLngLat(11.43, 70.96), 0);

  const expectSame = (a: Frame, b: Frame, p: () => Px, tol: number) => {
    const px = p();
    expect(
      diff(a.at(px), b.at(px)),
      `at ${px.map(Math.round)}: ${a.at(px)} vs ${b.at(px)}`
    ).toBeLessThanOrEqual(tol);
  };
  const expectDiffer = (a: Frame, b: Frame, p: () => Px, tol: number) => {
    const px = p();
    expect(
      diff(a.at(px), b.at(px)),
      `at ${px.map(Math.round)}: ${a.at(px)} vs ${b.at(px)}`
    ).toBeGreaterThanOrEqual(tol);
  };

  beforeAll(async () => {
    maplibregl.setWorkerUrl(workerUrl);
    host = document.createElement('div');
    host.style.cssText = `width:${CW}px;height:${CH}px`;
    document.body.appendChild(host);
    map = new maplibregl.Map({
      container: host,
      style,
      ...CAMERA,
      pixelRatio: 1,
      fadeDuration: 0,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { antialias: false, preserveDrawingBuffer: true }
    });
    map.on('error', (e) => errors.push(e.error));
    await new Promise<void>((r) => map.once('load', () => r()));
    overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
      deviceProps: { onError: (e: Error) => errors.push(e) },
      onError: (e: Error) => {
        errors.push(e);
      }
    });
    map.addControl(overlay);
    for (let i = 0; i < 200 && !deck().isInitialized; i++) await idle();
    expect(deck().isInitialized).toBe(true);
    without = await render([]);
    withLids = await render([
      heightLimitsLayer({ city: TINY.city, lids: TINY.lids, mode: { kind: 'plain' }, theme: THEME })
    ]);
  });

  afterAll(() => {
    map?.remove();
    host?.remove();
  });

  it('the scene is where the probes look', () => {
    const bg = hexToRgba(BG).slice(0, 3) as Rgb;
    // without lids: the face and the rim probe land on the tall box, the roof on the low box
    expect(diff(without.at(tallBoxFacePx()), bg)).toBeGreaterThan(10);
    expect(diff(without.at(rimBehindTallPx()), bg)).toBeGreaterThan(10);
    expect(diff(without.at(lowRoofPx()), bg)).toBeGreaterThan(10);
    expect(diff(without.at(groundPx()), bg)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  it('a lid behind a taller MapLibre building is hidden by it', () =>
    expectSame(withLids, without, tallBoxFacePx, 3));
  it('the roof of a MapLibre building under the lid is tinted', () =>
    expectDiffer(withLids, without, lowRoofPx, 6));
  it('the lid rim does not draw over the tall building', () =>
    expectSame(withLids, without, rimBehindTallPx, 3));
  it('open ground under the lid is tinted (the lid reads as up there, not a ground fill at pitch)', () =>
    expectDiffer(withLids, without, groundPx, 4));
});
