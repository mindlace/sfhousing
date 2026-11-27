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

/**
 * A seeded round at `width`, on the simulation, filled; the ruler's End unless pending. With
 * `off`, storage refuses the policy record, so the autosave is off.
 */
async function roundAt(page: Page, width: number, state: 'pending' | 'win' | 'late', off = false) {
  if (off) await refusePolicyRecord(page);
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

/** Storage refuses the policy record only: the autosave is off, the game still saves. */
async function refusePolicyRecord(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key === 'sfhousing:sim:v2') throw new DOMException('refused', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
}

/**
 * The phone line as drawn: its box, each drawn part's box (count, short count, homes, the rest
 * and the result), the part holding `word` and the viewport's width, for the checks and their
 * failure messages.
 */
async function phoneLine(page: Page, word: string) {
  return page.getByTestId('goal-phone').evaluate((line, w) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const parts = ['count', 'short', 'homes', 'rest', 'result']
      .map((c) => ({ c, el: line.querySelector(`.goal-${c}`) }))
      .filter((p) => p.el !== null && p.el.getBoundingClientRect().width > 0)
      .map((p) => ({ c: p.c, text: p.el!.textContent ?? '', ...box(p.el!) }));
    return {
      line: box(line),
      parts,
      word: parts.find((p) => p.text.includes(w)) ?? null,
      viewport: innerWidth
    };
  }, word);
}

/** Every drawn part of the line inside the line's box and the viewport; the word drawn whole. */
function expectWhole(drawn: Awaited<ReturnType<typeof phoneLine>>): void {
  const why = JSON.stringify(drawn);
  for (const p of drawn.parts) {
    expect(p.left, why).toBeGreaterThanOrEqual(drawn.line.left - 0.5);
    expect(p.right, why).toBeLessThanOrEqual(drawn.line.right + 0.5);
    expect(p.top, why).toBeGreaterThanOrEqual(drawn.line.top - 0.5);
    expect(p.bottom, why).toBeLessThanOrEqual(drawn.line.bottom + 0.5);
    expect(p.right, why).toBeLessThanOrEqual(drawn.viewport);
  }
  expect(drawn.word, why).not.toBeNull();
}

/** Each state's word, and how many gifts it shows. */
const STATES = [
  { state: 'pending', word: 'before', gifts: 0 },
  { state: 'win', word: 'early', gifts: 1 },
  { state: 'late', word: 'late', gifts: 0 }
] as const;

for (const width of [320, 375])
  for (const off of [false, true])
    for (const c of STATES) {
      test(`at ${width} px ${c.state}${off ? ' beside Autosave off' : ''}: the goal line is whole`, async ({
        page
      }) => {
        await roundAt(page, width, c.state, off);
        await expect(
          page.getByRole('banner').getByRole('button', { name: 'Autosave off', exact: true })
        ).toHaveCount(off ? 1 : 0);
        await expectHeaderRowFits(page);
        expectWhole(await phoneLine(page, c.word));
        await expect(page.getByTestId('goal-phone')).toContainText(c.word);
        const gifts = await page
          .getByTestId('goal-gift')
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
        expect(gifts).toHaveLength(c.gifts);
        expect(gifts.every((r) => r.width >= 24 && r.height >= 24)).toBe(true);
      });
    }

test('at 375 px with no status the win line is one line', async ({ page }) => {
  await roundAt(page, 375, 'win');
  const drawn = await phoneLine(page, 'early');
  expectWhole(drawn);
  expect(new Set(drawn.parts.map((p) => Math.round(p.top))).size, JSON.stringify(drawn)).toBe(1);
});

test('at 320 px beside Autosave off the wrapped line keeps the header at its height', async ({
  page
}) => {
  await roundAt(page, 320, 'win', true);
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Autosave off', exact: true })
  ).toBeVisible();
  const drawn = await phoneLine(page, 'early');
  expectWhole(drawn);
  const rest = drawn.parts.find((p) => p.c === 'rest')!;
  const result = drawn.parts.find((p) => p.c === 'result')!;
  expect(result.top, JSON.stringify(drawn)).toBeGreaterThan(rest.top);
  expect((await page.getByRole('banner').boundingBox())!.height).toBe(48);
});

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
