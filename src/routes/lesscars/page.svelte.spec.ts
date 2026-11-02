// The /lesscars page states that need no map: no-scenario and a load error (Retry reloads).
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../layout.css';
import { invalidateAllCalls } from '../../test-stubs/app/navigation';
import Page from './+page.svelte';

type PageData = import('./$types').PageData;

describe('/lesscars page', () => {
  it('no-scenario and error states render without a map or worker', async () => {
    render(Page, { params: {}, data: { state: 'no-scenario', datasetVersion: 'x' } as PageData });
    await expect.element(page.getByText('This dataset has no fewer-cars plan yet.')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Open the policy simulation' }))
      .toHaveAttribute('href', '/sim');
    expect(document.querySelector('[data-testid="fzp-sim-map-stub"]')).toBeNull();
    render(Page, {
      params: {},
      data: { state: 'error', datasetVersion: 'x', message: 'm' } as PageData
    });
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent("The fewer-cars plan couldn't be loaded.");
    await expect.element(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    const before = invalidateAllCalls.length;
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(invalidateAllCalls.length).toBe(before + 1);
  });
});
