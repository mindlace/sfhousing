import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { FULL_TEXT } from '$lib/game/copy';
import { n5, n6, remixNeeds } from './copy';
import SharedBanner, { type RemixState } from './SharedBanner.svelte';

type Notice = 'none' | 'remix' | 'gone';

function setup(
  p: {
    remix?: RemixState;
    error?: string | null;
    gameHref?: string;
    datasetNotice?: Notice;
    title?: string;
  } = {}
) {
  const onremix = vi.fn();
  render(SharedBanner, {
    title: p.title,
    id: 'abc23456',
    createdAt: '2026-10-11T23:30:00.000Z',
    datasetNotice: p.datasetNotice ?? 'none',
    planVersion: '2026-01-01',
    currentVersion: '2026-09-01',
    kind: 'plan',
    remix: p.remix === undefined ? { kind: 'ready', note: null } : p.remix,
    error: p.error ?? null,
    gameHref: p.gameHref ?? '/',
    onremix
  });
  return { onremix };
}

const banner = () => page.getByRole('region', { name: 'Shared plan' });
const remixButton = () => banner().getByRole('button', { name: 'Remix', exact: true });
const lockedButton = () => banner().getByRole('button', { name: 'Unlock the simulation to remix' });
const openCurrent = () => banner().getByRole('button', { name: 'Open with current data' });
/** A press on an aria-disabled button: a plain DOM click, which a disabled attribute would eat. */
const press = (loc: { element: () => Element }) => (loc.element() as HTMLElement).click();
const yourGame = () => banner().getByRole('link', { name: 'Your game' });

describe('SharedBanner', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('shows the title, "Shared plan" and the UTC publish date, with Remix and Your game', async () => {
    setup({ title: 'Mission infill', gameHref: '/sim' });
    await expect.element(banner()).toBeVisible();
    await expect.element(banner().getByText('Mission infill', { exact: true })).toBeVisible();
    await expect.element(banner()).toHaveTextContent(/Shared plan/);
    await expect.element(banner()).toHaveTextContent(/published Oct 11, 2026/);
    await expect.element(remixButton()).toBeVisible();
    await expect.element(yourGame()).toHaveAttribute('href', '/sim');
  });

  it('the banner draws on the surface tokens, with dark partners', async () => {
    setup();
    await expect.element(banner()).toBeVisible();
    const cls = [...banner().element().classList];
    for (const c of ['bg-surface', 'dark:bg-surface-dark', 'text-ink', 'dark:text-ink-dark']) {
      expect(cls, c).toContain(c);
    }
    expect(cls).not.toContain('bg-white');
  });

  it('ready: Remix remixes once, with no dialog', async () => {
    const { onremix } = setup();
    await userEvent.click(remixButton());
    expect(onremix).toHaveBeenCalledTimes(1);
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('ready with a note shows it under the buttons', async () => {
    setup({ remix: { kind: 'ready', note: remixNeeds(4) } });
    await expect.element(banner().getByText(remixNeeds(4))).toBeVisible();
  });

  it('locked: the button reads "Unlock the simulation to remix", aria-disabled, and a press does nothing', async () => {
    const { onremix } = setup({ remix: { kind: 'locked' } });
    await expect.element(lockedButton()).toHaveAttribute('aria-disabled', 'true');
    press(lockedButton());
    expect(onremix).not.toHaveBeenCalled();
    expect(remixButton().elements()).toHaveLength(0);
  });

  it('full: Remix is aria-disabled and the full line shows', async () => {
    const { onremix } = setup({ remix: { kind: 'full' } });
    await expect.element(remixButton()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(banner()).toHaveTextContent(FULL_TEXT);
    press(remixButton());
    expect(onremix).not.toHaveBeenCalled();
  });

  it('null: no Remix and no Open with current data; the notice text stays', async () => {
    setup({ remix: null, datasetNotice: 'gone' });
    await expect.element(banner().getByText(n6('2026-01-01', '2026-09-01'))).toBeVisible();
    expect(remixButton().elements()).toHaveLength(0);
    expect(openCurrent().elements()).toHaveLength(0);
  });

  it('Open with current data follows the state and calls the same action', async () => {
    const first = setup({ datasetNotice: 'remix' });
    await expect.element(banner().getByText(n5('2026-01-01', '2026-09-01'))).toBeVisible();
    await userEvent.click(openCurrent());
    expect(first.onremix).toHaveBeenCalledTimes(1);
  });

  it('Open with current data is aria-disabled while locked', async () => {
    const { onremix } = setup({ datasetNotice: 'remix', remix: { kind: 'locked' } });
    await expect.element(openCurrent()).toHaveAttribute('aria-disabled', 'true');
    press(openCurrent());
    expect(onremix).not.toHaveBeenCalled();
  });

  it('the error shows as an alert', async () => {
    setup({ error: 'This browser refused to save.' });
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('This browser refused to save.');
  });

  const states: [string, RemixState][] = [
    ['ready', { kind: 'ready', note: null }],
    ['locked', { kind: 'locked' }],
    ['full', { kind: 'full' }],
    ['null', null]
  ];
  it.each(states)('"Your game" links the current game\'s page when %s', async (_name, remix) => {
    setup({ remix, gameHref: '/sim' });
    await expect.element(yourGame()).toHaveAttribute('href', '/sim');
    expect(banner().getByRole('link', { name: 'Start your own' }).elements()).toHaveLength(0);
  });

  it("falls back to 'Untitled plan'", async () => {
    setup({});
    await expect.element(banner().getByText('Untitled plan', { exact: true })).toBeVisible();
  });

  it("'none' shows no dataset notice line", async () => {
    setup({ datasetNotice: 'none' });
    await expect.element(remixButton()).toBeVisible();
    expect(openCurrent().elements()).toHaveLength(0);
    expect(banner().element().textContent).not.toContain('Made with map data');
  });

  it("'gone' shows the exact N6 line with Open with current data", async () => {
    setup({ datasetNotice: 'gone' });
    await expect.element(banner().getByText(n6('2026-01-01', '2026-09-01'))).toBeVisible();
    await expect.element(openCurrent()).toBeVisible();
  });

  it('the policy kind says policy', async () => {
    render(SharedBanner, {
      id: 'abc23456',
      createdAt: '2026-10-30T12:00:00.000Z',
      datasetNotice: 'none',
      planVersion: '2026-01-01',
      currentVersion: '2026-09-01',
      kind: 'sim',
      remix: { kind: 'ready', note: null },
      error: null,
      gameHref: '/sim',
      onremix: () => {}
    });
    const region = page.getByRole('region', { name: 'Shared policy' });
    await expect.element(region.getByText('Untitled policy', { exact: true })).toBeVisible();
    await expect.element(region).toHaveTextContent(/Untitled policy · Shared policy · published/);
  });

  it('renders a title containing markup as literal text', async () => {
    setup({ title: '<b>"x"</b>' });
    await expect.element(banner().getByText('<b>"x"</b>', { exact: true })).toBeVisible();
    expect(banner().element().querySelector('b')).toBeNull();
  });
});
