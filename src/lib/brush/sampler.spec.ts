import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PATH_MAX_POINTS, project } from '$lib/plan';
import { createSampler, spacingM } from './sampler';

/** Micro-degree integers → degrees, exactly as quantize would produce them. */
const deg = (micro: number) => micro / 1e6;

function isPrefix(a: [number, number][], b: [number, number][]): boolean {
  if (a.length > b.length) return false;
  return a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

describe('spacingM', () => {
  it('is radius / 2 clamped to 2..50', () => {
    expect(spacingM(2)).toBe(2);
    expect(spacingM(5)).toBe(2.5);
    expect(spacingM(30)).toBe(15);
    expect(spacingM(100)).toBe(50);
    expect(spacingM(400)).toBe(50);
  });
});

describe('createSampler', () => {
  it('keeps every 15th point of a 1 m-step line at radius 30', () => {
    const s = createSampler(30);
    // 9 µdeg of latitude ≈ 1.0008 m, so 15 steps ≥ 15 m and 14 steps < 15 m.
    const lng = deg(-122_415_000);
    for (let i = 0; i <= 60; i++) s.push(lng, deg(37_760_000 + 9 * i));
    const lats = s.path().map((p) => p[1]);
    expect(lats).toEqual([0, 15, 30, 45, 60].map((i) => deg(37_760_000 + 9 * i)));
  });

  it('keeps the live tail after the last kept point', () => {
    const s = createSampler(30);
    const lng = deg(-122_415_000);
    for (let i = 0; i <= 20; i++) s.push(lng, deg(37_760_000 + 9 * i));
    expect(s.path().map((p) => p[1])).toEqual([0, 15, 20].map((i) => deg(37_760_000 + 9 * i)));
  });

  it('quantises points to 1e-6 degrees', () => {
    const s = createSampler(30);
    expect(s.push(-122.41234567, 37.76123449)).toBe(true);
    expect(s.path()).toEqual([[-122.412346, 37.761234]]);
  });

  it('drops out-of-bbox points', () => {
    const s = createSampler(30);
    expect(s.push(-121, 37.76)).toBe(false);
    expect(s.push(-122.41, 38.5)).toBe(false);
    expect(s.path()).toEqual([]);
    expect(s.push(-122.41, 37.76)).toBe(true);
    expect(s.push(-121, 37.76)).toBe(false);
    expect(s.path()).toEqual([[-122.41, 37.76]]);
  });

  it('accepts points on the bbox edge (inclusive)', () => {
    const s = createSampler(30);
    expect(s.push(-123.1738, 37.604)).toBe(true);
    expect(s.path()).toHaveLength(1);
  });

  it('gives a one-point stamp, and a repeat push changes nothing', () => {
    const s = createSampler(30);
    expect(s.push(-122.41, 37.76)).toBe(true);
    expect(s.path()).toHaveLength(1);
    expect(s.push(-122.41, 37.76)).toBe(false);
    expect(s.push(-122.4100001, 37.7600002)).toBe(false);
    expect(s.path()).toHaveLength(1);
  });

  it('reports full() at PATH_MAX_POINTS kept points and ignores further pushes', () => {
    const s = createSampler(5);
    const lng = deg(-122_415_000);
    // 27 µdeg of latitude ≈ 3.0023 m ≥ s = 2.5 m, so every point is kept.
    for (let i = 0; i < 1999; i++) s.push(lng, deg(37_720_000 + 27 * i));
    expect(s.full()).toBe(false);
    expect(s.push(lng, deg(37_720_000 + 27 * 1999))).toBe(true);
    expect(s.full()).toBe(true);
    expect(s.path()).toHaveLength(PATH_MAX_POINTS);
    expect(s.push(lng, deg(37_720_000 + 27 * 2000))).toBe(false);
    expect(s.push(lng, deg(37_720_000 + 27 * 2100))).toBe(false);
    expect(s.path()).toHaveLength(PATH_MAX_POINTS);
  });

  it('ends a 1,999-kept stroke with a live tail, then fills at the next kept point', () => {
    const s = createSampler(5);
    const lng = deg(-122_415_000);
    const lat = (i: number) => deg(37_720_000 + 27 * i);
    for (let i = 0; i < 1999; i++) s.push(lng, lat(i));
    // 9 µdeg ≈ 1 m < s = 2.5 m: a non-kept tail.
    expect(s.push(lng, deg(37_720_000 + 27 * 1998 + 9))).toBe(true);
    expect(s.path()).toHaveLength(2000);
    expect(s.full()).toBe(false);
    expect(s.push(lng, lat(1999))).toBe(true);
    expect(s.full()).toBe(true);
    expect(s.path()).toHaveLength(2000);
    expect(s.path()[1999]).toEqual([lng, lat(1999)]);
  });

  it('is prefix-stable: the kept part of each path is a prefix of the final path', () => {
    // Random walks from a Mission start; deltas span zero, sub-spacing and over-50 m steps.
    // 200 steps × 600 µdeg stays inside SF_BBOX from this start box.
    const delta = fc.oneof(
      fc.constant(0),
      fc.integer({ min: -30, max: 30 }),
      fc.integer({ min: -600, max: 600 })
    );
    const start = fc.tuple(
      fc.integer({ min: -122_425_000, max: -122_405_000 }),
      fc.integer({ min: 37_748_000, max: 37_768_000 })
    );
    let keptPushes = 0;
    let droppedPushes = 0;
    let tailSnapshots = 0;
    fc.assert(
      fc.property(
        start,
        fc.array(fc.tuple(delta, delta), { minLength: 0, maxLength: 199 }),
        fc.integer({ min: 5, max: 500 }),
        ([x0, y0], steps, radiusM) => {
          const s = createSampler(radiusM);
          const s2 = spacingM(radiusM) ** 2;
          // Independent oracle for the kept count (spec §4.4 radial filter).
          let lastKept: [number, number] | null = null;
          let keptCount = 0;
          const snapshots: { path: [number, number][]; kept: number }[] = [];
          let [x, y] = [x0, y0];
          for (const [dx, dy] of [[0, 0], ...steps]) {
            x += dx;
            y += dy;
            const p: [number, number] = [deg(x), deg(y)];
            const [px, py] = project(p[0], p[1]);
            const keep =
              lastKept === null || (px - lastKept[0]) ** 2 + (py - lastKept[1]) ** 2 >= s2;
            if (keep) {
              lastKept = [px, py];
              keptCount++;
              keptPushes++;
            } else {
              droppedPushes++;
            }
            const before = s.path();
            const changed = s.push(p[0], p[1]);
            const after = s.path();
            expect(changed).toBe(JSON.stringify(before) !== JSON.stringify(after));
            expect(after.length - keptCount).toBeGreaterThanOrEqual(0);
            expect(after.length - keptCount).toBeLessThanOrEqual(1);
            if (after.length > keptCount) tailSnapshots++;
            const prev = snapshots[snapshots.length - 1];
            if (prev) expect(isPrefix(prev.path.slice(0, prev.kept), after)).toBe(true);
            snapshots.push({ path: after, kept: keptCount });
          }
          const final = s.path();
          expect(final.length).toBeGreaterThan(0);
          expect(final.length).toBeLessThanOrEqual(PATH_MAX_POINTS);
          for (const snap of snapshots) {
            expect(isPrefix(snap.path.slice(0, snap.kept), final)).toBe(true);
          }
        }
      )
    );
    // The walk generator must exercise both filter branches and the live tail.
    expect(keptPushes).toBeGreaterThan(0);
    expect(droppedPushes).toBeGreaterThan(0);
    expect(tailSnapshots).toBeGreaterThan(0);
  });
});
