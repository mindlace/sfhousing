// A pool's level in its bar (timeline-ui, "A pool's bar shows its level"): one path, drawn under a
// shown clip to the playhead's day and a seen clip to the furthest day reached, nothing past it;
// as the day moves only the clips change.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import { dayFromUtc } from '$lib/fzp/time';
import type { Day } from '$lib/timelapse/time';
import LevelFill from './LevelFill.svelte';

// The path builders as they are, counted: a rebuild is a call.
vi.mock('./pool-level', async (importOriginal) => {
  const real = await importOriginal<typeof import('./pool-level')>();
  return { ...real, levelPath: vi.fn(real.levelPath), levelLine: vi.fn(real.levelLine) };
});
const { levelPath, levelLine } = await import('./pool-level');

const MONTHS: Day[] = Array.from({ length: 12 }, (_, i) => dayFromUtc(2026, 11 + i, 1));
const ASOF = MONTHS[0] + 14;
const FROM = ASOF;
const TO = dayFromUtc(2027, 11, 1) - 1;
const LEVEL = Float64Array.from([NaN, 1, 0.9, 0.7, 0.62, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0]);
const xOf = (d: Day) => ((d - FROM) / (TO - FROM)) * 1000;

async function setup(day: Day, reached: Day) {
  const props = { level: LEVEL, months: MONTHS, asOf: ASOF, from: FROM, to: TO, day, reached };
  const view = await render(LevelFill, { props });
  const svg = () => document.querySelector<SVGSVGElement>('[data-testid=tl-level]')!;
  const width = (id: string) =>
    Number(document.querySelector(`[data-testid=${id}]`)!.getAttribute('width'));
  const x = (id: string) =>
    Number(document.querySelector(`[data-testid=${id}]`)!.getAttribute('x'));
  return { view, props, svg, width, x };
}

describe('LevelFill', () => {
  it('draws the path under a shown clip to the day and a seen clip to reached; nothing past', async () => {
    const day = MONTHS[4] + 3;
    const reached = MONTHS[7] + 9;
    const s = await setup(day, reached);
    const shown = s.svg().querySelectorAll('[clip-path]');
    expect(shown).toHaveLength(2);
    expect(s.svg().querySelector('[data-testid=tl-level-shown] path')!.getAttribute('d')).toBe(
      s.svg().querySelector('[data-testid=tl-level-seen] path')!.getAttribute('d')
    );
    expect(s.x('tl-level-clip-shown')).toBe(0);
    expect(s.width('tl-level-clip-shown')).toBeCloseTo(xOf(day), 6);
    expect(s.x('tl-level-clip-seen')).toBeCloseTo(xOf(day), 6);
    expect(s.width('tl-level-clip-seen')).toBeCloseTo(xOf(reached) - xOf(day), 6);
    // The seen part is the dimmer.
    const alpha = (id: string) =>
      Number(s.svg().querySelector(`[data-testid=${id}] path`)!.getAttribute('fill-opacity'));
    expect(alpha('tl-level-seen')).toBe(alpha('tl-level-shown') / 2);
    // At today nothing is shown; a day before the box shows nothing either.
    await s.view.rerender({ ...s.props, day: ASOF, reached: ASOF });
    expect(s.width('tl-level-clip-shown')).toBe(0);
    expect(s.width('tl-level-clip-seen')).toBe(0);
  });

  it('a day change moves only the clip widths: the path d is not rewritten', async () => {
    const s = await setup(MONTHS[3] + 2, MONTHS[9]);
    const path = s.svg().querySelector('[data-testid=tl-level-shown] path')!;
    const builds = vi.mocked(levelPath).mock.calls.length;
    const lines = vi.mocked(levelLine).mock.calls.length;
    const changed: string[] = [];
    const mo = new MutationObserver((rs) => rs.forEach((r) => changed.push(r.attributeName!)));
    mo.observe(s.svg(), { attributes: true, subtree: true });
    for (const d of [MONTHS[4], MONTHS[5] + 20, MONTHS[6] + 1]) {
      await s.view.rerender({ ...s.props, day: d, reached: MONTHS[9] });
    }
    mo.takeRecords().forEach((r) => changed.push(r.attributeName!));
    mo.disconnect();
    expect(vi.mocked(levelPath).mock.calls.length).toBe(builds);
    expect(vi.mocked(levelLine).mock.calls.length).toBe(lines);
    expect(changed.length).toBeGreaterThan(0);
    expect(new Set(changed)).toEqual(new Set(['x', 'width', 'data-left']));
    expect(s.svg().querySelector('[data-testid=tl-level-shown] path')).toBe(path);
  });

  it('while stale both zones take the seen styling and the svg carries data-stale', async () => {
    const s = await setup(MONTHS[4] + 3, MONTHS[8]);
    const style = (id: string) => {
      const g = s.svg().querySelector(`[data-testid=${id}]`)!;
      const [area, edge] = g.querySelectorAll('path');
      return [area.getAttribute('fill-opacity'), edge.getAttribute('stroke-width')];
    };
    expect(s.svg().hasAttribute('data-stale')).toBe(false);
    expect(style('tl-level-shown')).toEqual(['1', '1.5']);
    await s.view.rerender({ ...s.props, stale: true });
    expect(s.svg().getAttribute('data-stale')).toBe('true');
    expect(style('tl-level-shown')).toEqual(style('tl-level-seen'));
    expect(style('tl-level-seen')).toEqual(['0.5', '1']);
  });

  it("aria-hidden; data-left is the playhead month's percent", async () => {
    const s = await setup(MONTHS[4] + 3, MONTHS[8]);
    expect(s.svg().getAttribute('aria-hidden')).toBe('true');
    expect(s.svg().getAttribute('data-left')).toBe('62');
    expect(getComputedStyle(s.svg()).pointerEvents).toBe('none');
    // Month 0 has no money yet; at today there is no reading.
    await s.view.rerender({ ...s.props, day: MONTHS[0] + 20 });
    expect(s.svg().getAttribute('data-left')).toBe('');
    await s.view.rerender({ ...s.props, day: ASOF });
    expect(s.svg().getAttribute('data-left')).toBe('');
    await s.view.rerender({ ...s.props, day: MONTHS[10] + 1 });
    expect(s.svg().getAttribute('data-left')).toBe('0');
  });
});
