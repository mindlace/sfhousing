import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import SiteHeader from './SiteHeader.svelte';

describe('SiteHeader', () => {
  it('renders a banner with a home link', async () => {
    render(SiteHeader);
    const banner = page.getByRole('banner');
    await expect.element(banner).toBeVisible();
    const link = banner.getByRole('link', { name: 'SF Housing Simulator' });
    await expect.element(link).toHaveAttribute('href', '/');
  });

  it('renders the actions snippet inside the header', async () => {
    await page.viewport(1024, 768);
    const actions = createRawSnippet(() => ({ render: () => '<button>Publish</button>' }));
    render(SiteHeader, { actions });
    await expect
      .element(page.getByRole('banner').getByRole('button', { name: 'Publish' }))
      .toBeVisible();
  });

  it('is 48px tall', async () => {
    render(SiteHeader);
    const el = page.getByRole('banner').element();
    expect(el.getBoundingClientRect().height).toBe(48);
  });

  describe('mode links', () => {
    it('shows both links at 1024px and marks the current mode', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      const paint = nav.getByRole('link', { name: 'Paint' });
      const simulate = nav.getByRole('link', { name: 'Simulate' });
      await expect.element(paint).toHaveAttribute('href', '/');
      await expect.element(paint).toHaveAttribute('aria-current', 'page');
      await expect.element(simulate).toHaveAttribute('href', '/sim');
      await expect.element(simulate).not.toHaveAttribute('aria-current');
    });

    it('flips the current link on /sim', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/sim' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect
        .element(nav.getByRole('link', { name: 'Paint' }))
        .not.toHaveAttribute('aria-current');
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .toHaveAttribute('aria-current', 'page');
    });

    it('shows both links with neither current on a shared plan', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/p/[id]' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect.element(nav.getByRole('link', { name: 'Simulate' })).toBeVisible();
      await expect
        .element(nav.getByRole('link', { name: 'Paint' }))
        .not.toHaveAttribute('aria-current');
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .not.toHaveAttribute('aria-current');
    });

    it('puts both links in the menu at 375px and marks the current mode', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim' });
      await expect.element(page.getByRole('link', { name: 'Paint' })).not.toBeInTheDocument();
      await page.getByRole('button', { name: 'Menu' }).click();
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .toHaveAttribute('aria-current', 'page');
    });
  });

  describe('brand', () => {
    const suffixOf = () => {
      const link = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });
      return link.element().querySelector('span') as HTMLElement;
    };

    it('shows "SF Housing" at 375px and keeps the full accessible name', async () => {
      await page.viewport(375, 812);
      render(SiteHeader);
      const link = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });
      await expect.element(link).toBeVisible();
      expect(link.element().textContent).toBe('SF Housing Simulator');
      // sr-only: " Simulator" is clipped to a 1px box, not rendered
      expect(suffixOf().getBoundingClientRect().width).toBeLessThanOrEqual(1);
    });

    it('shows "SF Housing Simulator" at 1024px', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader);
      await expect
        .element(page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' }))
        .toBeVisible();
      expect(suffixOf().getBoundingClientRect().width).toBeGreaterThan(20);
    });
  });

  it('fits at 375px with three 44px actions and no banner overflow', async () => {
    await page.viewport(375, 812);
    const actions = createRawSnippet(() => ({
      render: () =>
        '<span><button style="width:44px;height:44px">A</button>' +
        '<button style="width:44px;height:44px">B</button>' +
        '<button style="width:44px;height:44px">C</button></span>'
    }));
    render(SiteHeader, { routeId: '/', actions });
    const banner = page.getByRole('banner');
    await expect.element(banner).toBeVisible();
    const el = banner.element() as HTMLElement;
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
  });

  describe('phone menu', () => {
    const actions = createRawSnippet(() => ({
      render: () =>
        '<span><button>Another future</button><button aria-expanded="false">View</button></span>'
    }));
    const pinned = createRawSnippet(() => ({ render: () => '<button>1,234 homes added</button>' }));
    const menu = () => page.getByRole('button', { name: 'Menu' });

    it('at 375px hides the links and actions until Menu is pressed; the pinned item shows', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      const banner = page.getByRole('banner');
      await expect.element(banner.getByRole('button', { name: '1,234 homes added' })).toBeVisible();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(page.getByText('Another future')).not.toBeVisible();
      // Two copies of the links (header row from md, menu below md): neither shows.
      expect(page.getByRole('link', { name: 'Paint' }).elements()).toEqual([]);
      expect(page.getByText('Paint').elements()).toHaveLength(2);

      await menu().click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      const panel = document.getElementById(menu().element().getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      await expect.element(page.getByRole('button', { name: 'Another future' })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'Simulate' })).toBeVisible();
      await expect.element(banner.getByRole('button', { name: '1,234 homes added' })).toBeVisible();
      const el = banner.element() as HTMLElement;
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    });

    it('Escape closes the menu and returns focus to Menu', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      (page.getByRole('link', { name: 'Paint' }).element() as HTMLElement).focus();
      await userEvent.keyboard('{Escape}');
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(menu()).toHaveFocus();
      await expect.element(page.getByText('Another future')).not.toBeVisible();
    });

    it('choosing a plain button closes the menu; a disclosure inside keeps it open', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      await page.getByRole('button', { name: 'View' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: 'Another future' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(page.getByText('Another future')).not.toBeVisible();
    });

    it('a button inside a dialog opened from the menu keeps the menu (and the dialog) open', async () => {
      await page.viewport(375, 812);
      const withDialog = createRawSnippet(() => ({
        render: () =>
          '<span><button aria-haspopup="dialog">Publish</button>' +
          '<dialog><button>Send</button></dialog></span>'
      }));
      render(SiteHeader, { routeId: '/', actions: withDialog });
      await menu().click();
      const dlg = document.querySelector('dialog') as HTMLDialogElement;
      await page.getByRole('button', { name: 'Publish' }).click();
      dlg.showModal();
      await page.getByRole('button', { name: 'Send' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      await expect.element(page.getByRole('button', { name: 'Send' })).toBeVisible();
      dlg.close();
    });

    it('the Menu button is at least 24x24', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/' });
      const r = menu().element().getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    });

    it('at 1024px there is no Menu; the pinned item sits before the actions', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await expect.element(page.getByRole('button', { name: 'Another future' })).toBeVisible();
      expect(page.getByRole('button', { name: 'Menu' }).elements()).toEqual([]);
      const score = page.getByRole('button', { name: '1,234 homes added' }).element();
      const other = page.getByRole('button', { name: 'Another future' }).element();
      expect(score.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(score.getBoundingClientRect().right).toBeLessThanOrEqual(
        other.getBoundingClientRect().left
      );
    });
  });
});
