/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import axe from 'axe-core';
import '../../routes/layout.css';
import { page as appPage } from '$app/state';
import { newId } from '$lib/ids/base58';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { FULL_TEXT, STORAGE_TEXT, aimText, nextText, syncText } from './copy';
import type { Level } from './levels';
import { gamePath, loadPage } from './navigate';
import type { Progress } from './progress';
import { MAX_SAVES, SAVES_KEY, saveKey, type GameSave } from './saves';
import type { SyncState } from './save-sync.svelte';
import { GameStore, openGame } from './store.svelte';
import { FakeSync } from './test/fake-sync.svelte';
import StoreHost from './test/StoreHost.svelte';

vi.mock('./navigate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./navigate')>()),
  loadPage: vi.fn()
}));

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

afterEach(async () => {
  await scheme('light');
  // The stub's url is a plain URL; the real `page.url` type narrows the pathname to routes.
  appPage.url = new URL('http://localhost/') as never;
  vi.mocked(loadPage).mockClear();
});

const AT = '2026-01-10T12:00:00.000Z';

function progressAt(level: Level, complete = false): Progress {
  const banked: Progress['banked'] = {};
  for (let n = 2; n < level; n++) {
    banked[n as 2 | 3 | 4] = { on: 30000 + n * 400, datasetVersion: 'fixture-0', at: AT };
  }
  if (complete) banked[5] = { on: 32000, datasetVersion: 'fixture-0', at: AT };
  return { v: 1, level, banked, firstWinAt: level > 1 ? AT : null };
}

/** A local-calendar time `daysAgo` days before today, at noon. */
function daysAgo(days: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12).toISOString();
}

interface Seed {
  name: string;
  level: Level;
  /** Days before today. */
  ago: number;
  complete?: boolean;
}

/** Writes `seeds` as saved games and an index (the G2 layout); the first is current. */
function seed(storage: MemoryStorage, seeds: readonly Seed[]): GameSave[] {
  const games = seeds.map((s): GameSave => ({
    v: 1,
    id: newId(),
    name: s.name,
    nameIsDefault: false,
    progress: progressAt(s.level, s.complete),
    plan: null,
    policy: null,
    savedAt: daysAgo(s.ago)
  }));
  for (const g of games) storage.setItem(saveKey(g.id), JSON.stringify(g));
  const saves = games.map((g) => ({
    id: g.id,
    name: g.name,
    nameIsDefault: g.nameIsDefault,
    savedAt: g.savedAt,
    level: g.progress.level
  }));
  storage.setItem(SAVES_KEY, JSON.stringify({ v: 1, current: games[0].id, saves }));
  return games;
}

const THREE: readonly Seed[] = [
  { name: 'Mission', level: 3, ago: 0 },
  { name: 'Sunset', level: 2, ago: 1 },
  { name: 'Richmond', level: 4, ago: 3 }
];

function makeStore(seeds: readonly Seed[] = THREE) {
  const storage = new MemoryStorage();
  const games = seed(storage, seeds);
  const sync = new FakeSync();
  const store = new GameStore({ storage, sync });
  return { storage, games, sync, store };
}

async function mount(seeds: readonly Seed[] = THREE) {
  const made = makeStore(seeds);
  const onescape = vi.fn();
  await render(StoreHost, { props: { store: made.store, show: 'panel', onescape } });
  await expect.element(panel()).toBeVisible();
  return { ...made, onescape };
}

const panel = () => page.getByTestId('level-panel');
const heading = () => page.getByRole('heading', { level: 2 });
const levelUpButton = () => page.getByRole('button', { name: 'Level up' });
const newGameButton = () => page.getByRole('button', { name: 'New game' });
const rows = () => page.getByTestId('save-row');
const rowOf = (name: string) => rows().filter({ hasText: name });
const field = () => page.getByRole('textbox', { name: 'Name' });

describe('LevelPanel', () => {
  it('the top at each level', async () => {
    const cases: { level: Level; complete?: boolean; aim?: string; next: string }[] = [
      { level: 1, aim: 'Paint room for the goal', next: 'Next: The simulation' },
      { level: 2, aim: 'Play to the goal', next: 'Next: Permitting' },
      { level: 3, next: 'Next: Zoning' },
      { level: 5, next: 'Next: The end of the round' },
      {
        level: 5,
        complete: true,
        aim: 'Round complete',
        next: 'Coming next: designing funding, market rules and affordability targets'
      }
    ];
    for (const c of cases) {
      const { store } = makeStore([
        { name: 'Mission', level: c.level, ago: 0, complete: c.complete }
      ]);
      const { unmount } = await render(StoreHost, { props: { store, show: 'panel' } });
      await expect.element(heading()).toHaveTextContent(`Level ${c.level}`);
      const p = progressAt(c.level, c.complete);
      await expect.element(page.getByTestId('level-aim')).toHaveTextContent(c.aim ?? aimText(p));
      expect(aimText(p)).toMatch(c.level >= 3 && !c.complete ? /^Beat / : /./);
      await expect.element(page.getByTestId('level-next')).toHaveTextContent(c.next);
      expect(nextText(p)).toBe(c.next);
      unmount();
    }
  });

  it('Level up shows only with an offer, never after the round', async () => {
    const { store } = await mount();
    await expect.element(levelUpButton()).not.toBeInTheDocument();
    store.setOffer({ on: 31000, datasetVersion: 'fixture-0' });
    await expect.element(levelUpButton()).toBeVisible();
    store.setOffer(null);
    await expect.element(levelUpButton()).not.toBeInTheDocument();
  });

  it('Level up never shows once the round is complete', async () => {
    const { store } = await mount([{ name: 'Done', level: 5, ago: 0, complete: true }]);
    store.setOffer({ on: 31000, datasetVersion: 'fixture-0' });
    await tick();
    await expect.element(heading()).toHaveTextContent('Level 5');
    await expect.element(levelUpButton()).not.toBeInTheDocument();
  });

  it('pressing Level up raises the level and focuses the heading', async () => {
    const { store } = await mount();
    store.setOffer({ on: 31000, datasetVersion: 'fixture-0' });
    await levelUpButton().click();
    await expect.element(heading()).toHaveTextContent('Level 4');
    await expect.element(levelUpButton()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(heading().element());
  });

  it("each sync state's words", async () => {
    appPage.url = new URL('http://localhost/sim?x=1') as never;
    const { sync } = await mount();
    const states: SyncState[] = ['local', 'saving', 'offline', 'sign-in', 'full'];
    for (const state of states) {
      sync.state = state;
      await expect.element(page.getByTestId('level-sync')).toHaveTextContent(syncText(state)!);
    }
    sync.state = 'sign-in';
    const link = page.getByRole('link', { name: 'Sign in to save' });
    await expect.element(link).toHaveAttribute('href', '/signin?returnTo=%2Fsim%3Fx%3D1');
    sync.state = 'local';
    await expect.element(link).not.toBeInTheDocument();
    sync.state = 'saved';
    await expect.element(page.getByTestId('level-sync')).not.toBeInTheDocument();
  });

  it('rows in store order, the current one marked', async () => {
    const { store, games } = await mount();
    const els = rows().elements();
    expect(els.map((e) => e.textContent)).toHaveLength(store.saves.length);
    store.saves.forEach((entry, i) => expect(els[i].textContent).toContain(entry.name));
    const current = rowOf('Mission');
    await expect.element(current).toHaveAttribute('aria-current', 'true');
    await expect.element(current).toHaveTextContent('Level 3 · Playing');
    await expect.element(rowOf('Sunset')).not.toHaveAttribute('aria-current');
    await expect.element(rowOf('Sunset')).toHaveTextContent('Level 2 · Yesterday');
    expect(store.currentId).toBe(games[0].id);
  });

  it('pressing another name switches and loads its page', async () => {
    const { store, games } = await mount();
    await page.getByRole('button', { name: 'Sunset', exact: true }).click();
    expect(store.currentId).toBe(games[1].id);
    expect(loadPage).toHaveBeenCalledWith(gamePath(2));
  });

  it('rename by Enter', async () => {
    const { store, games } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await expect.element(field()).toHaveFocus();
    // The name is selected, so typing replaces it.
    await userEvent.keyboard('Outer{Enter}');
    await expect.element(field()).not.toBeInTheDocument();
    expect(store.saves.find((e) => e.id === games[1].id)?.name).toBe('Outer');
    await expect.element(page.getByRole('button', { name: 'Rename Outer' })).toHaveFocus();
  });

  it('rename by blur', async () => {
    const { store, games } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await expect.element(field()).toHaveFocus();
    await field().fill('Outer');
    newGameButton().element().focus();
    await expect.element(field()).not.toBeInTheDocument();
    expect(store.saves.find((e) => e.id === games[1].id)?.name).toBe('Outer');
    await expect.element(page.getByRole('button', { name: 'Rename Outer' })).toHaveFocus();
  });

  it('Escape cancels rename', async () => {
    const { store, games, onescape } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    const input = field();
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveAttribute('maxlength', '60');
    await expect.element(input).toHaveValue('Sunset');
    const el = input.element() as HTMLInputElement;
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 'Sunset'.length]);
    await userEvent.keyboard('X{Escape}');
    await expect.element(field()).not.toBeInTheDocument();
    expect(store.saves.find((e) => e.id === games[1].id)?.name).toBe('Sunset');
    await expect.element(page.getByRole('button', { name: 'Rename Sunset' })).toHaveFocus();
    expect(onescape).not.toHaveBeenCalled();
  });

  it('delete asks once', async () => {
    const { store, games, onescape } = await mount();
    const cancel = () => page.getByRole('button', { name: 'Cancel' });
    const askDelete = () => page.getByRole('button', { name: 'Delete Sunset' });

    await askDelete().click();
    await expect.element(page.getByText('Delete Sunset?')).toBeVisible();
    await expect.element(cancel()).toHaveFocus();
    await cancel().click();
    await expect.element(page.getByText('Delete Sunset?')).not.toBeInTheDocument();
    await expect.element(askDelete()).toHaveFocus();

    await askDelete().click();
    await expect.element(cancel()).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText('Delete Sunset?')).not.toBeInTheDocument();
    await expect.element(askDelete()).toHaveFocus();
    expect(onescape).not.toHaveBeenCalled();

    await askDelete().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.element(rowOf('Sunset')).not.toBeInTheDocument();
    expect(store.saves.map((e) => e.id)).not.toContain(games[1].id);
    await expect.element(newGameButton()).toHaveFocus();
    expect(loadPage).not.toHaveBeenCalled();

    await page.getByRole('button', { name: 'Delete Mission' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    expect(store.currentId).toBe(games[2].id);
    expect(loadPage).toHaveBeenCalledWith(gamePath(4));
  });

  it("opening rename on one row closes another row's delete question", async () => {
    const { store } = await mount();
    await page.getByRole('button', { name: 'Delete Sunset' }).click();
    await expect.element(page.getByText('Delete Sunset?')).toBeVisible();
    await page.getByRole('button', { name: 'Rename Richmond' }).click();
    await expect.element(page.getByText('Delete Sunset?')).not.toBeInTheDocument();
    await expect.element(field()).toHaveValue('Richmond');
    expect(store.saves).toHaveLength(3);
  });

  it("opening delete on one row closes another row's rename without renaming", async () => {
    const { store } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await field().fill('Outer');
    await page.getByRole('button', { name: 'Delete Richmond' }).click();
    await expect.element(field()).not.toBeInTheDocument();
    await expect.element(page.getByText('Delete Richmond?')).toBeVisible();
    expect(store.saves.map((e) => e.name)).toContain('Sunset');
  });

  it('New game loads Paint', async () => {
    const { store } = await mount();
    await newGameButton().click();
    expect(store.saves).toHaveLength(4);
    expect(loadPage).toHaveBeenCalledWith('/');
  });

  it('with a field open, New game renames and loads Paint', async () => {
    const { store, games } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await field().fill('Outer');
    await newGameButton().click();
    expect(store.saves.find((e) => e.id === games[1].id)?.name).toBe('Outer');
    expect(store.saves).toHaveLength(4);
    expect(loadPage).toHaveBeenCalledWith('/');
  });

  it("with a field open, a lower row's name renames and switches", async () => {
    const { store, games } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await field().fill('Outer');
    await page.getByRole('button', { name: 'Richmond', exact: true }).click();
    expect(store.saves.find((e) => e.id === games[1].id)?.name).toBe('Outer');
    expect(store.currentId).toBe(games[2].id);
    expect(loadPage).toHaveBeenCalledWith(gamePath(4));
  });

  it('Cancel after a refused delete clears the alert', async () => {
    const { storage } = await mount();
    const error = page.getByTestId('level-error');
    storage.failWrites = true;
    await page.getByRole('button', { name: 'Delete Sunset' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.element(error).toHaveTextContent(STORAGE_TEXT);
    await expect.element(rowOf('Sunset')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(error).toHaveTextContent(/^$/);
  });

  it('at 12 games New game is aria-disabled and does nothing', async () => {
    const seeds = Array.from({ length: MAX_SAVES }, (_, i) => ({
      name: `Game ${i + 1}`,
      level: 2 as Level,
      ago: i
    }));
    const { store } = await mount(seeds);
    await expect.element(newGameButton()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(page.getByText(FULL_TEXT)).toBeVisible();
    // Playwright waits for an aria-disabled control to be enabled; force the press.
    await newGameButton().click({ force: true });
    expect(store.saves).toHaveLength(MAX_SAVES);
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('Escape outside a field or question bubbles', async () => {
    const { onescape } = await mount();
    newGameButton().element().focus();
    await userEvent.keyboard('{Escape}');
    expect(onescape).toHaveBeenCalledTimes(1);
  });

  it('renders nothing under the open game', async () => {
    await render(StoreHost, { props: { store: openGame(), show: 'panel' } });
    await tick();
    await expect.element(panel()).not.toBeInTheDocument();
  });

  it('a refused switch shows the storage line', async () => {
    const { store, storage, games } = await mount();
    const error = page.getByTestId('level-error');
    await expect.element(error).toHaveTextContent(/^$/);
    storage.failWrites = true;
    await page.getByRole('button', { name: 'Sunset', exact: true }).click();
    await expect.element(error).toHaveTextContent(STORAGE_TEXT);
    expect(store.currentId).toBe(games[0].id);
    expect(store.saves.map((e) => e.name)).toEqual(['Mission', 'Sunset', 'Richmond']);
    expect(loadPage).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await expect.element(error).toHaveTextContent(/^$/);
  });

  it('every control is at least 24 px', async () => {
    await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    for (const el of panel().element().querySelectorAll('button, a, input')) {
      const r = el.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
  });

  it('axe finds no violation in light and dark', async () => {
    const { sync } = await mount();
    sync.state = 'sign-in';
    await expect.element(page.getByTestId('level-sync')).toBeVisible();
    const check = async () => {
      for (const s of ['light', 'dark'] as const) {
        await scheme(s);
        const res = await axe.run(panel().element(), { runOnly: TAGS });
        expect(res.violations.map((v) => v.id)).toEqual([]);
      }
    };
    await check();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await expect.element(field()).toBeVisible();
    await check();
    await userEvent.keyboard('{Escape}');
    await page.getByRole('button', { name: 'Delete Richmond' }).click();
    await expect.element(page.getByText('Delete Richmond?')).toBeVisible();
    await check();
  });
});
