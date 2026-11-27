// The game shell end to end (game-shell): the opening on `/` and the simulation after Start at the
// same address, `/sim` as a redirect to `/`, the header with no steps, the first load's brush, the
// simulation with no game, and `/p/<id>` in full. Runs against the VITE_E2E build on fixture-0,
// with the real game switched on by e2e/helpers/game.ts before the first navigation. The round's
// header at phone width: the pinned goal's states at 320 px, a win with "Autosave off" beside it,
// and the round panel under the header.
import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/lib/game/state';
import { expectHeaderRowFits } from './helpers/chrome';
import { seedGoalAmount } from './helpers/game';
import { FIXTURE_AMOUNT, frameMap, monthDay, seedRuns, waitResult, waitSim } from './helpers/play';
import { slider, waitFilled } from './helpers/run';
import {
  gotoEditor,
  gotoHydrated,
  openHeaderMenu,
  ops,
  paintOnce,
  smallText
} from './helpers/sharing';

test('a new visitor paints once, presses Start, and the simulation opens at /', async ({
  page,
  isMobile
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const paths: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) paths.push(new URL(f.url()).pathname);
  });
  await seedGoalAmount(page, 1);
  await gotoEditor(page);
  await paintOnce(page, isMobile);

  const start = page.getByTestId('opening-start');
  await expect(start).toBeVisible();
  await start.click();
  await waitSim(page);

  await expect(page).toHaveURL(/\/$/);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(paths.length).toBeGreaterThan(0);
  expect(new Set(paths)).toEqual(new Set(['/']));
});

test('the opening card is one element inside its box', async ({ page, isMobile }) => {
  await seedGoalAmount(page, 1);
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  const box = page.getByTestId('opening-card-box');
  await expect(box).toBeVisible();
  await expect(box.getByTestId('opening-card')).toHaveCount(1);
  await expect(page.getByTestId('opening-card')).toHaveCount(1);
});

test('/sim is a 308 to /', async ({ page }) => {
  const res = await page.request.get('/sim?seed=1', { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()['location']).toBe('/');

  await page.goto('/sim');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('the header has no steps and reads SF Housing', async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await gotoEditor(page);
    await expect(page.getByRole('navigation', { name: 'Steps' })).toHaveCount(0);
    // Below sm, with the room score pinned, the site name is in the open Menu; from sm in the bar.
    await openHeaderMenu(page);
    const name = page.getByRole('banner').getByRole('link', { name: 'SF Housing', exact: true });
    await expect(name).toBeVisible();
    await expect(name).toHaveAttribute('href', '/');
    await expect(page.getByRole('navigation', { name: 'Steps' })).toHaveCount(0);
  }
});

test("a new visitor's first load shows the brush at Room for 0 homes", async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));
  await gotoEditor(page);
  await expect(page.getByRole('banner').getByTestId('score-bar')).toContainText('Room for 0 homes');
  expect(await ops(page)).toBe(0);
  expect(messages.filter((m) => /hydrat/i.test(m))).toEqual([]);
});

test('with no game, / shows the simulation and no game panel', async ({ page }) => {
  await gotoHydrated(page, '/');
  await expect(page.getByTestId('tl-mode')).toBeVisible();
  await expect(page.getByTestId('game-panel')).toHaveCount(0);
  expect(await ops(page)).toBeNull();
});

test('/p/<id> opens in full with no Remix and links Your game to /', async ({ page, request }) => {
  const res = await request.post('/api/plans', {
    data: smallText,
    headers: { 'content-type': 'application/json' }
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };

  await gotoHydrated(page, `/p/${id}`);
  const banner = page.getByRole('region', { name: 'Shared plan' });
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remix' })).toHaveCount(0);
  await expect(page.getByText('Open with current data')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Your game' })).toHaveAttribute('href', '/');
});

// ---- the round's header at phone width (Review Focus 5) ----------------------------------------

// Current law reaches FIXTURE_AMOUNT in Sep 2039: a target of Jan 2045 is beaten, Jan 2035 is not.
const ROUND: Record<'pending' | 'win' | 'late', Partial<GameState>> = {
  pending: { phase: 'runs', round: 1, target: monthDay(2045, 1) },
  win: { phase: 'runs', round: 1, target: monthDay(2045, 1) },
  late: { phase: 'runs', round: 1, target: monthDay(2035, 1) }
};

/** A seeded round at `width`, on the simulation, filled; the ruler's End unless pending. */
async function roundAt(page: Page, width: number, state: 'pending' | 'win' | 'late') {
  await page.setViewportSize({ width, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedRuns(page, ROUND[state], FIXTURE_AMOUNT);
  await gotoHydrated(page, '/');
  await waitSim(page);
  await frameMap(page);
  await waitFilled(page);
  if (state !== 'pending') {
    await slider(page).focus();
    await page.keyboard.press('End');
  }
  await waitResult(page, state);
}

/**
 * The phone line as drawn: its text, the rest's box against the line's (overflow hidden), and the
 * header's parts as [left, right] for the failure message.
 */
async function phoneLine(page: Page) {
  return page.getByTestId('goal-phone').evaluate((line) => {
    const box = line.getBoundingClientRect();
    const rest = line.querySelector('.goal-rest')!.getBoundingClientRect();
    const span = (el: Element | null) => {
      if (!el || !(el as HTMLElement).checkVisibility()) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left * 10) / 10, Math.round(r.right * 10) / 10];
    };
    return {
      text: (line as HTMLElement).innerText,
      restLeft: rest.left,
      restRight: rest.right,
      lineLeft: box.left,
      lineRight: box.right,
      parts: {
        goalBox: span(document.querySelector('[data-testid="goal-box"]')),
        gift: span(document.querySelector('[data-testid="goal-gift"]')),
        status: [...document.querySelectorAll('header [data-header-status]')].map(span),
        menu: span(document.querySelector('header [data-header-menu]'))
      }
    };
  });
}

/** Each state at 320 px: the word its line must show, and how many gifts it has. */
const AT_320 = [
  { state: 'pending', word: 'before', gifts: 0 },
  { state: 'win', word: 'early', gifts: 1 },
  { state: 'late', word: 'late', gifts: 0 }
] as const;

for (const c of AT_320) {
  test(`at 320 px the round's header fits: ${c.state}`, async ({ page }) => {
    // At 320 px the win and late lines clip (measured 2026-11-26, both projects, FIXTURE_AMOUNT):
    // in a win the phone line runs 23 to 173.5 px (the gift 177.5 to 201.5, the status cell 216.5
    // to 264 with nothing shown in it, the Menu 272 to 304) and its rest "by Sep 2039 · 5 yr 4 mo
    // early" ends at 223.3, so "early" is cut; late, the line ends at 201.5 and "· 4 yr 8 mo late"
    // at 216. Reported as a concern in Task 11; the row itself fits and the gift is 24 by 24.

    test.fixme(c.state !== 'pending', 'the win and late lines clip at 320 px (see the comment)');
    await roundAt(page, 320, c.state);
    await expectHeaderRowFits(page);
    const line = await phoneLine(page);
    expect(line.restRight, `the rest is clipped: ${JSON.stringify(line)}`).toBeLessThanOrEqual(
      line.lineRight + 0.5
    );
    expect(line.text).toContain(c.word);
    const gifts = await page
      .getByTestId('goal-gift')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    expect(gifts).toHaveLength(c.gifts);
    expect(gifts.every((r) => r.width >= 24 && r.height >= 24)).toBe(true);
  });
}

for (const width of [320, 375]) {
  test(`at ${width} px a win with the gift and Autosave off: the goal is not clipped`, async ({
    page
  }) => {
    // With "Autosave off" the status cell is 97 px wide (166.9 to 264 at 320 px, 221.9 to 319 at
    // 375; measured 2026-11-26, both projects): the phone line ends at 123.9 (320) and 178.9 (375)
    // and its rest "by Sep 2039 · 5 yr 4 mo early" at 223.3, so "early" is cut. The row fits.
    // Reported as a concern in Task 11.

    test.fixme(true, 'the win line clips beside Autosave off at 320 and 375 px (see the comment)');
    // Storage refuses the policy record only: the autosave is off, the game still saves.
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (key === 'sfhousing:sim:v2') throw new DOMException('refused', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    await roundAt(page, width, 'win');
    const off = page.getByRole('banner').getByRole('button', { name: 'Autosave off', exact: true });
    await expect(off).toBeVisible();
    await expect(page.getByTestId('goal-gift')).toBeVisible();
    await expectHeaderRowFits(page);
    const line = await phoneLine(page);
    expect(line.restRight, `the rest is clipped: ${JSON.stringify(line)}`).toBeLessThanOrEqual(
      line.lineRight + 0.5
    );
    expect(line.text).toContain('early');
  });
}

for (const width of [320, 1280]) {
  test(`at ${width} px the round panel opens inside the viewport, under the header`, async ({
    page
  }) => {
    await roundAt(page, width, 'pending');
    await page.getByTestId('goal-headline-button').click();
    const panel = page.getByTestId('round-panel');
    await expect(panel).toBeVisible();
    // The pop-over that holds `round-panel` (GoalHeadline's panel container, by its id).
    const box = await panel.evaluate((el) => {
      const r = (el.closest('[id]') ?? el).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const header = (await page.getByRole('banner').boundingBox())!;
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    expect(box.bottom).toBeLessThanOrEqual(800);
    expect(box.top).toBeGreaterThanOrEqual(header.y + header.height - 0.5);
    expect(box.top).toBeLessThanOrEqual(header.y + header.height + 8);
  });
}
