// The game shell end to end (game-shell): the opening on `/` and the first run's start at the same
// address, `/sim` as a redirect to `/`, the header with no steps, the first load's brush, the
// simulation with no game, and `/p/<id>` in full. Runs against the VITE_E2E build on fixture-0,
// with the real game switched on by e2e/helpers/game.ts before the first navigation.
import { expect, test } from '@playwright/test';
import { seedGoalAmount } from './helpers/game';
import { waitPhase } from './helpers/play';
import {
  gotoEditor,
  gotoHydrated,
  openHeaderMenu,
  ops,
  paintOnce,
  smallText
} from './helpers/sharing';

test('a new visitor paints once, presses Start, and the first run starts at /', async ({
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
  await waitPhase(page, 'run');

  await expect(page).toHaveURL(/\/$/);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(paths.length).toBeGreaterThan(0);
  expect(new Set(paths)).toEqual(new Set(['/']));
  // The map box takes focus (tl-map-box, tabindex -1 while starting and running).
  await expect
    .poll(() =>
      page.evaluate(
        () => !!document.activeElement?.contains(document.querySelector('[data-testid="map-root"]'))
      )
    )
    .toBe(true);
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
    // Below lg the site name is in the open Menu; from lg it is in the bar.
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

test('with no game, / shows the simulation and no unit count', async ({ page }) => {
  await gotoHydrated(page, '/');
  await expect(page.getByTestId('tl-mode')).toBeVisible();
  await expect(page.getByTestId('header-units')).toHaveCount(0);
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
