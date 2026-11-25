/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { dayFromUtc } from '$lib/fzp/time';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import type { RunResult } from '../run-result';
import { SIDE_GOALS } from '../side-goals';
import { GameStore, openGame } from '../store.svelte';
import { FakeSync } from '../test/fake-sync.svelte';
import { TALLY_ROLL_MS } from './motion';
import TallyHost from './test/TallyHost.svelte';
import { runResult } from './test/fixtures';
import {
  SIDE_GOAL_FALLBACK,
  STAGE_ROWS,
  UNIT_MARK,
  WAITING_MONEY,
  collectedName,
  homesOfText,
  lumpName,
  sideRewardName,
  sideRewardText
} from './words';

// The catalogue ships no side tuning yet; give SIDE_GOALS one goal of the test's own.
vi.mock('../catalogue/tuning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../catalogue/tuning')>()),
  SIDE_TUNING: { 'policy-homes-1': { target: 1000, reward: { home: 500 } } }
}));

/** Both media features at once: each Emulation.setEmulatedMedia call replaces the last. */
async function emulate(scheme: 'light' | 'dark', motion: 'reduce' | 'no-preference' = 'reduce') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: scheme },
      { name: 'prefers-reduced-motion', value: motion }
    ]
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await emulate('light', 'reduce');
});

const DEADLINE = 'Dec 2055';
const card = () => page.getByTestId('tally');
const cont = () => page.getByTestId('tally-continue');
const realStore = () =>
  new GameStore({
    storage: new MemoryStorage(),
    sync: new FakeSync(),
    now: () => new Date(2026, 10, 25)
  });

interface MountOver {
  result?: Partial<RunResult>;
  before?: number | null;
  oncontinue?: () => void;
  onescape?: () => void;
}

function mount(over: MountOver = {}) {
  const { onescape, oncontinue = () => {}, before = null } = over;
  return render(TallyHost, {
    props: {
      store: realStore(),
      tally: { result: runResult(over.result), before, deadline: DEADLINE, oncontinue },
      onescape
    }
  });
}

const el = (testid: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${testid}"]`) as HTMLElement;
const strong = () => el('tally-homes').querySelector('strong')?.textContent?.trim();
const fill = (e: Element) => e.querySelector('[data-fill]')?.getAttribute('data-fill');
/** The text a screen reader gets: everything outside aria-hidden, whitespace collapsed. */
function spoken(e: Element): string {
  const copy = e.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('Tally', () => {
  it('the title for a run that met the goal and one that did not', async () => {
    const met = await mount({ result: { reachedOn: dayFromUtc(2049, 3, 15) } });
    await expect
      .element(page.getByRole('heading', { name: 'Goal met in Mar 2049', exact: true }))
      .toBeVisible();
    await met.unmount();
    await mount();
    await expect
      .element(page.getByRole('heading', { name: 'By Dec 2055', exact: true }))
      .toBeVisible();
  });

  it('the homes line and the change', async () => {
    const cases: [number | null, string | null][] = [
      [36_850, '+3,150'],
      [43_150, '−3,150'],
      [40_000, 'No change'],
      [null, null]
    ];
    for (const [before, text] of cases) {
      const r = await mount({ before });
      await expect.element(page.getByTestId('tally-homes')).toBeVisible();
      expect(strong()).toBe('40,000');
      const change = page.getByTestId('tally-change');
      if (text === null) await expect.element(change).not.toBeInTheDocument();
      else await expect.element(change).toHaveTextContent(text);
      await r.unmount();
    }
  });

  it('the bar fills to the share of the goal', async () => {
    const half = await mount();
    await expect.element(page.getByTestId('tally-bar')).toHaveAttribute('data-fill', '50');
    await half.unmount();
    await mount({ result: { homes: 90_000 } });
    await expect.element(page.getByTestId('tally-bar')).toHaveAttribute('data-fill', '100');
  });

  it('a bar reads 100 only at the goal', async () => {
    await mount({ result: { homes: 79_999 } });
    await expect.element(page.getByTestId('tally-bar')).toHaveAttribute('data-fill', '99');
  });

  it('collected, the lump and side rewards', async () => {
    const plain = await mount();
    await expect
      .element(page.getByTestId('tally-units'))
      .toHaveTextContent('7,300 of 9,100 collected');
    await expect.element(page.getByTestId('tally-lump')).not.toBeInTheDocument();
    await plain.unmount();
    await mount({
      result: {
        lump: { home: 2000 },
        side: [
          { id: SIDE_GOALS[0].id, reward: { home: 500 } },
          { id: 'gone', reward: { home: 50 } }
        ]
      }
    });
    await expect.element(page.getByTestId('tally-lump')).toHaveTextContent('+2,000 for the goal');
    const side = page.getByTestId('tally-side');
    await expect.poll(() => side.all().length).toBe(2);
    await expect.element(side.nth(0)).toHaveTextContent(sideRewardText(500, SIDE_GOALS[0].label));
    await expect.element(side.nth(1)).toHaveTextContent(sideRewardText(50, SIDE_GOAL_FALLBACK));
  });

  it('the units, lump and side lines are read as their Name words, never the mark', async () => {
    await mount({
      result: {
        lump: { home: 2000 },
        side: [
          { id: SIDE_GOALS[0].id, reward: { home: 500 } },
          { id: 'gone', reward: { home: 50 } }
        ]
      }
    });
    const side = page.getByTestId('tally-side');
    await expect.poll(() => side.all().length).toBe(2);
    const lines: [Element, string][] = [
      [el('tally-units').querySelector('p') as Element, collectedName(7300, 9100)],
      [el('tally-lump'), lumpName(2000)],
      [side.elements()[0], sideRewardName(500, SIDE_GOALS[0].label)],
      [side.elements()[1], sideRewardName(50, SIDE_GOAL_FALLBACK)]
    ];
    for (const [line, name] of lines) {
      expect(spoken(line)).toBe(name);
      expect(spoken(line)).not.toContain(UNIT_MARK);
      expect(line.querySelector('.sr-only')?.textContent?.trim()).toBe(name);
    }
  });

  it('four stage rows summed from six stages', async () => {
    await mount({
      result: {
        stages: {
          preApplication: 1,
          filed: 2,
          entitled: 3,
          permitFiled: 4,
          permitIssued: 5,
          construction: 6
        }
      }
    });
    const rows = page.getByTestId('tally-stage');
    await expect.poll(() => rows.all().length).toBe(4);
    const els = rows.elements();
    expect(els.map((e) => e.getAttribute('data-stage'))).toEqual([
      'planning',
      'approved',
      'issued',
      'building'
    ]);
    els.forEach((e, i) => {
      expect(e.textContent).toContain(STAGE_ROWS[i].label);
      expect(e.lastElementChild?.textContent?.trim()).toBe(String([3, 7, 5, 6][i]));
    });
  });

  it('the money row and the shared scale', async () => {
    const stages = {
      preApplication: 1,
      filed: 2,
      entitled: 3,
      permitFiled: 4,
      permitIssued: 5,
      construction: 6
    };
    const none = await mount({ result: { stages } });
    await expect.poll(() => page.getByTestId('tally-stage').all().length).toBe(4);
    await expect.element(page.getByTestId('tally-money')).not.toBeInTheDocument();
    expect(page.getByTestId('tally-stage').elements().map(fill)).toEqual(['42', '100', '71', '85']);
    await none.unmount();
    await mount({ result: { stages, waitingMoney: 14 } });
    const money = page.getByTestId('tally-money');
    await expect.element(money).toHaveTextContent(WAITING_MONEY);
    expect(money.element().lastElementChild?.textContent?.trim()).toBe('14');
    expect(page.getByTestId('tally-stage').elements().map(fill)).toEqual(['21', '50', '35', '42']);
    expect(fill(money.element())).toBe('100');
  });

  it('every row shows at 0 with an empty bar', async () => {
    await mount({ result: { waitingMoney: 0 } });
    await expect.element(page.getByTestId('tally-money')).toBeVisible();
    const rows = [...page.getByTestId('tally-stage').elements(), el('tally-money')];
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.lastElementChild?.textContent?.trim()).toBe('0');
      expect(fill(r)).toBe('0');
    }
  });

  it('Continue has focus at mount; Continue and Escape each call oncontinue once', async () => {
    const pressed = vi.fn();
    const pressedR = await mount({ oncontinue: pressed });
    await expect.element(cont()).toBeVisible();
    expect(document.activeElement).toBe(cont().element());
    await cont().click();
    expect(pressed).toHaveBeenCalledTimes(1);
    await pressedR.unmount();
    const escaped = vi.fn();
    await mount({ oncontinue: escaped });
    await expect.element(cont()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(escaped).toHaveBeenCalledTimes(1);
  });

  it('Escape does not reach the window', async () => {
    const oncontinue = vi.fn();
    const onescape = vi.fn();
    await mount({ oncontinue, onescape });
    await expect.element(cont()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(oncontinue).toHaveBeenCalledTimes(1);
    expect(onescape).not.toHaveBeenCalled();
  });

  it('the account offer is inside the card', async () => {
    await mount();
    await expect.element(card()).toBeVisible();
    expect(card().element().querySelector('[data-testid="account-offer"]')).not.toBeNull();
  });

  it('renders nothing for the open game', async () => {
    await render(TallyHost, {
      props: {
        store: openGame(),
        tally: { result: runResult(), before: null, deadline: DEADLINE, oncontinue: () => {} }
      }
    });
    await expect.element(card()).not.toBeInTheDocument();
  });

  it('with reduced motion the final numbers show at once', async () => {
    await mount({ before: 36_850 });
    await expect.element(page.getByTestId('tally-homes')).toBeVisible();
    expect(strong()).toBe('40,000');
    expect(el('tally-units').querySelector('[aria-hidden="true"]')?.textContent).toContain(
      '7,300 of 9,100 collected'
    );
  });

  // Fake the animation clock before the render: the roll's frames run on it. No
  // expect.element after it: its retries wait on timers.
  async function rolling() {
    await emulate('light', 'no-preference');
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    // Not awaited: its trace mark would wait on the faked clock.
    void mount({ before: 36_850 });
    flushSync();
  }

  it('without reduced motion the numbers roll for TALLY_ROLL_MS', async () => {
    await rolling();
    expect(strong()).toBe('36,850');
    await vi.advanceTimersByTimeAsync(TALLY_ROLL_MS + 50);
    flushSync();
    expect(strong()).toBe('40,000');
    expect(el('tally-units').querySelector('[aria-hidden="true"]')?.textContent).toContain(
      '7,300 of 9,100 collected'
    );
  });

  it('the screen reader gets the final numbers during a roll', async () => {
    await rolling();
    expect(strong()).toBe('36,850');
    expect(el('tally-homes').querySelector('.sr-only')?.textContent?.trim()).toBe(
      homesOfText(40_000, 80_000)
    );
    expect(spoken(el('tally-units'))).toBe(collectedName(7300, 9100));
  });

  it('Continue is at least 24 px', async () => {
    await mount();
    await expect.element(cont()).toBeVisible();
    const r = cont().element().getBoundingClientRect();
    expect(r.width).toBeGreaterThanOrEqual(24);
    expect(r.height).toBeGreaterThanOrEqual(24);
  });

  it('axe finds no violation in light and dark', async () => {
    await mount({
      before: 36_850,
      result: {
        lump: { home: 2000 },
        side: [{ id: SIDE_GOALS[0].id, reward: { home: 500 } }],
        waitingMoney: 3
      }
    });
    await expect.element(card()).toBeVisible();
    for (const s of ['light', 'dark'] as const) {
      await emulate(s);
      expect((await axe.run(card().element())).violations).toEqual([]);
    }
  });
});
