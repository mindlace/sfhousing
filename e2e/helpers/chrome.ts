// The site chrome on the map pages: no footer; the header's About entry stays reachable.
import { expect, type Page } from '@playwright/test';
import { openHeaderMenu } from './sharing';

/** The map pages have no footer landmark. */
export async function expectNoFooter(page: Page): Promise<void> {
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Footer' })).toHaveCount(0);
}

/**
 * The header's About entry (in the Menu below lg): visible, fully in the viewport, the topmost
 * element at its centre, and tappable (trial). Closes the Menu again if it opened it.
 */
export async function expectAboutReachable(page: Page): Promise<void> {
  const banner = page.getByRole('banner');
  const menu = banner.getByRole('button', { name: 'Menu', exact: true });
  const wasOpen =
    !(await menu.isVisible()) || (await menu.getAttribute('aria-expanded')) === 'true';
  await openHeaderMenu(page);
  const about = banner.getByRole('link', { name: 'About', exact: true });
  await expect(about).toBeVisible();
  await expect(about).toBeInViewport({ ratio: 1 });
  const hit = await about.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: !!top && el.contains(top), top: top ? `${top.tagName}.${top.className}` : 'null' };
  });
  expect(hit.ok, `About covered by ${hit.top}`).toBe(true);
  await about.click({ trial: true });
  if (!wasOpen) {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  }
}
