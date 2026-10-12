import { describe, expect, it } from 'vitest';
import { normaliseSite } from './site';
import { signedArea, totalArea } from './poly';

type Ring = [number, number][];
const rect = (w: number, h: number, cx = 0, cy = 0): Ring => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2]
];
const STD = rect(7.62, 30.48);

describe('normaliseSite (§4.4)', () => {
  it('standard lot: A, centroid, long axis, inset base region', () => {
    const s = normaliseSite([STD], 0.4)!;
    expect(s.A).toBeCloseTo(232.26, 2);
    expect(s.c.x).toBeCloseTo(0, 9);
    expect(s.c.y).toBeCloseTo(0, 9);
    expect(s.u.x).toBeCloseTo(0, 9);
    expect(s.u.y).toBeCloseTo(1, 9);
    expect(s.v.x).toBeCloseTo(-1, 9);
    expect(s.v.y).toBeCloseTo(0, 9);
    expect(totalArea(s.Q)).toBeCloseTo(6.82 * 29.68, 1);
    expect(signedArea(s.P)).toBeGreaterThan(0);
  });
  it('tiny (6×6 m, A=36 < 40) → null', () => {
    expect(normaliseSite([rect(6, 6)], 0.4)).toBeNull();
  });
  it('sliver (1.5×60 m) fails the width test → null', () => {
    expect(normaliseSite([rect(1.5, 60)], 0.4)).toBeNull();
  });
  it('no rings, or rings with < 3 distinct vertices → null', () => {
    expect(normaliseSite([], 0.4)).toBeNull();
    expect(
      normaliseSite(
        [
          [
            [0, 0],
            [1, 1],
            [0, 0]
          ]
        ],
        0.4
      )
    ).toBeNull();
  });
  it('multipart: the largest part is the site, the other part is ignored', () => {
    const s = normaliseSite([STD, rect(5, 10, 12.5, 5)], 0.4)!;
    expect(s).toEqual(normaliseSite([STD], 0.4));
  });
  it('holed: exclusions reduce usable area', () => {
    const hole: Ring = [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1]
    ];
    expect(normaliseSite([STD, hole], 0.4)!.A).toBeCloseTo(normaliseSite([STD], 0.4)!.A - 4, 2);
  });
  it('clockwise single ring gives the same site', () => {
    expect(normaliseSite([[...STD].reverse()], 0.4)).toEqual(normaliseSite([STD], 0.4));
  });
  // Review Focus 1
  it('rings with non-finite coordinates are dropped, never thrown on', () => {
    expect(
      normaliseSite(
        [
          [
            [0, 0],
            [NaN, 1],
            [5, 5],
            [0, 9]
          ]
        ],
        0.4
      )
    ).toBeNull();
    expect(
      normaliseSite(
        [
          [
            [0, 0],
            [Infinity, 0],
            [5, 5]
          ],
          STD
        ],
        0.4
      )
    ).toEqual(normaliseSite([STD], 0.4));
  });
  // Review Focus 2
  it('closed rings and repeated vertices equal the open ring', () => {
    const closed: Ring = [...STD, STD[0]];
    const dup: Ring = [STD[0], STD[0], STD[1], STD[2], STD[2], STD[3]];
    expect(normaliseSite([closed], 0.4)).toEqual(normaliseSite([STD], 0.4));
    expect(normaliseSite([dup], 0.4)).toEqual(normaliseSite([STD], 0.4));
  });
});
