/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { GOAL, goalName } from '$lib/goal/goal';
import { formatDollars } from '$lib/fzp/format';
import type { ActivityItem, ActivityTotals, Starter } from './activity-view';
import { limitAlert } from '$lib/sim-page/funding-copy';
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
      ['Approved in new projects', '1,234'],
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
      ['Approved in new projects', '1,234'],
      ['Completed', '567'],
      ['Stopped', '12'],
      ['From your policy', '+24'],
      ['All public money spent', formatDollars(2.5e6)],
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
      ['All public money spent', formatDollars(1e6)],
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

  it('a refusal shows as a card under the starters with the limit words', async () => {
    const words = limitAlert('pools');
    const ondismissrefusal = vi.fn();
    const r = await renderAtRest(props({ refusal: null, ondismissrefusal }));
    // The polite region is there, empty, before any refusal.
    const region = page.getByTestId('tl-activity-refusal');
    await expect.element(region).toHaveAttribute('role', 'status');
    expect(region.element().textContent!.trim()).toBe('');
    await r.rerender(props({ refusal: words, ondismissrefusal }));
    const card = region.element().querySelector('[data-shape]')!;
    await expect.element(region).toHaveTextContent(words);
    expect(card.getAttribute('data-shape')).toBe('card');
    // Under the starters, and its own words only: no second live region inside it.
    const list = page.getByRole('list', { name: 'Try one:' }).element();
    expect(list.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.querySelector('[role], [aria-live]')).toBeNull();
    // It does not take focus.
    expect(card.contains(document.activeElement)).toBe(false);
    await region.getByRole('button', { name: 'Dismiss' }).click();
    expect(ondismissrefusal).toHaveBeenCalledOnce();
    await r.rerender(props({ refusal: words, atToday: false, totals: TOTALS }));
    expect(page.getByText(words).elements()).toHaveLength(0);
  });

  it("with the pressed starter gone, the refusal's Dismiss puts focus on the page's fallback", async () => {
    const words = limitAlert('pools');
    const box = document.createElement('div');
    box.tabIndex = -1;
    box.dataset.testid = 'fallback';
    document.body.appendChild(box);
    try {
      const fallbackfocus = () => box;
      const r = await renderAtRest(props({ fallbackfocus }));
      await page.getByRole('button', { name: 'SB 423 approval clock' }).click();
      // The starter added something after all elsewhere: the starters go, the refusal stays.
      await r.rerender(props({ starters: [], refusal: words, fallbackfocus }));
      await page
        .getByTestId('tl-activity-refusal')
        .getByRole('button', { name: 'Dismiss' })
        .click();
      await expect.poll(() => document.activeElement).toBe(box);
    } finally {
      box.remove();
    }
  });

  it('starters and Details are 24 px targets at least', async () => {
    await renderAtRest(props());
    for (const b of page.getByRole('button').elements()) {
      const r = b.getBoundingClientRect();
      expect(r.height).toBeGreaterThanOrEqual(24);
      expect(r.width).toBeGreaterThanOrEqual(24);
    }
  });

  const LONG = 'Bayview Hunters Point and the Neighbourhoods Beyond the Long Name';
  const EVENTS: ActivityItem[] = [
    {
      key: '7:completed',
      stage: 'Completed',
      homes: '120 homes',
      place: 'Mission',
      when: 'Mar 2031',
      policy: true
    },
    {
      key: '3:started',
      stage: 'Building',
      homes: '1 home',
      place: null,
      when: 'Feb 2031',
      policy: false
    },
    {
      key: '9:approved',
      stage: 'Approved',
      homes: '48 homes',
      place: LONG,
      when: 'Jan 2031',
      policy: false
    }
  ];
  const items = () => page.getByRole('list', { name: 'Latest' }).getByRole('listitem');

  it('lists events newest first; a policy event has the glyph and "Under your policy" for AT', async () => {
    // A column as narrow as the phone's sheet.
    const box = document.body.appendChild(document.createElement('div'));
    box.style.width = '320px';
    const r = await render(SimActivity, {
      target: box,
      props: props({ atToday: false, totals: TOTALS, events: EVENTS })
    });
    await expect.element(page.getByRole('heading', { level: 3, name: 'Latest' })).toBeVisible();
    // Above the totals.
    const dl = page.getByTestId('tl-totals').element();
    const h3 = page.getByRole('heading', { level: 3 }).element();
    expect(dl.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const li = items().elements();
    expect(li).toHaveLength(3);
    const text = (e: Element) => e.textContent!.replace(/\s+/g, ' ').trim();
    expect(li.map(text)).toEqual([
      '◆Under your policy Completed 120 homes Mission · Mar 2031',
      'Building 1 home Feb 2031',
      `Approved 48 homes ${LONG} · Jan 2031`
    ]);
    // The mark is a glyph hidden from AT, with words for it; colour is not the only cue.
    const mark = li[0].querySelector('[aria-hidden=true]')!;
    expect(mark.textContent).toBe('◆');
    // What assistive technology reads: the text without the aria-hidden glyph.
    const spoken = (e: Element) => {
      const c = e.cloneNode(true) as Element;
      c.querySelectorAll('[aria-hidden=true]').forEach((h) => h.remove());
      return text(c);
    };
    expect(spoken(li[0])).toBe('Under your policy Completed 120 homes Mission · Mar 2031');
    expect(spoken(li[1])).not.toContain('Under your policy');
    // No place: no separator left over.
    expect(text(li[1])).not.toContain('·');
    // One line each: the long place is cut with an ellipsis; its full text stays for AT.
    const line = li[1].getBoundingClientRect().height;
    for (const e of li) expect(e.getBoundingClientRect().height).toBe(line);
    const place = [...li[2].querySelectorAll('span')].find((s) => s.textContent === LONG)!;
    expect(getComputedStyle(place).textOverflow).toBe('ellipsis');
    expect(place.scrollWidth).toBeGreaterThan(place.clientWidth);
    expect(spoken(li[2])).toContain(LONG);
    // The month stays whole after a cut place.
    const month = li[2].lastElementChild!;
    expect(month.scrollWidth).toBeLessThanOrEqual(month.clientWidth);
    await r.unmount();
    box.remove();
  });

  it('after today: Latest comes before the totals; the totals are two columns', async () => {
    // The column at 1280 is 512 px wide, padded 12 px a side.
    const box = document.body.appendChild(document.createElement('div'));
    box.style.width = '488px';
    const totals = { ...TOTALS, effect: 24, cost: { spent: 2.5e6, perAddedHome: 410_000 } };
    const r = await render(SimActivity, {
      target: box,
      props: props({ atToday: false, totals, events: EVENTS })
    });
    await expect.element(page.getByRole('heading', { level: 3, name: 'Latest' })).toBeVisible();
    const h3 = page.getByRole('heading', { level: 3 }).element();
    const list = page.getByRole('list', { name: 'Latest' }).element();
    const dl = page.getByTestId('tl-totals').element();
    // In the DOM and on screen: the heading, the list, then the totals.
    expect(h3.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dl.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      list.getBoundingClientRect().bottom
    );
    // Two columns of term and value pairs, read across: 7 pairs on 4 lines.
    const cells = [...dl.querySelectorAll(':scope > div')].map((d) => d.getBoundingClientRect());
    expect(cells).toHaveLength(7);
    for (let i = 0; i + 1 < cells.length; i += 2) {
      expect(cells[i + 1].top).toBe(cells[i].top);
      expect(cells[i + 1].left).toBeGreaterThan(cells[i].right);
    }
    for (let i = 2; i < cells.length; i++) expect(cells[i].left).toBe(cells[i % 2].left);
    expect(new Set(cells.map((c) => c.top)).size).toBe(4);
    // Each value sits on its term's line, at the cell's right.
    for (const d of dl.querySelectorAll(':scope > div')) {
      const dt = d.querySelector('dt')!.getBoundingClientRect();
      const dd = d.querySelector('dd')!.getBoundingClientRect();
      expect(dd.left).toBeGreaterThanOrEqual(dt.right);
      expect(dd.right).toBeCloseTo(d.getBoundingClientRect().right, 0);
    }
    expect(pairs().map(([t]) => t)).toEqual([
      'Approved in new projects',
      'Completed',
      'Stopped',
      'Affordable',
      'From your policy',
      'All public money spent',
      'Per added home'
    ]);
    await r.unmount();
    box.remove();
  });

  it('after today with no events: No stage changes yet.', async () => {
    const r = await renderAtRest(props({ atToday: false, totals: TOTALS, events: [] }));
    await expect.element(page.getByRole('heading', { level: 3, name: 'Latest' })).toBeVisible();
    await expect.element(page.getByText('No stage changes yet.')).toBeVisible();
    expect(document.querySelector('ol')).toBeNull();
    // At today and while calculating: no list and no Latest.
    for (const over of [{ atToday: true }, { atToday: false, totals: null }]) {
      await r.rerender(props({ events: EVENTS, ...over }));
      expect(page.getByRole('heading', { level: 3 }).elements()).toHaveLength(0);
      expect(document.querySelector('ol')).toBeNull();
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
