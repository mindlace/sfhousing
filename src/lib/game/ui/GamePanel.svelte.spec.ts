/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { page as appPage } from '$app/state';
import { RUNGS } from '../ladder';
import { MAX_SAVES } from '../saves';
import type { SyncState } from '../save-sync.svelte';
import { GameStore, openGame } from '../store.svelte';
import { FakeSync } from '../test/fake-sync.svelte';
import { FULL_TEXT, STORAGE_TEXT, syncText } from '../words';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { FakeGame, entry, type FakeGameInit } from './test/fake-game.svelte';
import PanelHost from './test/PanelHost.svelte';
import { reloadGame } from './reload';

vi.mock('./reload', () => ({ reloadGame: vi.fn() }));

beforeEach(() => localStorage.clear());

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
  // Stands in for SURFACE_POP (src/lib/shell/ui.ts:55), the pop-over surface the panel sits on in
  // the app; a checked switch's translucent tint needs that surface under it for axe to read the
  // real colour.
  const sfx = value === 'dark' ? '-dark' : '';
  document.body.style.background = `var(--color-surface${sfx})`;
  document.body.style.color = `var(--color-ink${sfx})`;
}

afterEach(async () => {
  await scheme('light');
  document.body.style.background = '';
  document.body.style.color = '';
  // The stub's url is a plain URL; the real `page.url` type narrows the pathname to routes.
  appPage.url = new URL('http://localhost/') as never;
  vi.mocked(reloadGame).mockClear();
});

/** A local-calendar time `daysAgo` days before today, at noon. */
function daysAgo(days: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12).toISOString();
}

const panel = () => page.getByTestId('game-panel');
const rows = () => page.getByTestId('save-row');
const rowOf = (name: string) => rows().filter({ hasText: name });
const field = () => page.getByRole('textbox', { name: 'Name' });
const newGameButton = () => page.getByRole('button', { name: 'New game' });
const errorLine = () => page.getByTestId('game-error');

// Mission is current, in its opening; Sunset and Richmond are in their runs.
const THREE = () => [
  entry('Mission', { savedAt: daysAgo(0) }),
  entry('Sunset', { phase: 'runs', rung: 0, savedAt: daysAgo(1) }),
  entry('Richmond', { phase: 'runs', rung: RUNGS - 1, savedAt: daysAgo(3) })
];

async function mount(init: FakeGameInit = { saves: THREE() }) {
  const game = new FakeGame(init);
  const onescape = vi.fn();
  const view = await render(PanelHost, { props: { game: game.asStore(), onescape } });
  await expect.element(panel()).toBeVisible();
  return { game, onescape, unmount: view.unmount };
}

describe('GamePanel', () => {
  it('the heading is the current game and the stage line reads its goal', async () => {
    const { unmount } = await mount({
      saves: THREE(),
      currentId: 'id-Richmond',
      state: { phase: 'runs', rung: RUNGS - 1, units: { home: 1240 } }
    });
    await expect.element(page.getByRole('heading', { level: 2 })).toHaveTextContent('Richmond');
    await expect
      .element(page.getByTestId('game-stage'))
      .toHaveTextContent(`Goal ${RUNGS} of ${RUNGS}`);
    unmount();
    await mount({ saves: THREE() });
    await expect.element(page.getByTestId('game-stage')).toHaveTextContent('Painting');
  });

  it('a row reads Painting or Goal N of M, then Playing or when it was played', async () => {
    await mount();
    await expect.element(rowOf('Mission')).toHaveAttribute('aria-current', 'true');
    await expect.element(rowOf('Mission')).toHaveTextContent('Painting · Playing');
    await expect.element(rowOf('Sunset')).not.toHaveAttribute('aria-current');
    await expect.element(rowOf('Sunset')).toHaveTextContent(`Goal 1 of ${RUNGS} · Yesterday`);
    await expect.element(rowOf('Richmond')).toHaveTextContent(`Goal ${RUNGS} of ${RUNGS} ·`);
    expect(rows().elements()).toHaveLength(3);
  });

  it("each sync state's words", async () => {
    appPage.url = new URL('http://localhost/?x=1') as never;
    const sync = new FakeSync();
    await mount({ saves: THREE(), sync });
    const states: SyncState[] = ['local', 'saving', 'offline', 'sign-in', 'full'];
    for (const state of states) {
      sync.state = state;
      await expect.element(page.getByTestId('game-sync')).toHaveTextContent(syncText(state)!);
    }
    sync.state = 'sign-in';
    const link = page.getByRole('link', { name: 'Sign in to save' });
    await expect.element(link).toHaveAttribute('href', '/signin?returnTo=%2F%3Fx%3D1');
    sync.state = 'local';
    await expect.element(link).not.toBeInTheDocument();
    sync.state = 'saved';
    await expect.element(page.getByTestId('game-sync')).not.toBeInTheDocument();
  });

  it('pressing another name switches and reloads /', async () => {
    const { game } = await mount();
    await page.getByRole('button', { name: 'Sunset', exact: true }).click();
    expect(game.calls).toContainEqual({ kind: 'switchTo', id: 'id-Sunset' });
    expect(reloadGame).toHaveBeenCalledTimes(1);
  });

  it('New game reloads /', async () => {
    const { game } = await mount();
    await newGameButton().click();
    expect(game.calls).toContainEqual({ kind: 'newGame' });
    expect(reloadGame).toHaveBeenCalledTimes(1);
  });

  it('deleting the game in play reloads /; deleting another does not', async () => {
    const { game, onescape } = await mount();
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
    expect(game.calls).toContainEqual({ kind: 'remove', id: 'id-Sunset' });
    await expect.element(newGameButton()).toHaveFocus();
    expect(reloadGame).not.toHaveBeenCalled();

    await page.getByRole('button', { name: 'Delete Mission' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    expect(game.calls).toContainEqual({ kind: 'remove', id: 'id-Mission' });
    expect(reloadGame).toHaveBeenCalledTimes(1);
  });

  it('refusals show their words and never reload', async () => {
    const { game } = await mount();
    const cases = [
      ['full', FULL_TEXT],
      ['storage', STORAGE_TEXT],
      ['changed', STORAGE_TEXT]
    ] as const;
    for (const [reason, words] of cases) {
      game.refuse = { ok: false, reason };
      await page.getByRole('button', { name: 'Sunset', exact: true }).click();
      await expect.element(errorLine()).toHaveTextContent(words);
      await newGameButton().click();
      await expect.element(errorLine()).toHaveTextContent(words);
      await page.getByRole('button', { name: 'Delete Sunset' }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect.element(errorLine()).toHaveTextContent(words);
      await expect.element(rowOf('Sunset')).toBeVisible();
      expect(reloadGame).not.toHaveBeenCalled();
    }
    // Sunset's own delete question is still open, so the rename that clears the alert is Richmond's.
    await page.getByRole('button', { name: 'Rename Richmond' }).click();
    await expect.element(errorLine()).toHaveTextContent(/^$/);
  });

  it('rename by Enter', async () => {
    const { game } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await expect.element(field()).toHaveFocus();
    // The name is selected, so typing replaces it.
    await userEvent.keyboard('Outer{Enter}');
    await expect.element(field()).not.toBeInTheDocument();
    expect(game.calls).toContainEqual({ kind: 'rename', id: 'id-Sunset', name: 'Outer' });
    expect(game.saves.find((e) => e.id === 'id-Sunset')?.name).toBe('Outer');
    await expect.element(page.getByRole('button', { name: 'Rename Outer' })).toHaveFocus();
  });

  it('rename by blur', async () => {
    const { game } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await expect.element(field()).toHaveFocus();
    await field().fill('Outer');
    newGameButton().element().focus();
    await expect.element(field()).not.toBeInTheDocument();
    expect(game.saves.find((e) => e.id === 'id-Sunset')?.name).toBe('Outer');
    await expect.element(page.getByRole('button', { name: 'Rename Outer' })).toHaveFocus();
  });

  it('Escape cancels rename', async () => {
    const { game, onescape } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    const input = field();
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveAttribute('maxlength', '60');
    await expect.element(input).toHaveValue('Sunset');
    const el = input.element() as HTMLInputElement;
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 'Sunset'.length]);
    await userEvent.keyboard('X{Escape}');
    await expect.element(field()).not.toBeInTheDocument();
    expect(game.saves.find((e) => e.id === 'id-Sunset')?.name).toBe('Sunset');
    expect(game.calls.filter((c) => c.kind === 'rename')).toEqual([]);
    await expect.element(page.getByRole('button', { name: 'Rename Sunset' })).toHaveFocus();
    expect(onescape).not.toHaveBeenCalled();
  });

  it("opening rename on one row closes another row's delete question", async () => {
    const { game } = await mount();
    await page.getByRole('button', { name: 'Delete Sunset' }).click();
    await expect.element(page.getByText('Delete Sunset?')).toBeVisible();
    await page.getByRole('button', { name: 'Rename Richmond' }).click();
    await expect.element(page.getByText('Delete Sunset?')).not.toBeInTheDocument();
    await expect.element(field()).toHaveValue('Richmond');
    expect(game.saves).toHaveLength(3);
  });

  it("opening delete on one row closes another row's rename without renaming", async () => {
    const { game } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await field().fill('Outer');
    await page.getByRole('button', { name: 'Delete Richmond' }).click();
    await expect.element(field()).not.toBeInTheDocument();
    await expect.element(page.getByText('Delete Richmond?')).toBeVisible();
    expect(game.saves.map((e) => e.name)).toContain('Sunset');
  });

  it('with a field open, New game renames and reloads /', async () => {
    const { game } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await field().fill('Outer');
    await newGameButton().click();
    expect(game.calls).toContainEqual({ kind: 'rename', id: 'id-Sunset', name: 'Outer' });
    expect(game.calls).toContainEqual({ kind: 'newGame' });
    expect(reloadGame).toHaveBeenCalledTimes(1);
  });

  it("with a field open, a lower row's name renames and switches", async () => {
    const { game } = await mount();
    await page.getByRole('button', { name: 'Rename Sunset' }).click();
    await field().fill('Outer');
    await page.getByRole('button', { name: 'Richmond', exact: true }).click();
    expect(game.calls).toContainEqual({ kind: 'rename', id: 'id-Sunset', name: 'Outer' });
    expect(game.calls).toContainEqual({ kind: 'switchTo', id: 'id-Richmond' });
    expect(game.currentId).toBe('id-Richmond');
    expect(reloadGame).toHaveBeenCalledTimes(1);
  });

  it('Cancel after a refused delete clears the alert', async () => {
    const { game } = await mount();
    game.refuse = { ok: false, reason: 'storage' };
    await page.getByRole('button', { name: 'Delete Sunset' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.element(errorLine()).toHaveTextContent(STORAGE_TEXT);
    await expect.element(rowOf('Sunset')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(errorLine()).toHaveTextContent(/^$/);
  });

  it('at MAX_SAVES New game is aria-disabled and does nothing', async () => {
    const saves = Array.from({ length: MAX_SAVES }, (_, i) =>
      entry(`Game ${i + 1}`, { savedAt: daysAgo(i) })
    );
    const { game } = await mount({ saves });
    await expect.element(newGameButton()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(page.getByText(FULL_TEXT)).toBeVisible();
    // Playwright waits for an aria-disabled control to be enabled; force the press.
    await newGameButton().click({ force: true });
    expect(game.calls.filter((c) => c.kind === 'newGame')).toEqual([]);
    expect(reloadGame).not.toHaveBeenCalled();
  });

  it('Escape outside a field or question bubbles', async () => {
    const { onescape } = await mount();
    newGameButton().element().focus();
    await userEvent.keyboard('{Escape}');
    expect(onescape).toHaveBeenCalledTimes(1);
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

  it('renders nothing for the open game', async () => {
    await render(PanelHost, { props: { game: openGame() } });
    await tick();
    await expect.element(panel()).not.toBeInTheDocument();
  });

  it('against the real store: New game adds a game and reloads /', async () => {
    const store = new GameStore({ storage: new MemoryStorage(), sync: new FakeSync() });
    await render(PanelHost, { props: { game: store } });
    await expect
      .element(page.getByRole('heading', { level: 2 }))
      .toHaveTextContent(store.saves[0].name);
    await expect.element(page.getByTestId('game-stage')).toHaveTextContent('Painting');
    await newGameButton().click();
    expect(store.saves).toHaveLength(2);
    expect(reloadGame).toHaveBeenCalledTimes(1);
  });

  it('axe finds no violation in light and dark', async () => {
    const sync = new FakeSync();
    await mount({ saves: THREE(), sync });
    sync.state = 'sign-in';
    await expect.element(page.getByTestId('game-sync')).toBeVisible();
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
