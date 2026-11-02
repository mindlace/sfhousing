/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { parseSummary } from '$lib/data/lesscars/codec';
import { formatCount } from '$lib/scoreboard/format';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import { AMENITIES_COPY, BUILDING_NOTE } from './copy';
import DetailsPanel from './DetailsPanel.svelte';
import { bandText, breakdownRows, finalYear } from './summary-view';

const fx = parseSummary(summaryJson);
const N = Math.round(fx.extra.mean.at(-1)!);
const Y = finalYear(fx);

describe('DetailsPanel', () => {
  it('the breakdown table rows and total match the headline', async () => {
    await page.viewport(1024, 768);
    await render(DetailsPanel, {
      props: { summary: fx, day: fx.yearEnds[0], onevidence: vi.fn() }
    });
    const rows = page
      .getByRole('table', { name: `Where the extra homes come from, ${Y}` })
      .getByRole('row');
    for (const [k, r] of breakdownRows(fx).entries())
      await expect.element(rows.nth(k + 1)).toHaveTextContent(`${r.label}${formatCount(r.homes)}`);
    await expect.element(rows.last()).toHaveTextContent(`Total${formatCount(N)}`);
    await expect.element(page.getByText(bandText(fx))).toBeVisible();
    await expect.element(page.getByText(AMENITIES_COPY)).toBeVisible();
  });

  it('Evidence for every number calls onevidence; the map key lists Removed: now land', async () => {
    await page.viewport(1024, 768);
    const onevidence = vi.fn();
    await render(DetailsPanel, { props: { summary: fx, day: fx.yearEnds[0], onevidence } });
    await page.getByRole('button', { name: 'Evidence for every number' }).click();
    expect(onevidence).toHaveBeenCalledTimes(1);
    await page.getByText('Map key').click();
    await expect.element(page.getByText('Removed: now land')).toBeVisible();
    await expect.element(page.getByText(BUILDING_NOTE)).toBeVisible();
  });
});
