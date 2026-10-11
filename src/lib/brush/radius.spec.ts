import { describe, expect, it } from 'vitest';
import {
  RADIUS_STEPS,
  STORY_PRESETS,
  clampRadius,
  clampStories,
  heightHintM,
  posFromRadius,
  radiusFromPos,
  stepRadius
} from './radius';

describe('radius scale', () => {
  it('has 100 positions with ends 5 and 500', () => {
    expect(RADIUS_STEPS).toBe(100);
    expect(radiusFromPos(0)).toBe(5);
    expect(radiusFromPos(99)).toBe(500);
  });

  it('is monotonic and round-trips within one position', () => {
    let prev = 0;
    for (let p = 0; p < RADIUS_STEPS; p++) {
      const r = radiusFromPos(p);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(Number.isInteger(r)).toBe(true);
      prev = r;
      expect(Math.abs(posFromRadius(r) - p)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps posFromRadius to 0..99', () => {
    expect(posFromRadius(1)).toBeLessThanOrEqual(1);
    expect(posFromRadius(-50)).toBeGreaterThanOrEqual(0);
    expect(posFromRadius(9999)).toBe(99);
  });
});

describe('clampRadius', () => {
  it('rounds, clamps and defaults NaN to 30', () => {
    expect(clampRadius(4)).toBe(5);
    expect(clampRadius(501)).toBe(500);
    expect(clampRadius(30.4)).toBe(30);
    expect(clampRadius(NaN)).toBe(30);
  });
});

describe('stepRadius', () => {
  it('steps by 1.25', () => {
    expect(stepRadius(30, 'up')).toBe(38);
    expect(stepRadius(30, 'down')).toBe(24);
  });
  it('stops at bounds', () => {
    expect(stepRadius(500, 'up')).toBe(500);
    expect(stepRadius(5, 'down')).toBe(5);
  });
  it('always moves at least 1 m', () => {
    expect(stepRadius(5, 'up')).toBe(6);
    expect(stepRadius(6, 'up')).toBe(8);
    expect(stepRadius(6, 'down')).toBe(5);
    expect(stepRadius(2, 'up')).toBeGreaterThan(5);
  });
});

describe('stories', () => {
  it('clamps and rounds', () => {
    expect(clampStories(0.4)).toBe(1);
    expect(clampStories(80.6)).toBe(80);
    expect(clampStories(6.5)).toBe(7);
    expect(clampStories(NaN)).toBe(6);
  });
  it('derives height hint', () => {
    expect(heightHintM(6)).toBe(19);
  });
  it('lists presets', () => {
    expect([...STORY_PRESETS]).toEqual([2, 3, 4, 6, 8, 12, 20, 40]);
  });
});
