// Playing the game from a spec: the saved game, the simulation tool and the rounds. Every wait is a
// state in the page or in storage (the tool's dock, the goal's `data-state`, the saved game); none
// is a fixed time.
import { expect, type Locator, type Page } from '@playwright/test';
import { E2E_GOAL_KEY } from '../../src/lib/game/e2e';
import type { GameSave } from '../../src/lib/game/save-shape';
import { SAVES_KEY, saveKey } from '../../src/lib/game/saves';
import type { GameState } from '../../src/lib/game/state';
import type { Day } from '../../src/lib/timelapse/time';
import { seedGame, seedGoalAmount } from './game';
import { holdPolicy, openKind } from './run';
import { FRAME, jumpAndIdle, openHeaderMenu, type Win } from './sharing';

/** The first day of a calendar month, as a `Day` (whole days since 1970-01-01, UTC). */
export const monthDay = (year: number, month: number): Day =>
  Date.UTC(year, month - 1, 1) / 86_400_000;

// The probe (a scratch script over `openEngine({ dir: 'e2e/fixtures/data/fixture-0' })` and
// `catalogueDoc`, not committed) measured the goal month of current law and of each round-1 policy
// alone at every amount up to current law's 462 homes at the window's end; today is 10 Oct 2026.
// Re-run after the building-choice engine (2026-11-27): from 434 to 442 homes current law reaches
// the goal in Aug 2038 and the rail rule alone in Sep 2033, 59 months earlier (the SB 423 clock: no
// change). 438 sits in the middle of that window. Below 434 the rail rule is no earlier than current
// law; at 445 to 448 and 449 to 462 it also wins, but each play from today is longer at 3x, which a
// 30 s test cannot spare. Branch A: the rail rule switched on wins.

/** The goal's amount the round journeys play at (the probe: the rail rule wins from 434 to 442). */
export const FIXTURE_AMOUNT = 438;
/** 'switch': a round-1 policy switched on wins (branch A). 'edit': the rail rule edited to 12
 *  stories and 1,200 m wins in a seeded round-2 game (branch B). */
export const FIXTURE_ROUTE: 'switch' | 'edit' = 'switch';
/** Branch B only: the seeded target, the goal month with the rail rule on at its fixed values
 *  (first day of the month); null for branch A. */
export const FIXTURE_TARGET: Day | null = null;
/** Current law's goal month at FIXTURE_AMOUNT (the probe): Aug 2038. */
export const FIXTURE_LAW_MONTH: Day = monthDay(2038, 8);
/** The rail rule's goal month at FIXTURE_AMOUNT, at its fixed values (the probe): Sep 2033. */
export const FIXTURE_RAIL_MONTH: Day = monthDay(2033, 9);

/**
 * Before the first load: the goal amount (default 1) and a game seeded with `state` (default: in
 * the runs, round 1).
 */
export async function seedRuns(
  page: Page,
  state: Partial<GameState> = { phase: 'runs', round: 1 },
  amount = 1
): Promise<void> {
  await seedGoalAmount(page, amount);
  await seedGame(page, state);
}

/**
 * Sets the goal's amount in storage now. The opening and the simulation each read it once, when
 * they mount, so a journey can paint to a small room goal and then Start a simulation at another
 * amount.
 */
export async function setGoalAmount(page: Page, amount: number): Promise<void> {
  await page.evaluate((a) => localStorage.setItem(a.key, a.value), {
    key: E2E_GOAL_KEY,
    value: String(amount)
  });
}

/** The current game as storage holds it; throws when there is none. */
export async function savedGame(page: Page): Promise<GameSave> {
  const index = await page.evaluate((k) => localStorage.getItem(k), SAVES_KEY);
  if (index === null) throw new Error('savedGame: no saved games');
  const current = (JSON.parse(index) as { current?: unknown }).current;
  if (typeof current !== 'string') throw new Error('savedGame: no current game');
  const text = await page.evaluate((k) => localStorage.getItem(k), saveKey(current));
  if (text === null) throw new Error(`savedGame: no save for ${current}`);
  return JSON.parse(text) as GameSave;
}

/** Polls `savedGame` every 50 ms (no back-off) until `ok` holds; returns that save. */
export async function waitSaved(page: Page, ok: (s: GameSave) => boolean): Promise<GameSave> {
  let last: GameSave | null = null;
  await expect
    .poll(
      async () => {
        try {
          last = await savedGame(page);
        } catch {
          return false;
        }
        return ok(last);
      },
      { intervals: [50] }
    )
    .toBe(true);
  return last!;
}

/** Waits until the page is the simulation tool: its dock (the timeline) is visible. */
export async function waitSim(page: Page): Promise<void> {
  await expect(page.getByTestId('tl-dock')).toBeVisible();
}

/**
 * Once the simulation's map is ready, moves it to the fixture's frame (zoom 18.5, flat) and waits
 * for it to idle. A loaded game opens on the whole city in 3D, which software GL draws slowly
 * enough to hold the main thread for seconds a frame on a loaded machine: clicks wait on it, and
 * playback steps fewer months a second.
 */
export async function frameMap(page: Page): Promise<void> {
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready');
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
  await jumpAndIdle(page, FRAME);
}

/** The pinned goal (`GoalHeadline`'s root, which carries `data-state`). */
export const goal = (page: Page): Locator => page.getByTestId('goal-headline');

/** Waits for goal-headline's data-state. */
export async function waitResult(page: Page, state: 'pending' | 'win' | 'late'): Promise<void> {
  await expect(goal(page)).toHaveAttribute('data-state', state);
}

/**
 * Plays at 3x until the state leaves pending (bounded by the test's timeout), then pauses: playback
 * would run on to the window's end, keeping the page's main thread busy for what the test does
 * next.
 */
export async function playToResult(page: Page): Promise<'win' | 'late'> {
  await waitResult(page, 'pending');
  const speed = page.getByTestId('tl-speed');
  if ((await speed.textContent())?.trim() !== '3×') await speed.click();
  await expect(speed).toHaveText('3×');
  const play = page.getByTestId('tl-play');
  await expect(play).not.toHaveAccessibleName('Pause');
  await play.click();
  // No timeout of its own: playback takes as long as the months it plays (3 years a second).
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="goal-headline"]')?.getAttribute('data-state') !==
      'pending'
  );
  const state = await goal(page).getAttribute('data-state');
  if (state !== 'win' && state !== 'late') throw new Error(`playToResult: state ${state}`);
  await pausePlayback(page);
  return state;
}

/** Presses Pause when playback runs (it may have reached the window's end and stopped). */
async function pausePlayback(page: Page): Promise<void> {
  const play = page.getByTestId('tl-play');
  // The label reads Replay once playback stopped at the end; Pause while it runs.
  if ((await play.textContent())?.trim() === 'Pause') await play.click();
  await expect(play).not.toHaveAccessibleName('Pause');
}

/** Presses the gift and Accept through every explainer; returns the titles seen. */
export async function takeGift(page: Page, by: 'pointer' | 'keys'): Promise<string[]> {
  const gift = page.getByTestId('goal-gift');
  if (by === 'pointer') await gift.click();
  else {
    // The gift is in the header, before the page's controls: back with Shift+Tab.
    await tabBackTo(page, gift);
    await page.keyboard.press('Enter');
  }
  const dialog = page.getByTestId('gift-dialog');
  await expect(dialog).toBeVisible();
  const step = dialog.getByTestId('gift-step');
  const count = Number(/ of (\d+)$/.exec((await step.textContent()) ?? '')?.[1]);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('takeGift: no step count');
  const titles: string[] = [];
  const accept = dialog.getByTestId('gift-accept');
  for (let i = 1; i <= count; i++) {
    await expect(step).toHaveText(`${i} of ${count}`);
    titles.push(((await dialog.getByRole('heading', { level: 2 }).textContent()) ?? '').trim());
    await expect(accept).toBeFocused();
    if (by === 'pointer') await accept.click();
    else await page.keyboard.press('Enter');
  }
  await expect(dialog).toHaveCount(0);
  return titles;
}

const focused = (target: Locator): Promise<boolean> =>
  target.evaluate((el) => el === document.activeElement);

/** Puts focus on body and makes it the start of sequential focus navigation. */
export async function focusBody(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
}

/** Presses Tab, at most 80 times, until `target` has focus; throws otherwise. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  if (await focused(target)) return;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await focused(target)) return;
  }
  throw new Error('tabTo: target not reached in 80 presses');
}

/** Presses Shift+Tab, at most 80 times, until `target` has focus; throws otherwise. */
export async function tabBackTo(page: Page, target: Locator): Promise<void> {
  if (await focused(target)) return;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Shift+Tab');
    if (await focused(target)) return;
  }
  throw new Error('tabBackTo: target not reached in 80 presses');
}

/** Presses Tab until `target` has focus, at most 80 times; returns how many presses it took. */
export async function tabCount(page: Page, target: Locator): Promise<number> {
  if (await focused(target)) return 0;
  for (let i = 1; i <= 80; i++) {
    await page.keyboard.press('Tab');
    if (await focused(target)) return i;
  }
  throw new Error('tabCount: target not reached in 80 presses');
}

/** Opens the header's Menu, which holds the game panel; returns the panel. */
export async function openGamePanel(page: Page): Promise<Locator> {
  await openHeaderMenu(page);
  const panel = page.getByTestId('game-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * A policy's row parts (`tl-policy`, a display: contents wrapper) by its id. A catalogue transit
 * rule's id is its key (`transit-rail`); a preset's is made when it is added, so find those by
 * label (`policyRowNamed`).
 */
export const policyRow = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="tl-policy"][data-policy-id="${id}"]`).first();

/** A policy's row parts by the policy's label. */
export const policyRowNamed = (page: Page, label: string): Locator =>
  page
    .getByTestId('tl-policy')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();

/** The playhead's day, from the debug hook. */
export const playheadDay = (page: Page): Promise<number> =>
  page.evaluate(() => (window as { __sfhFzp?: { day: number } }).__sfhFzp?.day ?? -1);

/** Storage refuses the policy record only: the autosave is off, the game still saves. */
export async function refusePolicyRecord(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key === 'sfhousing:sim:v2') throw new DOMException('refused', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
}

/** The header's "Autosave off" button (an icon below sm in a game, named by its word). */
export const autosaveOff = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: 'Autosave off', exact: true });
/** "Updating" in the status cell (a spinner below sm in a game, named by its word). */
export const updating = (page: Page) =>
  page.getByTestId('tl-status').getByRole('button', { name: 'Updating', exact: true });

/** The rail rule switched on while `setPolicy` is held: "Updating" shows, the state pending. */
export async function staleEdit(page: Page): Promise<void> {
  await holdPolicy(page);
  await openKind(page, 'Zoning');
  const railSwitch = policyRow(page, 'transit-rail').getByRole('switch');
  await railSwitch.click();
  await expect(railSwitch).toHaveAttribute('aria-checked', 'true');
  const close = page.getByRole('button', { name: 'Close Zoning', exact: true });
  if (await close.isVisible()) await close.click();
  await expect(updating(page)).toBeVisible();
  await waitResult(page, 'pending');
}
