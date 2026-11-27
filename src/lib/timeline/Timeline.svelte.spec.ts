/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { isGiven, OPEN_LIMITS, within, type Limits } from '$lib/game/limits';
import { NOT_IN_GAME } from './copy';
import { limitsWith } from './test/limits';
import { dayPct, fixedRef, formatEdge } from './rows';
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
import { PLUS_NAME } from './test/plus';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { indexOfDay } from './playhead';
import type { LevelSet } from './pool-level';

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
  playheadMonth?: number;
  playheadDay?: number;
  pinned?: boolean;
  /** Px: the timeline sits in a box this tall. */
  height?: number;
  levels?: LevelSet | null;
  reached?: number;
  stale?: boolean;
  limits?: Limits;
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
    playheadDay: first(1),
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
    await expect.element(page.getByRole('button', { name: PLUS_NAME.Zoning })).toBeVisible();
  });

  it('draws one playhead line through the pinned block and every row at the playhead day', async () => {
    await setup({ playheadDay: first(13) });
    const lines = all('[data-testid=tl-playhead-line]');
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(parseFloat(l.style.left)).toBeCloseTo(dayPct(first(13), asOf, windowEnd), 2);
      expect(l.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(l).pointerEvents).toBe('none');
    }
    const pin = page.getByTestId('tl-pin').element().getBoundingClientRect();
    const grid = page.getByTestId('tl-rows').element().getBoundingClientRect();
    const [a, b] = lines.map((l) => l.getBoundingClientRect());
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.bottom - pin.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.top - pin.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.bottom - grid.bottom)).toBeLessThanOrEqual(1);
    expect(b.height).toBeGreaterThan(100);
  });

  it('in a box where the rows scroll, their line segment spans every row, not just the box', async () => {
    const { rows } = await tall({ playheadDay: first(13) });
    expect(rows.scrollHeight).toBeGreaterThan(rows.clientHeight);
    const line = rows.querySelector<HTMLElement>('[data-testid=tl-playhead-line]')!;
    expect(Math.abs(line.getBoundingClientRect().height - rows.scrollHeight)).toBeLessThanOrEqual(
      1
    );
  });

  it('reports the pinned block height and keeps its background opaque', async () => {
    await setup();
    const pin = page.getByTestId('tl-pin').element() as HTMLElement;
    const host = page.getByTestId('host-pin').element();
    await expect.poll(() => Number(host.getAttribute('data-pin-height'))).toBeGreaterThan(0);
    expect(
      Math.abs(Number(host.getAttribute('data-pin-height')) - pin.offsetHeight)
    ).toBeLessThanOrEqual(1);
    const style = getComputedStyle(pin);
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.backgroundColor).not.toBe('transparent');
    expect(style.position).not.toBe('sticky');
  });

  /** Every kind open in a 300 px box: the rows run past it. */
  async function tall(over: Over = {}) {
    await setup({ height: 300, ...over });
    for (const name of ['Zoning', 'Permitting', 'Public money']) await kindButton(name).click();
    await expect
      .element(page.getByTestId('tl-kind-money').getByTestId('tl-bar').first())
      .toBeInTheDocument();
    return {
      pin: page.getByTestId('tl-pin').element() as HTMLElement,
      rows: page.getByTestId('tl-rows').element() as HTMLElement
    };
  }

  it('the pinned block and the rows are two boxes; the rows box scrolls under nothing', async () => {
    const { pin, rows } = await tall();
    expect(getComputedStyle(rows).overflowY).toBe('auto');
    expect(rows.scrollHeight).toBeGreaterThan(rows.clientHeight);
    expect(getComputedStyle(pin).position).not.toBe('sticky');
    expect(rows.contains(pin)).toBe(false);
    expect(
      Math.abs(rows.getBoundingClientRect().top - pin.getBoundingClientRect().bottom)
    ).toBeLessThanOrEqual(0.5);
    const host = page.getByTestId('host-pin').element().getBoundingClientRect();
    expect(rows.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.bottom + 0.5);
  });

  it('the block and the rows share one x scale, the rows scrollbar included', async () => {
    // A classic scrollbar (headless Chromium overlays its own, 0 px wide).
    const bar = document.createElement('style');
    bar.textContent = '[data-testid=tl-rows]::-webkit-scrollbar { width: 12px }';
    document.head.appendChild(bar);
    onTestFinished(() => {
      bar.remove();
    });
    const { pin, rows } = await tall();
    await expect.poll(() => rows.offsetWidth - rows.clientWidth).toBe(12);
    const a = () => pin.querySelector('[data-testid=tl-lane]')!.getBoundingClientRect();
    const b = rows.querySelector('[data-testid=tl-lane]')!.getBoundingClientRect();
    await expect.poll(() => Math.abs(a().width - b.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a().left - b.left)).toBeLessThanOrEqual(1);
  });

  it('unpinned, the rows box does not scroll and the timeline is one piece', async () => {
    const { pin, rows } = await tall({ pinned: false });
    expect(getComputedStyle(rows).overflowY).toBe('visible');
    expect(rows.scrollHeight).toBeLessThanOrEqual(rows.clientHeight + 1);
    expect(
      Math.abs(rows.getBoundingClientRect().top - pin.getBoundingClientRect().bottom)
    ).toBeLessThanOrEqual(0.5);
  });

  it('on a phone the playhead line runs through the lanes of an open kind sheet', async () => {
    await setup({ playheadDay: first(13) });
    await page.viewport(390, 800);
    await kindButton('Permitting').click();
    const sheet = page.getByRole('dialog', { name: 'Permitting' });
    await expect.element(sheet).toBeVisible();
    const line = sheet.element().querySelector<HTMLElement>('[data-testid=tl-playhead-line]');
    expect(line).not.toBeNull();
    expect(parseFloat(line!.style.left)).toBeCloseTo(dayPct(first(13), asOf, windowEnd), 2);
    expect(line!.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(line!).pointerEvents).toBe('none');
    // The lanes drawn (below md the open kind's own, empty lane is not).
    const lanes = [
      ...sheet.element().querySelectorAll<HTMLElement>('[data-testid=tl-lane]')
    ].filter((l) => l.getBoundingClientRect().height > 0);
    expect(lanes.length).toBeGreaterThan(1);
    const l = line!.getBoundingClientRect();
    const x = l.left + l.width / 2;
    const lane = lanes[0].getBoundingClientRect();
    expect(
      Math.abs(x - (lane.left + (lane.width * parseFloat(line!.style.left)) / 100))
    ).toBeLessThanOrEqual(1);
    expect(l.top).toBeLessThanOrEqual(lane.top + 1);
    expect(l.bottom).toBeGreaterThanOrEqual(
      lanes[lanes.length - 1].getBoundingClientRect().bottom - 1
    );
    await userEvent.keyboard('{Escape}');
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
    for (const name of ['Current law', 'Current timelines', 'Current funding']) {
      await expect
        .element(page.getByRole('button', { name: new RegExp(`, ${name}, whole window$`) }))
        .toBeVisible();
    }
    const world = page.getByTestId('tl-world').element();
    expect(world.textContent).toContain('Market conditions');
    expect(world.textContent).toContain(
      marketLevel(cal) === 'private' ? 'private starts only' : 'all starts'
    );
    expect(world.textContent).not.toMatch(/, (private|all)$/);
    await page.getByRole('button', { name: /, Current timelines, whole window$/ }).click();
    expect(onselect).toHaveBeenCalledWith({ kind: 'permitting', id: 'fixed', span: -1 });
    const firstRow = document.querySelector(
      '[data-testid=tl-kind-permitting] [data-testid=tl-fixed]'
    );
    expect(firstRow?.textContent).toContain('Current timelines');
    const rowOrder = all(
      '[data-testid=tl-kind-permitting] [data-testid=tl-fixed], [data-testid=tl-kind-permitting] [data-testid=tl-policy]'
    ).map((e) => e.getAttribute('data-testid'));
    expect(rowOrder).toEqual(['tl-fixed', 'tl-policy', 'tl-policy']);
  });

  it('has no Public money without market and baseline funding', async () => {
    await setup({ calibration: calNoMoney });
    expect(document.querySelector('[data-testid=tl-kind-money]')).toBeNull();
    expect(document.body.textContent).not.toContain('Current funding');
    expect(document.body.textContent).not.toContain('Housing bond');
    expect(page.getByTestId('tl-world').element().textContent).toContain('2007 to 2025 average');
  });

  it("a bar's keys produce the expected document", async () => {
    const { onedit } = await setup({ playheadMonth: 1 });
    await kindButton('Permitting').click();
    const name = `30% faster, Faster permit review, ${formatEdge(first(24))} to ${formatEdge(last(71))}`;
    (page.getByRole('button', { name }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onedit).toHaveBeenCalledTimes(1);
    const [change, label] = onedit.mock.calls[0] as [(d: SimPolicy4) => SimPolicy4, string];
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
    await page.getByRole('button', { name: PLUS_NAME.Permitting }).click();
    expect(onadd).toHaveBeenCalledWith('permitting');
  });

  const emptyDoc: SimPolicy4 = { schema: 4, kinds: { zoning: [], permitting: [], money: [] } };
  const laneWords = () => all('[data-testid=tl-empty-lane]');

  it('a closed empty kind shows its words in the lane; pressing them calls onadd(kind)', async () => {
    const { onadd } = await setup({
      policy: { ...emptyDoc, kinds: { ...emptyDoc.kinds, zoning: [zoning] } }
    });
    // Zoning has a policy: its miniature, no words. The other two say what "+" adds.
    expect(laneWords().map((e) => e.textContent!.trim())).toEqual([
      'Add a permitting change',
      'Add public money'
    ]);
    const words = page.getByTestId('tl-kind-money').getByTestId('tl-empty-lane');
    await expect.element(words).toBeVisible();
    expect(words.element().closest('[data-testid=tl-lane]')).not.toBeNull();
    await words.click();
    expect(onadd).toHaveBeenCalledExactlyOnceWith('money');
    // Open, the kind shows its rows instead.
    await kindButton('Permitting').click();
    expect(laneWords().map((e) => e.textContent!.trim())).toEqual(['Add public money']);
  });

  it('while the words show, the "+" is named by them (voice control); otherwise "Add {kind} policy"', async () => {
    const plusOf = (kind: string) =>
      page.getByTestId(`tl-kind-${kind}`).element().querySelector<HTMLElement>('button.plus')!;
    const { rerender } = await setup({ policy: emptyDoc });
    for (const [kind, words] of [
      ['zoning', 'Add a zoning change'],
      ['permitting', 'Add a permitting change'],
      ['money', 'Add public money']
    ])
      await expect.element(plusOf(kind)).toHaveAccessibleName(words);
    // With a policy the words go, and the "+" takes its kind's name again.
    await rerender({ policy: { ...emptyDoc, kinds: { ...emptyDoc.kinds, zoning: [zoning] } } });
    await expect.element(plusOf('zoning')).toHaveAccessibleName('Add Zoning policy');
    await expect.element(plusOf('money')).toHaveAccessibleName('Add public money');
    // Open, likewise.
    await kindButton('Permitting').click();
    await expect.element(plusOf('permitting')).toHaveAccessibleName('Add Permitting policy');
  });

  it('the words are hidden from assistive tech and out of tab order; read-only shows none', async () => {
    const { rerender } = await setup({ policy: emptyDoc });
    const words = laneWords();
    expect(words).toHaveLength(3);
    for (const w of words) {
      expect(w.getAttribute('aria-hidden')).toBe('true');
      expect(w.getAttribute('tabindex')).toBe('-1');
      // The "+" named for the kind stays the one keyboard and assistive path.
      const kind = w.closest('[data-testid^=tl-kind-]')!;
      expect(kind.querySelectorAll('button.plus')).toHaveLength(1);
      // A 24 px target at least.
      expect(w.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    }
    await rerender({ policy: emptyDoc, readonly: true });
    expect(laneWords()).toHaveLength(0);
    expect(page.getByRole('button', { name: /^Add / }).elements()).toHaveLength(0);
    // No Public money kind, no words for it.
    await rerender({ policy: emptyDoc, calibration: calNoMoney });
    expect(laneWords().map((e) => e.textContent!.trim())).toEqual([
      'Add a zoning change',
      'Add a permitting change'
    ]);
  });

  it('a click on the words adds but never focuses them (they are hidden from assistive tech)', async () => {
    const { onadd } = await setup({ policy: emptyDoc });
    const words = laneWords()[0];
    await userEvent.click(words);
    expect(onadd).toHaveBeenCalledExactlyOnceWith('zoning');
    // Focus is where a press of the row's "+" leaves it: on the "+".
    expect(document.activeElement).not.toBe(words);
    expect(document.activeElement).toBe(
      words.closest('[data-testid=tl-kind-zoning]')!.querySelector('button.plus')
    );
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
    const [change, label] = onedit.mock.calls[0] as [(d: SimPolicy4) => SimPolicy4, string];
    expect(label).toBe('Moved: Faster permit review');
    const next = change(doc) as SimPolicy4;
    expect(next.kinds.permitting[0].spans[0].to).not.toBe(doc.kinds.permitting[0].spans[0].to);
  });

  it('no lane is hatched', async () => {
    await setup();
    for (const name of ['Zoning', 'Permitting', 'Public money']) await kindButton(name).click();
    const lanes = all('[data-testid=tl-lane]');
    expect(lanes.length).toBeGreaterThan(5);
    for (const l of lanes) {
      for (const el of [l, ...l.querySelectorAll('*')])
        expect(getComputedStyle(el).backgroundImage).not.toContain('repeating-linear-gradient');
    }
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
  it('every bar text keeps 4.5:1', async () => {
    await setup();
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
    // Bars 2 and 3 are the off policy's; each is the topmost element at its centre.
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

  it('in one piece, keeps the playhead and chart in view and the sheet tall when the timeline is low or scrolled', async () => {
    await page.viewport(390, 800);
    const spacer = document.createElement('div');
    spacer.style.height = '1500px';
    document.body.insertBefore(spacer, document.body.firstChild);
    // In one piece, scrolled by the page (pinned, the page's box gives the room: TimelineMode).
    await setup({ pinned: false });
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

describe('the rows below md: a name line above each lane', () => {
  const rect = (e: Element) => e.getBoundingClientRect();
  /** The label cell (the row's first child) and its lane. */
  const parts = (row: Element) => ({
    lab: row.querySelector(':scope > .lab')!,
    lane: row.querySelector(':scope > [data-testid=tl-lane]')!
  });
  /** Whether an element shows its text whole (no ellipsis cut). */
  const whole = (e: Element) => e.scrollWidth <= e.clientWidth;

  async function phone() {
    await setup({ playheadDay: first(13) });
    await page.viewport(375, 812);
    await expect.element(page.getByTestId('ph-part')).toBeVisible();
    // The page's matchMedia listener has seen the new width: the chart's label is the plain one.
    await expect.element(page.getByText('Homes completed', { exact: true })).toBeVisible();
    return page.getByTestId('tl-rows').element().querySelector('.rows-grid')!;
  }

  it('below md a closed kind\'s name is shown whole, with its count and "+" on the same line', async () => {
    const grid = await phone();
    const g = rect(grid);
    for (const [kind, name] of [
      ['zoning', 'Zoning'],
      ['permitting', 'Permitting'],
      ['money', 'Public money']
    ] as const) {
      const row = page.getByTestId(`tl-kind-${kind}`).element();
      const { lab, lane } = parts(row);
      const toggle = kindButton(name).element();
      expect(toggle.textContent?.trim()).toBe(name);
      expect(whole(toggle), `${name} is cut`).toBe(true);
      // The label line spans the grid; the lane sits under it in the lane column.
      const l = rect(lab);
      expect(Math.abs(l.left - g.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(l.right - g.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect(lane).top - l.bottom)).toBeLessThanOrEqual(1);
      // Lines pack: no spare height shared out to them.
      expect(l.height).toBeLessThanOrEqual(32);
      expect(rect(lane).height).toBeLessThanOrEqual(32);
      // Chevron, name, count and "+" on that one line.
      const line = (e: Element) => {
        const r = rect(e);
        return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
      };
      expect(line(toggle)).toBe(true);
      expect(line(row.querySelector('[data-testid=tl-count]')!)).toBe(true);
      expect(line(row.querySelector('.plus')!)).toBe(true);
    }
  });

  it('below md each policy row in the sheet shows its name on its own line above its lane', async () => {
    await phone();
    await kindButton('Permitting').click();
    const sheet = page.getByRole('dialog', { name: 'Permitting' });
    await expect.element(sheet).toBeVisible();
    const grid = sheet.element().querySelector('.grid')!;
    const g = rect(grid);
    const rows = [...sheet.element().querySelectorAll('[data-testid=tl-policy]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const { lab, lane } = parts(row);
      const l = rect(lab);
      const n = rect(lane);
      expect(Math.abs(l.left - g.left)).toBeLessThanOrEqual(1);
      expect(n.top).toBeGreaterThanOrEqual(l.bottom - 1);
      expect(whole(lab.querySelector('.name')!)).toBe(true);
      // The words sit over the playhead line (the line passes under the name line).
      const cs = getComputedStyle(lab);
      expect(cs.position).toBe('relative');
      expect(Number(cs.zIndex)).toBeGreaterThan(1);
      expect(cs.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    }
    expect(rows[0].textContent).toContain('Faster permit review');
    await userEvent.keyboard('{Escape}');
  });

  it("below md the lanes keep the ruler's x scale: a bar's left matches dayPct", async () => {
    await phone();
    const ruler = page.getByTestId('tl-pin').element().querySelector('[data-testid=tl-lane]')!;
    const r = rect(ruler);
    for (const row of all('[data-testid=tl-rows] [data-testid=tl-lane]')) {
      const n = rect(row);
      if (n.height === 0) continue;
      expect(Math.abs(n.left - r.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.width - r.width)).toBeLessThanOrEqual(1);
    }
    await kindButton('Permitting').click();
    const sheet = page.getByRole('dialog', { name: 'Permitting' }).element();
    await expect.poll(() => sheet.querySelectorAll('[data-testid=tl-bar]').length).toBe(4);
    const bar = sheet.querySelector<HTMLElement>('[data-testid=tl-bar]')!;
    const lane = rect(bar.closest('[data-testid=tl-lane]')!);
    expect(Math.abs(lane.left - r.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(lane.width - r.width)).toBeLessThanOrEqual(1);
    const want = lane.left + (lane.width * dayPct(first(24), asOf, windowEnd)) / 100;
    expect(Math.abs(rect(bar).left - want)).toBeLessThanOrEqual(1);
    await userEvent.keyboard('{Escape}');
  });

  it('from md the label column and the rows are as before', async () => {
    await setup();
    await page.viewport(768, 900);
    for (const name of ['Zoning', 'Permitting', 'Public money']) await kindButton(name).click();
    const rows = all(
      '[data-testid=tl-rows] [data-testid^=tl-kind-], [data-testid=tl-rows] [data-testid=tl-policy], [data-testid=tl-rows] [data-testid=tl-fixed], [data-testid=tl-world]'
    );
    expect(rows.length).toBeGreaterThan(6);
    for (const row of rows) {
      const { lab, lane } = parts(row);
      const l = rect(lab);
      const n = rect(lane);
      expect(Math.abs(l.width - 288)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.left - l.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.top - l.top)).toBeLessThanOrEqual(1);
    }
  });
});

describe("a pool's level in its bar", () => {
  // Calendar months from the dataset month, five years of them.
  const { y, m } = utcParts(asOf);
  const MONTHS = Array.from({ length: 60 }, (_, i) => dayFromUtc(y, m + i, 1));
  const ramp = (start: number) =>
    Float64Array.from(MONTHS, (_, i) => (i < start ? NaN : Math.max(0, 1 - (i - start) / 40)));
  const levels: LevelSet = {
    months: MONTHS,
    asOf,
    byPolicy: new Map([['m1', ramp(11)]]),
    fixed: ramp(0)
  };
  const rides: Policy = {
    id: 'm2',
    label: 'Grants from City money',
    preset: null,
    on: true,
    where: { tag: 'fund', pool: 'city' },
    spans: [{ from: first(4), to: null, what: { tag: 'fund', pool: null, programmes: [] } }]
  };
  const withRides: SimPolicy4 = { ...doc, kinds: { ...doc.kinds, money: [money, rides] } };
  const pct = (a: Float64Array, day: number) => Math.round(a[indexOfDay(MONTHS, day)] * 100);

  it('an open Public money kind: a fund bar and Current funding carry a level and ", N% left"', async () => {
    const day = first(30);
    const s = await setup({ levels, playheadDay: day, playheadMonth: 30, reached: first(40) });
    await kindButton('Public money').click();
    const bar = barsOf('money')[0];
    const bond = pct(levels.byPolicy.get('m1')!, day);
    expect(bond).toBeGreaterThan(0);
    expect(bond).toBeLessThan(100);
    expect(bar.getAttribute('aria-label')).toMatch(
      new RegExp(`^\\$500M, ${bond}% left, Housing bond, `)
    );
    const fill = bar.querySelector('[data-testid=tl-level]')!;
    expect(fill.getAttribute('data-left')).toBe(String(bond));
    expect(fill.getAttribute('aria-hidden')).toBe('true');
    // The bar's text says it too, after its setting, above the fill.
    expect(bar.textContent?.trim()).toBe(`$500M, ${bond}% left`);
    const fixed = page.getByRole('button', { name: /Current funding, whole window$/ }).element();
    const base = pct(levels.fixed!, day);
    expect(fixed.getAttribute('aria-label')).toBe(
      `In force, ${base}% left, Current funding, whole window`
    );
    expect(fixed.textContent?.trim()).toBe(`In force, ${base}% left`);
    expect(fixed.querySelector('[data-testid=tl-level]')!.getAttribute('data-left')).toBe(
      String(base)
    );
    // The words fit the bar: nothing of them is cut at 1280.
    const words = bar.querySelector<HTMLElement>('.txt')!;
    expect(words.getBoundingClientRect().right).toBeLessThanOrEqual(
      bar.getBoundingClientRect().right
    );
    // At today: a level is drawn nowhere and no name or text says one.
    await s.rerender({ levels, playheadDay: asOf, playheadMonth: 1, reached: asOf });
    expect(barsOf('money')[0].getAttribute('aria-label')).not.toMatch(/left/);
    expect(barsOf('money')[0].textContent?.trim()).toBe('$500M');
    expect(fixed.textContent?.trim()).toBe('In force');
    expect(
      page
        .getByRole('button', { name: /Current funding, whole window$/ })
        .element()
        .getAttribute('aria-label')
    ).toBe('In force, Current funding, whole window');
  });

  // WCAG 2.5.3: a voice user says what they see; the name starts with it.
  it("every bar's accessible name contains its visible text, first", async () => {
    await setup({ levels, playheadDay: first(30), playheadMonth: 30, reached: first(40) });
    for (const k of ['Zoning', 'Permitting', 'Public money']) await kindButton(k).click();
    const bars = all('[data-testid=tl-bar], [data-testid=tl-fixed] button');
    // Every kind's fixed row, the world row and the policies' bars (one off).
    expect(bars.length).toBeGreaterThanOrEqual(9);
    const words = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim();
    for (const b of bars) {
      expect(words(b).length).toBeGreaterThan(0);
      expect(b.getAttribute('aria-label')!.startsWith(words(b) + ', ')).toBe(true);
    }
    const world = page.getByTestId('tl-world').getByRole('button').element();
    expect(world.getAttribute('aria-label')).toBe(
      `${words(world)}, Market conditions, whole window`
    );
    const off = barsOf('permitting').find((b) => b.classList.contains('off'))!;
    expect(off.getAttribute('aria-label')).toMatch(/, Paused review, .* to .*, off$/);
  });

  it('a closed kind and a fund policy with no own pool carry none', async () => {
    const s = await setup({
      policy: withRides,
      levels,
      playheadDay: first(30),
      playheadMonth: 30,
      reached: first(30)
    });
    // Closed: the miniatures carry no level.
    expect(document.querySelectorAll('[data-testid=tl-level]')).toHaveLength(0);
    await kindButton('Public money').click();
    const [bond, ride] = barsOf('money');
    expect(bond.querySelector('[data-testid=tl-level]')).not.toBeNull();
    expect(ride.querySelector('[data-testid=tl-level]')).toBeNull();
    expect(ride.getAttribute('aria-label')).not.toMatch(/left/);
    // Other kinds' fixed rows carry none.
    await kindButton('Zoning').click();
    expect(
      document.querySelector('[data-testid=tl-kind-zoning] [data-testid=tl-level]')
    ).toBeNull();
    // Without levels, nothing.
    await s.rerender({ levels: null });
    expect(document.querySelectorAll('[data-testid=tl-level]')).toHaveLength(0);
  });

  it('while stale the levels and their words dim; fresh again they do not', async () => {
    const s = await setup({
      levels,
      playheadDay: first(30),
      playheadMonth: 30,
      reached: first(30),
      stale: true
    });
    await kindButton('Public money').click();
    const fills = () => all('[data-testid=tl-kind-money] [data-testid=tl-level]');
    expect(fills()).toHaveLength(2);
    for (const f of fills()) expect(f.getAttribute('data-stale')).toBe('true');
    const lefts = () => all('[data-testid=tl-kind-money] .left');
    expect(lefts()).toHaveLength(2);
    for (const l of lefts()) expect(Number(getComputedStyle(l).opacity)).toBeLessThan(1);
    await s.rerender({ stale: false });
    for (const f of fills()) expect(f.hasAttribute('data-stale')).toBe(false);
    for (const l of lefts()) expect(getComputedStyle(l).opacity).toBe('1');
  });

  it("dragging a bar's edge hides its level until the pointer is up", async () => {
    await setup({ levels, playheadDay: first(30), playheadMonth: 30, reached: first(30) });
    await kindButton('Public money').click();
    const bar = barsOf('money')[0];
    const handle = bar.parentElement!.querySelector<HTMLElement>('[data-edge=from]')!;
    const hr = handle.getBoundingClientRect();
    const fire = (type: string, x: number) =>
      handle.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: hr.top + hr.height / 2,
          pointerId: 1,
          button: 0,
          bubbles: true,
          pointerType: 'mouse'
        })
      );
    expect(bar.querySelector('[data-testid=tl-level]')).not.toBeNull();
    fire('pointerdown', hr.left + hr.width / 2);
    fire('pointermove', hr.left + 40);
    await expect.poll(() => bar.querySelector('[data-testid=tl-level]')).toBeNull();
    expect(bar.textContent?.trim()).toBe('$500M');
    fire('pointerup', hr.left + hr.width / 2);
    await expect.poll(() => bar.querySelector('[data-testid=tl-level]')).not.toBeNull();
  });

  it("the bar's text keeps 4.5:1 over the level's fill and its edge 3:1, light and dark", () => {
    // The custom properties of `.tl` and of the level, per theme, read from the stylesheets.
    const vars = { light: new Map<string, string>(), dark: new Map<string, string>() };
    const own = /(^|\s)\.(tl|level)[.\s{]|^\.(tl|level)$/;
    const walk = (rules: CSSRuleList, dark: boolean) => {
      for (const r of rules) {
        if (r instanceof CSSMediaRule) walk(r.cssRules, dark || r.conditionText.includes('dark'));
        else if (r instanceof CSSStyleRule && own.test(r.selectorText)) {
          for (const n of r.style)
            if (n.startsWith('--'))
              vars[dark ? 'dark' : 'light'].set(n, r.style.getPropertyValue(n).trim());
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
    const rgba = (c: string): number[] =>
      c.startsWith('#')
        ? [...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), 1]
        : c.match(/[\d.]+/g)!.map(Number);
    const over = (top: string, base: string) => {
      const [r, g, b, a] = rgba(top);
      const under = rgba(base);
      return [r, g, b].map((v, i) => a * v + (1 - a) * under[i]);
    };
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const theme of ['light', 'dark'] as const) {
      const v = (n: string) => vars[theme].get(n) ?? vars.light.get(n)!;
      const bar = rgba(v('--k-money')).slice(0, 3);
      const text = rgba(v('--on-k')).slice(0, 3);
      const empty = v('--level-empty');
      expect(empty, theme).toMatch(/^rgb/);
      // The darkest fill is the shown zone's (the seen zone is at half strength).
      const filled = over(empty, v('--k-money'));
      expect(ratio(text, filled), `${theme} text over the fill`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(text, bar), `${theme} edge on the bar`).toBeGreaterThanOrEqual(3);
      expect(ratio(text, filled), `${theme} edge on the fill`).toBeGreaterThanOrEqual(3);
      // The fill only raises the text's contrast.
      expect(ratio(text, filled)).toBeGreaterThan(ratio(text, bar));
      // While stale the label sits on the fill's shade and its ", N% left" dims, still 4.5:1.
      const dim = Number(v('--level-dim'));
      expect(dim, theme).toBeGreaterThan(0);
      expect(dim, theme).toBeLessThan(1);
      const dimmed = over(`rgb(${text.join(' ')} / ${dim})`, `rgb(${filled.join(' ')})`);
      expect(ratio(dimmed, filled), `${theme} dimmed words`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("a game's limits", () => {
  const KINDS = ['zoning', 'permitting', 'money'] as const;
  const plus = (kind: string) =>
    document.querySelector(`[data-testid=tl-kind-${kind}] button.plus`);

  afterEach(async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }]
    });
  });

  it('no kind has a locked lane; a kind that does not open has no +', async () => {
    await setup({ limits: limitsWith({}) });
    await expect.element(page.getByTestId('tl-kind-money')).toBeInTheDocument();
    expect(all('[data-testid=tl-locked-lane]')).toHaveLength(0);
    expect(document.querySelectorAll('button.plus')).toHaveLength(0);
    expect(all('[data-testid=tl-empty-lane]')).toHaveLength(0);
    for (const name of Object.values(PLUS_NAME)) {
      expect(page.getByRole('button', { name }).all()).toHaveLength(0);
    }
  });

  it('offered stops open Zoning, money opens Public money; Permitting waits for the end', async () => {
    await setup({ limits: limitsWith({ stops: new Set(['regionalRail'] as const), money: true }) });
    await expect.element(page.getByTestId('tl-kind-money')).toBeInTheDocument();
    expect(KINDS.map((k) => plus(k) !== null)).toEqual([true, false, true]);
  });

  it('the toggle is described by the count alone', async () => {
    await setup({ limits: limitsWith({}) });
    await expect.element(kindButton('Permitting')).toHaveAccessibleDescription('2');
  });

  it('a kind without + still opens', async () => {
    const { onselect } = await setup({ limits: limitsWith({}) });
    await kindButton('Permitting').click();
    await expect.element(kindButton('Permitting')).toHaveAttribute('aria-expanded', 'true');
    const fixed = page.getByTestId('tl-kind-permitting').getByTestId('tl-fixed');
    await expect.element(fixed).toHaveTextContent('Current timelines');
    await fixed.getByRole('button').click();
    expect(onselect).toHaveBeenCalledWith(fixedRef('permitting'));
  });

  it('a policy not within is dimmed and inert and says NOT_IN_GAME', async () => {
    const painted: Policy = {
      ...zoning,
      id: 'z2',
      label: 'Painted rule',
      where: { tag: 'painted' }
    };
    const l = limitsWith({ stops: new Set(['metro'] as const), own: true });
    expect(within('zoning', painted, l)).toBe(false);
    expect(within('zoning', zoning, l)).toBe(true);
    const { onselect, onedit } = await setup({
      limits: l,
      policy: { schema: 4, kinds: { zoning: [painted, zoning], permitting: [], money: [] } }
    });
    await kindButton('Zoning').click();
    const rows = page.getByTestId('tl-kind-zoning').getByTestId('tl-policy');
    await expect.element(rows.nth(1)).toBeInTheDocument();
    const [stray, runs] = rows.all().map((r) => r.element() as HTMLElement);
    expect(stray.hasAttribute('data-locked')).toBe(true);
    expect(stray.querySelector('[data-testid=tl-policy-note]')?.textContent).toBe(NOT_IN_GAME);
    const bar = stray.querySelector<HTMLElement>('[data-testid=tl-bar]')!;
    expect(bar.tagName).not.toBe('BUTTON');
    expect(bar.hasAttribute('tabindex')).toBe(false);
    bar.click();
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onselect).not.toHaveBeenCalled();
    expect(onedit).not.toHaveBeenCalled();
    expect(runs.hasAttribute('data-locked')).toBe(false);
    expect(runs.textContent).not.toContain(NOT_IN_GAME);
  });

  it('a money policy runs when it is a free measure and money is offered', async () => {
    const free: Policy = { ...money, id: 'm3', label: 'State money off', preset: 'state-off' };
    expect(isGiven(free)).toBe(true);
    await setup({
      limits: limitsWith({ money: true }),
      policy: { schema: 4, kinds: { zoning: [], permitting: [], money: [money, free] } }
    });
    await kindButton('Public money').click();
    const rows = page.getByTestId('tl-kind-money').getByTestId('tl-policy');
    await expect.element(rows.nth(1)).toBeInTheDocument();
    const [own, measure] = rows.all().map((r) => r.element() as HTMLElement);
    expect(own.hasAttribute('data-locked')).toBe(true);
    expect(own.querySelector('[data-testid=tl-policy-note]')?.textContent).toBe(NOT_IN_GAME);
    expect(measure.hasAttribute('data-locked')).toBe(false);
    expect(measure.querySelector('[data-testid=tl-bar]')?.tagName).toBe('BUTTON');
  });

  it('OPEN_LIMITS locks nothing', async () => {
    await setup({ limits: OPEN_LIMITS });
    await expect.element(page.getByTestId('tl-kind-money')).toBeInTheDocument();
    expect(all('[data-locked]')).toHaveLength(0);
  });

  it('without a game nothing is locked', async () => {
    await setup();
    for (const name of ['Zoning', 'Permitting', 'Public money']) await kindButton(name).click();
    await expect
      .element(page.getByTestId('tl-kind-money').getByTestId('tl-bar').first())
      .toBeInTheDocument();
    expect(all('[data-locked]')).toHaveLength(0);
    for (const name of Object.values(PLUS_NAME)) {
      await expect.element(page.getByRole('button', { name })).toBeVisible();
    }
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`locked bars pass axe in ${mode}`, async () => {
      await cdp().send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: mode }]
      });
      const { view } = await setup({ limits: limitsWith({}) });
      // The page gives the timeline its ground; the test host has none.
      view.container.style.background = `var(--color-surface${mode === 'dark' ? '-dark' : ''})`;
      for (const name of ['Zoning', 'Public money']) await kindButton(name).click();
      await expect
        .element(page.getByTestId('tl-kind-zoning').getByTestId('tl-bar'))
        .toBeInTheDocument();
      const r = await axe.run(view.container, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
      });
      expect(r.violations).toEqual([]);
    });
  }
});

describe('Timeline policy rows: switch, New and Edit', () => {
  const metro: Policy = {
    id: 'transit-metro',
    label: 'Taller near Muni Metro',
    preset: null,
    on: false,
    where: { tag: 'transit', stopTypes: ['metro'] },
    spans: [
      {
        from: first(1),
        to: null,
        what: {
          tag: 'bands',
          bands: [
            { maxM: 402, stories: 6 },
            { maxM: 805, stories: 5 }
          ]
        }
      }
    ]
  };
  const rail: Policy = {
    ...metro,
    id: 'transit-rail',
    label: 'Taller near BART and Caltrain',
    on: true,
    where: { tag: 'transit', stopTypes: ['regionalRail'] }
  };
  const gameDoc: SimPolicy4 = {
    schema: 4,
    kinds: { zoning: [rail, metro], permitting: [], money: [] }
  };
  const round2 = limitsWith({
    offered: new Set(['transit-rail', 'transit-metro'] as const),
    editable: new Set(['transit-rail'] as const),
    stops: new Set(['regionalRail', 'metro'] as const)
  });
  const policyRow = (label: string) =>
    page.getByTestId('tl-kind-zoning').getByTestId('tl-policy').filter({ hasText: label });

  async function open(over: Over = {}) {
    const r = await setup({ policy: gameDoc, limits: round2, ...over });
    await kindButton('Zoning').click();
    await expect.element(policyRow('Taller near Muni Metro')).toBeInTheDocument();
    return r;
  }

  it('a fixed policy has a switch and New, an editable one a switch and Edit', async () => {
    await open();
    const fixedRow = policyRow('Taller near Muni Metro');
    const editRow = policyRow('Taller near BART and Caltrain');
    await expect
      .element(fixedRow.getByRole('switch', { name: 'Taller near Muni Metro on' }))
      .toHaveAttribute('aria-checked', 'false');
    await expect
      .element(fixedRow.getByRole('button', { name: 'New: Taller near Muni Metro, details' }))
      .toBeVisible();
    expect(fixedRow.getByTestId('tl-policy-edit').all()).toHaveLength(0);
    await expect
      .element(editRow.getByRole('switch', { name: 'Taller near BART and Caltrain on' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(editRow.getByRole('button', { name: 'Edit Taller near BART and Caltrain' }))
      .toBeVisible();
    expect(editRow.getByTestId('tl-policy-new').all()).toHaveLength(0);
  });

  it('the switch turns a fixed policy on in one undo step', async () => {
    const { onedit } = await open();
    await policyRow('Taller near Muni Metro')
      .getByRole('switch', { name: 'Taller near Muni Metro on' })
      .click();
    expect(onedit).toHaveBeenCalledTimes(1);
    const [change, label] = onedit.mock.calls[0] as [(d: SimPolicy4) => SimPolicy4, string];
    expect(label).toBe('Switched on: Taller near Muni Metro');
    expect(change(gameDoc).kinds.zoning.find((p) => p.id === 'transit-metro')?.on).toBe(true);
  });

  it('New and Edit select the policy', async () => {
    const { onselect } = await open();
    await policyRow('Taller near Muni Metro').getByTestId('tl-policy-new').click();
    expect(onselect).toHaveBeenLastCalledWith({ kind: 'zoning', id: 'transit-metro', span: 0 });
    await policyRow('Taller near BART and Caltrain').getByTestId('tl-policy-edit').click();
    expect(onselect).toHaveBeenLastCalledWith({ kind: 'zoning', id: 'transit-rail', span: 0 });
  });

  it('a fixed policy bar selects but has no edges and no keys', async () => {
    const { onselect, onedit } = await open();
    const row = policyRow('Taller near Muni Metro').element();
    expect(row.querySelectorAll('[data-edge]')).toHaveLength(0);
    const bar = row.querySelector<HTMLElement>('[data-testid=tl-bar]')!;
    bar.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(onedit).not.toHaveBeenCalled();
    bar.click();
    expect(onselect).toHaveBeenLastCalledWith({ kind: 'zoning', id: 'transit-metro', span: 0 });
    const edit = policyRow('Taller near BART and Caltrain').element();
    expect(edit.querySelectorAll('[data-edge]').length).toBeGreaterThan(0);
  });

  it('at 375 px New sits below the switch', async () => {
    await setup({ policy: gameDoc, limits: round2 });
    await page.viewport(375, 812);
    await kindButton('Zoning').click();
    const sheet = page.getByRole('dialog', { name: 'Zoning' });
    const row = sheet.getByTestId('tl-policy').filter({ hasText: 'Taller near Muni Metro' });
    await expect.element(row).toBeVisible();
    const sw = row.getByRole('switch').element().getBoundingClientRect();
    const nb = row.getByTestId('tl-policy-new').element().getBoundingClientRect();
    expect(nb.top).toBeGreaterThanOrEqual(sw.bottom - 1);
    expect(nb.height).toBeGreaterThanOrEqual(24);
    expect(sw.height).toBeGreaterThanOrEqual(24);
    expect(sw.width).toBeGreaterThanOrEqual(24);
  });

  it('read-only has no switch and no button', async () => {
    await open({ readonly: true });
    expect(all('[role=switch]')).toHaveLength(0);
    expect(all('[data-testid=tl-policy-new]')).toHaveLength(0);
    expect(all('[data-testid=tl-policy-edit]')).toHaveLength(0);
    await expect.element(policyRow('Taller near Muni Metro')).toHaveTextContent(', off');
  });

  it('with no game every row has the switch and Edit', async () => {
    await setup();
    await kindButton('Permitting').click();
    const rows = page.getByTestId('tl-kind-permitting').getByTestId('tl-policy');
    await expect.element(rows.nth(1)).toBeInTheDocument();
    expect(all('[data-testid=tl-kind-permitting] [role=switch]')).toHaveLength(2);
    expect(all('[data-testid=tl-kind-permitting] [data-testid=tl-policy-edit]')).toHaveLength(2);
    expect(all('[data-testid=tl-policy-new]')).toHaveLength(0);
  });

  it('a locked row has neither the switch nor a button', async () => {
    const painted: Policy = {
      ...zoning,
      id: 'z2',
      label: 'Painted rule',
      where: { tag: 'painted' }
    };
    await setup({
      limits: limitsWith({ stops: new Set(['metro'] as const), own: false }),
      policy: { schema: 4, kinds: { zoning: [painted], permitting: [], money: [] } }
    });
    await kindButton('Zoning').click();
    await expect.element(page.getByTestId('tl-policy-note')).toHaveTextContent(NOT_IN_GAME);
    expect(all('[data-testid=tl-kind-zoning] [role=switch]')).toHaveLength(0);
    expect(all('[data-testid=tl-kind-zoning] button[data-testid^=tl-policy-]')).toHaveLength(0);
  });
});
