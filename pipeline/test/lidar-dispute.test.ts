import { describe, expect, it } from 'vitest';
import { BOXES } from '../boxes-config.js';
import type { MultiPoly, Ring } from '../geom.js';
import { checkParts } from '../lib/lidar/dispute.js';
import type { Part } from '../lib/lidar/parts.js';
import { fpOf, rect, shiftOf, synthWindow, type SynthScene } from './lidar-synth.js';

const poly = (r: Ring): MultiPoly => [[r]];
const flat = (): number => 15;

const part = (id: string, ring: Ring, o: Partial<Part> = {}): Part => ({
  id,
  buildingId: 'b1',
  shape: poly(ring),
  heightM: 20,
  minHeightM: null,
  roofShape: null,
  roofHeightM: null,
  ...o
});

function run(
  scene: Pick<SynthScene, 'boxes' | 'shift'>,
  fpRing: Ring,
  counted: Part[],
  o: { shift?: ReturnType<typeof shiftOf> | null; window?: boolean } = {}
): ReturnType<typeof checkParts> {
  const xs = fpRing.map((q) => q[0]);
  const ys = fpRing.map((q) => q[1]);
  const pad = 4;
  const w = synthWindow(
    { ground: flat, ...scene },
    {
      x0: Math.min(...xs) - pad,
      y0: Math.min(...ys) - pad,
      x1: Math.max(...xs) + pad,
      y1: Math.max(...ys) + pad
    }
  );
  const shift = o.shift === undefined ? shiftOf(scene.shift?.[0], scene.shift?.[1]) : o.shift;
  return checkParts(o.window === false ? null : w, fpOf(poly(fpRing)), shift, counted);
}

const agree = (ring: Ring, p: Part, lidar: number): ReturnType<typeof checkParts> =>
  run({ boxes: [{ ring, top: lidar }] }, ring, [p]);

describe('checkParts', () => {
  it('a part the LiDAR agrees with is checked and trusted', () => {
    const r = rect(100, 200, 120, 220);
    const c = agree(r, part('a', r, { heightM: 20 }), 20);
    expect(c).toMatchObject({ checked: 1, disputed: 0, rejected: false });
    expect(Math.abs((c.parts[0].lidarM as number) - 20)).toBeLessThan(0.2);
  });

  it('a skillion part drawn at mid-roof under a taller roof is disputed and rejects the building', () => {
    // Salesforce: skillion parts drawn at 203.5 m, the LiDAR reads about 270 m.
    const r = rect(100, 200, 120, 208);
    const p = part('a', r, { heightM: 70, roofShape: 'skillion', roofHeightM: 50 });
    const c = agree(r, p, 70);
    expect(c.parts[0].topM).toBe(45);
    expect(c).toMatchObject({ checked: 1, disputed: 1, rejected: true });
  });

  it('a part drawn above the LiDAR is trusted: an open frame the LiDAR sees into', () => {
    // Sutro: a 232 m part over cells whose raised median is 67 m, raised share about 0.6.
    const r = rect(100, 200, 120, 210);
    const c = run(
      {
        boxes: [
          { ring: rect(100, 200, 112, 210), top: 60 },
          { ring: rect(112, 200, 113, 210), top: 230 }
        ]
      },
      r,
      [part('a', r, { heightM: 232 })]
    );
    expect(c.parts[0].raisedShare as number).toBeCloseTo(0.65, 1);
    expect(c.parts[0].lidarM as number).toBeLessThan(70);
    expect(c).toMatchObject({ checked: 1, disputed: 0, rejected: false });
  });

  it('tiered and small parts are never checked', () => {
    const big = rect(100, 200, 120, 220);
    const small = rect(130, 200, 134, 204);
    const scene = {
      boxes: [
        { ring: big, top: 10 },
        { ring: small, top: 10 }
      ]
    };
    const c = run(scene, rect(100, 200, 134, 220), [
      part('a', big, { heightM: 60, roofShape: 'pyramidal' }),
      part('b', small, { heightM: 90 })
    ]);
    expect(c.checked).toBe(0);
    expect(c.parts.map((v) => v.seenM2)).toEqual([null, null]);
  });

  it('a podium part sees only what the tower part leaves', () => {
    const podium = rect(100, 200, 110, 212);
    const tower = rect(102, 204, 108, 210);
    const c = run(
      {
        boxes: [
          { ring: podium, top: 20 },
          { ring: tower, top: 60 }
        ]
      },
      podium,
      [part('a', podium, { heightM: 20 }), part('b', tower, { heightM: 60 })]
    );
    expect(c).toMatchObject({ checked: 2, disputed: 0 });
    expect(Math.abs((c.parts[0].seenM2 as number) - 84)).toBeLessThan(0.5);
    expect(Math.abs((c.parts[0].lidarM as number) - 20)).toBeLessThan(0.3);
  });

  it('a lattice the LiDAR sees through is trusted', () => {
    const r = rect(100, 200, 120, 210);
    const c = run({ boxes: [{ ring: rect(100, 200, 106, 210), top: 100 }] }, r, [
      part('a', r, { heightM: 100 })
    ]);
    expect(c.checked).toBe(0);
    expect(c.parts[0].raisedShare as number).toBeLessThan(0.5);
  });

  it('a disputed part under partRejectShare keeps the parts', () => {
    const big = rect(100, 200, 130, 210);
    const small = rect(140, 200, 150, 203);
    const c = run(
      {
        boxes: [
          { ring: big, top: 20 },
          { ring: small, top: 40 }
        ]
      },
      rect(100, 200, 150, 210),
      [part('a', big, { heightM: 20 }), part('b', small, { heightM: 20 })]
    );
    expect(c).toMatchObject({ checked: 2, disputed: 1, rejected: false });
  });

  it('the tolerance is max(partTolM, partTolFrac x top), LiDAR above the drawn top only', () => {
    const r = rect(100, 200, 120, 220);
    const dispute = (top: number, lidar: number): boolean =>
      agree(r, part('a', r, { heightM: top }), lidar).disputed === 1;
    expect(dispute(100, 109)).toBe(false);
    expect(dispute(100, 111)).toBe(true);
    expect(dispute(20, 24.5)).toBe(false);
    expect(dispute(20, 25.5)).toBe(true);
    expect(dispute(100, 50)).toBe(false);
    expect(dispute(20, 10)).toBe(false);
  });

  it('without a window, a shift, or with shift source none, every part is trusted', () => {
    const r = rect(100, 200, 120, 220);
    const p = part('a', r, { heightM: 80 });
    const scene = { boxes: [{ ring: r, top: 20 }] };
    for (const c of [
      run(scene, r, [p], { window: false }),
      run(scene, r, [p], { shift: null }),
      run(scene, r, [p], { shift: shiftOf(0, 0, 'none') })
    ])
      expect(c).toMatchObject({ checked: 0, disputed: 0, rejected: false });
  });

  it('a part outside the window is trusted', () => {
    const r = rect(100, 200, 120, 220);
    const far = rect(170, 200, 176, 205);
    const c = run({ boxes: [{ ring: r, top: 20 }] }, r, [
      part('a', r, { heightM: 20 }),
      part('b', far, { heightM: 80 })
    ]);
    expect(c.parts[1]).toMatchObject({ checked: false, disputed: false, raisedShare: 0 });
  });

  it('equal-top overlapping parts both see their own cells', () => {
    const a = rect(100, 200, 120, 220);
    const b = rect(110, 200, 130, 220);
    const all = rect(100, 200, 130, 220);
    const c = run({ boxes: [{ ring: all, top: 20 }] }, all, [
      part('a', a, { heightM: 20 }),
      part('b', b, { heightM: 20 })
    ]);
    expect(c.checked).toBe(2);
    expect(c.parts[0].seenM2).toBeCloseTo(400, 0);
    expect(c.parts[1].seenM2).toBeCloseTo(400, 0);
  });

  it('samples at the shift, draws nothing', () => {
    const r = rect(100, 200, 120, 220);
    const c = run({ boxes: [{ ring: r, top: 20 }], shift: [1.0, -0.3] }, r, [
      part('a', r, { heightM: 20 })
    ]);
    expect(c).toMatchObject({ checked: 1, disputed: 0, rejected: false });
    expect(Math.abs((c.parts[0].lidarM as number) - 20)).toBeLessThan(0.2);
  });

  it('reads its tolerances from BOXES', () => {
    expect([BOXES.partTolM, BOXES.partTolFrac, BOXES.partRejectShare]).toEqual([5, 0.1, 0.25]);
  });
});
