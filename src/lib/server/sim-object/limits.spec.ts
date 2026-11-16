import { describe, expect, it } from 'vitest';
import { LIMITS, RateBucket, overFrameLimit, utf8Bytes } from './limits';
import { READER_RESUME_BUDGET, WRITER_RESUME_BUDGET } from './resume-budget';

describe('overFrameLimit', () => {
  it('is true only past the incoming frame limit, by string length', () => {
    const small = { ...LIMITS, frameBytes: 4 };
    expect(overFrameLimit('abcd', small)).toBe(false);
    expect(overFrameLimit('abcde', small)).toBe(true);
    // Four characters but eight UTF-8 bytes: not caught here, the host measures utf8Bytes.
    expect(overFrameLimit('éééé', small)).toBe(false);
    expect(overFrameLimit('x'.repeat(LIMITS.frameBytes + 1))).toBe(true);
  });
});

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

  it('takes n tokens at once, refusing when fewer are left, and refills by the second', () => {
    const b = new RateBucket(10, 4, 0);
    expect(b.take(0, 8)).toBe(true);
    expect(b.take(0, 3)).toBe(false);
    expect(b.take(0, 2)).toBe(true);
    expect(b.take(500, 2)).toBe(true);
    expect(b.take(500, 1)).toBe(false);
  });
});

describe('resume limits', () => {
  it('pins the resume bound and the two budgets, each able to pay for a full page', () => {
    expect(LIMITS.resumeBytes).toBe(8_388_608);
    expect(LIMITS.resumeBytes).toBeGreaterThanOrEqual(LIMITS.commitBytes);
    expect(WRITER_RESUME_BUDGET).toEqual({ burst: 25_165_824, perSecond: 4_194_304 });
    expect(READER_RESUME_BUDGET).toEqual({ burst: 12_582_912, perSecond: 2_097_152 });
    for (const b of [WRITER_RESUME_BUDGET, READER_RESUME_BUDGET]) {
      expect(b.burst).toBeGreaterThan(LIMITS.resumeBytes + LIMITS.commitBytes);
    }
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
