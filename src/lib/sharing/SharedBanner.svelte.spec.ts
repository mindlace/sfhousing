import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { copyFor } from './copy';
import type { DocKind } from './doc-codec';
import SharedBanner from './SharedBanner.svelte';

type Notice = 'none' | 'remix' | 'gone';

function setup(p: { datasetNotice?: Notice; title?: string; kind?: DocKind } = {}) {
  render(SharedBanner, {
    title: p.title,
    id: 'abc23456',
    createdAt: '2026-10-11T23:30:00.000Z',
    datasetNotice: p.datasetNotice ?? 'none',
    planVersion: '2026-01-01',
    currentVersion: '2026-09-01',
    kind: p.kind ?? 'plan'
  });
}

const banner = () => page.getByRole('region', { name: 'Shared plan' });
const yourGame = () => banner().getByRole('link', { name: 'Your game' });

describe('SharedBanner', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('the title line and "Your game" to /, and no button', async () => {
    setup({ title: 'Mission infill' });
    await expect
      .element(banner())
      .toHaveTextContent(/Mission infill · Shared plan · published Oct 11, 2026/);
    await expect.element(yourGame()).toHaveAttribute('href', '/');
    expect(banner().getByRole('button').elements()).toEqual([]);
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

  for (const kind of ['plan', 'sim'] as const)
    for (const [notice, key] of [
      ['remix', 'n5'],
      ['gone', 'n6']
    ] as const)
      it(`${kind}: the ${notice} notice shows its line and no button`, async () => {
        setup({ kind, datasetNotice: notice });
        const region = page.getByRole('region', { name: copyFor(kind).shared });
        const line = copyFor(kind)[key]('2026-01-01', '2026-09-01');
        await expect.element(region.getByText(line, { exact: true })).toBeVisible();
        expect(region.getByRole('button').elements()).toEqual([]);
      });

  it("falls back to 'Untitled plan'", async () => {
    setup({});
    await expect.element(banner().getByText('Untitled plan', { exact: true })).toBeVisible();
  });

  it("'none' shows no dataset notice line", async () => {
    setup({ datasetNotice: 'none' });
    await expect.element(yourGame()).toBeVisible();
    expect(banner().element().textContent).not.toContain('Made with map data');
  });

  it('the policy kind says policy', async () => {
    setup({ kind: 'sim' });
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
