import { describe, expect, it, vi } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { MonthGate, clampDay, filledEndDay, indexOfDay, keyTarget, viewMonthOf } from './playhead';

const asOf = dayFromUtc(2025, 1, 1) - 1;
// First days of calendar months from 2025-01 to 2028-12.
const months = Array.from({ length: 48 }, (_, i) =>
  dayFromUtc(2025 + Math.floor(i / 12), (i % 12) + 1, 1)
);

describe('playhead rules', () => {
  it('End goes to the filled mark and nothing moves past it', () => {
    const end = filledEndDay(months, 10, asOf);
    expect(keyTarget('End', asOf, asOf, end)).toBe(end);
    expect(keyTarget('PageUp', end - 3, asOf, end)).toBe(end);
    expect(keyTarget('ArrowRight', end - 1, asOf, end)).toBe(end);
  });

  it('a playhead past the filled end does not move forward (a refill withdrew months under it)', () => {
    const end = filledEndDay(months, 10, asOf);
    const past = end + 40;
    expect(keyTarget('ArrowRight', past, asOf, end)).toBe(past);
    expect(keyTarget('ArrowUp', past, asOf, end)).toBe(past);
    expect(keyTarget('PageUp', past, asOf, end)).toBe(past);
    expect(keyTarget('ArrowLeft', past, asOf, end)).toBeLessThan(past);
  });

  it('Home goes to the dataset date; Left and Right move a month; Page keys a year', () => {
    const end = filledEndDay(months, 40, asOf);
    const mid = dayFromUtc(2026, 6, 15);
    expect(keyTarget('Home', mid, asOf, end)).toBe(asOf);
    expect(keyTarget('ArrowLeft', mid, asOf, end)).toBe(dayFromUtc(2026, 6, 1));
    expect(keyTarget('ArrowDown', mid, asOf, end)).toBe(dayFromUtc(2026, 6, 1));
    expect(keyTarget('ArrowRight', mid, asOf, end)).toBe(dayFromUtc(2026, 7, 1));
    expect(keyTarget('ArrowUp', mid, asOf, end)).toBe(dayFromUtc(2026, 7, 1));
    expect(keyTarget('PageDown', mid, asOf, end)).toBe(dayFromUtc(2025, 6, 1));
    expect(keyTarget('PageUp', mid, asOf, end)).toBe(dayFromUtc(2027, 6, 1));
    expect(keyTarget('a', mid, asOf, end)).toBeNull();
  });

  it('filledEndDay is the last day of the last final month, asOf before any', () => {
    expect(filledEndDay(months, -1, asOf)).toBe(asOf);
    expect(filledEndDay(months, 0, asOf)).toBe(months[1] - 1);
    expect(filledEndDay(months, 47, asOf)).toBe(dayFromUtc(2028, 12, 31));
  });

  it('indexOfDay clamps into the months', () => {
    expect(indexOfDay(months, dayFromUtc(2026, 3, 9))).toBe(14);
    expect(indexOfDay(months, dayFromUtc(2000, 1, 1))).toBe(0);
    expect(indexOfDay(months, dayFromUtc(2090, 1, 1))).toBe(47);
  });

  it('viewMonthOf is month 1 at the dataset date', () => {
    expect(viewMonthOf(asOf, asOf)).toBe(1);
    expect(viewMonthOf(asOf, asOf + 100)).toBeGreaterThan(1);
  });

  it('clampDay holds a day inside [asOf, end]', () => {
    expect(clampDay(asOf - 5, asOf, asOf + 10)).toBe(asOf);
    expect(clampDay(asOf + 50, asOf, asOf + 10)).toBe(asOf + 10);
    expect(clampDay(asOf + 4, asOf, asOf + 10)).toBe(asOf + 4);
  });
});

describe('MonthGate', () => {
  function rig() {
    vi.useFakeTimers();
    let t = 0;
    const sent: number[] = [];
    const gate = new MonthGate({
      send: (m) => sent.push(m),
      now: () => t,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    });
    const advance = (ms: number) => {
      t += ms;
      vi.advanceTimersByTime(ms);
    };
    return { gate, sent, advance };
  }

  it('sends at most once per 250 ms and then the latest month', () => {
    const { gate, sent, advance } = rig();
    gate.want(2);
    expect(sent).toEqual([2]);
    advance(100);
    gate.want(3);
    advance(100);
    gate.want(4);
    expect(sent).toEqual([2]);
    advance(50);
    expect(sent).toEqual([2, 4]);
    vi.useRealTimers();
  });

  it('dispose drops a pending month', () => {
    const { gate, sent, advance } = rig();
    gate.want(2);
    advance(10);
    gate.want(3);
    gate.dispose();
    advance(500);
    expect(sent).toEqual([2]);
    vi.useRealTimers();
  });

  it('works with the default timers', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const gate = new MonthGate({ send: (m) => sent.push(m), now: () => Date.now() });
    gate.want(2);
    gate.want(3);
    expect(sent).toEqual([2]);
    vi.advanceTimersByTime(250);
    expect(sent).toEqual([2, 3]);
    gate.dispose();
    vi.useRealTimers();
  });

  it('calls injected timers as plain functions, not as methods of the deps', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const real = { st: setTimeout, ct: clearTimeout };
    const strict = {
      // Like an unbound window.setTimeout: throws when `this` is the deps object.
      setTimeout(this: unknown, fn: () => void, ms: number) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        return real.st(fn, ms);
      },
      clearTimeout(this: unknown, t: ReturnType<typeof setTimeout>) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        real.ct(t);
      }
    };
    const gate = new MonthGate({
      send: (m) => sent.push(m),
      now: () => Date.now(),
      setTimeout: strict.setTimeout as unknown as typeof setTimeout,
      clearTimeout: strict.clearTimeout as unknown as typeof clearTimeout
    });
    gate.want(2);
    gate.want(3);
    gate.dispose();
    gate.want(4);
    vi.advanceTimersByTime(300);
    expect(sent).toEqual([2, 4]);
    vi.useRealTimers();
  });
});
