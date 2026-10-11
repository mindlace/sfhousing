import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

describe('/ shell', () => {
  it('renders an accessible page heading and the map region', async () => {
    render(Page);
    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('SF Housing Simulator');
    expect(document.getElementById('map-region')).not.toBeNull();
  });
});
