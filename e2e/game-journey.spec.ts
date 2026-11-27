// The game's journeys in rounds (policy-rounds spec, sec-done): a new visitor by pointer from the
// opening through current law's win and the gift to a win with a round-1 policy and its edit; the
// same loop by keyboard only; a late round; the ending; and a saved version 2 game. Runs against
// the VITE_E2E build on fixture-0 at the probe's amount (helpers/play.ts, FIXTURE_AMOUNT: current
// law reaches it in Sep 2039, the rail rule alone in Aug 2038). Every wait is a state: the goal's
// `data-state`, the debug hook's day, the saved game or a visible element.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { PLUS_NAME } from '../src/lib/timeline/test/plus';
import { seedGoalAmount, seedV2Game } from './helpers/game';
import {
  FIXTURE_AMOUNT,
  FIXTURE_LAW_MONTH,
  FIXTURE_RAIL_MONTH,
  FIXTURE_ROUTE,
  focusBody,
  frameMap,
  goal,
  monthDay,
  playToResult,
  playheadDay,
  policyRow,
  policyRowNamed,
  savedGame,
  seedRuns,
  setGoalAmount,
  tabBackTo,
  tabCount,
  tabTo,
  takeGift,
  waitResult,
  waitSaved,
  waitSim
} from './helpers/play';
import { openKind, slider, waitFilled } from './helpers/run';
import {
  FRAME,
  gotoEditor,
  gotoHydrated,
  jumpAndIdle,
  openHeaderMenu,
  ops,
  paintOnce,
  smallText,
  type Win
} from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

/** The round-1 policies, in the order the explainers give them. */
const ROUND_1 = ['Taller near BART and Caltrain', 'SB 423 clock', 'Housing bond'];
/** The round-2 policies, in the order the explainers give them. */
const ROUND_2 = ['Taller near Muni Metro', 'Benchmark permits', 'General revenue'];
const RAIL = 'transit-rail';
/** A rule's source code in the height limits is SRC_RULE0 + its index (src/lib/sim/levers/source.ts,
 *  whose imports Playwright cannot load). */
const SRC_RULE0 = 2;

/** expect.poll without the back-off: a state is seen within 50 ms of being reached. */
const FAST = { intervals: [50] };

const fzp = <K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> =>
  page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;

/** The rail rule's first month (its one span's `from`) in the page's document. */
const railFrom = (page: Page): Promise<number> =>
  page.evaluate(
    (id) =>
      (window as FzpWin).__sfhFzp!.policy.kinds.zoning.find((p) => p.id === id)!.spans[0].from,
    RAIL
  );

/** The rail rule's bands in the page's document. */
const railBands = (page: Page): Promise<{ maxM: number; stories: number }[]> =>
  page.evaluate((id) => {
    const what = (window as FzpWin).__sfhFzp!.policy.kinds.zoning.find((p) => p.id === id)!.spans[0]
      .what;
    return what.tag === 'bands' ? what.bands.map((b) => ({ ...b })) : [];
  }, RAIL);

/** The saved games the account holds, as `GET /api/game` lists them (phase and round only). */
async function accountSaves(page: Page): Promise<unknown> {
  const res = await page.request.get('/api/game');
  if (res.status() !== 200) return { status: res.status() };
  const body = (await res.json()) as { saves: { phase: string; round: number }[] };
  return { status: 200, saves: body.saves.map((e) => ({ phase: e.phase, round: e.round })) };
}

/** Below md a kind's rows are a sheet over the timeline: closes it (from md nothing to do). */
async function closeKindSheet(page: Page, kind: string): Promise<void> {
  const close = page.getByRole('button', { name: `Close ${kind}`, exact: true });
  if (await close.isVisible()) {
    await close.click();
    await expect(close).toHaveCount(0);
  }
}

/** A row of `kind` reads New, its switch off. */
async function expectNewOff(
  page: Page,
  kind: 'Zoning' | 'Permitting' | 'Public money',
  label: string
) {
  await openKind(page, kind);
  const row = policyRowNamed(page, label);
  await expect(row.getByTestId('tl-policy-new')).toBeVisible();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await closeKindSheet(page, kind);
}

/** The map's camera now (map debug). */
const camera = (page: Page) =>
  page.evaluate(() => {
    const m = (window as Win).__sfhMap!.map!;
    const c = m.getCenter();
    return {
      center: [c.lng, c.lat] as [number, number],
      zoom: m.getZoom(),
      pitch: m.getPitch(),
      bearing: m.getBearing()
    };
  });

/** Rendered features of the existing buildings' layer in the map's view (map debug). */
const buildingsDrawn = (page: Page) =>
  page.evaluate(
    () =>
      (window as Win).__sfhMap?.map?.queryRenderedFeatures({ layers: ['existing-buildings'] })
        .length ?? 0
  );

/**
 * The opening as a new visitor, painted to a room goal of 1; Start pressed later. Returns Start
 * and the opening's own camera as it loaded (before the stroke: `paintOnce` moves to a flat frame
 * over the fixture's lots so its stroke lands on them).
 */
async function paintedOpening(
  page: Page,
  isMobile: boolean
): Promise<{ start: Locator; opening: Awaited<ReturnType<typeof camera>> }> {
  await seedGoalAmount(page, 1);
  await gotoEditor(page);
  const opening = await camera(page);
  await paintOnce(page, isMobile);
  const start = page.getByTestId('opening-start');
  await expect(start).toBeVisible();
  await waitSaved(page, (s) => s.state.firstWinAt !== null);
  return { start, opening };
}

/**
 * Round 1 as the first half of each journey leaves it: current law's month (FIXTURE_LAW_MONTH) to
 * beat, its policies offered off, on the simulation with the forecast filled. Each journey is cut
 * here: whole, it plays about 8 s of months at 3x on top of the page's own work and ran 24 to 29 s
 * of its 30 s budget under a loaded machine. The keyboard journey, one key and one focus check at
 * a time, is cut again at round 2 (a seeded game with the rail rule editable).
 */
async function roundOne(page: Page): Promise<void> {
  await seedRuns(page, { phase: 'runs', round: 1, target: FIXTURE_LAW_MONTH }, FIXTURE_AMOUNT);
  await gotoHydrated(page, '/');
  await waitSim(page);
  await frameMap(page);
  await waitFilled(page);
  await waitResult(page, 'pending');
}

// The pointer and keyboard journeys are branch A's: a round-1 policy switched on wins. Should the
// probe ever set FIXTURE_ROUTE to 'edit', they would test nothing true; fail loudly instead.
if (FIXTURE_ROUTE !== 'switch')
  throw new Error(
    "FIXTURE_ROUTE is 'edit': write the branch B journeys (Task 11 brief, t11-s2) before running these"
  );

test.describe('by pointer', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a new visitor paints, starts, wins current law and takes the gift: round 1', async ({
    page,
    isMobile
  }) => {
    // 1. The opening: it loads pitched (its own camera, the test tilts nothing). A stroke meets a
    // room goal of 1 (the fixture's lots hold about 70 homes of room, short of FIXTURE_AMOUNT);
    // the stroke needs a flat frame over the lots, so the opening's camera is put back after it.
    // The simulation then reads the goal at FIXTURE_AMOUNT when it mounts.
    const { start, opening } = await paintedOpening(page, isMobile);
    expect(opening.pitch).toBeGreaterThan(0);
    await jumpAndIdle(page, opening);
    await setGoalAmount(page, FIXTURE_AMOUNT);
    await start.click();
    await waitSim(page);
    expect(new URL(page.url()).pathname).toBe('/');

    // 2. The simulation keeps the opening's pitch, with buildings drawn.
    await expect.poll(async () => (await camera(page)).pitch, FAST).toBeCloseTo(opening.pitch, 1);
    await expect.poll(() => buildingsDrawn(page)).toBeGreaterThan(0);

    // 3. Current law: pending until played, then the win at its goal month, with the gift.
    await waitFilled(page);
    await waitResult(page, 'pending');
    await expect(page.getByTestId('goal-line2')).toHaveText('Play to see current law');
    expect(await playToResult(page)).toBe('win');
    await expect(page.getByTestId('goal-line1')).toHaveText(/by Sep 2039$/);
    await expect(page.getByTestId('goal-line2')).toHaveText('Current law');
    await expect(page.getByTestId('goal-gift')).toHaveAccessibleName(
      'Open the gift: 3 new policies'
    );

    // 4. The gift: three explainers; round 1 with current law's month to beat; three New rows,
    // off.
    expect(await takeGift(page, 'pointer')).toEqual(ROUND_1);
    const one = await waitSaved(page, (s) => s.state.round === 1);
    expect(one.state.target).toBe(FIXTURE_LAW_MONTH);
    expect(one.state.editable).toEqual([]);
    await waitResult(page, 'pending');
    for (const [kind, label] of [
      ['Zoning', ROUND_1[0]],
      ['Permitting', ROUND_1[1]],
      ['Public money', ROUND_1[2]]
    ] as const)
      await expectNewOff(page, kind, label);
  });

  test('in round 1 the rail rule switched on wins; in round 2 its edit holds', async ({ page }) => {
    await roundOne(page);

    // 5. Playing, the rail rule switched on: playback stops, the playhead goes to the later of
    // today and the rule's first month, and the state is pending.
    await page.getByTestId('tl-play').click();
    await expect.poll(() => fzp(page, 'playing'), FAST).toBe(true);
    await openKind(page, 'Zoning');
    const railSwitch = policyRow(page, RAIL).getByRole('switch');
    await railSwitch.click();
    await expect(railSwitch).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => fzp(page, 'playing'), FAST).toBe(false);
    const reset = Math.max(await fzp(page, 'asOf'), await railFrom(page));
    await expect.poll(() => playheadDay(page), FAST).toBe(reset);
    await waitResult(page, 'pending');
    await closeKindSheet(page, 'Zoning');

    // 6. Played to the win: Aug 2038, 1 yr 1 mo before Sep 2039; the gift offers round 2.
    await waitFilled(page);
    expect(await playToResult(page)).toBe('win');
    await expect(page.getByTestId('goal-line1')).toHaveText(/by Aug 2038$/);
    await expect(page.getByTestId('goal-line2')).toHaveText('1 yr 1 mo early');
    expect(await takeGift(page, 'pointer')).toEqual(ROUND_2);
    const two = await waitSaved(page, (s) => s.state.round === 2);
    expect(two.state.editable).toEqual([RAIL]);
    expect(two.state.target).toBe(FIXTURE_RAIL_MONTH);

    // 7. The rail row reads Edit; band 2 set to 1,200 m holds.
    await openKind(page, 'Zoning');
    const edit = policyRow(page, RAIL).getByTestId('tl-policy-edit');
    await expect(edit).toHaveAccessibleName('Edit Taller near BART and Caltrain');
    await expect(policyRow(page, RAIL).getByTestId('tl-policy-new')).toHaveCount(0);
    await edit.click();
    const band2 = page.getByTestId('inspector').getByLabel('Within metres, band 2');
    await band2.fill('1200');
    await band2.press('Enter');
    await expect(band2).toHaveValue('1200');
    await expect
      .poll(() => railBands(page), FAST)
      .toEqual([
        { maxM: 402, stories: 7 },
        { maxM: 1200, stories: 6 }
      ]);

    // 8. The account has the one game, in round 2.
    await expect
      .poll(() => accountSaves(page), FAST)
      .toEqual({ status: 200, saves: [{ phase: 'runs', round: 2 }] });
  });
});

test.describe('by keyboard only', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => isMobile, 'the keyboard journey runs on the desktop project');

  test('the opening stamped by Enter, Start, and current law won by the ruler: round 1', async ({
    page
  }) => {
    // 1. Tab to the map, Enter stamps, Enter on Start. (No click, tap, mouse or touchscreen.)
    await seedGoalAmount(page, 1);
    await gotoEditor(page);
    await jumpAndIdle(page, FRAME);
    await focusBody(page);
    await tabTo(page, page.locator('.maplibregl-canvas'));
    await page.keyboard.press('Enter');
    await expect.poll(() => ops(page), FAST).toBe(1);
    const start = page.getByTestId('opening-start');
    await expect(start).toBeFocused();
    await waitSaved(page, (s) => s.state.firstWinAt !== null);
    await setGoalAmount(page, FIXTURE_AMOUNT);
    await page.keyboard.press('Enter');
    await waitSim(page);
    await waitFilled(page);

    // 2. The ruler's End: current law's win; the gift by keys, then focus on the goal.
    await tabTo(page, slider(page));
    await page.keyboard.press('End');
    await waitResult(page, 'win');
    expect(await takeGift(page, 'keys')).toEqual(ROUND_1);
    await expect(page.getByTestId('goal-headline-button')).toBeFocused();
    const one = await waitSaved(page, (s) => s.state.round === 1);
    expect(one.state.target).toBe(FIXTURE_LAW_MONTH);
  });

  test("round 1's New pane by Enter, the rail rule on by Space, the win by Space at 3x", async ({
    page
  }) => {
    await roundOne(page);
    await focusBody(page);

    // 3. The kind by Enter; the rail rule's New pane by Enter (focus stays on New, the pane has
    // no focus of its own); Close by Tab and Enter.
    const zoning = page
      .getByTestId('tl-timeline')
      .getByRole('button', { name: 'Zoning', exact: true })
      .first();
    await tabTo(page, zoning);
    await page.keyboard.press('Enter');
    await expect(zoning).toHaveAttribute('aria-expanded', 'true');
    const row = policyRow(page, RAIL);
    const newButton = row.getByTestId('tl-policy-new');
    await tabTo(page, newButton);
    await page.keyboard.press('Enter');
    const details = page.getByTestId('policy-details');
    await expect(details).toBeVisible();
    await expect(newButton).toBeFocused();
    const toDetailsClose = await tabCount(
      page,
      details.getByRole('button', { name: 'Close details' })
    );
    test.info().annotations.push({
      type: 'tabs',
      description: `New to the details pane's Close: ${toDetailsClose} Tab presses`
    });
    await page.keyboard.press('Enter');
    await expect(details).toHaveCount(0);

    // 4. The rule switched on by Space: the playhead resets and the state is pending.
    const railSwitch = row.getByRole('switch');
    await tabBackTo(page, railSwitch);
    await page.keyboard.press('Space');
    await expect(railSwitch).toHaveAttribute('aria-checked', 'true');
    const reset = Math.max(await fzp(page, 'asOf'), await railFrom(page));
    await expect.poll(() => playheadDay(page), FAST).toBe(reset);
    await waitResult(page, 'pending');

    // 5. 3x by Enter on the speed; Space plays (the page's shortcut) to the win; the gift by keys.
    await waitFilled(page);
    const speed = page.getByTestId('tl-speed');
    await tabBackTo(page, speed);
    await page.keyboard.press('Enter');
    await expect(speed).toHaveText('3×');
    await tabTo(page, slider(page));
    await page.keyboard.press('Space');
    await expect.poll(() => fzp(page, 'playing'), FAST).toBe(true);
    // No timeout of its own: playback takes as long as the months it plays (3 years a second).
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="goal-headline"]')?.getAttribute('data-state') !==
        'pending'
    );
    await waitResult(page, 'win');
    // Space again pauses (playback would run on to the window's end).
    await page.keyboard.press('Space');
    await expect.poll(() => fzp(page, 'playing'), FAST).toBe(false);
    await expect(page.getByTestId('goal-line2')).toHaveText('1 yr 1 mo early');
    expect(await takeGift(page, 'keys')).toEqual(ROUND_2);
    const two = await waitSaved(page, (s) => s.state.round === 2);
    expect(two.state.editable).toEqual([RAIL]);
    expect(two.state.target).toBe(FIXTURE_RAIL_MONTH);
  });

  test("round 2's rail rule edited: Edit by Enter, 1,200 m typed into band 2", async ({ page }) => {
    await seedRuns(
      page,
      { phase: 'runs', round: 2, target: FIXTURE_RAIL_MONTH, editable: [RAIL] },
      FIXTURE_AMOUNT
    );
    await gotoHydrated(page, '/');
    await waitSim(page);
    await frameMap(page);
    await waitFilled(page);
    await focusBody(page);
    const zoning = page
      .getByTestId('tl-timeline')
      .getByRole('button', { name: 'Zoning', exact: true })
      .first();
    await tabTo(page, zoning);
    await page.keyboard.press('Enter');
    await expect(zoning).toHaveAttribute('aria-expanded', 'true');
    const row = policyRow(page, RAIL);

    // 6. Edit by Enter (focus stays on Edit); Tab to the editor's Close, then on to band 2's
    // distance; 1,200 m typed and entered.
    const edit = row.getByTestId('tl-policy-edit');
    await tabTo(page, edit);
    await page.keyboard.press('Enter');
    const editor = page.getByTestId('inspector');
    await expect(editor).toBeVisible();
    await expect(edit).toBeFocused();
    const close = editor.getByRole('button', { name: 'Close editor' });
    const toEditorClose = await tabCount(page, close);
    const band2 = editor.getByLabel('Within metres, band 2');
    const toBand2 = await tabCount(page, band2);
    test.info().annotations.push({
      type: 'tabs',
      description: `Edit to the editor's Close: ${toEditorClose} Tab presses; then to band 2's distance: ${toBand2}`
    });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('1200');
    await page.keyboard.press('Enter');
    await expect(band2).toHaveValue('1200');
    await expect
      .poll(() => railBands(page), FAST)
      .toEqual([
        { maxM: 402, stories: 7 },
        { maxM: 1200, stories: 6 }
      ]);
  });
});

test('a round played past its target is late, with no gift, and nothing is saved', async ({
  page
}) => {
  // Round 1 with Jan 2035 to beat: current law reaches the goal in Sep 2039.
  await seedRuns(page, { phase: 'runs', round: 1, target: monthDay(2035, 1) }, FIXTURE_AMOUNT);
  await gotoHydrated(page, '/');
  await waitSim(page);
  await frameMap(page);
  await waitFilled(page);
  const before = await waitSaved(page, (s) => s.state.round === 1);

  expect(await playToResult(page)).toBe('late');
  await expect(page.getByTestId('goal-line2')).toHaveText(/late$/);
  await expect(page.getByTestId('goal-line2')).toHaveText('4 yr 8 mo late');
  await expect(page.getByTestId('goal-gift')).toHaveCount(0);
  // Compared once the page has settled: playback paused, and the autosave back at "saved" (a
  // debounced write reads "saving" until it lands), so a wrongly scheduled save has had its chance.
  await expect.poll(() => fzp(page, 'playing'), FAST).toBe(false);
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-status', 'saved');
  expect((await savedGame(page)).state).toEqual(before.state);
});

test('the last round won is the ending: Every policy, and the zoning "+" offers a rule', async ({
  page
}) => {
  // Round 4 with Jan 2045 to beat: current law reaches the goal in Sep 2039.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedRuns(page, { phase: 'runs', round: 4, target: monthDay(2045, 1) }, FIXTURE_AMOUNT);
  await gotoHydrated(page, '/');
  await waitSim(page);
  await frameMap(page);
  await waitFilled(page);

  expect(await playToResult(page)).toBe('win');
  await expect(page.getByTestId('goal-gift')).toHaveAccessibleName('Open the gift: every policy');
  expect(await takeGift(page, 'pointer')).toEqual(['Every policy']);
  const done = await waitSaved(page, (s) => s.state.finished);
  expect(done.state.round).toBe(4);
  expect(done.state.target).toBe(FIXTURE_LAW_MONTH);

  await page
    .getByTestId('tl-timeline')
    .getByRole('button', { name: PLUS_NAME.Zoning })
    .last()
    .click();
  const menu = page.getByRole('group', { name: 'Add to Zoning' });
  await expect(menu.getByRole('button', { name: 'Transit rule', exact: true })).toBeVisible();
});

test('a saved version 2 game opens in round 2 with its plan and its own rule running', async ({
  page
}) => {
  const at = new Date().toISOString();
  // The rule the points build gave the game, at a reach above today's 1,200 m maximum.
  const rule = {
    id: 'game-transit',
    label: 'Transit rule',
    preset: null,
    on: true,
    where: { tag: 'transit', stopTypes: ['regionalRail'] },
    spans: [
      {
        from: monthDay(2026, 11),
        to: null,
        what: { tag: 'bands', bands: [{ maxM: 3219, stories: 12 }] }
      }
    ]
  };
  const policy = JSON.stringify({
    schema: 4,
    kind: 'sim',
    datasetVersion: 'fixture-0',
    policy: { schema: 4, kinds: { zoning: [rule], permitting: [], money: [] } }
  });
  await seedGoalAmount(page, FIXTURE_AMOUNT);
  await seedV2Game(
    page,
    {
      v: 2,
      phase: 'runs',
      firstWinAt: at,
      units: { home: 40 },
      bought: { 'stop-rail': 1, 'sb423-clock': 1 },
      rung: 1,
      met: [
        { rung: 0, reachedOn: FIXTURE_LAW_MONTH, datasetVersion: 'fixture-0', at },
        { rung: 1, reachedOn: monthDay(2045, 6), datasetVersion: 'fixture-0', at }
      ],
      side: {},
      runs: 2,
      last: null
    },
    policy,
    smallText
  );
  await gotoHydrated(page, '/');
  await waitSim(page);
  // A loaded game opens on the simulation pitched, with buildings drawn (before the test frames
  // the map flat over the fixture's lots).
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready');
  await expect.poll(async () => (await camera(page)).pitch, FAST).toBeGreaterThan(0);
  await expect.poll(() => buildingsDrawn(page)).toBeGreaterThan(0);
  await frameMap(page);
  await waitFilled(page);

  // Round 2: the label, in the bar from sm, in the open Menu beside the name below it.
  await openHeaderMenu(page);
  await expect(
    page.locator('[data-testid="round-label"]:visible, [data-testid="round-label-menu"]:visible')
  ).toHaveText('Round 2');
  await page.keyboard.press('Escape');

  // Its plan is kept.
  const planRecord = await page.evaluate(() => localStorage.getItem('sfhousing:plan:v1'));
  expect(JSON.parse(planRecord!).plan).toBe(smallText);

  // Its rule is in the document as stored, and the map's height limits draw it: the worker's
  // limits name it, and contours on its side read its 12 stories.
  const kept = await page.evaluate(() =>
    (window as FzpWin).__sfhFzp!.policy.kinds.zoning.find((p) => p.id === 'game-transit')
  );
  expect(kept?.on).toBe(true);
  expect(kept?.spans[0].what).toEqual({ tag: 'bands', bands: [{ maxM: 3219, stories: 12 }] });
  await expect
    .poll(
      () =>
        page.evaluate((rule0) => {
          const c = (window as FzpWin).__sfhFzp!.heights;
          if (!c) return null;
          const code = rule0 + c.sourceIds.indexOf('game-transit');
          const stories = new Set<number>();
          for (let i = 0; i < c.chains.hi.length; i++) {
            if (c.chains.srcA[i] === code) stories.add(c.chains.hi[i]);
          }
          return { ids: c.sourceIds, stories: [...stories] };
        }, SRC_RULE0),
      FAST
    )
    .toEqual({ ids: ['game-transit'], stories: [12] });

  // Its editor shows the stored reach.
  await openKind(page, 'Zoning');
  await policyRow(page, 'game-transit').getByTestId('tl-policy-edit').click();
  await expect(page.getByTestId('inspector').getByLabel('Within metres, band 1')).toHaveValue(
    '3219'
  );
  await expect(goal(page)).toBeVisible();
});
