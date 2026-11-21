/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { GOAL, goalName } from '$lib/goal/goal';
import { formatDollars } from '$lib/fzp/format';
import type { ActivityTotals, Starter } from './activity-view';
import SimActivity from './SimActivity.svelte';

const STARTERS: Starter[] = [
  {
    choice: { kind: 'zoning', what: 'transit' },
    text: 'Taller near transit',
    label: 'Transit rule'
  },
  {
    choice: { kind: 'permitting', what: 'preset', preset: 'sb423Clock' },
    text: 'SB 423 approval clock',
    label: 'SB 423 approval clock'
  },
  {
    choice: { kind: 'money', what: 'preset', preset: 'housing-bond' },
    text: 'A housing bond',
    label: 'A housing bond'
  }
];

const TOTALS: ActivityTotals = {
  approved: 1234,
  completed: 567,
  stopped: 12,
  affordable: 89,
  effect: null,
  cost: null
};

const props = (over: Partial<ComponentProps<typeof SimActivity>> = {}) => ({
  goal: GOAL,
  totals: null as ActivityTotals | null,
  atToday: true,
  starters: STARTERS,
  onstarter: vi.fn(),
  ondetails: vi.fn(),
  stale: false,
  ...over
});

/** Renders with the pointer at rest on the heading: no explanation open (Global Constraints). */
async function renderAtRest(p: ReturnType<typeof props>) {
  const screen = render(SimActivity, { props: p });
  await userEvent.hover(page.getByRole('heading', { name: 'Activity', exact: true }));
  await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
  return screen;
}

/** The totals list as [term, value] pairs. */
const pairs = () =>
  [...document.querySelectorAll('[data-testid=tl-totals] > div')].map((d) => [
    d.querySelector('dt')!.textContent!.trim(),
    d.querySelector('dd')!.textContent!.trim()
  ]);

describe('SimActivity', () => {
  it('at today with nothing in force: the goal, Try one: and three starter buttons', async () => {
    await renderAtRest(props());
    await expect.element(page.getByText(goalName(GOAL))).toBeVisible();
    expect(goalName(GOAL)).toMatch(/^State target: [\d,]+ homes by \w{3} \d{4}$/);
    await expect.element(page.getByText('Try one:')).toBeVisible();
    const list = page.getByRole('list', { name: 'Try one:' });
    const buttons = list.getByRole('button').elements();
    expect(buttons.map((b) => b.textContent!.trim())).toEqual([
      'Taller near transit',
      'SB 423 approval clock',
      'A housing bond'
    ]);
    expect(page.getByText('Press Play to see what gets built.').elements()).toHaveLength(0);
    expect(document.querySelector('[data-testid=tl-totals]')).toBeNull();
    // One h2 with Details in its row.
    const h2 = page.getByRole('heading', { level: 2 }).elements();
    expect(h2.map((h) => h.textContent!.trim())).toEqual(['Activity']);
    const row = h2[0].parentElement!;
    expect(row.querySelector('button')!.textContent!.trim()).toBe('Details');
  });

  it('at today with a policy in force: the goal and Press Play, no starters', async () => {
    await renderAtRest(props({ starters: [] }));
    await expect.element(page.getByText(goalName(GOAL))).toBeVisible();
    await expect.element(page.getByText('Press Play to see what gets built.')).toBeVisible();
    expect(page.getByText('Try one:').elements()).toHaveLength(0);
    expect(
      page
        .getByRole('button')
        .elements()
        .map((b) => b.textContent!.trim())
    ).toEqual(['Details']);
  });

  it('after today: the totals list; From your policy only in force; cost only with money', async () => {
    const r = await renderAtRest(props({ atToday: false, totals: TOTALS }));
    expect(page.getByText(goalName(GOAL)).elements()).toHaveLength(0);
    expect(page.getByText('Try one:').elements()).toHaveLength(0);
    expect(pairs()).toEqual([
      ['Approved', '1,234'],
      ['Completed', '567'],
      ['Stopped', '12'],
      ['Affordable', '89']
    ]);
    await r.rerender(
      props({
        atToday: false,
        totals: {
          ...TOTALS,
          affordable: null,
          effect: 24,
          cost: { spent: 2.5e6, perAddedHome: null }
        }
      })
    );
    expect(pairs()).toEqual([
      ['Approved', '1,234'],
      ['Completed', '567'],
      ['Stopped', '12'],
      ['From your policy', '+24'],
      ['Public money spent', formatDollars(2.5e6)],
      ['Per added home', 'no homes added yet']
    ]);
    await r.rerender(
      props({
        atToday: false,
        totals: { ...TOTALS, effect: -4, cost: { spent: 1e6, perAddedHome: 410_000 } }
      })
    );
    expect(pairs().slice(4)).toEqual([
      ['From your policy', '−4'],
      ['Public money spent', formatDollars(1e6)],
      ['Per added home', formatDollars(410_000)]
    ]);
    // Not filled yet: calculating, no list.
    await r.rerender(props({ atToday: false, totals: null }));
    expect(document.querySelector('[data-testid=tl-totals]')).toBeNull();
    await expect.element(page.getByText('calculating…')).toBeVisible();
  });

  it('Details calls ondetails; a starter calls onstarter with it', async () => {
    const p = props();
    await renderAtRest(p);
    await page.getByRole('button', { name: 'Details' }).click();
    expect(p.ondetails).toHaveBeenCalledOnce();
    await page.getByRole('button', { name: 'SB 423 approval clock' }).click();
    expect(p.onstarter).toHaveBeenCalledExactlyOnceWith(STARTERS[1]);
  });

  it('starters and Details are 24 px targets at least', async () => {
    await renderAtRest(props());
    for (const b of page.getByRole('button').elements()) {
      const r = b.getBoundingClientRect();
      expect(r.height).toBeGreaterThanOrEqual(24);
      expect(r.width).toBeGreaterThanOrEqual(24);
    }
  });

  it('stale: the body dims; the heading and Details keep full contrast', async () => {
    const r = await renderAtRest(props({ atToday: false, totals: TOTALS }));
    const color = (el: Element) => getComputedStyle(el).color;
    const heading = page.getByRole('heading', { name: 'Activity' }).element();
    const button = page.getByRole('button', { name: 'Details' }).element();
    const dd = document.querySelector('[data-testid=tl-totals] dd')!;
    const before = { heading: color(heading), button: color(button), dd: color(dd) };
    expect(before.dd).toBe(before.heading);
    await r.rerender(props({ atToday: false, totals: TOTALS, stale: true }));
    await expect
      .element(page.getByTestId('tl-activity-body'))
      .toHaveAttribute('data-stale', 'true');
    expect(color(dd)).not.toBe(before.dd);
    expect(color(heading)).toBe(before.heading);
    expect(color(button)).toBe(before.button);
  });
});
