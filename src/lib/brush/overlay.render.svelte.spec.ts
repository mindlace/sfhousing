// Renders the real swath layer on a standalone Deck (no MapLibre) and compares its pixels with the
// exact swath: every segment drawn as its own round-capped path, whose union is the polyline's
// r-buffer. deck's PathLayer clamps a sharp joint's inner miter by the longer segment, so a
// near-reversal next to a short segment (the live tail, or a reversing kept point) used to lose
// the inner half of the longer segment and draw dark wedges: the brush "line" artefact.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Deck, MapView, type Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { quantize } from '$lib/plan';
import { buildOverlayLayers, metersPerPixel } from './overlay';

type P = [number, number];

const W = 480;
const H = 480;
const C: P = [quantize(-122.4194), quantize(37.7749)];
// The app's default framing is pitched and rotated (src/lib/map/camera.ts).
const VIEW = { longitude: C[0], latitude: C[1], zoom: 17, pitch: 55, bearing: -20 };
const R = 20;
const M_LNG = 1 / (111320 * Math.cos((C[1] * Math.PI) / 180));
const M_LAT = 1 / 110540;

/** The point `d` metres from `from` at heading `deg` (0 = east, counter-clockwise), quantised. */
const at = (from: P, d: number, deg: number): P => {
  const a = (deg * Math.PI) / 180;
  return [quantize(from[0] + d * Math.cos(a) * M_LNG), quantize(from[1] + d * Math.sin(a) * M_LAT)];
};

let deck: Deck<MapView> | null = null;
let canvas: HTMLCanvasElement | null = null;
let pending: { resolve: (px: Uint8Array) => void; layers: Layer[] } | null = null;

function getDeck(): Deck<MapView> {
  if (deck) return deck;
  canvas = document.createElement('canvas');
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  document.body.appendChild(canvas);
  const d = new Deck<MapView>({
    canvas,
    width: W,
    height: H,
    useDevicePixels: false,
    views: new MapView({ repeat: false }),
    viewState: VIEW,
    controller: false,
    layers: [],
    onAfterRender: ({ gl }) => {
      if (!pending) return;
      // Read only a frame that drew the requested layers: deck initialises a new layer just before
      // the frame that first draws it, so every one being loaded means this frame drew them all.
      if (!pending.layers.every((l) => l.isLoaded)) {
        setTimeout(() => deck?.redraw('swath-render-spec'));
        return;
      }
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const p = pending;
      pending = null;
      p.resolve(px);
    }
  });
  deck = d;
  return d;
}

afterAll(() => {
  deck?.finalize();
  canvas?.remove();
});

let seq = 0;
async function draw(layers: Layer[]): Promise<Uint8Array> {
  const d = getDeck();
  return new Promise<Uint8Array>((resolve) => {
    pending = { resolve, layers };
    d.setProps({ layers });
    d.redraw('swath-render-spec');
  });
}

const alphaAt = (px: Uint8Array, i: number) => px[i * 4 + 3];

/** The brush's own swath layer for `swath`, at its real opacity or opaque. */
function swathLayers(swath: P[], opacity?: number): Layer[] {
  return buildOverlayLayers({ PathLayer, ScatterplotLayer } as never, {
    tool: 'paint',
    ring: null,
    radiusM: R,
    swath,
    metersPerPixel: metersPerPixel(C[1], VIEW.zoom),
    dark: false
  }).map((l) => l.clone({ id: `brush-swath-${seq++}`, ...(opacity ? { opacity } : {}) }));
}

/** The exact r-buffer of `points`: each segment its own round-capped path (the union). */
function exactLayer(points: P[]): Layer {
  const segments: P[][] = [];
  for (let i = 0; i + 1 < points.length; i++) segments.push([points[i], points[i + 1]]);
  return new PathLayer({
    id: `exact-${seq++}`,
    data: segments,
    getPath: (d: unknown) => d as P[],
    widthUnits: 'meters',
    getWidth: 2 * R,
    capRounded: true,
    jointRounded: true,
    getColor: [0, 0, 0, 255]
  });
}

/**
 * Drawn swath (opaque) vs the exact r-buffer of the points it should draw: the pixels it leaves
 * out, and the pixels it draws outside.
 */
async function diff(swath: P[], expected: P[]) {
  const a = await draw(swathLayers(swath, 1));
  const b = await draw([exactLayer(expected)]);
  let missing = 0;
  let extra = 0;
  let exact = 0;
  for (let i = 0; i < W * H; i++) {
    const inA = alphaAt(a, i) > 8;
    const inB = alphaAt(b, i) > 8;
    if (inB) exact++;
    if (inB && !inA) missing++;
    if (inA && !inB) extra++;
  }
  return { missing, extra, exact };
}

let singleAlpha = 0;
/** Pixels of the swath at its real 25% opacity that deck blended twice (a darker wedge or sliver). */
async function doubled(swath: P[]): Promise<number> {
  const px = await draw(swathLayers(swath));
  let n = 0;
  for (let i = 0; i < W * H; i++) if (alphaAt(px, i) > singleAlpha + 24) n++;
  return n;
}

// Rasterisation differences between one path and per-segment caps stay under ~25 px here.
const TOLERANCE_PX = 40;

describe('swath rendering (standalone deck, pitched camera)', () => {
  const heading = 23;
  const p1 = C;
  const p0 = at(p1, 3 * R, heading + 180); // a long last kept segment (a fast drag)

  beforeAll(async () => {
    // The first frames after Deck creation can predate the canvas size; draw a few first.
    for (let i = 0; i < 3; i++) await draw([exactLayer([p0, p1])]);
    // One translucent layer's alpha where it covers a pixel once (its most common value).
    const px = await draw(swathLayers([p0, p1]));
    const counts = new Map<number, number>();
    for (let i = 0; i < W * H; i++) {
      const a = alphaAt(px, i);
      if (a > 0) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    singleAlpha = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
  });

  it('a live tail backing up 0.1 m (one quantum) leaves the swath whole, with no wedge', async () => {
    const swath = [p0, p1, at(p1, 0.11, heading + 150)];
    const d = await diff(swath, [p0, p1]);
    expect(d.exact).toBeGreaterThan(5000);
    expect(d.missing).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(d.extra).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(await doubled(swath)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  it('a live tail jittering back 0.15 m at 160° draws no darker half-disc', async () => {
    expect(await doubled([p0, p1, at(p1, 0.15, heading + 160)])).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  it('a live tail turning back by 135° leaves the swath whole', async () => {
    const swath = [p0, p1, at(p1, 1, heading + 135)];
    const d = await diff(swath, [p0, p1]);
    expect(d.exact).toBeGreaterThan(5000);
    expect(d.missing).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(d.extra).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  it('a reversing kept point after a long segment draws the whole r-buffer', async () => {
    const swath = [at(p1, 10 * R, heading + 180), p1, at(p1, R / 2 + 0.5, heading + 175)];
    const d = await diff(swath, swath);
    expect(d.exact).toBeGreaterThan(5000);
    expect(d.missing).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(d.extra).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  it('a zig-zag whose tail backs up draws the whole r-buffer of its kept points', async () => {
    const a = at(p1, 2 * R, heading + 180);
    const b = at(a, 3 * R, heading); // forward
    const c = at(b, 3 * R, heading + 175); // back
    const swath = [a, b, c, at(c, 0.3, heading - 10)]; // the tail backs up again
    const d = await diff(swath, [a, b, c]);
    expect(d.exact).toBeGreaterThan(5000);
    expect(d.missing).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(d.extra).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  it('a straight swath with a forward tail is drawn exactly, tail included', async () => {
    const swath = [p0, p1, at(p1, 2, heading)];
    const d = await diff(swath, swath);
    expect(d.exact).toBeGreaterThan(5000);
    expect(d.missing).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(d.extra).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(await doubled(swath)).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});
