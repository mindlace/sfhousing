// GPU test of HeightLimitsLayer (height-lids plan, Task 10): a standalone deck over a 128×64
// canvas, as fog-layer.gpu.svelte.spec.ts, with the tinyLimits() scene. Top-down, the glaze lies
// over open ground and low roofs but not over roofs above the lid, and the lid edge is ink.
// Zoomed out, contours draw and the glaze does not. Pitched, a wall shows its colour unless a box
// in front of it hides it. In rule mode a dimmed rim is lighter than a highlighted one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Deck, MapView, type Layer, type MapViewState, type Material } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { localFrame } from '$lib/generator/geo';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { SRC_FZP, SRC_RULE0 } from '$lib/sim/levers/source';
import { TOKENS, hexToRgba } from '../palette';
import type { Theme } from '../types';
import { LABEL_FONT_FAMILY, LABEL_H_PX, labelWidthPx } from './labels';
import {
  LIMITS_LAYER_ID,
  HeightLimitsLayer,
  LimitLabelsLayer,
  PAN_STEP_PX,
  heightLimitsLayer
} from './limits-layer';
import { GLAZE_ALPHA, type LimitsView } from './limits-style';
import { lotBlock, LOT_D, runLids, scene, tinyLimits, toLngLat } from './test/fixtures';
import type { HeightCity, HeightLids } from './types';

type Rgb = [number, number, number];

const CW = 128;
const CH = 64;
/** The clear colour (opaque magenta): unlike every limits token, so "nothing drawn" is visible. */
const BG: Rgb = [255, 0, 255];
/** Per-channel tolerance (0–255) for an opaque pixel: unlit flat colour, rounding only. */
const TOL = 2;
/** A blended pixel adds the blend's own rounding (8-bit source alpha, rounded result). */
const TOL_BLEND = TOL + 1;
const BOX_RGB: Rgb = [200, 80, 40];

/** `c` at alpha `a` over BG (deck's SRC_ALPHA, ONE_MINUS_SRC_ALPHA). */
const over = (c: Rgb, a: number): Rgb => c.map((v, i) => a * v + (1 - a) * BG[i]) as Rgb;
/** `top` at alpha `a` over `under`. */
const mix = (under: Rgb, top: Rgb, a: number): Rgb =>
  under.map((v, i) => a * top[i] + (1 - a) * v) as Rgb;

const token = (theme: Theme, name: 'limit-ink' | 'limit-glaze' | 'limit-wall') => {
  const [r, g, b, a] = hexToRgba(TOKENS[theme][name]);
  return { rgb: [r, g, b] as Rgb, a: a / 255 };
};

const TINY = tinyLimits();
/** Lots are 7.62 m wide and 30.48 m deep; the 20 m street runs y 60.96–80.96, x 0–22.86. */
const STREET = toLngLat(11.43, 70.96);
/** Lid heights (storiesToM): 4 stories 13.8 m, 6 stories 20 m. */
const Z4 = 13.8;

/** The glaze alpha of the piece whose face holds `ll` (the 4-story region here). */
function glazeAt(lids: HeightLids, ll: [number, number], theme: Theme): number {
  for (const f of lids.faces) {
    if (!inRings(f.rings, ll)) continue;
    const step = lids.pieces.glaze[f.piece];
    return (Math.round(token(theme, 'limit-glaze').a * 255 * GLAZE_ALPHA[step]) / 255) as number;
  }
  throw new Error('no face holds the point');
}
function inRings(rings: Float64Array[], [x, y]: [number, number]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const [xi, yi, xj, yj] = [r[i], r[i + 1], r[j], r[j + 1]];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
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
    id: `box-${at.join(',')}-${heightM}`,
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

/** Camera altitude 6 viewport heights (≈ 181 m at z17), above every roof and lid here. */
const view = (at: [number, number], zoom: number, pitch = 0, bearing = 0) =>
  ({ longitude: at[0], latitude: at[1], zoom, pitch, bearing, altitude: 6 }) as MapViewState;

const limits = (
  data: { city: HeightCity; lids: HeightLids } = TINY,
  mode: LimitsView = { kind: 'plain' },
  theme: Theme = 'light'
) => heightLimitsLayer({ city: data.city, lids: data.lids, mode, theme });

describe('HeightLimitsLayer on the GPU', () => {
  let canvas: HTMLCanvasElement;
  let deck: Deck<MapView>;
  let gl: WebGL2RenderingContext;
  const errors: Error[] = [];

  const live = () =>
    (deck as unknown as { layerManager: { getLayers(): Layer[] } }).layerManager.getLayers();

  /** Sets the layers, waits until deck has initialised and linked every drawn layer, then reads. */
  async function render(layers: Layer[], viewState: MapViewState) {
    deck.setProps({ layers, viewState });
    const ready = () => {
      const all = live();
      if (!layers.every((l) => all.includes(l))) return false;
      const drawn = all.filter((l) => !l.isComposite);
      return drawn.every(
        (l) =>
          l.state != null &&
          l.getModels().length > 0 &&
          l
            .getModels()
            .every((m) => (m.pipeline as { linkStatus?: string }).linkStatus !== 'pending')
      );
    };
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
      /** The pixel holding (x, y) in canvas px (top-left origin). */
      at(x: number, y: number): Rgb {
        const i = 4 * ((CH - 1 - Math.floor(y)) * CW + Math.floor(x));
        return [buf[i], buf[i + 1], buf[i + 2]];
      }
    };
  }

  /** Canvas px of a point, at height z metres. */
  const toPx = (ll: [number, number], z = 0): [number, number] => {
    const [x, y] = deck.getViewports()[0].project([ll[0], ll[1], z]);
    return [x, y];
  };
  /**
   * Canvas px of the point of `piece`'s rims nearest `ll` (rims follow the 2 m lid raster, so a
   * lot edge's rim can sit up to a metre off the lot line).
   */
  const rimPx = (lids: HeightLids, piece: number, ll: [number, number]): [number, number] => {
    const { starts, positions: p, piece: owner } = lids.rims;
    const [mx, my] = [M_PER_DEG_LNG, M_PER_DEG_LAT];
    let best: [number, number, number] = [0, 0, 0];
    let bestD = Infinity;
    for (let k = 0; k + 1 < starts.length; k++) {
      if (owner[k] !== piece) continue;
      for (let v = starts[k]; v + 1 < starts[k + 1]; v++) {
        const [ax, ay, az, bx, by] = [
          p[3 * v],
          p[3 * v + 1],
          p[3 * v + 2],
          p[3 * v + 3],
          p[3 * v + 4]
        ];
        const dx = (bx - ax) * mx;
        const dy = (by - ay) * my;
        const len2 = dx * dx + dy * dy;
        const t =
          len2 === 0
            ? 0
            : Math.max(0, Math.min(1, ((ll[0] - ax) * mx * dx + (ll[1] - ay) * my * dy) / len2));
        const q: [number, number, number] = [ax + (bx - ax) * t, ay + (by - ay) * t, az];
        const d = Math.hypot((q[0] - ll[0]) * mx, (q[1] - ll[1]) * my);
        if (d < bestD) [best, bestD] = [q, d];
      }
    }
    return toPx([best[0], best[1]], best[2]);
  };
  const subIds = () => live().map((l) => l.id);

  const expectPx = (got: Rgb, want: Rgb, tol: number) =>
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
        viewState: view(STREET, 17),
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
    '%s top-down z17: open ground under a lid is the glaze over the ground',
    async (theme) => {
      const px = await render([limits(TINY, { kind: 'plain' }, theme)], view(STREET, 17));
      const glaze = token(theme, 'limit-glaze');
      expectPx(
        px.at(...toPx(STREET, Z4)),
        over(glaze.rgb, glazeAt(TINY.lids, STREET, theme)),
        TOL_BLEND
      );
      expect(errors).toEqual([]);
    }
  );

  it('a roof above the lid is untinted; a roof below it is tinted', async () => {
    const tallAt = toLngLat(2, 70.96);
    const lowAt = toLngLat(20, 70.96);
    const px = await render(
      [solidBox(tallAt, 30, BOX_RGB), solidBox(lowAt, 6, BOX_RGB), limits()],
      view(STREET, 17)
    );
    expectPx(px.at(...toPx(tallAt, 30)), BOX_RGB, TOL);
    const glaze = token('light', 'limit-glaze');
    expectPx(
      px.at(...toPx(lowAt, 6)),
      mix(BOX_RGB, glaze.rgb, glazeAt(TINY.lids, lowAt, 'light')),
      TOL_BLEND
    );
    expect(errors).toEqual([]);
  });

  it('the lid edge draws ink', async () => {
    const px = await render([limits()], view(STREET, 17));
    // the west edge of the 4-story region (x = 0) at the street's latitude
    expectPx(
      px.at(...rimPx(TINY.lids, 0, toLngLat(0, 70.96))),
      token('light', 'limit-ink').rgb,
      TOL_BLEND
    );
    expect(errors).toEqual([]);
  });

  it('z13: contours draw, glaze does not', async () => {
    // A 305 × 244 m block of one limit: at z13 (≈ 15 m/px) its contour runs ≥ 8 px from the
    // centre, clear of the centre pixel, and its one contour label sits on the contour.
    const sc = scene(lotBlock(0, 0, 40, 8, () => ({ existing: 1 })));
    const big = { city: sc.city, lids: runLids(sc.input) };
    const centre = toLngLat(152.4, 121.92);
    const px = await render([limits(big)], view(centre, 13));
    expect(subIds()).toContain(`${LIMITS_LAYER_ID}-contours`);
    // hidden, not dropped: deck keeps the lid sublayers' GPU state across the fade
    const glazeLayer = live().find((l) => l.id === `${LIMITS_LAYER_ID}-glaze`);
    expect(glazeLayer?.props.visible).toBe(false);
    expect(live().find((l) => l.id === `${LIMITS_LAYER_ID}-contours`)?.props.visible).toBe(true);
    // the contour's longest segment, at its midpoint
    const { starts, positions } = big.city.chains;
    let best = -1;
    let bestLen = 0;
    for (let v = starts[0]; v + 1 < starts[1]; v++) {
      const d = Math.hypot(
        positions[2 * v + 2] - positions[2 * v],
        positions[2 * v + 3] - positions[2 * v + 1]
      );
      if (d > bestLen) [best, bestLen] = [v, d];
    }
    const mid: [number, number] = [
      (positions[2 * best] + positions[2 * best + 2]) / 2,
      (positions[2 * best + 1] + positions[2 * best + 3]) / 2
    ];
    expectPx(px.at(...toPx(mid)), token('light', 'limit-ink').rgb, TOL_BLEND);
    expectPx(px.at(...toPx(centre)), BG, TOL);
    expect(errors).toEqual([]);
  });

  describe('pitched 60°', () => {
    // The 6-story exception's west wall (x = 7.62, y 0–30.48, 13.8–20 m), seen from the south-west.
    const wallAt = toLngLat(7.62, 5);
    const wallZ = 17;
    // The view centre is the ground point ~29 m on along the line of sight, so the wall point lands
    // near the canvas centre; the region's label sits ~20 px above it.
    const pitched = view(toLngLat(7.62 + 20.8, 5 + 20.8), 17, 60, 45);

    it('the wall between 4 and 6 stories shows the wall colour', async () => {
      const px = await render([limits()], pitched);
      const wall = token('light', 'limit-wall');
      expectPx(px.at(...toPx(wallAt, wallZ)), over(wall.rgb, wall.a), TOL_BLEND);
      expect(errors).toEqual([]);
    });

    it('a box in front hides it', async () => {
      const px = await render([solidBox(toLngLat(-6, -9), 40, BOX_RGB), limits()], pitched);
      expectPx(px.at(...toPx(wallAt, wallZ)), BOX_RGB, TOL);
      expect(errors).toEqual([]);
    });
  });

  it('rule mode: a dimmed rim is lighter than a highlighted one', async () => {
    // 4 stories by FZP south of a 20 m street, 6 stories by rule 'r' north of it.
    const north = 2 * LOT_D + 20;
    const sc = scene(
      [
        ...lotBlock(0, 0, 3, 2, () => ({ stories: 4, src: SRC_FZP })),
        ...lotBlock(0, north, 3, 2, () => ({ stories: 6, src: SRC_RULE0 }))
      ],
      { sourceIds: ['r'] }
    );
    const data = { city: sc.city, lids: runLids(sc.input) };
    const px = await render([limits(data, { kind: 'rule', ruleId: 'r' })], view(STREET, 17));
    const dimmed = px.at(...rimPx(data.lids, 0, toLngLat(11.43, 2 * LOT_D))); // FZP, north edge
    const full = px.at(...rimPx(data.lids, 1, toLngLat(11.43, north))); // rule 'r', south edge
    const sum = (c: Rgb) => c[0] + c[1] + c[2];
    expectPx(full, token('light', 'limit-ink').rgb, TOL_BLEND);
    expect(sum(dimmed)).toBeGreaterThan(sum(full) + 100);
    expect(errors).toEqual([]);
  });

  it('paint mode draws the paint pieces dashed; plain does not', async () => {
    await render([limits(TINY, { kind: 'paint' })], view(STREET, 17));
    expect(subIds()).toContain(`${LIMITS_LAYER_ID}-rims-dashed`);
    await render([limits()], view(STREET, 17));
    expect(subIds()).not.toContain(`${LIMITS_LAYER_ID}-rims-dashed`);
  });

  it('zooming across the fade keeps the sublayers and their GPU state', async () => {
    const find = (id: string) => live().find((l) => l.id === `${LIMITS_LAYER_ID}-${id}`);
    await render([limits()], view(STREET, 13));
    const glaze = find('glaze')!.getModels()[0];
    const walls = find('walls')!.getModels()[0];
    expect(find('glaze')!.props.visible).toBe(false);
    await render([limits()], view(STREET, 17));
    expect(find('glaze')!.props.visible).toBe(true);
    expect(find('glaze')!.getModels()[0]).toBe(glaze);
    expect(find('walls')!.getModels()[0]).toBe(walls);
    const contours = find('contours')!.getModels()[0];
    expect(find('contours')!.props.visible).toBe(false);
    await render([limits()], view(STREET, 13));
    expect(find('contours')!.getModels()[0]).toBe(contours);
    expect(errors).toEqual([]);
  });

  type Shown = { text: string; position: [number, number, number] };
  const shownLabels = () =>
    (live().find((l) => l.id === `${LIMITS_LAYER_ID}-lid-labels-text`)?.props.data ??
      []) as Shown[];

  it('labels draw in the system sans with a visible halo', async () => {
    const i = TINY.lids.labels.minZoom.findIndex((z) => z <= 17);
    const p = TINY.lids.labels.position;
    const at: [number, number] = [p[3 * i], p[3 * i + 1]];
    const px = await render([limits(TINY, { kind: 'plain' }, 'light')], view(at, 17));
    const text = live().find((l) => l.id === `${LIMITS_LAYER_ID}-lid-labels-text`)!;
    expect((text.props as { fontFamily?: string }).fontFamily).toBe(LABEL_FONT_FAMILY);
    const halo = hexToRgba(TOKENS.light['limit-halo']);
    let n = 0;
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const c = px.at(x, y);
        if (c.every((v, k) => Math.abs(v - halo[k]) <= 8)) n++;
      }
    // a 2 px halo round the glyphs of one label: well over a hundred pixels (a 0.3 px one: none)
    expect(n).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });

  it('pitched, the paint-mode labels shown never overlap on screen', async () => {
    // A region's paint part and rest labelled 12 m apart north-south at one height: clear of each
    // other top-down (about 50 px at z18), squeezed together once pitched.
    const north = 12 / M_PER_DEG_LAT;
    const lids: HeightLids = {
      ...TINY.lids,
      paintLabels: {
        text: ['4 stories · +16 floors', '4 stories · +41 floors'],
        position: Float64Array.of(STREET[0], STREET[1], Z4, STREET[0], STREET[1] + north, Z4),
        minZoom: Uint8Array.of(15, 15)
      }
    };
    for (const [zoom, pitch, bearing] of [
      [18, 0, 0],
      [17, 60, -20],
      [18, 70, 0],
      [18, 60, 90]
    ]) {
      await render(
        [limits({ ...TINY, lids }, { kind: 'paint' })],
        view(STREET, zoom, pitch, bearing)
      );
      const shown = shownLabels();
      if (pitch === 0) expect(shown).toHaveLength(2);
      const boxes = shown.map((l) => {
        const [x, y] = toPx([l.position[0], l.position[1]], l.position[2]);
        return { x, y, hw: labelWidthPx(l.text) / 2, hh: LABEL_H_PX / 2 };
      });
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [p, q] = [boxes[i], boxes[j]];
          const overlap = Math.abs(p.x - q.x) < p.hw + q.hw && Math.abs(p.y - q.y) < p.hh + q.hh;
          expect(overlap, `z${zoom} pitch ${pitch} bearing ${bearing}`).toBe(false);
        }
    }
    expect(errors).toEqual([]);
  });

  it('is `sim-height-limits`, a HeightLimitsLayer', () => {
    const layer = limits();
    expect(layer).toBeInstanceOf(HeightLimitsLayer);
    expect(layer.id).toBe(LIMITS_LAYER_ID);
    expect(LIMITS_LAYER_ID).toBe('sim-height-limits');
  });

  it('a viewport change updates only across an integer zoom or inside the fade', () => {
    const layer = limits();
    const should = (was: number, zoom: number) => {
      layer.state = { zoom: was } as HeightLimitsLayer['state'];
      return layer.shouldUpdateState({
        changeFlags: { viewportChanged: true, propsOrDataChanged: false },
        context: { viewport: { zoom } }
      } as unknown as Parameters<HeightLimitsLayer['shouldUpdateState']>[0]);
    };
    expect(should(16.2, 16.7)).toBe(false);
    expect(should(16.7, 17.1)).toBe(true);
    expect(should(15.0, 15.2)).toBe(true);
    expect(should(15.4, 15.6)).toBe(true);
    expect(should(13.2, 13.9)).toBe(false);
  });

  it('a pitch, bearing or pitched long-pan step reruns the label layer only; a flat pan never', () => {
    const vp = (o: Record<string, number>) => ({
      zoom: 16.2,
      pitch: 30,
      bearing: 0,
      longitude: STREET[0],
      latitude: STREET[1],
      width: 800,
      height: 600,
      ...o
    });
    const labels = new LimitLabelsLayer({
      id: 'x',
      set: TINY.lids.labels,
      ink: [0, 0, 0, 255],
      halo: [255, 255, 255, 255]
    });
    const shouldLabels = (was: Record<string, number>, now: Record<string, number>) => {
      labels.state = { key: LimitLabelsLayer.labelKey(vp(was)) };
      return labels.shouldUpdateState({
        changeFlags: { viewportChanged: true, propsOrDataChanged: false },
        context: { viewport: vp(now) }
      } as unknown as Parameters<LimitLabelsLayer['shouldUpdateState']>[0]);
    };
    const parent = limits();
    const shouldParent = (now: Record<string, number>) => {
      parent.state = { zoom: 16.2 } as HeightLimitsLayer['state'];
      return parent.shouldUpdateState({
        changeFlags: { viewportChanged: true, propsOrDataChanged: false },
        context: { viewport: vp(now) }
      } as unknown as Parameters<HeightLimitsLayer['shouldUpdateState']>[0]);
    };
    const far = { longitude: STREET[0] + 0.02, latitude: STREET[1] + 0.02 };
    expect(shouldLabels({}, { longitude: STREET[0] + 1e-5 })).toBe(false);
    expect(shouldLabels({}, { pitch: 45 })).toBe(true);
    expect(shouldLabels({}, { bearing: 30 })).toBe(true);
    expect(shouldLabels({}, far)).toBe(true);
    expect(shouldLabels({ pitch: 0 }, { pitch: 0, ...far })).toBe(false);
    for (const now of [{ pitch: 45 }, { bearing: 30 }, far] as Record<string, number>[])
      expect(shouldParent(now)).toBe(false);
    // each axis steps at its own scale: PAN_STEP_PX at the integer zoom, east-west as north-south
    const key = (lng: number, lat: number) =>
      LimitLabelsLayer.labelKey(vp({ longitude: lng, latitude: lat })).split(':');
    const stepM = PAN_STEP_PX * ((78271.517 * 0.7906233208295852) / 2 ** 16);
    const lngKey = (d: number) => Number(key(STREET[0] + d / M_PER_DEG_LNG, STREET[1])[3]);
    const latKey = (d: number) => Number(key(STREET[0], STREET[1] + d / M_PER_DEG_LAT)[4]);
    expect(lngKey(stepM) - lngKey(0)).toBe(1);
    expect(latKey(stepM) - latKey(0)).toBe(1);
  });

  it('a pan inside a key step, and one across it keeping the kept set, keep the text data and rebuild no lid sublayer', async () => {
    const i = TINY.lids.labels.minZoom.findIndex((z) => z <= 17);
    const p = TINY.lids.labels.position;
    const at: [number, number] = [p[3 * i], p[3 * i + 1]];
    const layer = limits();
    const find = (id: string) => live().find((l) => l.id === `${LIMITS_LAYER_ID}-${id}`)!;
    const keyAt = (lng: number) =>
      LimitLabelsLayer.labelKey({ ...view([lng, at[1]], 17, 30), width: CW, height: CH });
    // the first lng east of `at` where the key changes
    const dLng = 1 / M_PER_DEG_LNG; // 1 m
    let b = 0;
    while (keyAt(at[0] + b * dLng) === keyAt(at[0]) && b < 2000) b++;
    expect(b).toBeLessThan(2000);
    const before = at[0] + (b - 1) * dLng;
    const after = at[0] + b * dLng;
    await render([layer], view([before, at[1]], 17, 30));
    // a composite updates on the frame after a viewport change
    await render([layer], view([before, at[1]], 17, 30));
    const text0 = find('lid-labels-text');
    const data0 = text0.props.data;
    expect((data0 as unknown[]).length).toBeGreaterThan(0);
    const [glaze, walls, rims] = [find('glaze'), find('walls'), find('rims')];
    const labelLayer = find('lid-labels');
    const key0 = (labelLayer.state as { key: string }).key;
    // inside the step
    await render([layer], view([before - 0.3 * dLng, at[1]], 17, 30));
    // a composite updates on the frame after a viewport change
    await render([layer], view([before - 0.3 * dLng, at[1]], 17, 30));
    expect(find('lid-labels-text').props.data).toBe(data0);
    // across it
    await render([layer], view([after, at[1]], 17, 30));
    // a composite updates on the frame after a viewport change
    await render([layer], view([after, at[1]], 17, 30));
    expect((find('lid-labels').state as { key: string }).key).not.toBe(key0);
    expect(find('lid-labels-text').props.data).toBe(data0);
    expect(find('glaze')).toBe(glaze);
    expect(find('walls')).toBe(walls);
    expect(find('rims')).toBe(rims);
    expect(errors).toEqual([]);
  });

  it('zooming through the fade at one integer zoom reruns no collision and keeps the text data', async () => {
    // one lid label shown from z15, at the view centre
    const lids: HeightLids = {
      ...TINY.lids,
      labels: {
        text: ['4 stories · +16 floors'],
        position: Float64Array.of(STREET[0], STREET[1], Z4),
        minZoom: Uint8Array.of(15)
      }
    };
    const layer = limits({ ...TINY, lids });
    const find = (id: string) => live().find((l) => l.id === `${LIMITS_LAYER_ID}-${id}`)!;
    const shownMemo = () => (find('lid-labels').state as { shown: unknown }).shown;
    const at = (zoom: number) => view(STREET, zoom, 30);
    await render([layer], at(15.1));
    await render([layer], at(15.1));
    const data0 = find('lid-labels-text').props.data;
    const memo0 = shownMemo();
    expect((data0 as unknown[]).length).toBeGreaterThan(0);
    const op0 = find('lid-labels').props.opacity;
    const runs = LimitLabelsLayer.collisions;
    for (const zoom of [15.2, 15.3, 15.45]) {
      await render([layer], at(zoom));
      await render([layer], at(zoom));
      expect(find('lid-labels').props.opacity).not.toBe(op0);
      expect(LimitLabelsLayer.collisions).toBe(runs);
      expect(shownMemo()).toBe(memo0);
      expect(find('lid-labels-text').props.data).toBe(data0);
    }
    expect(errors).toEqual([]);
  });
});
