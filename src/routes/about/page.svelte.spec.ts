import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { REPO_URL } from '$lib/config';
import { ABOUT_ID, ABOUT_INTRO, ABOUT_TITLE, PART_HEADING } from '$lib/about/copy';
import Page from './+page.svelte';

const data = {
  datasetVersion: 'fixture-0',
  appRelease: 'dev',
  user: null,
  signInAvailable: true,
  manifest: null
};

describe('/about', () => {
  it('the page: h1 About this model, the intro, the four parts in order, the source code link', async () => {
    render(Page, { data });
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent(ABOUT_TITLE);
    expect(ABOUT_TITLE).toBe('About this model');
    await expect.element(page.getByText(ABOUT_INTRO)).toBeInTheDocument();
    const h2 = [...document.querySelectorAll('h2')].map((h) => h.textContent?.trim());
    expect(h2).toEqual([
      PART_HEADING.meanings,
      PART_HEADING.assumptions,
      PART_HEADING.data,
      PART_HEADING.using
    ]);
    const ids = [...document.querySelectorAll('section[id^="about-"]')]
      .map((s) => s.id)
      .filter((id) => id !== ABOUT_ID.shortcuts);
    expect(ids).toEqual([ABOUT_ID.meanings, ABOUT_ID.assumptions, ABOUT_ID.data, ABOUT_ID.using]);
    await expect
      .element(page.getByRole('link', { name: 'MIT licensed' }))
      .toHaveAttribute('href', `${REPO_URL}/blob/main/LICENSE`);
  });

  it('sets the two colour properties to the light tokens on its root', async () => {
    render(Page, { data });
    const root = document.getElementById(ABOUT_ID.meanings)!.parentElement!;
    expect(root.style.getPropertyValue('--about-muted')).toBe('var(--color-ink-muted)');
    expect(root.style.getPropertyValue('--about-line')).toBe('var(--color-line)');
  });
});
