import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { REPO_URL } from '$lib/config';
import Page from './+page.svelte';

describe('/about', () => {
  it('links the data page and the source repository', async () => {
    render(Page);
    await expect
      .element(page.getByRole('link', { name: 'data and licences page' }))
      .toHaveAttribute('href', '/attribution');
    await expect
      .element(page.getByRole('link', { name: 'source code' }))
      .toHaveAttribute('href', REPO_URL);
  });
});
