import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { n5, n6, remixConfirm } from './copy';
import SharedBanner from './SharedBanner.svelte';

type Notice = 'none' | 'remix' | 'gone';

function setup(
  p: { title?: string; datasetNotice?: Notice; count?: number; createdAt?: string } = {}
) {
  const onremix = vi.fn();
  const confirmText = vi.fn(() => ((p.count ?? 0) >= 1 ? remixConfirm(p.count ?? 0) : null));
  render(SharedBanner, {
    title: p.title,
    id: 'abc23456',
    createdAt: p.createdAt ?? '2026-10-11T23:30:00.000Z',
    datasetNotice: p.datasetNotice ?? 'none',
    planVersion: '2026-01-01',
    currentVersion: '2026-09-01',
    kind: 'plan',
    confirmText,
    onremix
  });
  return { onremix, confirmText };
}

const banner = () => page.getByRole('region', { name: 'Shared plan' });
const remixButton = () => banner().getByRole('button', { name: 'Remix', exact: true });
const openCurrent = () => banner().getByRole('button', { name: 'Open with current data' });
const dialog = () => page.getByRole('dialog');

describe('SharedBanner', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('shows the title, "Shared plan" and the UTC publish date, with Remix and Start your own', async () => {
    setup({ title: 'Mission infill' });
    await expect.element(banner()).toBeVisible();
    await expect.element(banner().getByText('Mission infill', { exact: true })).toBeVisible();
    await expect.element(banner()).toHaveTextContent(/Shared plan/);
    await expect.element(banner()).toHaveTextContent(/published Oct 11, 2026/);
    await expect.element(remixButton()).toBeVisible();
    const start = banner().getByRole('link', { name: 'Start your own' });
    await expect.element(start).toHaveAttribute('href', '/');
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

  it("'remix' shows the exact N5 line with Open with current data", async () => {
    setup({ datasetNotice: 'remix' });
    await expect.element(banner().getByText(n5('2026-01-01', '2026-09-01'))).toBeVisible();
    await expect.element(openCurrent()).toBeVisible();
  });

  it("'gone' shows the exact N6 line with Open with current data", async () => {
    setup({ datasetNotice: 'gone' });
    await expect.element(banner().getByText(n6('2026-01-01', '2026-09-01'))).toBeVisible();
    await expect.element(openCurrent()).toBeVisible();
  });

  it('Open with current data with an empty local plan remixes immediately', async () => {
    const { onremix } = setup({ datasetNotice: 'gone', count: 0 });
    await userEvent.click(openCurrent());
    expect(onremix).toHaveBeenCalledTimes(1);
    expect(dialog().elements()).toHaveLength(0);
  });

  it('Remix with a non-empty local plan asks first; Cancel does nothing, Replace remixes once', async () => {
    const { onremix } = setup({ count: 3 });
    await userEvent.click(remixButton());
    await expect.element(dialog()).toBeVisible();
    await expect.element(dialog().getByText(remixConfirm(3))).toBeVisible();
    await expect.element(dialog().getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onremix).not.toHaveBeenCalled();

    await userEvent.click(remixButton());
    await expect.element(dialog()).toBeVisible();
    await userEvent.click(dialog().getByRole('button', { name: 'Replace' }));
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onremix).toHaveBeenCalledTimes(1);
  });

  it('Open with current data runs the same confirm flow when the local plan is non-empty', async () => {
    const { onremix, confirmText } = setup({ datasetNotice: 'remix', count: 2 });
    await userEvent.click(openCurrent());
    await expect.element(dialog().getByText(remixConfirm(2))).toBeVisible();
    expect(confirmText).toHaveBeenCalled();
    expect(onremix).not.toHaveBeenCalled();
  });

  it('the dialog names the right count when focus moves into it on the first open', async () => {
    setup({ count: 4 });
    let atFocus: string | null = null;
    const onFocus = (e: FocusEvent) => {
      const dlg = (e.target as Element).closest('dialog');
      if (dlg && atFocus === null) atFocus = dlg.textContent;
    };
    document.addEventListener('focusin', onFocus);
    try {
      await userEvent.click(remixButton());
      await expect.element(dialog()).toBeVisible();
      await expect.element(dialog()).toHaveAccessibleName(remixConfirm(4));
      expect(atFocus).toContain(remixConfirm(4));
    } finally {
      document.removeEventListener('focusin', onFocus);
    }
  });

  it('renders a title containing markup as literal text', async () => {
    setup({ title: '<b>"x"</b>' });
    await expect.element(banner().getByText('<b>"x"</b>', { exact: true })).toBeVisible();
    expect(banner().element().querySelector('b')).toBeNull();
  });
});
