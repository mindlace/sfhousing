// GPU test of TimelapseExtension (spec §6 `timelapse-extension.gpu`): a standalone deck over a
// 64×64 canvas renders one 4-slot timeline cell; the pixel at each part's centre must fall in the
// colour class that `evalPart` (the CPU reference) gives for that part and day.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Deck, MapView, type Layer, type MapViewState, type Material } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { TimelapseExtension, type TimelapseExtensionProps } from './extension';
import { encodeParts, partAttrs, type EncodedParts } from './encode';
import { evalPart } from './state';
import { GHOST_ALPHA } from './constants';
import type { PartEval, TimelineClock } from './types';
import { packTimedCell, type TimedPackInput } from '../pack-timed';
import { appearanceColor } from '../appearance';
import { TOKENS, hexToRgba, type RGBA } from '../palette';
import { TYPOLOGY_ORDER, type Theme, type TimedPackedCell } from '../types';
import { timelineLookups } from '../fixtures/timeline-lookups';
import { localFrame } from '$lib/generator/geo';
import type { GeneratedBuilding, TypologyId } from '$lib/generator';
import type { Massing, Schedule } from '$lib/sim/scenario/types';

const SIZE = 64;
const CENTRE: [number, number] = [-122.42, 37.77];
const FRAME = localFrame(CENTRE);
/** Base day; schedule days below are offsets from it. */
const B = 20000;
/** The clear colour behind every part (opaque white). */
const BG: [number, number, number] = [255, 255, 255];
/** Per-channel tolerance (0–255) for a pixel to match its class prototype. */
const TOL = 6;

/** A rectangle ring (half-sizes `hx`, `hy`; default a 20 m square) centred `(x, y)` metres from
 *  CENTRE, as lng/lat. */
function square(x: number, y: number, hx = 10, hy = 10): [number, number][] {
  return [
    [x - hx, y - hy],
    [x - hx, y + hy],
    [x + hx, y + hy],
    [x + hx, y - hy]
  ].map(([px, py]) => FRAME.to(px, py));
}

function building(typology: TypologyId, stories: number, ring: [number, number][]) {
  const ground = typology === 'midrise' ? 4.5 : 3.1;
  const b: GeneratedBuilding = {
    parcelId: `p-${typology}-${stories}`,
    source: 'user',
    typology,
    composition: 'simple',
    parts: [
      { footprint: ring, role: 'occupied', tone: 0, baseM: 0, topM: ground + (stories - 1) * 3.1 }
    ],
    stories,
    units: 10 * stories,
    floorAreaM2: 400 * stories,
    replacesExisting: true
  };
  return b;
}

function item(
  projectId: string,
  pathway: Schedule['pathway'],
  entered: Schedule['entered'],
  end: Schedule['end'],
  massings: Massing[],
  revDays: number[] = [Math.min(...Object.values(entered))]
): TimedPackInput {
  return {
    schedule: {
      projectId,
      origin: 'simulated',
      parcelIds: [projectId],
      pathway,
      entered,
      end,
      revisions: massings.map((m, i) => ({
        day: revDays[i],
        units: 40,
        stories: 'parts' in m ? m.stories : null
      })),
      existingUnits: 1,
      multiPhase: false,
      phase: null
    },
    massings,
    pickParcelId: projectId
  };
}

// Four slots in projectId order: fx-1 completes (SW), fx-2 exits before construction (SE),
// fx-3 dies in construction (NW), fx-4 is footprint-only and completes (NE). Each has one
// square part, except fx-2: its two revisions are side by side (west half, then east half from
// day +200), so its revision-0 part is hidden by its part window alone while the revision-1
// part is visible. Part order: 0 fx-1, 1 fx-2 rev 0, 2 fx-2 rev 1, 3 fx-3, 4 fx-4.
const CELL: TimedPackedCell = packTimedCell('gpu-test', [
  item(
    'fx-1',
    'discretionary',
    {
      filed: B + 100,
      entitled: B + 200,
      permitIssued: B + 300,
      construction: B + 400,
      complete: B + 1200
    },
    { kind: 'complete', day: B + 1200 },
    [building('walkup', 5, square(-14, -14))]
  ),
  item(
    'fx-2',
    'streamlined',
    { filed: B + 100, entitled: B + 150, permitFiled: B + 180 },
    { kind: 'exit', stage: 'permitFiled', reason: 'withdrawn', day: B + 250 },
    [building('plex', 3, square(9, -14, 5, 10)), building('plex', 4, square(19, -14, 5, 10))],
    [B + 100, B + 200]
  ),
  item(
    'fx-3',
    'discretionary',
    { filed: B + 100, entitled: B + 200, permitIssued: B + 300, construction: B + 350 },
    { kind: 'exit', stage: 'construction', reason: 'cancelled', day: B + 750 },
    [building('midrise', 5, square(-14, 14))]
  ),
  item(
    'fx-4',
    'permitOnly',
    { permitFiled: B + 150, permitIssued: B + 300, construction: B + 400, complete: B + 1200 },
    { kind: 'complete', day: B + 1200 },
    [{ footprint: square(14, 14) }]
  )
]);
const ENC: EncodedParts = encodeParts(CELL, timelineLookups);
const PARTS = CELL.partCount;
const FILL: RGBA[] = Array.from({ length: PARTS }, (_, k) =>
  appearanceColor('light', TYPOLOGY_ORDER[CELL.partTypology[k]], CELL.partAppearance[k])
);

/** 12 days (offsets from B) covering every rule; the comment is what `evalPart` gives. */
const DAYS = [
  50, // all hidden: before ghostFrom
  120, // planning ×3 (fx-2 rev 1 hidden: before its window); fx-4 hidden (later first stage)
  160, // fx-2 rev 0 and fx-4 permit; fx-1, fx-3 planning
  220, // permit ×4; fx-2 rev 0 hidden by its window's end, its rev 1 part visible from +200
  280, // fx-2 dying, hold (age 30)
  320, // ready ×3 (fx-2 still dying, hold)
  380, // fx-3 constructing below the first floor (zCut 0); fx-2 dying, fade
  600, // fx-1, fx-3 constructing above zCut; fx-2 hidden after death; fx-4 footprint ready
  800, // fx-3 dying with frozen construction floors (hold)
  950, // fx-3 dying, fade, floors frozen
  1100, // fx-1 floors capped at 0.9; fx-3 hidden after death
  1250 // fx-1 complete; fx-4 footprint at completion keeps the ready tint
].map((d) => B + d);

type PixelClass = 'hidden' | 'planning' | 'permit' | 'ready' | 'palette' | 'dying' | 'dying-floor';

/** The class seen top-down: a constructing part shows its ghost (ready) roof above zCut. */
function expectedClass(e: PartEval): PixelClass {
  if (e.state === 'constructing') return 'ready';
  if (e.state === 'complete') return 'palette';
  return e.state;
}

/** The class of a side-wall point `h` metres up, seen from outside (§4.2.3 fragment table). */
function expectedSideClass(e: PartEval, h: number): PixelClass {
  if (e.state === 'constructing') return h < e.zCutM ? 'palette' : 'ready';
  if (e.state === 'dying' && h < e.zCutM) return 'dying-floor';
  return expectedClass(e);
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => hexToRgba(hex).slice(0, 3) as Rgb;
/** `c` at alpha `a` over the opaque background (deck's SRC_ALPHA, ONE_MINUS_SRC_ALPHA). */
const over = (c: Rgb, a: number): Rgb => c.map((v, i) => a * v + (1 - a) * BG[i]) as Rgb;

/** Each class's expected pixel for part `k` on a day where `evalPart` gives `e`. */
function prototypes(theme: Theme, k: number, e: PartEval): Record<PixelClass, Rgb> {
  const t = TOKENS[theme];
  const a = GHOST_ALPHA[theme];
  const f = e.state === 'dying' ? e.alpha : 1;
  const fill = FILL[k].slice(0, 3) as Rgb;
  const dying = rgb(t['tl-ghost-dying']);
  return {
    hidden: BG,
    planning: over(rgb(t['tl-ghost-planning']), a),
    permit: over(rgb(t['tl-ghost-permit']), a),
    ready: over(rgb(t['tl-ghost-ready']), a),
    palette: fill,
    dying: over(dying, 1.5 * a * f),
    'dying-floor': over(fill.map((v, i) => 0.4 * v + 0.6 * dying[i]) as Rgb, f)
  };
}

/** The nearest prototype within TOL, or 'unmatched'. */
function classify(px: number[], protos: Record<PixelClass, Rgb>): PixelClass | 'unmatched' {
  let best: PixelClass | 'unmatched' = 'unmatched';
  let bestD = Infinity;
  for (const [name, p] of Object.entries(protos) as [PixelClass, Rgb][]) {
    const d = Math.max(...p.map((v, i) => Math.abs(v - px[i])));
    if (d < bestD) [best, bestD] = [name, d];
  }
  return bestD <= TOL ? best : 'unmatched';
}

const VIEW_STATE: MapViewState = {
  longitude: CENTRE[0],
  latitude: CENTRE[1],
  zoom: 16,
  pitch: 0,
  bearing: 0
};

describe('TimelapseExtension on the GPU', () => {
  let canvas: HTMLCanvasElement;
  let deck: Deck<MapView>;
  let gl: WebGL2RenderingContext;
  const errors: Error[] = [];
  const clock: TimelineClock = { day: B, theme: 'light' };
  const ext = new TimelapseExtension({ clock });
  let layers: Layer[];

  const accessors = {
    getTlA: (_: unknown, { index }: { index: number }) =>
      Array.from(ENC.tlA.subarray(4 * index, 4 * index + 4)),
    getTlB: (_: unknown, { index }: { index: number }) =>
      Array.from(ENC.tlB.subarray(4 * index, 4 * index + 4)),
    getTlC: (_: unknown, { index }: { index: number }) =>
      Array.from(ENC.tlC.subarray(4 * index, 4 * index + 4))
  };
  const data = {
    length: PARTS,
    startIndices: CELL.startIndices,
    attributes: { getPolygon: { value: CELL.positions, size: 2 } }
  };
  function cellLayer(pass: 0 | 1) {
    return new SolidPolygonLayer<unknown, TimelapseExtensionProps>({
      id: pass === 0 ? 'timeline-solid-gpu-test' : 'timeline-ghost-gpu-test',
      data,
      extruded: true,
      _normalize: false,
      _windingOrder: 'CW',
      elevationScale: 1,
      // Unlit so each class has one exact colour; lighting is deck's, not the extension's. luma's
      // gouraud material takes `unlit` (gouraud-material.ts), though deck's Material type omits it.
      material: { unlit: true } as Material,
      getElevation: (_: unknown, { index }: { index: number }) => CELL.partTopM[index],
      getFillColor: (_: unknown, { index }: { index: number }) => FILL[index],
      pickable: true,
      extensions: [ext],
      timelapsePass: pass,
      ...accessors,
      ...(pass === 1 ? { parameters: { depthWriteEnabled: false } } : {})
    });
  }

  beforeAll(async () => {
    canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    document.body.appendChild(canvas);
    layers = [cellLayer(0), cellLayer(1)];
    await new Promise<void>((resolve) => {
      let loaded = false;
      deck = new Deck<MapView>({
        canvas,
        width: SIZE,
        height: SIZE,
        useDevicePixels: false,
        deviceProps: {
          webgl: { preserveDrawingBuffer: true },
          // luma 9.4 reports a shader compile or link failure here, not through deck's onError
          // (webgl-shared-render-pipeline.ts `_reportLinkStatus` → `device.reportError`).
          onError: (e: Error) => {
            errors.push(e);
          }
        },
        views: new MapView({ clear: true, clearColor: [...BG, 255] }),
        viewState: VIEW_STATE,
        controller: false,
        layers,
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
    // Linking may finish asynchronously (KHR_parallel_shader_compile); a pending pipeline skips
    // its draws. Wait for every pipeline to settle, then let a failure's report reach `errors`.
    for (let i = 0; i < 200 && linkStatuses().includes('pending'); i++) {
      deck.redraw('link');
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 10));
  });

  /** Each layer model's pipeline link status (luma WEBGLRenderPipeline). */
  function linkStatuses(): string[] {
    return layers.flatMap((l) =>
      l.getModels().map((m) => String((m.pipeline as { linkStatus?: string }).linkStatus))
    );
  }

  afterAll(() => {
    deck?.finalize();
    canvas?.remove();
  });

  function readAt(x: number, y: number): number[] {
    const px = new Uint8Array(4);
    gl.readPixels(Math.round(x), SIZE - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [...px];
  }

  /** Part `k`'s roof centre in canvas pixels (top-left origin). */
  function roofCentre(k: number): [number, number] {
    // The centre of the lng/lat bounding box: a closing duplicate vertex cannot bias it.
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let v = CELL.startIndices[k]; v < CELL.startIndices[k + 1]; v++) {
      const [x, y] = [CELL.positions[2 * v], CELL.positions[2 * v + 1]];
      [x0, x1] = [Math.min(x0, x), Math.max(x1, x)];
      [y0, y1] = [Math.min(y0, y), Math.max(y1, y)];
    }
    const [px, py] = deck
      .getViewports()[0]
      .project([(x0 + x1) / 2, (y0 + y1) / 2, CELL.partTopM[k]]);
    return [px, py];
  }

  it('packs one part per revision, each centred inside the canvas', () => {
    expect(PARTS).toBe(5);
    expect([...CELL.partSlot]).toEqual([0, 1, 1, 2, 3]);
    for (let k = 0; k < PARTS; k++) {
      const [x, y] = roofCentre(k);
      expect(x).toBeGreaterThan(4);
      expect(x).toBeLessThan(SIZE - 4);
      expect(y).toBeGreaterThan(4);
      expect(y).toBeLessThan(SIZE - 4);
    }
  });

  it('the 12 days cover every evalPart rule', () => {
    const seen = new Set<string>();
    for (const day of DAYS)
      for (let k = 0; k < PARTS; k++) {
        const a = partAttrs(ENC, k);
        const e = evalPart(a, day);
        seen.add(e.state);
        if (e.state === 'hidden' && day < a.ghostFrom) seen.add('hidden:before');
        if (e.state === 'hidden' && a.endKind === 2 && day >= a.endDay) seen.add('hidden:dead');
        // Hidden by the part window alone, while another part of the same slot is visible.
        const byWindow = day >= a.ghostFrom && (day < a.partFrom || day >= a.partTo);
        const sibling = [...CELL.partSlot].some(
          (s, j) =>
            j !== k && s === CELL.partSlot[k] && evalPart(partAttrs(ENC, j), day).state !== 'hidden'
        );
        if (e.state === 'hidden' && byWindow && sibling)
          seen.add(day < a.partFrom ? 'window:before' : 'window:after');
        if (e.state === 'constructing') seen.add(e.zCutM === 0 ? 'cut:zero' : 'cut:floors');
        if (
          e.state === 'constructing' &&
          e.zCutM > 0 &&
          (day - a.constructionDay) / a.constructionTypicalDays > 0.9
        )
          seen.add('cut:cap');
        if (e.state === 'dying') seen.add(e.alpha === 1 ? 'dying:hold' : 'dying:fade');
        if (e.state === 'dying' && e.zCutM > 0) seen.add('dying:floors');
        if (a.stories === 0 && day >= a.completeDay) seen.add(`footprint-complete:${e.state}`);
      }
    expect([...seen].sort()).toEqual(
      [
        'complete',
        'constructing',
        'cut:cap',
        'cut:floors',
        'cut:zero',
        'dying',
        'dying:fade',
        'dying:floors',
        'dying:hold',
        'footprint-complete:ready',
        'hidden',
        'hidden:before',
        'hidden:dead',
        'permit',
        'planning',
        'ready',
        'window:after',
        'window:before'
      ].sort()
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`each part's centre pixel has the evalPart class on all 12 days (${theme})`, () => {
      const models = layers.map((l) => l.getModels());
      expect(models.every((m) => m.length > 0)).toBe(true);
      clock.theme = theme;
      const got: string[] = [];
      const want: string[] = [];
      for (const day of DAYS) {
        clock.day = day;
        deck.redraw('test');
        for (let k = 0; k < PARTS; k++) {
          const e = evalPart(partAttrs(ENC, k), day);
          const [x, y] = roofCentre(k);
          const px = readAt(x, y);
          const cls = classify(px, prototypes(theme, k, e));
          got.push(`${day - B} part ${k}: ${cls} rgba(${px.join(',')})`);
          want.push(`${day - B} part ${k}: ${expectedClass(e)} rgba(${px.join(',')})`);
        }
      }
      expect(got).toEqual(want);
      // The same layer instances and models served every day: the clock is mutated, never
      // replaced, and no layer was re-created or re-initialised.
      expect(deck.props.layers).toBe(layers);
      expect(layers.map((l) => l.getModels())).toEqual(models);
      layers.forEach((l, i) => l.getModels().forEach((m, j) => expect(m).toBe(models[i][j])));
      expect(errors).toEqual([]);
    });
  }

  it('hidden parts are not pickable; visible ones are', () => {
    clock.theme = 'light';
    const [x, y] = roofCentre(0);
    clock.day = B + 50;
    deck.redraw('test');
    expect(deck.pickObject({ x, y })).toBeNull();
    clock.day = B + 120; // fx-1 planning: only the ghost layer draws it
    deck.redraw('test');
    expect(deck.pickObject({ x, y })).toMatchObject({ index: 0, layer: { id: layers[1].id } });
    clock.day = B + 1250; // fx-1 complete: only the solid layer draws it
    deck.redraw('test');
    expect(deck.pickObject({ x, y })).toMatchObject({ index: 0, layer: { id: layers[0].id } });
    expect(errors).toEqual([]);
  });

  /** Part `k`'s ring vertices as lng/lat. */
  function ringOf(k: number): [number, number][] {
    const out: [number, number][] = [];
    for (let v = CELL.startIndices[k]; v < CELL.startIndices[k + 1]; v++)
      out.push([CELL.positions[2 * v], CELL.positions[2 * v + 1]]);
    return out;
  }

  // Seen from outside at pitch 60, a wall point h metres up shows the solid/ghost split at zCut.
  // At that pitch the ray through a wall point below 10 m reaches the ground inside the 20 m
  // footprint, so the facing wall is the only surface on it. fx-1 (SW) is seen on its west wall
  // from the west (bearing 90); fx-3 (NW) on its north wall from the north (bearing 180).
  // Packed rings are closed (PR #21): the last vertex repeats the first, so with
  // `_normalize: false` deck draws every wall, the closing edge's included. The probe point is
  // the middle of the wall's bounding-box side, which a repeated vertex cannot bias.
  const SIDE_CASES: { k: number; bearing: 90 | 180; h: number; day: number }[] = [
    { k: 0, bearing: 90, h: 6, day: B + 320 }, // ready ghost
    { k: 0, bearing: 90, h: 6, day: B + 600 }, // constructing, zCut 3.1: ghost above the cut
    { k: 0, bearing: 90, h: 2, day: B + 600 }, // constructing, zCut 3.1: solid below the cut
    { k: 0, bearing: 90, h: 6, day: B + 1100 }, // constructing, capped zCut 12.4: solid
    { k: 0, bearing: 90, h: 6, day: B + 1250 }, // complete: solid
    { k: 3, bearing: 180, h: 3, day: B + 600 }, // constructing, zCut 4.5: solid
    { k: 3, bearing: 180, h: 9, day: B + 800 }, // dying above the frozen zCut 7.6: red ghost
    { k: 3, bearing: 180, h: 3, day: B + 800 }, // dying below the frozen zCut: red-tinted floors
    { k: 3, bearing: 180, h: 3, day: B + 950 }, // the same floors, fading
    { k: 3, bearing: 180, h: 3, day: B + 1100 } // hidden after death: vacant lot
  ];

  it('side walls split solid below zCut and ghost above it, as evalPart gives', () => {
    clock.theme = 'light';
    const got: string[] = [];
    const want: string[] = [];
    try {
      for (const { k, bearing, h, day } of SIDE_CASES) {
        deck.setProps({ viewState: { ...VIEW_STATE, pitch: 60, bearing } });
        clock.day = day;
        deck.redraw('test');
        const ring = ringOf(k);
        const lo = (i: 0 | 1) => Math.min(...ring.map((v) => v[i]));
        const hi = (i: 0 | 1) => Math.max(...ring.map((v) => v[i]));
        const mid = (i: 0 | 1) => (lo(i) + hi(i)) / 2;
        // West wall: the smallest longitude; north wall: the largest latitude.
        const at: [number, number, number] =
          bearing === 90 ? [lo(0), mid(1), h] : [mid(0), hi(1), h];
        const [x, y] = deck.getViewports()[0].project(at);
        expect(x > 2 && x < SIZE - 2 && y > 2 && y < SIZE - 2).toBe(true);
        const e = evalPart(partAttrs(ENC, k), day);
        const px = readAt(x, y);
        const tag = `${day - B} part ${k} h ${h}`;
        got.push(`${tag}: ${classify(px, prototypes('light', k, e))} rgba(${px.join(',')})`);
        want.push(`${tag}: ${expectedSideClass(e, h)} rgba(${px.join(',')})`);
      }
    } finally {
      deck.setProps({ viewState: VIEW_STATE });
    }
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });

  it('reuses one timelapse props object per layer across draws (no per-draw allocation)', () => {
    const spies = layers.map((l) => vi.spyOn(l, 'setShaderModuleProps'));
    try {
      clock.theme = 'light';
      clock.day = B + 120;
      deck.redraw('test');
      clock.theme = 'dark';
      clock.day = B + 1250;
      deck.redraw('test');
      layers.forEach((l, i) => {
        const sent = spies[i].mock.calls.map(([p]) => p).filter((p) => 'timelapse' in p);
        expect(sent.length).toBeGreaterThanOrEqual(2);
        expect(new Set(sent).size).toBe(1);
        // luma copies the values, so mutating the one object in place still updates the uniforms.
        for (const m of l.getModels()) {
          const u = (m.shaderInputs as unknown as { moduleUniforms: Record<string, unknown> })
            .moduleUniforms.timelapse as { day: number; pass: number; ghostAlpha: number };
          expect(u).toMatchObject({ day: B + 1250, pass: i, ghostAlpha: GHOST_ALPHA.dark });
        }
      });
    } finally {
      spies.forEach((s) => s.mockRestore());
      clock.theme = 'light';
    }
    expect(errors).toEqual([]);
  });

  it('compiles and links every pipeline, and reports no error', () => {
    const statuses = linkStatuses();
    expect(statuses.length).toBe(6); // side, wireframe and top model per layer
    expect(statuses.filter((s) => s !== 'success')).toEqual([]);
    expect(errors).toEqual([]);
  });
});
