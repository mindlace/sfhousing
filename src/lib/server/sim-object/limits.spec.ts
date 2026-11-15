import { describe, expect, it } from 'vitest';
import { LIMITS, RateBucket, utf8Bytes } from './limits';

describe('RateBucket', () => {
  it('allows a burst, then refuses', () => {
    const b = new RateBucket(3, 1, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
  });

  it('refills at its rate and never above its burst', () => {
    const b = new RateBucket(2, 2, 0);
    b.take(0);
    b.take(0);
    expect(b.take(0)).toBe(false);
    expect(b.take(500)).toBe(true);
    expect(b.take(500)).toBe(false);
    expect([b.take(60_000), b.take(60_000), b.take(60_000)]).toEqual([true, true, false]);
  });

  it('adds nothing when the clock goes back', () => {
    const b = new RateBucket(1, 1, 10_000);
    b.take(10_000);
    expect(b.take(0)).toBe(false);
  });
});

describe('limits', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('é')).toBe(2);
  });

  it('admits a frame a little larger than the largest commit', () => {
    expect(LIMITS.frameBytes).toBeGreaterThan(LIMITS.commitBytes);
  });

  it('caps a sim at 64 MiB', () => {
    expect(LIMITS.simBytes).toBe(67_108_864);
  });
});
