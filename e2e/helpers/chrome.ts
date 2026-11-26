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

/**
 * The phone header (375 px) on a page that pins an item: the bar fits (`expectHeaderRowFits`), and
 * the site name is in the Menu, not the bar. Leaves the Menu closed.
 */
export async function expectPhoneHeaderFits(page: Page): Promise<void> {
  const banner = page.getByRole('banner');
  const name = banner.getByRole('link', { name: /SF Housing/ });
  await expect(name).toHaveCount(0);
  await expectHeaderRowFits(page);
  await openHeaderMenu(page);
  await expect(banner.getByRole('link', { name: 'SF Housing', exact: true })).toBeVisible();
  const menu = banner.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
}

/**
 * The header's bar at any width: 48 px tall, nothing overflows the bar or the page, and no two
 * visible items overlap.
 */
export async function expectHeaderRowFits(page: Page): Promise<void> {
  const banner = page.getByRole('banner');
  expect((await banner.boundingBox())!.height).toBe(48);
  const fit = await banner.evaluate((b) => ({
    bar: b.scrollWidth - b.clientWidth,
    page: document.scrollingElement!.scrollWidth - window.innerWidth
  }));
  expect(fit, 'the header overflows').toEqual({ bar: 0, page: 0 });
  const row = await banner.evaluate((b) => {
    const items = [
      ...b.querySelectorAll<HTMLElement>('a, button, [data-header-status] > *')
    ].filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0);
    return items
      .filter((el) => !items.some((o) => o !== el && o.contains(el)))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: (el.textContent ?? '').trim(), left: r.left, right: r.right };
      })
      .sort((a, b) => a.left - b.left);
  });
  expect(row.length).toBeGreaterThan(1);
  for (let i = 1; i < row.length; i++)
    expect(row[i].left, `"${row[i].name}" overlaps "${row[i - 1].name}"`).toBeGreaterThanOrEqual(
      row[i - 1].right - 0.5
    );
}
