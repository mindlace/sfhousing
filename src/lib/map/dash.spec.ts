import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { dashPath } from './dash';

type Pt = [number, number];
const CENTRE: Pt = [-122.4194, 37.7749];

/** A closed square of side `sideM` metres, as lng/lat. */
function squareRing(c: Pt, sideM: number): Pt[] {
  const dx = sideM / M_PER_DEG_LNG;
  const dy = sideM / M_PER_DEG_LAT;
  return [
    [c[0], c[1]],
    [c[0] + dx, c[1]],
    [c[0] + dx, c[1] + dy],
    [c[0], c[1] + dy],
    [c[0], c[1]]
  ];
}
function pathLengthM(path: number[][]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++)
    m += Math.hypot(
      (path[i][0] - path[i - 1][0]) * M_PER_DEG_LNG,
      (path[i][1] - path[i - 1][1]) * M_PER_DEG_LAT
    );
  return m;
}

describe('dashPath', () => {
  it('dashes a 100 m square into dash and gap lengths along its edges', () => {
    const d = dashPath(squareRing(CENTRE, 100), 4, 3, true);
    expect(d.length).toBe(Math.floor(400 / 7) + 1);
    for (const dash of d.slice(0, -1)) expect(pathLengthM(dash)).toBeCloseTo(4, 1);
  });

  it('a dash that crosses a corner keeps the corner vertex', () => {
    // dashes start at 0, 7, ..., 98: the one from 98 m to 102 m bends at the corner (100 m)
    const d = dashPath(squareRing(CENTRE, 100), 4, 3, true);
    const bent = d[14];
    expect(bent.length).toBe(3);
    expect(pathLengthM(bent)).toBeCloseTo(4, 1);
  });

  it('closes an open ring', () => {
    const open = squareRing(CENTRE, 100).slice(0, -1);
    expect(dashPath(open, 4, 3, true).length).toBe(Math.floor(400 / 7) + 1);
  });

  it('an open path is not closed: three sides of the square dash over 300 m', () => {
    const open = squareRing(CENTRE, 100).slice(0, -1);
    expect(dashPath(open, 4, 3, false).length).toBe(Math.floor(300 / 7) + 1);
  });

  it('a 3D open path keeps z on every dash vertex', () => {
    const flat = squareRing(CENTRE, 100).slice(0, 3);
    const path = flat.map(([x, y], i) => [x, y, 10 + 10 * i]); // z 10, 20, 30 at 0, 100, 200 m
    const d = dashPath(path, 4, 3, false);
    expect(d.length).toBe(Math.floor(200 / 7) + 1);
    for (const dash of d) for (const p of dash) expect(p).toHaveLength(3);
    // the first dash runs 0–4 m along the first side: z 10 → 10.4
    expect(d[0][0][2]).toBeCloseTo(10, 6);
    expect(d[0][d[0].length - 1][2]).toBeCloseTo(10.4, 6);
    // the bent dash (98–102 m) keeps the corner vertex at z 20
    expect(d[14][1]).toEqual(path[1]);
  });

  it('nothing for a degenerate path or a non-positive dash', () => {
    expect(dashPath([[0, 0]], 4, 3, false)).toEqual([]);
    expect(dashPath(squareRing(CENTRE, 100), 0, 3, true)).toEqual([]);
  });
});
