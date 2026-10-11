import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { score } from './accumulator';
import { frameLatest } from './latest.svelte';
import Scoreboard from './Scoreboard.svelte';
import { building, parcel } from './score-fixtures';
import { M1_TARGETS } from './targets';
import type { Score } from './types';
import type { ScoreStatus } from './view';

const status = (s: Partial<ScoreStatus> = {}): ScoreStatus => ({
  pendingChunks: 0,
  failedChunks: 0,
  complete: true,
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-10T12:00:00Z',
  mode: 'max',
  ...s
});

function withNet(net: number): Score {
  const p = parcel('7000001', 0, 'Mission');
  return score([[p, building(p, net, true)]], M1_TARGETS);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Scoreboard region', () => {
  it('is a region labelled "Housing scoreboard"; null score renders empty', async () => {
    await page.viewport(1280, 800);
    await render(Scoreboard, { props: { score: null, status: status() } });
    await expect
      .element(page.getByRole('region', { name: 'Housing scoreboard' }))
      .toBeInTheDocument();
    await expect.element(page.getByTestId('score-net').first()).toHaveTextContent('0');
  });

  it('desktop: docked panel visible, mobile bar hidden', async () => {
    await page.viewport(1280, 800);
    await render(Scoreboard, { props: { score: withNet(5), status: status() } });
    await expect.element(page.getByTestId('score-net').first()).toBeVisible();
    await expect.element(page.getByTestId('scorebar-text')).not.toBeVisible();
  });
});

describe('375 px', () => {
  it('collapsed bar shows "{net} net new homes · {pct} of RHNA", 56 px tall, and sets --scorebar-h', async () => {
    await page.viewport(375, 812);
    await render(Scoreboard, { props: { score: withNet(41035), status: status() } });
    const bar = page.getByTestId('scorebar-text');
    await expect.element(bar).toHaveTextContent('41,035 net new homes · 50% of RHNA');
    const btn = page.getByRole('button', { name: /net new homes/ }).element();
    expect(btn.getBoundingClientRect().height).toBe(56);
    expect(getComputedStyle(document.documentElement).getPropertyValue('--scorebar-h').trim()).toBe(
      '56px'
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  it('tapping opens the sheet (focus to Close), reports its height; Close restores', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    await render(Scoreboard, { props: { score: withNet(5), status: status(), onsheetchange } });
    const barBtn = page.getByRole('button', { name: /net new homes/ });
    await barBtn.click();
    await expect.element(barBtn).toHaveAttribute('aria-expanded', 'true');
    const close = page.getByRole('button', { name: 'Close' });
    await expect.element(close).toHaveFocus();
    await expect.element(page.getByRole('group', { name: 'Scoreboard details' })).toBeVisible();
    await expect.poll(() => onsheetchange.mock.calls.at(-1)).toEqual([true, expect.any(Number)]);
    expect(onsheetchange.mock.calls.at(-1)![1]).toBeGreaterThan(56);
    const firstOpen = onsheetchange.mock.calls.find((c) => c[0] === true)!;
    expect(firstOpen[1]).toBeGreaterThan(56);
    expect(onsheetchange.mock.calls.some((c) => c[0] === true && c[1] === 0)).toBe(false);
    await close.click();
    await expect.element(barBtn).toHaveFocus();
    expect(onsheetchange.mock.calls.at(-1)).toEqual([false, 0]);
  });

  it('Escape closes the sheet', async () => {
    await page.viewport(375, 812);
    await render(Scoreboard, { props: { score: withNet(5), status: status() } });
    await page.getByRole('button', { name: /net new homes/ }).click();
    await userEvent.keyboard('{Escape}');
    await expect
      .element(page.getByRole('group', { name: 'Scoreboard details' }))
      .not.toBeInTheDocument();
  });

  it('Escape with focus outside the sheet closes it without moving focus', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    await render(Scoreboard, { props: { score: withNet(5), status: status(), onsheetchange } });
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    await page.getByRole('button', { name: /net new homes/ }).click();
    outside.focus();
    await userEvent.keyboard('{Escape}');
    await expect
      .element(page.getByRole('group', { name: 'Scoreboard details' }))
      .not.toBeInTheDocument();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('Escape while closed does nothing', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    await render(Scoreboard, { props: { score: withNet(5), status: status(), onsheetchange } });
    onsheetchange.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onsheetchange).not.toHaveBeenCalled();
  });

  it('widening past 768 px closes the sheet and reports closed', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    await render(Scoreboard, { props: { score: withNet(5), status: status(), onsheetchange } });
    await page.getByRole('button', { name: /net new homes/ }).click();
    await page.viewport(1024, 768);
    await expect.poll(() => onsheetchange.mock.calls.at(-1)).toEqual([false, 0]);
  });

  it('unmounting with the sheet open reports closed', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    const screen = await render(Scoreboard, {
      props: { score: withNet(5), status: status(), onsheetchange }
    });
    await page.getByRole('button', { name: /net new homes/ }).click();
    await screen.unmount();
    expect(onsheetchange.mock.calls.at(-1)).toEqual([false, 0]);
    expect(getComputedStyle(document.documentElement).getPropertyValue('--scorebar-h').trim()).toBe(
      ''
    );
  });
});

describe('aria-live (§4.7)', () => {
  it('silent on first render; announces 1 s after the last change once settled', async () => {
    vi.useFakeTimers();
    await page.viewport(1280, 800);
    const screen = await render(Scoreboard, { props: { score: withNet(5), status: status() } });
    const live = () => page.getByTestId('score-live').element().textContent;
    vi.advanceTimersByTime(2000);
    expect(live()).toBe('');

    await screen.rerender({ score: withNet(41035), status: status({ complete: false }) });
    vi.advanceTimersByTime(2000);
    expect(live()).toBe(''); // updating: silent

    await screen.rerender({ score: withNet(41035), status: status() });
    vi.advanceTimersByTime(900);
    expect(live()).toBe('');
    vi.advanceTimersByTime(200);
    await expect.poll(live).toBe('Net new homes 41,035, 50% of RHNA');
  });

  it('a change within the 1 s window restarts the timer', async () => {
    vi.useFakeTimers();
    await page.viewport(1280, 800);
    const screen = await render(Scoreboard, { props: { score: withNet(5), status: status() } });
    const live = () => page.getByTestId('score-live').element().textContent;
    await screen.rerender({ score: withNet(6), status: status() });
    vi.advanceTimersByTime(600);
    await screen.rerender({ score: withNet(7), status: status() });
    vi.advanceTimersByTime(600);
    expect(live()).toBe('');
    vi.advanceTimersByTime(500);
    await expect.poll(live).toBe('Net new homes 7, 0.0% of RHNA');
  });
});

describe('aria-live settled failure and no-repeat', () => {
  it('announces once failed-but-settled (incomplete, failed chunk, none pending)', async () => {
    vi.useFakeTimers();
    await page.viewport(1280, 800);
    const screen = await render(Scoreboard, { props: { score: withNet(5), status: status() } });
    const live = () => page.getByTestId('score-live').element().textContent;
    await screen.rerender({
      score: withNet(41035),
      status: status({ complete: false, failedChunks: 1 })
    });
    vi.advanceTimersByTime(1100);
    await expect.poll(live).toBe('Net new homes 41,035, 50% of RHNA');
  });

  it('no repeat when the value is unchanged, and the live node is not touched', async () => {
    vi.useFakeTimers();
    await page.viewport(1280, 800);
    const screen = await render(Scoreboard, { props: { score: withNet(5), status: status() } });
    const node = page.getByTestId('score-live').element();
    await screen.rerender({ score: withNet(41035), status: status() });
    vi.advanceTimersByTime(1100);
    await expect.poll(() => node.textContent).toBe('Net new homes 41,035, 50% of RHNA');

    let mutations = 0;
    const mo = new MutationObserver((r) => (mutations += r.length));
    mo.observe(node, { childList: true, characterData: true, subtree: true });
    await screen.rerender({
      score: withNet(41035),
      status: status({ pendingChunks: 0, builtAt: 'x' })
    });
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    mutations += mo.takeRecords().length;
    mo.disconnect();
    expect(mutations).toBe(0);
    expect(node.textContent).toBe('Net new homes 41,035, 50% of RHNA');
  });
});

describe('frameLatest (§4.3: ≤ 1 render per frame)', () => {
  it('coalesces many pushes per frame into one commit of the latest value', () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => frames.push(cb));
    const l = frameLatest(0, raf, vi.fn());
    l.push(1);
    l.push(2);
    l.push(3);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(l.current).toBe(0);
    frames.shift()!(0);
    expect(l.current).toBe(3);
    l.push(4);
    expect(raf).toHaveBeenCalledTimes(2);
    frames.shift()!(16);
    expect(l.current).toBe(4);
  });

  it('dispose cancels a pending frame', () => {
    const caf = vi.fn();
    const l = frameLatest(0, () => 7, caf);
    l.push(1);
    l.dispose();
    expect(caf).toHaveBeenCalledWith(7);
    expect(l.current).toBe(0);
  });
});
