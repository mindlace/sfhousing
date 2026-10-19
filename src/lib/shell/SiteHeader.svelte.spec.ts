import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
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
      const timelapse = nav.getByRole('link', { name: 'Timelapse' });
      await expect.element(paint).toHaveAttribute('href', '/');
      await expect.element(paint).toHaveAttribute('aria-current', 'page');
      await expect.element(timelapse).toHaveAttribute('href', '/fzp');
      await expect.element(timelapse).not.toHaveAttribute('aria-current');
    });

    it('flips the current link on /fzp', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/fzp' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect
        .element(nav.getByRole('link', { name: 'Paint' }))
        .not.toHaveAttribute('aria-current');
      await expect
        .element(nav.getByRole('link', { name: 'Timelapse' }))
        .toHaveAttribute('aria-current', 'page');
    });

    it('shows both links with neither current on a shared plan', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/p/[id]' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect.element(nav.getByRole('link', { name: 'Timelapse' })).toBeVisible();
      await expect
        .element(nav.getByRole('link', { name: 'Paint' }))
        .not.toHaveAttribute('aria-current');
      await expect
        .element(nav.getByRole('link', { name: 'Timelapse' }))
        .not.toHaveAttribute('aria-current');
    });

    it('shows only Paint at 375px on /fzp', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/fzp' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect.element(nav.getByText('Timelapse')).not.toBeVisible();
    });

    it.each(['/', '/p/[id]'])('shows only Timelapse at 375px on %s', async (routeId) => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect.element(nav.getByRole('link', { name: 'Timelapse' })).toBeVisible();
      await expect.element(nav.getByText('Paint')).not.toBeVisible();
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
});
