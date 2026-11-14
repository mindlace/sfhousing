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
    expect(permitting.textContent).toContain('2');
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
    expect(world.textContent).toContain(marketLevel(cal));
    await page.getByRole('button', { name: /^Permitting times, as observed/ }).click();
    expect(onselect).toHaveBeenCalledWith({ kind: 'permitting', id: 'fixed', span: 0 });
    const firstRow = document.querySelector(
      '[data-testid=tl-kind-permitting] [data-testid=tl-fixed]'
    );
    expect(firstRow?.textContent).toContain('Permitting times, as observed');
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
});
