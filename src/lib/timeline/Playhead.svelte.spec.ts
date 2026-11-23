/// <reference types="@vitest/browser-playwright" />
import { flushSync, type ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { formatShortMonthYear } from '$lib/fzp/format';
import { dayFromUtc } from '$lib/fzp/time';
import type { Day } from '$lib/timelapse/time';
import PlayheadHost from './test/PlayheadHost.svelte';

const ASOF = dayFromUtc(2026, 10, 15);
const WINDOW_END = dayFromUtc(2066, 10, 31);
const END = dayFromUtc(2040, 12, 31);

/** A manual frame queue: the tests drive frames at chosen timestamps, no real timers. */
function manualRaf() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  let calls = 0;
  return {
    raf: (cb: FrameRequestCallback) => {
      calls += 1;
      const h = next++;
      queue.set(h, cb);
      return h;
    },
    cancelRaf: (h: number) => {
      queue.delete(h);
    },
    calls: () => calls,
    frame(ts: number) {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(ts);
      flushSync();
    }
  };
}

type HostProps = ComponentProps<typeof PlayheadHost>;
const stateText = () => page.getByTestId('state').element().textContent!;
const stateDay = () => Number(stateText().split('|')[0]);
const statePlaying = () => stateText().split('|')[1];
const stateSpeed = () => stateText().split('|')[2];
const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });
const play = () => page.getByTestId('tl-play');
const byId = (id: string) => page.getByTestId(id).element() as HTMLElement;
const rect = (el: Element) => el.getBoundingClientRect();
const centre = (r: DOMRect) => r.left + r.width / 2;
const near = (a: number, b: number, what: string, tol = 1) =>
  expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);

async function setup(props: Partial<HostProps> = {}, size: [number, number] = [1280, 900]) {
  await page.viewport(...size);
  const q = manualRaf();
  const onday = vi.fn();
  const view = await render(PlayheadHost, {
    props: {
      asOf: ASOF,
      windowEnd: WINDOW_END,
      end: END,
      onday,
      raf: q.raf,
      cancelRaf: q.cancelRaf,
      ...props
    }
  });
  return { q, onday, view };
}

/** The x of day `d` on the track. */
function xOf(d: Day): number {
  const t = rect(byId('tl-track'));
  return t.left + ((d - ASOF) / (WINDOW_END - ASOF)) * t.width;
}

function press(el: Element, clientX: number, clientY: number, type = 'pointerdown') {
  el.dispatchEvent(
    new PointerEvent(type, { clientX, clientY, pointerId: 1, button: 0, bubbles: true })
  );
  flushSync();
}

/** The min-height a `(pointer: coarse)` rule gives `el`, or null. */
function coarseMinHeight(el: Element): string | null {
  let found: string | null = null;
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of rules) {
      if (!(r instanceof CSSMediaRule) || !r.conditionText.includes('pointer: coarse')) continue;
      for (const s of r.cssRules) {
        if (s instanceof CSSStyleRule && s.style.minHeight && el.matches(s.selectorText))
          found = s.style.minHeight;
      }
    }
  }
  return found;
}

describe('Playhead', () => {
  for (const [w, h, tall] of [
    [1280, 900, 68],
    [1280, 720, 52],
    [390, 760, 68]
  ] as const) {
    it(`one row: the transport in the label cell, the ruler in the lane cell (${w}x${h})`, async () => {
      await setup({}, [w, h]);
      const controls = byId('tl-controls');
      const axis = byId('tl-axis');
      const grid = rect(byId('host-grid'));
      const c = rect(controls);
      const a = rect(axis);
      near(c.left, grid.left, 'label cell left');
      near(a.left, c.right, 'lane cell left');
      near(a.right, grid.right, 'lane cell right');
      near(c.top, a.top, 'one row');
      near(c.height, tall, 'row height');
      near(a.height, c.height, 'lane cell height');
      for (const id of ['tl-play', 'tl-speed', 'tl-today'])
        expect(controls.contains(byId(id)), id).toBe(true);
      // Line 1 is Play at the cell's content width; line 2 speed and Today, 4 px below it.
      const p = rect(byId('tl-play'));
      const s = rect(byId('tl-speed'));
      const t = rect(byId('tl-today'));
      const pad = w >= 768 ? 10 : 0;
      near(p.left, c.left + pad, 'play left');
      near(p.right, c.right - pad, 'play right');
      near(s.top, p.bottom + 4, 'line 2');
      near(t.top, s.top, 'today on line 2');
      expect(t.left).toBeGreaterThan(s.right);
      expect(t.right).toBeLessThanOrEqual(c.right - pad + 0.5);
      if (w < 768) {
        near(s.width, 44, 'speed width');
        near(t.width, 44, 'today width');
      }
      // The slider is the whole lane cell.
      const r = rect(slider().element());
      near(r.left, a.left, 'slider left');
      near(r.width, a.width, 'slider width');
      near(r.height, a.height, 'slider height');
      expect(slider().element().getAttribute('data-testid')).toBe('tl-ruler');
    });
  }

  it('the ruler is the slider: name, value, value text and description', async () => {
    const last = WINDOW_END - 20;
    await setup({
      last,
      reached: dayFromUtc(2045, 6, 10),
      goalDeadline: dayFromUtc(2031, 1, 31)
    });
    const el = slider();
    await expect.element(el).toHaveAttribute('aria-valuemin', String(ASOF));
    await expect.element(el).toHaveAttribute('aria-valuemax', String(last));
    await expect.element(el).toHaveAttribute('aria-valuenow', String(ASOF));
    await expect.element(el).toHaveAttribute('aria-valuetext', 'October 2026');
    await expect
      .element(el)
      .toHaveAccessibleDescription('Seen up to June 2045. Goal deadline January 2031.');
    // Everything drawn inside is hidden from assistive technology.
    for (const id of ['tl-year', 'tl-flag', 'tl-goal-flag', 'tl-zone-shown']) {
      const node = page.getByTestId(id).first().element();
      expect(node.closest('[aria-hidden=true]'), id).not.toBeNull();
    }
  });

  it("says how far is seen only while the furthest month is after the playhead's", async () => {
    const goalDeadline = dayFromUtc(2031, 1, 31);
    const day = dayFromUtc(2030, 3, 10);
    // Reached is the day itself: nothing seen ahead.
    const a = await setup({ startDay: day, goalDeadline });
    await expect.element(slider()).toHaveAccessibleDescription('Goal deadline January 2031.');
    a.view.unmount();
    // Reached later in the playhead's own month: still nothing.
    const b = await setup({ startDay: day, reached: dayFromUtc(2030, 3, 25), goalDeadline });
    await expect.element(slider()).toHaveAccessibleDescription('Goal deadline January 2031.');
    b.view.unmount();
    // Reached in a later month: said.
    await setup({ startDay: day, reached: dayFromUtc(2030, 4, 2), goalDeadline });
    await expect
      .element(slider())
      .toHaveAccessibleDescription('Seen up to April 2030. Goal deadline January 2031.');
  });

  it('with nothing seen ahead and no goal, the slider has no description', async () => {
    await setup();
    expect(slider().element().hasAttribute('aria-describedby')).toBe(false);
  });

  it('a press anywhere on the ruler, years and flags included, moves the day and pauses', async () => {
    const { onday } = await setup({ startPlaying: true, goalDeadline: dayFromUtc(2031, 1, 31) });
    const span = WINDOW_END - ASOF;
    const dayAtX = (x: number) => {
      const t = rect(byId('tl-track'));
      return Math.min(Math.max(Math.round(ASOF + ((x - t.left) / t.width) * span), ASOF), END);
    };
    const year = page
      .getByTestId('tl-year')
      .elements()
      .find((e) => e.textContent === '2031')!;
    const yr = rect(year);
    press(year, centre(yr), yr.top + yr.height / 2);
    near(stateDay(), dayAtX(centre(yr)), 'on a year', 1);
    expect(statePlaying()).toBe('false');
    expect(onday).toHaveBeenCalledTimes(1);

    const goal = rect(byId('tl-goal-flag'));
    press(byId('tl-goal-flag'), goal.left + 2, goal.top + goal.height / 2);
    near(stateDay(), dayAtX(goal.left + 2), 'on the goal flag', 1);

    const flag = rect(byId('tl-flag'));
    press(byId('tl-flag'), flag.right - 2, flag.top + flag.height / 2);
    near(stateDay(), dayAtX(flag.right - 2), 'on the date flag', 1);

    // A drag moves on; past the computed edge it clamps there.
    const r = rect(slider().element());
    press(slider().element(), r.left + r.width * 0.9, r.top + 5, 'pointermove');
    expect(stateDay()).toBe(END);
    press(slider().element(), r.left + r.width * 0.9, r.top + 5, 'pointerup');
    press(slider().element(), r.left + r.width * 0.1, r.top + 5, 'pointermove');
    expect(stateDay()).toBe(END);
  });

  it('Left and Right move a month, Page keys a year, Home the dataset date, End the computed edge', async () => {
    const start = dayFromUtc(2030, 3, 17);
    const { onday } = await setup({ startDay: start });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(stateDay()).toBe(dayFromUtc(2030, 4, 1));
    await userEvent.keyboard('{ArrowLeft}');
    expect(stateDay()).toBe(dayFromUtc(2030, 3, 1));
    await userEvent.keyboard('{PageUp}');
    expect(stateDay()).toBe(dayFromUtc(2031, 3, 1));
    await userEvent.keyboard('{PageDown}');
    expect(stateDay()).toBe(dayFromUtc(2030, 3, 1));
    await userEvent.keyboard('{End}');
    expect(stateDay()).toBe(END);
    await userEvent.keyboard('{ArrowRight}');
    expect(stateDay()).toBe(END);
    await userEvent.keyboard('{Home}');
    expect(stateDay()).toBe(ASOF);
    expect(onday).toHaveBeenCalledTimes(6);
  });

  it('leaves modified keys alone', async () => {
    const { onday } = await setup({ startDay: dayFromUtc(2030, 3, 17) });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Control>}{ArrowRight}{/Control}');
    await userEvent.keyboard('{Alt>}{Home}{/Alt}');
    expect(onday).not.toHaveBeenCalled();
    expect(stateDay()).toBe(dayFromUtc(2030, 3, 17));
  });

  it('does not move forward when the computed edge fell behind it', async () => {
    const start = dayFromUtc(2041, 6, 1);
    const { onday } = await setup({ startDay: start });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(stateDay()).toBe(start);
    expect(onday).not.toHaveBeenCalled();
  });

  it('a key pauses playback', async () => {
    const { q } = await setup({ startPlaying: true, startDay: dayFromUtc(2030, 3, 17) });
    expect(statePlaying()).toBe('true');
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(statePlaying()).toBe('false');
    expect(q.calls()).toBe(1);
  });

  it('nothing plays on mount', async () => {
    const { q } = await setup();
    expect(q.calls()).toBe(0);
    expect(statePlaying()).toBe('false');
  });

  it('Play and Pause are one button; Replay at last restarts from today', async () => {
    const { q, view } = await setup();
    await expect.element(play()).toHaveAccessibleName('Play');
    await play().click();
    expect(statePlaying()).toBe('true');
    await expect.element(play()).toHaveAccessibleName('Pause');
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBeGreaterThan(ASOF);
    expect(stateDay()).toBeLessThanOrEqual(END);
    await play().click();
    expect(statePlaying()).toBe('false');
    await expect.element(page.getByTestId('tl-play-label')).toHaveTextContent('Play');
    view.unmount();

    const last = WINDOW_END - 20;
    const at = await setup({ last, end: last, startDay: last - 10, startPlaying: true });
    at.q.frame(0);
    at.q.frame(100);
    expect(stateDay()).toBe(last);
    expect(statePlaying()).toBe('false');
    await expect.element(page.getByTestId('tl-play-label')).toHaveTextContent('Replay');
    await play().click();
    expect(stateDay()).toBe(ASOF);
    expect(statePlaying()).toBe('true');
    expect(at.onday).toHaveBeenLastCalledWith(ASOF);
  });

  it('Play from moves the day there, then plays', async () => {
    const from = dayFromUtc(2028, 3, 1);
    const { onday } = await setup({ startDay: dayFromUtc(2035, 5, 1), playFrom: from });
    await expect.element(page.getByTestId('tl-play-label')).toHaveTextContent('Play from 2028');
    await play().click();
    expect(onday).toHaveBeenCalledTimes(1);
    expect(onday).toHaveBeenCalledWith(from);
    expect(stateDay()).toBe(from);
    expect(statePlaying()).toBe('true');
  });

  it('the speed button switches 1× and 3× and never starts playback', async () => {
    const { q } = await setup();
    const speed = page.getByTestId('tl-speed');
    await expect.element(speed).toHaveTextContent('1×');
    await expect.element(speed).toHaveAccessibleName('1× speed, 1 year per second');
    await speed.click();
    expect(stateSpeed()).toBe('threeYears');
    await expect.element(speed).toHaveTextContent('3×');
    await expect.element(speed).toHaveAccessibleName('3× speed, 3 years per second');
    expect(statePlaying()).toBe('false');
    expect(q.calls()).toBe(0);
    await play().click();
    await speed.click();
    expect(stateSpeed()).toBe('year');
    expect(statePlaying()).toBe('true');
  });

  it('stops at the computed edge and goes on by itself when it moves', async () => {
    const end1 = ASOF + 100;
    const { q, view } = await setup({ end: end1, startPlaying: true });
    let ts = 0;
    q.frame(ts);
    for (let i = 0; i < 10; i++) q.frame((ts += 100));
    expect(stateDay()).toBe(end1);
    expect(statePlaying()).toBe('true');
    // Idle at the edge: frames keep coming and the day stays.
    q.frame((ts += 100));
    expect(stateDay()).toBe(end1);
    expect(statePlaying()).toBe('true');
    await view.rerender({ end: ASOF + 400 });
    flushSync();
    q.frame((ts += 100));
    q.frame(ts + 100);
    expect(stateDay()).toBeGreaterThan(end1);
    expect(statePlaying()).toBe('true');
  });

  it("the flag rides the playhead: Today at today, the month after; its centre is the thumb's", async () => {
    await setup();
    const flag = page.getByTestId('tl-flag');
    await expect.element(flag).toHaveTextContent('Today');
    // At today the thumb is at the track's start: the flag stays inside the lane cell.
    const axis = rect(byId('tl-axis'));
    expect(rect(flag.element()).left).toBeGreaterThanOrEqual(axis.left - 0.5);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(flag).toHaveTextContent('Nov 2026');
    for (let i = 0; i < 9; i++) await userEvent.keyboard('{PageUp}');
    await expect.element(flag).toHaveTextContent(formatShortMonthYear(stateDay()));
    const thumb = rect(byId('tl-thumb'));
    near(centre(rect(flag.element())), centre(thumb), 'flag centre');
    near(centre(thumb), xOf(stateDay()), 'thumb');
    // Every month's label fits the flag.
    for (let i = 0; i < 12; i++) {
      await userEvent.keyboard('{ArrowRight}');
      const el = flag.element() as HTMLElement;
      expect(el.scrollWidth, el.textContent!).toBeLessThanOrEqual(el.clientWidth);
    }
  });

  it('zones: shown to the day, seen to the furthest date, unseen hatched past it', async () => {
    const day = dayFromUtc(2032, 5, 1);
    const reached = dayFromUtc(2038, 2, 1);
    const { view } = await setup({ startDay: day, reached });
    const t = rect(byId('tl-track'));
    const shown = rect(byId('tl-zone-shown'));
    const seen = rect(byId('tl-zone-seen'));
    const unseen = rect(byId('tl-zone-unseen'));
    near(shown.left, t.left, 'shown left');
    near(shown.right, xOf(day), 'shown right');
    near(seen.left, xOf(day), 'seen left');
    near(seen.right, xOf(reached), 'seen right');
    near(unseen.left, xOf(reached), 'unseen left');
    near(unseen.right, t.right, 'unseen right');
    expect(getComputedStyle(byId('tl-zone-unseen')).backgroundImage).toContain(
      'repeating-linear-gradient'
    );
    for (const id of ['tl-zone-shown', 'tl-zone-seen'])
      expect(getComputedStyle(byId(id)).backgroundImage).toBe('none');
    // No transition on any zone, the thumb or the flag.
    for (const id of ['tl-zone-shown', 'tl-zone-seen', 'tl-zone-unseen', 'tl-thumb', 'tl-flag'])
      expect(getComputedStyle(byId(id)).transitionDuration, id).toBe('0s');
    await view.rerender({ reached: day });
    expect(rect(byId('tl-zone-seen')).width).toBeLessThanOrEqual(0.5);
    near(rect(byId('tl-zone-unseen')).left, xOf(day), 'unseen from the day');
    view.unmount();

    // `last` is short of the window's end: an edge at it snaps to the track's end.
    const last = WINDOW_END - 20;
    await setup({ last, end: last, startDay: last - 400, reached: last });
    const t2 = rect(byId('tl-track'));
    expect(rect(byId('tl-zone-unseen')).width).toBeLessThanOrEqual(0.5);
    near(rect(byId('tl-zone-seen')).right, t2.right, 'seen to the end');
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    near(rect(byId('tl-zone-shown')).right, t2.right, 'shown to the end');
    expect(rect(byId('tl-zone-seen')).width).toBeLessThanOrEqual(0.5);
    // The thumb stays at the day's own place.
    near(centre(rect(byId('tl-thumb'))), xOf(last), 'thumb at last');
  });

  it('the goal flag sits at the deadline, and is gone without one', async () => {
    const deadline = dayFromUtc(2031, 1, 31);
    const { view } = await setup({ goalDeadline: deadline });
    const goal = page.getByTestId('tl-goal-flag');
    await expect.element(goal).toHaveTextContent('Goal');
    near(centre(rect(goal.element())), xOf(deadline), 'goal flag');
    // It sits under the track; the years and the date flag above it.
    expect(rect(goal.element()).top).toBeGreaterThanOrEqual(rect(byId('tl-track')).bottom - 0.5);
    expect(rect(byId('tl-flag')).bottom).toBeLessThanOrEqual(rect(byId('tl-track')).top + 0.5);
    await view.rerender({ goalDeadline: null });
    expect(document.querySelector('[data-testid=tl-goal-flag]')).toBeNull();
  });

  describe('the bar flag', () => {
    const deadline = dayFromUtc(2066, 10, 31);
    const flags = () => document.querySelectorAll('[data-testid=tl-bar-flag]');
    const describedBy = () =>
      document.getElementById(byId('tl-ruler').getAttribute('aria-describedby') ?? '')
        ?.textContent ?? '';

    it('sits at its date beside the Goal flag, and the ruler names it', async () => {
      const bar = dayFromUtc(2057, 6, 1);
      await setup({ goalDeadline: deadline, barDay: bar, last: WINDOW_END, end: WINDOW_END });
      expect(flags()).toHaveLength(1);
      const el = byId('tl-bar-flag');
      expect(el.textContent).toBe('To beat');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      const t = rect(byId('tl-track'));
      const want = ((bar - ASOF) / (WINDOW_END - ASOF)) * 100;
      near(parseFloat(el.style.left), want, 'left percent', 0.01);
      near(centre(rect(el)), t.left + (want / 100) * t.width, 'bar flag place');
      await expect.element(page.getByTestId('tl-goal-flag')).toBeInTheDocument();
      expect(describedBy().endsWith('To beat June 2057.')).toBe(true);
    });

    it('a bar within 30 months of the deadline merges with the Goal flag', async () => {
      const goalDeadline = dayFromUtc(2031, 1, 31);
      const { view } = await setup({ goalDeadline, barDay: dayFromUtc(2028, 8, 1) });
      expect(flags()).toHaveLength(1);
      expect(byId('tl-bar-flag').textContent).toBe('Goal · To beat');
      near(centre(rect(byId('tl-bar-flag'))), xOf(goalDeadline), 'merged place');
      expect(document.querySelector('[data-testid=tl-goal-flag]')).toBeNull();
      // Exactly 30 months: two flags.
      await view.rerender({ barDay: dayFromUtc(2028, 7, 1) });
      expect(flags()).toHaveLength(1);
      expect(byId('tl-bar-flag').textContent).toBe('To beat');
      expect(document.querySelector('[data-testid=tl-goal-flag]')).not.toBeNull();
    });

    it('the bar alone', async () => {
      await setup({ goalDeadline: null, barDay: dayFromUtc(2040, 3, 1) });
      expect(flags()).toHaveLength(1);
      expect(byId('tl-bar-flag').textContent).toBe('To beat');
      expect(document.querySelector('[data-testid=tl-goal-flag]')).toBeNull();
    });

    it("no barDay, no flag, and the description is today's", async () => {
      await setup({ goalDeadline: deadline });
      expect(flags()).toHaveLength(0);
      expect(describedBy()).not.toContain('To beat');
    });
  });

  it('every target is at least 24 px, the same on every pointer', async () => {
    for (const size of [
      [1280, 900],
      [1280, 720],
      [390, 760]
    ] as const) {
      const { view } = await setup({}, [...size]);
      const targets = [byId('tl-play'), byId('tl-speed'), byId('tl-today'), byId('tl-ruler')];
      for (const el of targets) {
        const r = rect(el);
        expect(r.width, el.dataset.testid).toBeGreaterThanOrEqual(24);
        expect(r.height, el.dataset.testid).toBeGreaterThanOrEqual(24);
      }
      // No coarse-pointer rule enlarges them: one size for mouse and touch.
      for (const el of targets.slice(0, 3))
        expect(coarseMinHeight(el), el.dataset.testid).toBeNull();
      view.unmount();
    }
  });

  it('a year label the date flag overlaps is hidden whole, and shows again once the flag moves on', async () => {
    for (const size of [
      [1280, 900],
      [390, 760]
    ] as const) {
      const { view } = await setup({}, [...size]);
      const labels = [...document.querySelectorAll<HTMLElement>('[data-testid=tl-year]')];
      const shows = (el: HTMLElement) => el.checkVisibility({ visibilityProperty: true });
      const under = (el: HTMLElement) => {
        const f = rect(byId('tl-flag'));
        const r = rect(el);
        return r.right > f.left && r.left < f.right;
      };
      // At today: every label the flag overlaps is hidden, and the next one shows.
      await expect.element(page.getByTestId('tl-flag')).toHaveTextContent('Today');
      await expect.poll(() => labels.filter(under).every((l) => !shows(l))).toBe(true);
      const hidden = labels.filter(under);
      expect(hidden.length, `${size}`).toBeGreaterThan(0);
      const next = labels[labels.indexOf(hidden[hidden.length - 1]) + 1];
      expect(shows(next), `${size}: ${next.textContent}`).toBe(true);
      for (const l of labels.filter((l) => !under(l))) expect(shows(l), l.textContent!).toBe(true);
      // The playhead moves away: those labels show again.
      (slider().element() as HTMLElement).focus();
      await userEvent.keyboard('{End}');
      await expect.poll(() => stateDay()).toBe(END);
      for (const l of hidden.filter((l) => !under(l)))
        await expect.poll(() => shows(l), { message: l.textContent! }).toBe(true);
      expect(labels.filter(under).every((l) => !shows(l))).toBe(true);
      view.unmount();
    }
  });

  it('only the zone, thumb and flag styles change as the day moves; the years are never rewritten', async () => {
    await setup({ startDay: dayFromUtc(2030, 1, 10) });
    const ruler = slider().element();
    const years = byId('tl-years');
    // The steps run synchronously, so every record waits in the observers' queues.
    const yearObs = new MutationObserver(() => {});
    yearObs.observe(years, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
    const obs = new MutationObserver(() => {});
    obs.observe(ruler, { subtree: true, childList: true, attributes: true, characterData: true });
    const r = rect(ruler);
    for (let i = 0; i < 20; i++)
      press(
        ruler,
        r.left + r.width * (0.2 + i * 0.005),
        r.top + 5,
        i === 0 ? 'pointerdown' : 'pointermove'
      );
    const yearRecords = yearObs.takeRecords();
    const changed = new Set<string>();
    for (const rec of obs.takeRecords()) {
      const el = rec.target instanceof Element ? rec.target : rec.target.parentElement!;
      changed.add(
        el === ruler ? 'ruler' : (el.closest('[data-testid]')?.getAttribute('data-testid') ?? '?')
      );
    }
    obs.disconnect();
    yearObs.disconnect();
    // The years are never rewritten: the one change allowed is the class of a label the flag
    // crosses (hidden under it, shown again after), at most twice per label.
    for (const rec of yearRecords) {
      expect(rec.type).toBe('attributes');
      expect(rec.attributeName).toBe('class');
      expect((rec.target as Element).getAttribute('data-testid')).toBe('tl-year');
    }
    const perLabel = new Map<Node, number>();
    for (const rec of yearRecords) perLabel.set(rec.target, (perLabel.get(rec.target) ?? 0) + 1);
    for (const n of perLabel.values()) expect(n).toBeLessThanOrEqual(2);
    for (const id of changed)
      expect([
        'ruler',
        'tl-zone-shown',
        'tl-zone-seen',
        'tl-zone-unseen',
        'tl-thumb',
        'tl-flag',
        // Only as yearRecords allows above: the class of a label the flag crosses.
        'tl-year'
      ]).toContain(id);
    expect(changed.has('tl-thumb')).toBe(true);
  });
});
