/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { formatMonthYear } from '$lib/fzp/format';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { marketLevel } from '$lib/sim/scenario/market';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { OBSERVED_TIMING } from '$lib/sim-page/timing';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Pool } from '$lib/timelapse/types';
import type { Policy, SimPolicy4 } from './policy4';
import { moveEdge, moveSpan, type SpanRef, type TimelineWindow } from './spans';
import TimelineHost from './test/TimelineHost.svelte';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const calNoMoney: Calibration = { ...miniCal, market: undefined, baselineFunding: undefined };
const asOf = cal.asOf;
const w: TimelineWindow = { asOf, months: 480 };
const first = (m: number) => monthFirstDay(asOf, m);
const last = (m: number) => monthLastDay(asOf, m);
const windowEnd = last(480);

const pool: Pool = {
  id: 'u-pool-1',
  kind: 'generalRevenue',
  label: 'Housing bond',
  inflows: [{ kind: 'once', day: first(10), dollars: 500_000_000 }],
  uncapped: false,
  debt: null,
  leverage: 1
};

const zoning: Policy = {
  id: 'z1',
  label: 'Taller near transit',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: [] },
  spans: [{ from: first(1), to: null, what: { tag: 'bands', bands: [{ maxM: 400, stories: 8 }] } }]
};
const timingSpan = (from: number, to: number | null, scale: number) => ({
  from: first(from),
  to: to === null ? null : last(to),
  what: {
    tag: 'timing' as const,
    set: {
      ...structuredClone(OBSERVED_TIMING.current),
      presetTimers: [
        {
          pathway: 'discretionary' as const,
          stage: 'permitFiled' as const,
          scale,
          reach: 'all' as const
        }
      ]
    }
  }
});
const permitting: Policy = {
  id: 'p1',
  label: 'Faster permit review',
  preset: null,
  on: true,
  where: { tag: 'routes' },
  spans: [timingSpan(24, 71, 0.7), timingSpan(72, null, 0.5)]
};
const offPermitting: Policy = { ...permitting, id: 'p2', label: 'Paused review', on: false };
const money: Policy = {
  id: 'm1',
  label: 'Housing bond',
  preset: null,
  on: true,
  where: { tag: 'fund', pool: 'u-pool-1' },
  spans: [{ from: first(10), to: null, what: { tag: 'fund', pool, programmes: [] } }]
};

const doc: SimPolicy4 = {
  schema: 4,
  kinds: { zoning: [zoning], permitting: [permitting, offPermitting], money: [money] }
};

interface Over {
  policy?: SimPolicy4;
  calibration?: Calibration;
  readonly?: boolean;
  selected?: SpanRef | null;
  filledEnd?: number;
  playheadMonth?: number;
}

async function setup(over: Over = {}) {
  await page.viewport(1280, 900);
  const onedit = vi.fn();
  const onselect = vi.fn();
  const onadd = vi.fn();
  const props = {
    policy: doc,
    calibration: cal,
    asOf,
    readonly: false,
    selected: null,
    onselect,
    onedit,
    onadd,
    playheadMonth: 1,
    filledEnd: windowEnd,
    ...over
  };
  const view = await render(TimelineHost, { props });
  const rerender = (next: Over) => view.rerender({ ...props, ...next });
  return { onedit, onselect, onadd, view, rerender };
}

const kindButton = (name: string) => page.getByRole('button', { name, exact: true });
const all = <T extends Element = HTMLElement>(sel: string) => [
  ...document.querySelectorAll<T>(sel)
];
const barsOf = (kind: string) => all(`[data-testid=tl-kind-${kind}] [data-testid=tl-bar]`);

describe('Timeline rows', () => {
  it('renders closed kinds as miniatures with a count and +', async () => {
    await setup();
    await expect.element(page.getByTestId('ph-part')).toBeInTheDocument();
    await expect.element(page.getByTestId('chart-part')).toBeInTheDocument();
    const wanted = [
      'ph-part',
      'chart-part',
      'tl-kind-zoning',
      'tl-kind-permitting',
      'tl-kind-money',
      'tl-world'
    ];
    const order = all('[data-testid]')
      .map((e) => e.getAttribute('data-testid')!)
      .filter((t) => wanted.includes(t));
    expect(order).toEqual(wanted);
    const permitting = page.getByTestId('tl-kind-permitting').element();
    expect(permitting.querySelector('[data-testid=tl-count]')?.textContent).toBe('2');
    expect(kindButton('Permitting').element().getAttribute('aria-describedby')).toBe(
      permitting.querySelector('[data-testid=tl-count]')?.id
    );
    expect(permitting.querySelectorAll('[data-testid=tl-mini]')).toHaveLength(2);
    expect(barsOf('permitting')).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'Add Zoning policy' })).toBeVisible();
  });

  it('opens a kind: a row per policy, a bar per span with its setting', async () => {
    await setup();
    await kindButton('Permitting').click();
    const rows = all('[data-testid=tl-kind-permitting] [data-testid=tl-policy]');
    expect(rows).toHaveLength(2);
    expect(all('[data-testid=tl-kind-permitting] [data-testid=tl-mini]')).toHaveLength(0);
    const bars = barsOf('permitting');
    expect(bars.map((b) => b.textContent?.trim())).toEqual([
      '30% faster',
      '50% faster',
      '30% faster',
      '50% faster'
    ]);
    // An off policy is dimmed in place; an open end fades.
    expect(rows[0].getAttribute('data-off')).toBe('false');
    expect(rows[1].getAttribute('data-off')).toBe('true');
    expect(bars[1].getAttribute('data-open')).toBe('true');
    expect(bars[0].getAttribute('data-open')).toBe('false');
    await kindButton('Public money').click();
    expect(barsOf('money').map((b) => b.textContent?.trim())).toEqual(['$500M']);
  });

  it('renders the fixed rows and Market conditions', async () => {
    const { onselect } = await setup();
    await kindButton('Zoning').click();
    await kindButton('Permitting').click();
    await kindButton('Public money').click();
    for (const name of [
      'Family Zoning Plan, as adopted',
      'Permitting times, as observed',
      'City funding today'
    ]) {
      await expect
        .element(page.getByRole('button', { name: new RegExp(`^${name}`) }))
        .toBeVisible();
    }
    const world = page.getByTestId('tl-world').element();
    expect(world.textContent).toContain('Market conditions');
    expect(world.textContent).toContain(
      marketLevel(cal) === 'private' ? 'private starts only' : 'all starts'
    );
    expect(world.textContent).not.toMatch(/, (private|all)$/);
    await page.getByRole('button', { name: /^Permitting times, as observed/ }).click();
    expect(onselect).toHaveBeenCalledWith({ kind: 'permitting', id: 'fixed', span: -1 });
    const firstRow = document.querySelector(
      '[data-testid=tl-kind-permitting] [data-testid=tl-fixed]'
    );
    expect(firstRow?.textContent).toContain('Permitting times, as observed');
    const rowOrder = all(
      '[data-testid=tl-kind-permitting] [data-testid=tl-fixed], [data-testid=tl-kind-permitting] [data-testid=tl-policy]'
    ).map((e) => e.getAttribute('data-testid'));
    expect(rowOrder).toEqual(['tl-fixed', 'tl-policy', 'tl-policy']);
  });

  it('has no Public money without market and baseline funding', async () => {
    await setup({ calibration: calNoMoney });
    expect(document.querySelector('[data-testid=tl-kind-money]')).toBeNull();
    expect(document.body.textContent).not.toContain('City funding today');
    expect(document.body.textContent).not.toContain('Housing bond');
    expect(page.getByTestId('tl-world').element().textContent).toContain('2007 to 2025 average');
  });

  it("a bar's keys produce the expected document", async () => {
    const { onedit } = await setup({ playheadMonth: 1 });
    await kindButton('Permitting').click();
    const name = `Faster permit review, ${formatMonthYear(first(24))} to ${formatMonthYear(last(71))}`;
    (page.getByRole('button', { name }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onedit).toHaveBeenCalledTimes(1);
    const [change, label] = onedit.mock.calls[0];
    expect(label).toBe('Moved: Faster permit review');
    const ref: SpanRef = { kind: 'permitting', id: 'p1', span: 0 };
    // The playhead is at month 1, so the nearer edge is the start.
    expect(change(doc)).toEqual(moveEdge(doc, ref, 'from', 12, w));
    expect(change(doc)).not.toEqual(doc);
  });

  it('moves the end when the playhead is nearer it, and the whole span with Alt', async () => {
    const { onedit } = await setup({ playheadMonth: 80 });
    await kindButton('Permitting').click();
    barsOf('permitting')[0].focus();
    await userEvent.keyboard('{ArrowLeft}');
    const ref: SpanRef = { kind: 'permitting', id: 'p1', span: 0 };
    expect(onedit.mock.calls[0][0](doc)).toEqual(moveEdge(doc, ref, 'to', -1, w));
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    expect(onedit).toHaveBeenCalledTimes(2);
    expect(onedit.mock.calls[1][0](doc)).toEqual(moveSpan(doc, ref, -1, w));
    expect(onedit.mock.calls[1][0](doc)).not.toEqual(doc);
  });

  it('every bar is reachable by Tab and operable by Enter', async () => {
    const { onselect } = await setup();
    await kindButton('Permitting').click();
    const bars = barsOf('permitting');
    expect(bars).toHaveLength(4);
    const seen = new Set<Element>();
    kindButton('Permitting').element().focus();
    for (let i = 0; i < 24 && seen.size < bars.length; i++) {
      await userEvent.tab();
      const a = document.activeElement;
      if (a && bars.includes(a as HTMLElement)) seen.add(a);
    }
    expect(seen.size).toBe(4);
    bars[2].focus();
    await userEvent.keyboard('{Enter}');
    expect(onselect).toHaveBeenLastCalledWith({ kind: 'permitting', id: 'p2', span: 0 });
  });

  it('readonly renders no + and ignores bar keys', async () => {
    const { onedit } = await setup({ readonly: true });
    expect(all('[aria-label^="Add "]')).toHaveLength(0);
    await kindButton('Permitting').click();
    barsOf('permitting')[0].focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onedit).not.toHaveBeenCalled();
  });

  it('"+" asks the page to add to its kind', async () => {
    const { onadd } = await setup();
    await page.getByRole('button', { name: 'Add Permitting policy' }).click();
    expect(onadd).toHaveBeenCalledWith('permitting');
  });

  it('a pointer drag of an edge commits one edit on pointer-up', async () => {
    const { onedit } = await setup();
    await kindButton('Permitting').click();
    const bar = barsOf('permitting')[0];
    const handle = bar.parentElement!.querySelector<HTMLElement>('[data-edge=to]')!;
    const lane = bar.closest<HTMLElement>('[data-testid=tl-lane]')!.getBoundingClientRect();
    const hr = handle.getBoundingClientRect();
    const at = (months: number) => lane.left + (lane.width * months) / 480;
    const y = hr.top + hr.height / 2;
    const fire = (type: string, x: number) =>
      handle.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          pointerId: 1,
          button: 0,
          bubbles: true,
          pointerType: 'mouse'
        })
      );
    fire('pointerdown', hr.left + hr.width / 2);
    fire('pointermove', at(60));
    expect(onedit).not.toHaveBeenCalled();
    fire('pointerup', at(60));
    expect(onedit).toHaveBeenCalledTimes(1);
    const [change, label] = onedit.mock.calls[0];
    expect(label).toBe('Moved: Faster permit review');
    const next = change(doc) as SimPolicy4;
    expect(next.kinds.permitting[0].spans[0].to).not.toBe(doc.kinds.permitting[0].spans[0].to);
  });

  it('hatches every row past filledEnd and moves the hatch when filledEnd grows', async () => {
    const quarter = (n: number) => asOf + Math.floor(((windowEnd - asOf) * n) / 4);
    const { rerender } = await setup({ filledEnd: quarter(1) });
    await kindButton('Permitting').click();
    const hatches = () => all('[data-testid=tl-hatch]');
    const lanes = all('[data-testid=tl-lane]');
    expect(lanes.length).toBeGreaterThan(5);
    expect(hatches()).toHaveLength(lanes.length);
    for (const h of hatches()) expect(parseFloat(h.style.left)).toBeCloseTo(25, 0);
    await rerender({ filledEnd: quarter(3) });
    for (const h of hatches()) expect(parseFloat(h.style.left)).toBeCloseTo(75, 0);
    await rerender({ filledEnd: windowEnd });
    expect(hatches()).toHaveLength(0);
  });

  it('on a phone a kind opens as a sheet over the same rows', async () => {
    await setup();
    await page.viewport(390, 800);
    await expect.element(page.getByTestId('ph-part')).toBeVisible();
    await kindButton('Permitting').click();
    const sheet = page.getByRole('dialog', { name: 'Permitting' });
    await expect.element(sheet).toBeVisible();
    expect(sheet.element().querySelectorAll('[data-testid=tl-policy]')).toHaveLength(2);
    // The playhead part and the chart stay above the sheet.
    const top = sheet.element().getBoundingClientRect().top;
    const chart = page.getByTestId('chart-part').element().getBoundingClientRect();
    expect(chart.bottom).toBeLessThanOrEqual(top + 1);
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('on a phone an Escape the editor took (default prevented) leaves the sheet open', async () => {
    await setup();
    await page.viewport(390, 800);
    await kindButton('Permitting').click();
    const sheet = page.getByRole('dialog', { name: 'Permitting' });
    await expect.element(sheet).toBeVisible();
    // The editor's own Escape handler runs first and prevents the default.
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('draws the hatch beneath the bars and keeps every bar text at 4.5:1', async () => {
    await setup({ filledEnd: asOf + Math.floor((windowEnd - asOf) / 8) });
    await kindButton('Permitting').click();
    const rgb = (c: string) =>
      c
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
    const lum = (c: string) => {
      const [r, g, b] = rgb(c).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const bars = barsOf('permitting');
    // Bars 2 and 3 are the off policy's; all four sit wholly under the hatch.
    for (const b of bars) {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      expect(top === b || b.contains(top)).toBe(true);
      const st = getComputedStyle(b);
      expect(ratio(st.color, st.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    }
    for (const kind of ['zoning', 'money'] as const) {
      await kindButton(kind === 'zoning' ? 'Zoning' : 'Public money').click();
      for (const b of barsOf(kind)) {
        const st = getComputedStyle(b);
        expect(ratio(st.color, st.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      }
    }
    const off = barsOf('permitting')[2];
    expect(off.getAttribute('aria-label')).toMatch(/, off$/);
    expect(getComputedStyle(off).opacity).toBe('1');
  });

  it('moves focus into the phone sheet, keeps it there and returns it on close', async () => {
    await setup();
    await page.viewport(390, 800);
    await expect.element(page.getByTestId('ph-part')).toBeVisible();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const toggle = kindButton('Permitting').element() as HTMLElement;
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('dialog', { name: 'Permitting' })).toBeVisible();
    const sheet = page.getByRole('dialog', { name: 'Permitting' }).element();
    await expect
      .poll(() =>
        sheet.contains(document.activeElement)
          ? 'in'
          : String(document.activeElement?.outerHTML).slice(0, 120)
      )
      .toBe('in');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
    // Nothing behind the sheet takes focus.
    expect(toggle.closest('[inert]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await expect.poll(() => document.activeElement === toggle).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the playhead and chart in view and the sheet tall when the timeline is low or scrolled', async () => {
    await page.viewport(390, 800);
    const spacer = document.createElement('div');
    spacer.style.height = '1500px';
    document.body.insertBefore(spacer, document.body.firstChild);
    await setup();
    await page.viewport(390, 800);
    const check = async () => {
      await kindButton('Permitting').click();
      const sheet = page.getByRole('dialog', { name: 'Permitting' }).element();
      await expect.poll(() => sheet.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
      const r = sheet.getBoundingClientRect();
      const ph = page.getByTestId('ph-part').element().getBoundingClientRect();
      const chart = page.getByTestId('chart-part').element().getBoundingClientRect();
      expect(ph.top).toBeGreaterThanOrEqual(0);
      expect(chart.bottom).toBeLessThanOrEqual(r.top + 1);
      expect(window.innerHeight - r.top).toBeGreaterThanOrEqual(300);
      await userEvent.keyboard('{Escape}');
    };
    window.scrollTo(0, 0);
    await check();
    window.scrollTo(0, document.documentElement.scrollHeight);
    await check();
    spacer.remove();
  });
  it('does not take a policy named fixed for a fixed row', async () => {
    const named: SimPolicy4 = {
      ...doc,
      kinds: { ...doc.kinds, permitting: [{ ...permitting, id: 'fixed', label: 'Fixed review' }] }
    };
    await setup({ policy: named, selected: { kind: 'permitting', id: 'fixed', span: 0 } });
    await kindButton('Permitting').click();
    const bars = barsOf('permitting');
    expect(bars[0].getAttribute('aria-pressed')).toBe('true');
    const fixed = document.querySelector(
      '[data-testid=tl-kind-permitting] [data-testid=tl-fixed] button'
    )!;
    expect(fixed.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps dark-mode bar fills at 3:1 and bar text at 4.5:1', () => {
    // The dark media rules, read from the stylesheet (the test page is light).
    const vars = new Map<string, string>();
    const walk = (rules: CSSRuleList, dark: boolean) => {
      for (const r of rules) {
        if (r instanceof CSSMediaRule) walk(r.cssRules, dark || r.conditionText.includes('dark'));
        else if (
          dark &&
          r instanceof CSSStyleRule &&
          /(^|\s)\.tl[.\s{]|^\.tl$/.test(r.selectorText)
        ) {
          for (const n of r.style)
            if (n.startsWith('--')) vars.set(n, r.style.getPropertyValue(n).trim());
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules, false);
      } catch {
        // A cross-origin sheet.
      }
    }
    const root = getComputedStyle(document.documentElement);
    const surface = root.getPropertyValue('--color-surface-dark').trim();
    const raised = root.getPropertyValue('--color-surface-dark-raised').trim();
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const lum = (c: string) => {
      const [r, g, b] = hex(c).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const on = vars.get('--on-k')!;
    expect(on).toMatch(/^#/);
    for (const k of ['zoning', 'permitting', 'money', 'world']) {
      const fill = vars.get(`--k-${k}`)!;
      expect(fill, k).toMatch(/^#/);
      expect(ratio(fill, surface), `${k} fill`).toBeGreaterThanOrEqual(3);
      expect(ratio(fill, raised), `${k} ring`).toBeGreaterThanOrEqual(3);
      expect(ratio(on, fill), `${k} text`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
