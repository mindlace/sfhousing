import { describe, expect, it } from 'vitest';
import { BOXES } from '../boxes-config.js';
import { area, difference, grow, intersect, type MultiPoly, type Ring } from '../geom.js';
import { deriveBoxes, groundOf, type DeriveInput, type RenderBox } from '../lib/lidar/derive.js';
import type { Footprint } from '../lib/lidar/register.js';
import { StreetIndex } from '../lib/lidar/streets.js';
import { fpOf, rect, shiftOf, synthWindow, type SynthScene } from './lidar-synth.js';

const disc = (cx: number, cy: number, r: number, n = 32): Ring =>
  Array.from({ length: n }, (_, k): [number, number] => [
    cx + r * Math.cos((2 * Math.PI * k) / n),
    cy + r * Math.sin((2 * Math.PI * k) / n)
  ]);

const flatGround = (): number => 15;

// The mini streets pattern: a public centreline 12 m in front of the street face (y = 200).
const FRONT_LINE: Ring = [
  [60, 188],
  [160, 188]
];
const streetsFront = new StreetIndex([FRONT_LINE]);

function bboxOf(p: MultiPoly): { x0: number; y0: number; x1: number; y1: number } {
  const pts = p.flat(2);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function run(
  scene: SynthScene,
  fp: Footprint,
  o: Partial<Omit<DeriveInput, 'fp'>> = {}
): ReturnType<typeof deriveBoxes> {
  const b = bboxOf(fp.shape);
  const pad = 4;
  const w = synthWindow(scene, { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad });
  const r = deriveBoxes(w, { fp, shift: shiftOf(), streets: streetsFront, ...o });
  // The global constraint, asserted on every scenario this helper runs.
  expectInside(r.boxes, o.area ?? fp.shape);
  return r;
}

/** The global constraint: no LiDAR-derived box pokes outside its footprint (and its holes). */
function expectInside(boxes: RenderBox[], within: MultiPoly): void {
  const g = grow(within, 0.005);
  for (const b of boxes) expect(area(difference(b.shape, g))).toBeLessThan(0.01);
}

const bySrc = (boxes: RenderBox[], src: RenderBox['src']): RenderBox[] =>
  boxes.filter((b) => b.src === src);

/** Directed distance from points along segment a-b to the polygon (0 inside). */
function segToPoly(a: [number, number], b: [number, number], p: MultiPoly): number {
  let worst = 0;
  for (let t = 0; t <= 100; t++) {
    const x = a[0] + ((b[0] - a[0]) * t) / 100;
    const y = a[1] + ((b[1] - a[1]) * t) / 100;
    let inside = false;
    for (const poly of p)
      for (const ring of poly)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
    if (inside) continue;
    let d = Infinity;
    for (const poly of p)
      for (const ring of poly)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [x1, y1] = ring[j];
          const [x2, y2] = ring[i];
          const ex = x2 - x1;
          const ey = y2 - y1;
          const l2 = ex * ex + ey * ey;
          const s = l2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * ex + (y - y1) * ey) / l2)) : 0;
          d = Math.min(d, Math.hypot(x - (x1 + s * ex), y - (y1 + s * ey)));
        }
    worst = Math.max(worst, d);
  }
  return worst;
}

describe('StreetIndex', () => {
  it('finds a centreline in front of a face and not behind it', () => {
    const s = new StreetIndex([FRONT_LINE]);
    expect(s.facing([104, 200], [0, -1], 30, 0.7)).toBe(true);
    expect(s.facing([104, 220], [0, 1], 30, 0.7)).toBe(false);
    // Too far: 45 m.
    expect(s.facing([104, 233], [0, -1], 30, 0.7)).toBe(false);
    // Beside, not in front: the closest point is off the cone.
    expect(s.facing([108, 210], [1, 0], 30, 0.7)).toBe(false);
  });

  it('judges by the nearest point of each segment', () => {
    // A side street running past a corner building: within 30 m of the rear face at 45 degrees,
    // but its nearest point is beside that face.
    const side = new StreetIndex([
      [
        [120, 170],
        [120, 250]
      ]
    ]);
    expect(side.facing([104, 220], [0, 1], 30, 0.7)).toBe(false);
    expect(side.facing([108, 210], [1, 0], 30, 0.7)).toBe(true);
    // A front street split at a node in front of the face still faces it.
    const split = new StreetIndex([
      [
        [60, 188],
        [104, 188]
      ],
      [
        [104, 188],
        [160, 186]
      ]
    ]);
    expect(split.facing([104, 200], [0, -1], 30, 0.7)).toBe(true);
    expect(new StreetIndex([]).facing([104, 200], [0, -1], 30, 0.7)).toBe(false);
  });
});

describe('deriveBoxes', () => {
  const house = rect(100, 200, 108, 220);

  it('flat roof gives one base', () => {
    const fp = fpOf([[house]]);
    const { boxes, roof } = run({ ground: flatGround, boxes: [{ ring: house, top: 10 }] }, fp, {
      kStart: 3
    });
    expect(boxes).toHaveLength(1);
    expect(boxes[0].src).toBe('base');
    expect(boxes[0].k).toBe(3);
    expect(boxes[0].bid).toBe('b1');
    expect(boxes[0].baseM).toBe(0);
    expect(Math.abs(boxes[0].heightM - 10)).toBeLessThanOrEqual(0.1);
    expect(roof.roof).toBe('flat');
    expect(roof.fallback).toBeNull();
    expect(roof.nFront).toBe(0);
    expect(roof.nStep).toBe(0);
    expect(roof.stepsCapped).toBe(false);
    expect(roof.groundM).toBeCloseTo(15, 2);
    expectInside(boxes, fp.shape);
  });

  it('gable is pitched, not a staircase', () => {
    const ring = rect(100, 200, 106, 220);
    const fp = fpOf([[ring]]);
    const top = (x: number): number => 6 + 4 * (1 - Math.abs(x - 103) / 3);
    const { boxes, roof } = run({ ground: flatGround, boxes: [{ ring, top }] }, fp);
    expect(roof.roof).toBe('pitched');
    expect(Math.abs(roof.eaveM! - 6)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(roof.ridgeM! - 10)).toBeLessThanOrEqual(0.3);
    // The long axis runs north: 0 degrees (mod 180).
    const d = roof.ridgeDeg!;
    expect(Math.min(d, 180 - d)).toBeLessThanOrEqual(5);
    expect(bySrc(boxes, 'base')).toHaveLength(1);
    expect(Math.abs(bySrc(boxes, 'base')[0].heightM - 8)).toBeLessThanOrEqual(0.3);
    expect(bySrc(boxes, 'step')).toHaveLength(0);
    expectInside(boxes, fp.shape);
  });

  it('a steep gable is one base: no ridge step, and its street gable end is no front', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    const top = (x: number): number => 5 + 7 * (1 - Math.abs(x - 105) / 5);
    const { boxes, roof } = run({ ground: flatGround, boxes: [{ ring, top }] }, fp);
    expect(roof.roof).toBe('pitched');
    expect(boxes).toHaveLength(1);
    expect(roof.nFront).toBe(0);
    expectInside(boxes, fp.shape);
  });

  it('a false front over a gable is a front from mid-roof', () => {
    const fp = fpOf([[house]]);
    const gable = (x: number): number => 6 + 3 * (1 - Math.abs(x - 104) / 4);
    const s: SynthScene = {
      ground: flatGround,
      boxes: [{ ring: house, top: (x, y) => (y < 202 ? 11 : gable(x)) }]
    };
    const { boxes, roof } = run(s, fp);
    expect(roof.roof).toBe('pitched');
    const fronts = bySrc(boxes, 'front');
    expect(fronts).toHaveLength(1);
    expect(Math.abs(fronts[0].heightM - 11)).toBeLessThanOrEqual(0.1);
    expect(fronts[0].baseM).toBe(bySrc(boxes, 'base')[0].heightM);
    expect(Math.abs(fronts[0].baseM - 7.5)).toBeLessThanOrEqual(0.3);
    expectInside(boxes, fp.shape);
  });

  describe('roof forms are not staircases or confetti', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    // Deterministic pseudo-noise in [-a, a].
    const noise = (x: number, y: number, a: number): number => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return a * 2 * (s - Math.floor(s) - 0.5);
    };
    const one = (top: (x: number, y: number) => number) =>
      run({ ground: flatGround, boxes: [{ ring, top }] }, fp);

    it('a hip roof is pitched and one box', () => {
      for (const [eave, slope] of [
        [6, 0.8],
        [5, 1.4]
      ]) {
        const { boxes, roof } = one(
          (x, y) => eave + slope * Math.min(x - 100, 110 - x, y - 200, 220 - y, 5)
        );
        expect(roof.roof).toBe('pitched');
        expect(boxes).toHaveLength(1);
        expectInside(boxes, fp.shape);
      }
    });

    it('a shed roof records its eave, ridge and ridge direction', () => {
      const { boxes, roof } = one((x) => 6 + 0.5 * (x - 100));
      expect(roof.roof).toBe('pitched');
      expect(Math.abs(roof.eaveM! - 6)).toBeLessThanOrEqual(0.3);
      expect(Math.abs(roof.ridgeM! - 11)).toBeLessThanOrEqual(0.3);
      expect(Math.min(roof.ridgeDeg!, 180 - roof.ridgeDeg!)).toBeLessThanOrEqual(5);
      expect(boxes).toHaveLength(1);
    });

    it('a gable across the street axis has its ridge east-west', () => {
      const { roof } = one((_x, y) => 6 + 0.6 * (10 - Math.abs(y - 210)));
      expect(roof.roof).toBe('pitched');
      expect(Math.abs(roof.ridgeDeg! - 90)).toBeLessThanOrEqual(5);
    });

    it('LiDAR noise makes no confetti', () => {
      const flat = one((x, y) => 10 + noise(x, y, 0.3));
      expect(flat.roof.roof).toBe('flat');
      expect(flat.boxes).toHaveLength(1);
      expect(Math.abs(flat.boxes[0].heightM - 10)).toBeLessThanOrEqual(0.2);
      const gable = one((x, y) => 6 + 0.9 * (5 - Math.abs(x - 105)) + noise(x, y, 0.15));
      expect(gable.roof.roof).toBe('pitched');
      expect(gable.boxes).toHaveLength(1);
    });

    it('a dormer on a gable is no step', () => {
      const { boxes, roof } = one((x, y) =>
        Math.max(
          6 + 0.9 * (5 - Math.abs(x - 105)),
          x > 106 && x < 109 && y > 205 && y < 212 ? 9.5 : 0
        )
      );
      expect(roof.roof).toBe('pitched');
      expect(boxes).toHaveLength(1);
    });
  });

  it('a 1.2 m band 1.5 m up (the mini b02) is a front', () => {
    const ring = rect(100, 200, 106, 220);
    const fp = fpOf([[ring]]);
    const { boxes } = run(
      { ground: flatGround, boxes: [{ ring, top: (_x, y) => (y < 201.2 ? 16.5 : 15) }] },
      fp
    );
    const fronts = bySrc(boxes, 'front');
    expect(fronts).toHaveLength(1);
    expect(Math.abs(fronts[0].heightM - 16.5)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(bySrc(boxes, 'base')[0].heightM - 15)).toBeLessThanOrEqual(0.1);
    expectInside(boxes, fp.shape);
  });

  describe('Victorian false front', () => {
    const fp = fpOf([[house]]);
    const scene = (band: number, rear = false): SynthScene => ({
      ground: flatGround,
      boxes: [{ ring: house, top: (_x, y) => ((rear ? y > 218 : y < 202) ? band : 9) }]
    });

    it('a street band 2 m above the roof gets a front strip', () => {
      const { boxes, roof } = run(scene(11), fp);
      const fronts = bySrc(boxes, 'front');
      expect(fronts).toHaveLength(1);
      expect(roof.nFront).toBe(1);
      expect(Math.abs(fronts[0].heightM - 11)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(fronts[0].baseM - 9)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(area(fronts[0].shape) / (8 * BOXES.frontDepthM) - 1)).toBeLessThanOrEqual(
        0.02
      );
      expect(Math.abs(bySrc(boxes, 'base')[0].heightM - 9)).toBeLessThanOrEqual(0.1);
      expect(bySrc(boxes, 'step')).toHaveLength(0);
      expectInside(boxes, fp.shape);
    });

    it('a 0.8 m rise is no front', () => {
      const { boxes, roof } = run(scene(9.8), fp);
      expect(bySrc(boxes, 'front')).toHaveLength(0);
      expect(roof.nFront).toBe(0);
      expectInside(boxes, fp.shape);
    });

    it('a rear face far from any street is no front', () => {
      const rearLine: Ring = [
        [60, 265],
        [160, 265]
      ];
      const { boxes } = run(scene(11, true), fp, { streets: new StreetIndex([rearLine]) });
      expect(bySrc(boxes, 'front')).toHaveLength(0);
      expectInside(boxes, fp.shape);
    });

    it('a street tree over the band raises no front', () => {
      const s: SynthScene = {
        ground: flatGround,
        boxes: [{ ring: house, top: 9 }],
        veg: [{ ring: disc(104, 199.5, 3), top: 14 }]
      };
      const { boxes, roof } = run(s, fp);
      expect(bySrc(boxes, 'front')).toHaveLength(0);
      expect(roof.nFront).toBe(0);
      expectInside(boxes, fp.shape);
    });
  });

  it('corner gets two fronts', () => {
    const fp = fpOf([[house]]);
    const side: Ring = [
      [120, 170],
      [120, 250]
    ];
    const s: SynthScene = {
      ground: flatGround,
      boxes: [{ ring: house, top: (x, y) => (y < 202 || x > 106 ? 11 : 9) }]
    };
    const { boxes, roof } = run(s, fp, { streets: new StreetIndex([FRONT_LINE, side]) });
    // A 2 m raised L over a third of the roof fits a shed plane; it is still a flat roof.
    expect(roof.roof).toBe('flat');
    expect(roof.nFront).toBe(2);
    const fronts = bySrc(boxes, 'front');
    expect(fronts).toHaveLength(2);
    for (const f of fronts) expect(Math.abs(f.heightM - 11)).toBeLessThanOrEqual(0.1);
    // The strips do not overlap at the corner.
    expect(area(intersect(fronts[0].shape, fronts[1].shape))).toBeLessThan(0.01);
    expectInside(boxes, fp.shape);
  });

  it('tower over podium with a flush face', () => {
    const ring = rect(100, 200, 115, 220);
    const tower = rect(100, 200, 109, 210);
    const fp = fpOf([[ring]]);
    const s: SynthScene = {
      ground: flatGround,
      boxes: [
        { ring, top: 12 },
        { ring: tower, top: 40 }
      ]
    };
    const { boxes, roof } = run(s, fp);
    expect(roof.roof).toBe('flat');
    const base = bySrc(boxes, 'base');
    expect(base).toHaveLength(1);
    expect(Math.abs(base[0].heightM - 12)).toBeLessThanOrEqual(0.1);
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(1);
    expect(Math.abs(steps[0].baseM - 12)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(steps[0].heightM - 40)).toBeLessThanOrEqual(0.1);
    // Flush: the street side and the west side lie on the footprint edge.
    expect(segToPoly([100, 200], [109, 200], steps[0].shape)).toBeLessThan(0.01);
    expect(segToPoly([100, 200], [100, 210], steps[0].shape)).toBeLessThan(0.01);
    // The street band inside the tower is the step, not a front.
    expect(bySrc(boxes, 'front')).toHaveLength(0);
    expect(roof.nStep).toBe(1);
    expectInside(boxes, fp.shape);
  });

  it('a full-width tower on the street is flat, not a shed roof', () => {
    const ring = rect(100, 200, 115, 220);
    const tower = rect(100, 200, 115, 206);
    const fp = fpOf([[ring]]);
    const s: SynthScene = {
      ground: flatGround,
      boxes: [
        { ring, top: 12 },
        { ring: tower, top: 40 }
      ]
    };
    const { boxes, roof } = run(s, fp);
    expect(roof.roof).toBe('flat');
    expect(Math.abs(bySrc(boxes, 'base')[0].heightM - 12)).toBeLessThanOrEqual(0.1);
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(1);
    expect(segToPoly([100, 200], [115, 200], steps[0].shape)).toBeLessThan(0.01);
    expect(bySrc(boxes, 'front')).toHaveLength(0);
    expectInside(boxes, fp.shape);
  });

  it('small or low regions are dropped', () => {
    const ring = rect(100, 200, 120, 230);
    const fp = fpOf([[ring]]);
    const s: SynthScene = {
      ground: flatGround,
      boxes: [
        { ring, top: 10 },
        { ring: rect(102, 214, 105, 219), top: 13 }, // 15 m2 at +3
        { ring: rect(108, 214, 113, 220), top: 12 }, // 30 m2 at +2
        { ring: rect(108, 222, 113, 228), top: 13 } // 30 m2 at +3
      ]
    };
    const { boxes } = run(s, fp, { streets: new StreetIndex([]) });
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(1);
    expect(Math.abs(steps[0].heightM - 13)).toBeLessThanOrEqual(0.1);
    expect(area(intersect(steps[0].shape, [[rect(108, 222, 113, 228)]]))).toBeGreaterThan(25);
    expectInside(boxes, fp.shape);
  });

  it('the step cap keeps the four tallest', () => {
    const ring = rect(100, 200, 130, 230);
    const fp = fpOf([[ring]]);
    const regions = Array.from({ length: 6 }, (_, k) => {
      const cx = 103 + (k % 3) * 9;
      const cy = 204 + Math.floor(k / 3) * 12;
      return { ring: rect(cx, cy, cx + 5, cy + 6), top: 13 + k };
    });
    const s: SynthScene = { ground: flatGround, boxes: [{ ring, top: 10 }, ...regions] };
    const { boxes, roof } = run(s, fp, { streets: new StreetIndex([]) });
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(BOXES.stepCap);
    expect(roof.nStep).toBe(BOXES.stepCap);
    expect(roof.stepsCapped).toBe(true);
    expect(steps.map((b) => b.heightM).sort((a, b) => a - b)).toEqual([15, 16, 17, 18]);
    expectInside(boxes, fp.shape);
  });

  it('a tower with a penthouse splits once', () => {
    const ring = rect(100, 200, 120, 230);
    const fp = fpOf([[ring]]);
    const s: SynthScene = {
      ground: flatGround,
      boxes: [
        { ring, top: 10 },
        { ring: rect(102, 212, 118, 228), top: 30 },
        { ring: rect(104, 214, 110, 220), top: 36 }
      ]
    };
    const { boxes, roof } = run(s, fp, { streets: new StreetIndex([]) });
    // A rise under taperMinRiseM keeps today's steps.
    expect(roof.sliced).toBe(false);
    expect(roof.stepCap).toBe(BOXES.stepCap);
    const steps = bySrc(boxes, 'step');
    expect(steps.map((b) => b.heightM).sort((a, b) => a - b)).toEqual([30, 36]);
    for (const st of steps) expect(st.baseM).toBe(10);
    expect(area(intersect(steps[0].shape, steps[1].shape))).toBeLessThan(0.01);
    expectInside(boxes, fp.shape);
  });

  describe('trees are not penthouses', () => {
    const ring = rect(100, 200, 115, 220);
    const fp = fpOf([[ring]]);

    it('a vegetation disc over the roof is no step', () => {
      const s: SynthScene = {
        ground: flatGround,
        boxes: [{ ring, top: 10 }],
        veg: [{ ring: disc(108, 212, 3.5), top: 16 }]
      };
      const { boxes, roof } = run(s, fp, { streets: new StreetIndex([]) });
      expect(bySrc(boxes, 'step')).toHaveLength(0);
      expect(roof.nStep).toBe(0);
      expectInside(boxes, fp.shape);
    });

    it('an unflagged rough region is no step', () => {
      // 3x3 std about 2 m: 13 and 17 alternating cell by cell.
      const rough = (x: number, y: number): number =>
        13 + 4 * ((Math.floor(x / 0.25) + Math.floor(y / 0.25)) % 2);
      const s: SynthScene = {
        ground: flatGround,
        boxes: [
          { ring, top: 10 },
          { ring: rect(104, 206, 110, 212), top: rough }
        ]
      };
      const { boxes } = run(s, fp, { streets: new StreetIndex([]) });
      expect(bySrc(boxes, 'step')).toHaveLength(0);
      expectInside(boxes, fp.shape);
    });
  });

  describe('fallbacks', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]], { heightM: 13 });

    it('no window is no_lidar', () => {
      const { boxes, roof } = deriveBoxes(null, { fp, shift: shiftOf(), streets: streetsFront });
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).toMatchObject({ src: 'box', heightM: 13, baseM: 0, k: 0 });
      expect(boxes[0].shape).toEqual(fp.shape);
      expect(roof).toMatchObject({ fallback: 'no_lidar', roof: 'unknown', groundM: null });
      expectInside(boxes, fp.shape);
    });

    it('no shift (no coverage) is no_lidar', () => {
      const { boxes, roof } = run({ ground: flatGround, boxes: [{ ring, top: 10 }] }, fp, {
        shift: null
      });
      expect(roof.fallback).toBe('no_lidar');
      expect(boxes).toHaveLength(1);
      expect(boxes[0].src).toBe('box');
    });

    it('all-NaN cells are no_lidar', () => {
      const { roof } = run(
        { ground: flatGround, boxes: [{ ring, top: 10 }], nodata: [rect(90, 190, 120, 230)] },
        fp
      );
      expect(roof.fallback).toBe('no_lidar');
    });

    it('an interior that reads as ground is new_building', () => {
      const { boxes, roof } = run(
        {
          ground: flatGround,
          boxes: [
            { ring, top: 0.2 },
            { ring: rect(100, 218, 110, 220), top: 10 }
          ]
        },
        fp
      );
      expect(roof.fallback).toBe('new_building');
      expect(roof.roof).toBe('unknown');
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).toMatchObject({ src: 'box', heightM: 13 });
      // The ground reference is still recorded (F3).
      expect(roof.groundM).toBeCloseTo(15, 2);
    });

    it('a bare lot is new_building', () => {
      const { roof } = run({ ground: flatGround, boxes: [] }, fp);
      expect(roof.fallback).toBe('new_building');
    });

    it('60% missing is unreliable', () => {
      const { roof, boxes } = run(
        { ground: flatGround, boxes: [{ ring, top: 10 }], nodata: [rect(99, 199, 111, 212)] },
        fp
      );
      expect(roof.fallback).toBe('unreliable');
      expect(boxes[0].src).toBe('box');
    });

    it('an elevated building keeps its single box', () => {
      const el = fpOf([[ring]], { baseM: 5, heightM: 9 });
      const { boxes, roof } = run({ ground: flatGround, boxes: [{ ring, top: 9 }] }, el);
      expect(roof.fallback).toBe('elevated');
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).toMatchObject({ src: 'box', baseM: 5, heightM: 9 });
      expect(roof.groundM).toBeCloseTo(15, 2);
    });

    it('a 2 x 2 m footprint is unreliable', () => {
      const tiny = rect(100, 200, 102, 202);
      const { roof } = run({ ground: flatGround, boxes: [{ ring: tiny, top: 6 }] }, fpOf([[tiny]]));
      expect(roof.fallback).toBe('unreliable');
    });

    it("a bare lot whose registration found nothing ('none') is new_building", () => {
      const { roof } = run({ ground: flatGround, boxes: [] }, fp, {
        shift: shiftOf(0, 0, 'none')
      });
      expect(roof.fallback).toBe('new_building');
    });

    it("shift source 'none' is unreliable", () => {
      const { roof } = run({ ground: flatGround, boxes: [{ ring, top: 10 }] }, fp, {
        shift: shiftOf(0, 0, 'none')
      });
      expect(roof.fallback).toBe('unreliable');
    });

    it("a 'zero' shift is a normal result", () => {
      const { roof, boxes } = run({ ground: flatGround, boxes: [{ ring, top: 10 }] }, fp, {
        shift: shiftOf(0, 0, 'zero')
      });
      expect(roof.fallback).toBeNull();
      expect(boxes[0].src).toBe('base');
    });

    it('a fallback over a restricted area covers that area', () => {
      const half: MultiPoly = [[rect(105, 200, 110, 220)]];
      const { boxes } = deriveBoxes(null, {
        fp,
        shift: shiftOf(),
        streets: streetsFront,
        area: half
      });
      expect(boxes).toHaveLength(1);
      expect(boxes[0].shape).toEqual(half);
      expectInside(boxes, half);
    });
  });

  it('hillside reference', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    // Ground rising 20 -> 26 across the footprint (a ramp; a kink at the walls would be smoothed
    // by the 1 m ground grid).
    const ground = (x: number): number => 20 + 0.6 * (x - 100);
    // A level roof at 33 m NAVD88 and a 30 m2 penthouse at 40 m, both drawn above local ground.
    const s: SynthScene = {
      ground,
      boxes: [
        { ring, top: (x) => 33 - ground(x) },
        { ring: rect(106, 205, 109, 215), top: (x) => 40 - ground(x) }
      ]
    };
    const { boxes, roof } = run(s, fp);
    expect(Math.abs(roof.groundM! - 23)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(roof.groundMinM! - 20)).toBeLessThanOrEqual(0.1);
    // Against the median ground (23) the roof is level at 10 and the penthouse at 17. Against
    // local ground the roof would read as a 13 -> 7 shed (pitched, with an eave and a ridge) and
    // the penthouse at about 40 - 24.5 = 15.5, so these assertions fail for a local reference.
    expect(roof.roof).toBe('flat');
    expect(roof.eaveM).toBeNull();
    expect(roof.ridgeM).toBeNull();
    const base = bySrc(boxes, 'base');
    expect(base).toHaveLength(1);
    expect(Math.abs(base[0].heightM - (33 - roof.groundM!))).toBeLessThanOrEqual(0.1);
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(1);
    expect(Math.abs(steps[0].heightM - (40 - roof.groundM!))).toBeLessThanOrEqual(0.1);
    expect(boxes).toHaveLength(2);
  });

  describe('rise and gap are measured from the rendered base top', () => {
    // A 2.0 m roof renders at the 2.5 m floor (heightRangeM).
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);

    it('a band 1.1 m over the roof but 0.6 m over the rendered top is no front', () => {
      const { boxes, roof } = run(
        { ground: flatGround, boxes: [{ ring, top: (_x, y) => (y < 202 ? 3.1 : 2.0) }] },
        fp
      );
      expect(bySrc(boxes, 'base')[0].heightM).toBe(BOXES.heightRangeM[0]);
      expect(bySrc(boxes, 'front')).toHaveLength(0);
      expect(roof.nFront).toBe(0);
    });

    it('a region 2.6 m over the roof but 2.1 m over the rendered top is no step', () => {
      const { boxes, roof } = run(
        {
          ground: flatGround,
          boxes: [
            { ring, top: 2.0 },
            { ring: rect(103, 208, 109, 214), top: 4.6 }
          ]
        },
        fp,
        { streets: new StreetIndex([]) }
      );
      expect(bySrc(boxes, 'step')).toHaveLength(0);
      expect(roof.nStep).toBe(0);
    });
  });

  it('ridgeDeg stays in [0, 180) for a ridge just west of north', () => {
    // A 6 x 20 m gable rotated 0.03 degrees anticlockwise: its ridge bears 359.97 = 179.97.
    const a = (0.03 * Math.PI) / 180;
    const [cx, cy] = [103, 210];
    const rot = (x: number, y: number): [number, number] => [
      cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
      cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)
    ];
    const ring: Ring = rect(100, 200, 106, 220).map(([x, y]) => rot(x, y));
    // Distance across the ridge, in the rotated frame.
    const across = (x: number, y: number): number =>
      (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a);
    const { roof } = run(
      {
        ground: flatGround,
        boxes: [{ ring, top: (x, y) => 10 - (4 / 3) * Math.abs(across(x, y)) }]
      },
      fpOf([[ring]])
    );
    expect(roof.roof).toBe('pitched');
    expect(roof.ridgeDeg).toBeGreaterThanOrEqual(0);
    expect(roof.ridgeDeg).toBeLessThan(180);
    expect(Math.min(roof.ridgeDeg!, 180 - roof.ridgeDeg!)).toBeLessThanOrEqual(0.5);
  });

  it('no front along an area cut that faces a street', () => {
    // A counted part covers the south 5 m (the street side); its LiDAR leaks 1.5 m past the cut.
    // The uncovered area's south edge is a cut, not the building's exterior.
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    const north: MultiPoly = [[rect(100, 205, 110, 220)]];
    const s: SynthScene = {
      ground: flatGround,
      boxes: [{ ring, top: (_x, y) => (y < 206.5 ? 20 : 10) }]
    };
    const { boxes, roof } = run(s, fp, { area: north });
    expect(bySrc(boxes, 'base')).toHaveLength(1);
    expect(bySrc(boxes, 'front')).toHaveLength(0);
    expect(roof.nFront).toBe(0);
    // An exterior street face inside `area` still gets its front: 'area restricts the derivation'.
  });

  it('samples at the shift, draws at the footprint', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    const s: SynthScene = { ground: flatGround, boxes: [{ ring, top: 10 }], shift: [1.0, -0.3] };
    const { boxes, roof } = run(s, fp, { shift: shiftOf(1.0, -0.3) });
    expect(roof.fallback).toBeNull();
    expect(boxes).toHaveLength(1);
    expect(Math.abs(boxes[0].heightM - 10)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(area(boxes[0].shape) - area(fp.shape))).toBeLessThanOrEqual(0.01);
    expect(area(difference(fp.shape, boxes[0].shape))).toBeLessThanOrEqual(0.01);
  });

  it('a shifted false front and tower land on the footprint', () => {
    const ring = rect(100, 200, 115, 220);
    const fp = fpOf([[ring]]);
    const s: SynthScene = {
      ground: flatGround,
      boxes: [
        { ring, top: (_x, y) => (y < 202 ? 14 : 12) },
        { ring: rect(108, 208, 115, 220), top: 30 }
      ],
      shift: [0.8, 0.6]
    };
    const { boxes } = run(s, fp, { shift: shiftOf(0.8, 0.6) });
    expect(bySrc(boxes, 'front')).toHaveLength(1);
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(1);
    expect(segToPoly([115, 208], [115, 220], steps[0].shape)).toBeLessThan(0.01);
    expectInside(boxes, fp.shape);
  });

  it('area restricts the derivation', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    const half: MultiPoly = [[rect(105, 200, 110, 220)]];
    const s: SynthScene = {
      ground: flatGround,
      boxes: [
        { ring, top: (_x, y) => (y < 202 ? 12 : 10) },
        { ring: rect(100, 208, 104, 216), top: 20 },
        { ring: rect(106, 208, 110, 216), top: 20 }
      ]
    };
    const full = run(s, fp);
    const { boxes, roof } = run(s, fp, { area: half });
    expect(bySrc(boxes, 'base')).toHaveLength(1);
    expect(bySrc(boxes, 'step')).toHaveLength(1);
    expect(bySrc(boxes, 'front')).toHaveLength(1);
    expectInside(boxes, half);
    // The ground reference is the whole footprint's (F3).
    expect(roof.groundM).toBe(full.roof.groundM);
  });

  it('an empty area derives nothing but records the ground', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    const { boxes, roof } = run({ ground: flatGround, boxes: [{ ring, top: 10 }] }, fp, {
      area: []
    });
    expect(boxes).toHaveLength(0);
    expect(roof.fallback).toBeNull();
    expect(roof.groundM).toBeCloseTo(15, 2);
  });

  describe('boxes stay inside unusual footprints', () => {
    it('a courtyard building keeps its hole open', () => {
      const outer = rect(100, 200, 120, 220);
      const hole = rect(106, 206, 114, 214);
      const shape: MultiPoly = [[outer, [...hole].reverse()]];
      const fp = fpOf(shape);
      const s: SynthScene = {
        ground: flatGround,
        boxes: [
          { ring: rect(100, 200, 120, 206), top: (_x, y) => (y < 202 ? 12 : 10) },
          { ring: rect(100, 214, 120, 220), top: 10 },
          { ring: rect(114, 200, 120, 220), top: (_x, y) => (y < 202 ? 12 : 10) },
          { ring: rect(100, 200, 106, 220), top: 14 }
        ]
      };
      const { boxes, roof } = run(s, fp);
      expect(roof.fallback).toBeNull();
      expect(bySrc(boxes, 'step')).toHaveLength(1);
      expect(bySrc(boxes, 'front')).toHaveLength(1);
      expectInside(boxes, shape);
      for (const b of boxes) expect(area(intersect(b.shape, [[hole]]))).toBeLessThan(0.01);
    });

    it('a two-part MultiPolygon keeps each box in its part', () => {
      const a = rect(100, 200, 110, 215);
      const b = rect(115, 200, 125, 215);
      const shape: MultiPoly = [[a], [b]];
      const fp = fpOf(shape);
      const s: SynthScene = {
        ground: flatGround,
        boxes: [
          { ring: a, top: 10 },
          { ring: b, top: 14 }
        ]
      };
      const { boxes } = run(s, fp, { streets: new StreetIndex([]) });
      const steps = bySrc(boxes, 'step');
      expect(steps).toHaveLength(1);
      expect(area(difference(steps[0].shape, grow([[b]], 0.005)))).toBeLessThan(0.01);
      expectInside(boxes, shape);
      // Nothing in the gap between the parts.
      for (const bx of boxes)
        expect(area(intersect(bx.shape, [[rect(110, 200, 115, 215)]]))).toBeLessThan(0.01);
    });
  });

  it('groundOf reads the whole footprint at the shift', () => {
    const ring = rect(100, 200, 110, 220);
    const fp = fpOf([[ring]]);
    const ground = (x: number): number => 20 + 0.6 * Math.min(10, Math.max(0, x - 100));
    const w = synthWindow(
      { ground, boxes: [{ ring, top: 9 }], shift: [1, 0] },
      { x0: 94, y0: 194, x1: 116, y1: 226 }
    );
    const g = groundOf(w, fp, shiftOf(1, 0))!;
    // At footprint + (1, 0) the ground runs 20.6..26 (clamped at x = 110): median about 23.6.
    expect(Math.abs(g.groundM - 23.6)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(g.groundMinM - 20.6)).toBeLessThanOrEqual(0.1);
    expect(groundOf(null, fp, shiftOf())).toBeNull();
  });
});

describe('terraces for tall rises', () => {
  // Setbacks are at least 1 m per side (ruling F5): the rough mask at taperRoughM marks one cell
  // each side of a jump, and the opening loses a ring narrower than 1.25 m between two jumps. The
  // first setback is 1 m (the 12 m ring is not a terrace); the others are 2 m.
  const cakeRing = rect(100, 200, 130, 220);
  const cake: SynthScene = {
    ground: flatGround,
    boxes: [
      { ring: cakeRing, top: 12 },
      { ring: rect(101, 201, 129, 219), top: 24 }, // 504 m2
      { ring: rect(103, 203, 127, 217), top: 36 }, // 336 m2
      { ring: rect(105, 205, 125, 215), top: 48 }, // 200 m2
      { ring: rect(107, 207, 123, 213), top: 60 } // 96 m2
    ]
  };
  const inside = (upper: MultiPoly, lower: MultiPoly): boolean =>
    area(difference(upper, grow(lower, 0.01))) < 0.01;

  it('a wedding-cake tower is sliced into stacked terraces', () => {
    const fp = fpOf([[cakeRing]]);
    const { boxes, roof } = run(cake, fp, { streets: new StreetIndex([]) });
    expect(roof.sliced).toBe(true);
    expect(roof.stepCap).toBe(32);
    expect(roof.roof).toBe('flat');
    const base = bySrc(boxes, 'base');
    expect(base).toHaveLength(1);
    expect(base[0].heightM).toBe(12);
    // Band 3 (rise 48 / 16 tiers), sampled half a band up: level 12 takes the 24 m tier and merges
    // through 15, 18 and 21; each tier starts a terrace at its own level.
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(4);
    expect(roof.nStep).toBe(4);
    expect(roof.stepsCapped).toBe(false);
    const want = [
      { heightM: 24, baseM: 12, area: 504 },
      { heightM: 36, baseM: 24, area: 336 },
      { heightM: 48, baseM: 36, area: 200 },
      { heightM: 60, baseM: 48, area: 96 }
    ];
    steps.forEach((s, i) => {
      expect(Math.abs(s.heightM - want[i].heightM)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(s.baseM - want[i].baseM)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(area(s.shape) / want[i].area - 1)).toBeLessThanOrEqual(0.1);
      if (i > 0) expect(inside(s.shape, steps[i - 1].shape)).toBe(true);
    });
  });

  it('a prism tower over a podium is one terrace box', () => {
    const ring = rect(100, 200, 120, 220);
    const fp = fpOf([[ring]]);
    const s: SynthScene = {
      ground: flatGround,
      boxes: [
        { ring, top: 10 },
        { ring: rect(105, 205, 115, 215), top: 70 }
      ]
    };
    const { boxes, roof } = run(s, fp, { streets: new StreetIndex([]) });
    expect(roof.sliced).toBe(true);
    // Sampled half a band up, the podium is not raised by a band: the base box tops at 10.
    expect(bySrc(boxes, 'base')[0].heightM).toBe(10);
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(1);
    expect(Math.abs(area(steps[0].shape) / 100 - 1)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(steps[0].heightM - 70)).toBeLessThanOrEqual(0.2);
    expect(steps[0].baseM).toBe(10);
  });

  it('the cap keeps the largest terraces and every kept terrace stands on another', () => {
    // Three towers of 17 square tiers (the shared 5 m podium and 16 more from 13 m), each 2 m in
    // per side and 3 m up. The band is 3.125 (rise 55 - 5 over 16 tiers), so the levels reach 15
    // distinct tiers per tower: 45 terraces before the cap.
    const ring = rect(100, 200, 310, 270);
    const fp = fpOf([[ring]]);
    const towers = [0, 1, 2].flatMap((i) =>
      Array.from({ length: 16 }, (_, t) => {
        const x0 = 100 + 70 * i;
        const d = 2 * (t + 1);
        return { ring: rect(x0 + d, 200 + d, x0 + 70 - d, 270 - d), top: 13 + 3 * t };
      })
    );
    const { boxes, roof } = run({ ground: flatGround, boxes: [{ ring, top: 5 }, ...towers] }, fp, {
      streets: new StreetIndex([])
    });
    expect(roof.sliced).toBe(true);
    expect(roof.nStep).toBe(32);
    expect(roof.stepsCapped).toBe(true);
    const baseTop = bySrc(boxes, 'base')[0].heightM;
    const steps = bySrc(boxes, 'step');
    expect(steps).toHaveLength(32);
    for (const s of steps) {
      if (s.baseM <= baseTop) continue;
      expect(steps.some((p) => p.heightM === s.baseM && inside(s.shape, p.shape))).toBe(true);
    }
  });

  it("a sliced building's terraces win over a street front", () => {
    // The default street lies 12 m in front of the south face; the 24 m tier stands 1 m in from
    // it, inside the front band.
    const { roof } = run(cake, fpOf([[cakeRing]]));
    expect(roof.sliced).toBe(true);
    expect(roof.nFront).toBe(0);
  });
});
