/// <reference types="@vitest/browser-playwright" />
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseSummary } from '$lib/data/lesscars/codec';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import HeadlineBar from './HeadlineBar.svelte';
import { headlineName, headlineText } from './summary-view';
import { headlineNameCopy, headlineCopy } from './copy';

const fx = parseSummary(summaryJson);
const panel = createRawSnippet(() => ({
  render: () => '<div><p>Details here</p><button type="button">Inside</button></div>'
}));

describe('HeadlineBar', () => {
  it('shows the headline and opens the details region by click, closes on Escape with focus back', async () => {
    await page.viewport(1024, 768);
    await render(HeadlineBar, { props: { summary: fx, panel } });
    const btn = page.getByTestId('lc-headline');
    await expect.element(btn).toHaveTextContent(headlineText(fx));
    await expect.element(btn).toHaveAccessibleName(headlineName(fx));
    await expect.element(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect.element(btn).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('region', { name: 'Fewer-cars details' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByTestId('lc-details')).not.toBeInTheDocument();
    await expect.element(btn).toHaveFocus();
  });

  it('an outside press closes the details', async () => {
    await page.viewport(1024, 768);
    await render(HeadlineBar, { props: { summary: fx, panel } });
    await page.getByTestId('lc-headline').click();
    await expect.element(page.getByText('Details here')).toBeVisible();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(page.getByText('Details here')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('lc-headline')).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([-56, 0, 1234])('the accessible name starts with the visible text (n = %i)', (n) => {
    expect(headlineNameCopy(n, 2068).startsWith(headlineCopy(n, 2068))).toBe(true);
  });
});
