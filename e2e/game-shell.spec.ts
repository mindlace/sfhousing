// The game shell end to end (game-shell, sec-tests-e2e): Paint's win and its Level up onto /sim,
// the header's locked Simulate step and level cell, and Remix from /s/<id> and /p/<id> into a
// saved game. Runs against the VITE_E2E build on fixture-0, with the real game switched on by
// e2e/helpers/game.ts before the first navigation.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { newVisitor, seedGame, seedGoalAmount } from './helpers/game';
import { addPolicy, openKind, waitFilled } from './helpers/run';
import {
  SIM_KEY,
  gotoEditor,
  gotoHydrated,
  openHeaderMenu,
  ops,
  paintOnce,
  seedPlanRow,
  smallText,
  waitForMap
} from './helpers/sharing';

const PRESET = "Permits at San Diego's pace";

/** A whole stored schema-2 policy document: a 'sim' row that needs no /sim to capture. */
const SCHEMA2_TEXT = readFileSync(
  new URL('../src/lib/sim-page/fixtures/schema2/painted.json', import.meta.url),
  'utf8'
);

/** The Steps nav on show: from lg the header's, below lg the open Menu's. */
const steps = (page: Page): Locator => page.getByRole('navigation', { name: 'Steps' });

/** The policy the app autosaves on /sim after adding the San Diego permitting preset. */
async function capturePresetDoc(page: Page): Promise<{ datasetVersion: string }> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, '/sim');
  await waitFilled(page);
  await addPolicy(page, 'Permitting', PRESET);
  const stored = () =>
    page.evaluate((k) => {
      const raw = localStorage.getItem(k);
      return raw === null ? null : JSON.parse((JSON.parse(raw) as { plan: string }).plan);
    }, SIM_KEY);
  await expect
    .poll(async () => (await stored())?.policy.kinds.permitting[0]?.preset)
    .toBe('benchmarkPermits');
  return await stored();
}

test("a new visitor's first load has no hydration warning and locks Simulate after hydration", async ({
  page
}) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));
  await newVisitor(page);
  await gotoHydrated(page, '/about');
  await openHeaderMenu(page);
  await expect(steps(page).locator('[data-step-locked]')).toBeVisible();
  await expect(steps(page).getByRole('link', { name: 'Simulate' })).toHaveCount(0);
  expect(messages.filter((m) => /hydrat/i.test(m))).toEqual([]);
});

test('a new visitor paints past the goal, levels up and lands on /sim at level 2', async ({
  page,
  isMobile
}) => {
  await newVisitor(page);
  await seedGoalAmount(page, 1);
  await gotoEditor(page);
  await paintOnce(page, isMobile);

  const card = page.getByTestId('paint-win');
  await expect(card.getByRole('heading', { name: 'Room for 1 homes' })).toBeVisible();
  await expect(card).toContainText('Unlocks: The simulation');
  await card.getByRole('button', { name: 'Level up' }).click();

  await expect(page).toHaveURL(/\/sim$/);
  await openHeaderMenu(page);
  await expect(page.getByTestId('header-level')).toHaveText('Level 2');
  await expect(steps(page).getByRole('link', { name: 'Simulate', exact: true })).toHaveAttribute(
    'href',
    '/sim'
  );
  await expect(page.locator('[data-step-locked]')).toHaveCount(0);
});

test("at level 1 the Simulate step is no link, and /s/<id>'s Remix asks to unlock", async ({
  page
}) => {
  await seedGame(page, 1);
  const id = await seedPlanRow(page.request, {
    body: SCHEMA2_TEXT,
    datasetVersion: 'fixture-0',
    kind: 'sim'
  });
  await gotoHydrated(page, `/s/${id}`);
  const banner = page.getByRole('region', { name: 'Shared policy' });
  await expect(
    banner.getByRole('button', { name: 'Unlock the simulation to remix' })
  ).toHaveAttribute('aria-disabled', 'true');
  await openHeaderMenu(page);
  await expect(steps(page).locator('[data-step-locked]')).toBeVisible();
  await expect(steps(page).getByRole('link', { name: 'Simulate' })).toHaveCount(0);
});

test("at level 1 /p/<id>'s Remix opens Paint on the published plan, listed in the level panel", async ({
  page,
  request
}) => {
  await seedGame(page, 1);
  const res = await request.post('/api/plans', {
    data: smallText,
    headers: { 'content-type': 'application/json' }
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };

  await page.goto(`/p/${id}`);
  await waitForMap(page);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page
    .getByRole('region', { name: 'Shared plan' })
    .getByRole('button', { name: 'Remix' })
    .click();
  await expect(page).toHaveURL(/\/$/);
  // toHaveURL passes when the new document commits; wait for Paint to mount and set its hook.
  await waitForMap(page);
  // small.json holds 3 ops: Paint opens the published plan.
  await expect.poll(() => ops(page)).toBe(3);

  await openHeaderMenu(page);
  await page.getByTestId('header-level').click();
  await expect(
    page
      .getByTestId('header-level-panel')
      .getByTestId('save-row')
      .filter({ hasText: 'Remix of Untitled plan' })
  ).toHaveCount(1);
});

test("at level 3 /s/<id>'s Remix of one permitting policy opens /sim with its row", async ({
  page
}) => {
  await seedGame(page, 3);
  const doc = await capturePresetDoc(page);
  const id = await seedPlanRow(page.request, {
    body: JSON.stringify(doc),
    datasetVersion: doc.datasetVersion,
    kind: 'sim'
  });
  // Clear the current game's policy, so the row /sim shows can only be the remixed one.
  await page.evaluate((k) => localStorage.removeItem(k), SIM_KEY);

  await gotoHydrated(page, `/s/${id}`);
  await page
    .getByRole('region', { name: 'Shared policy' })
    .getByRole('button', { name: 'Remix' })
    .click();
  await expect(page).toHaveURL(/\/sim$/);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await waitFilled(page);
  await openKind(page, 'Permitting');
  await expect(
    page.getByRole('button', { name: new RegExp(`, ${PRESET}, `) }).last()
  ).toBeVisible();
});
