import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { REPO_URL } from '$lib/config';
import SiteFooter from './SiteFooter.svelte';

describe('SiteFooter', () => {
  it('renders contentinfo with the three links', async () => {
    render(SiteFooter);
    const footer = page.getByRole('contentinfo');
    await expect
      .element(footer.getByRole('link', { name: 'About' }))
      .toHaveAttribute('href', '/about');
    await expect
      .element(footer.getByRole('link', { name: 'Data & licences' }))
      .toHaveAttribute('href', '/attribution');
    await expect
      .element(footer.getByRole('link', { name: 'Source code (GitHub)' }))
      .toHaveAttribute('href', REPO_URL);
  });

  it('does not overflow horizontally at 375px', async () => {
    await page.viewport(375, 812);
    render(SiteFooter);
    await expect.element(page.getByRole('contentinfo')).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
