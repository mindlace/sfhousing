/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { parseSitesFile, parseSummary } from '$lib/data/lesscars/codec';
import { formatCount } from '$lib/scoreboard/format';
import sitesJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/sites.json';
import V1_SITES from '$lib/data/lesscars/fixtures/v1/sites.json';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import { AMENITIES_COPY, BUILDING_NOTE } from './copy';
import DetailsPanel from './DetailsPanel.svelte';
import { freedLandCopy } from './copy';
import { bandText, freedLandSplit, breakdownRows, finalYear } from './summary-view';

const fx = parseSummary(summaryJson);
const sites = parseSitesFile(sitesJson);
const N = Math.round(fx.extra.mean.at(-1)!);
const Y = finalYear(fx);

describe('DetailsPanel', () => {
  it('the breakdown table rows and total match the headline', async () => {
    await page.viewport(1024, 768);
    await render(DetailsPanel, {
      props: { summary: fx, sites, day: fx.yearEnds[0], onevidence: vi.fn() }
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
    await render(DetailsPanel, { props: { summary: fx, sites, day: fx.yearEnds[0], onevidence } });
    await page.getByRole('button', { name: 'Evidence for every number' }).click();
    expect(onevidence).toHaveBeenCalledTimes(1);
    await page.getByText('Map key').click();
    await expect.element(page.getByText('Removed: now land')).toBeVisible();
    await expect.element(page.getByText(BUILDING_NOTE)).toBeVisible();
  });

  it('says how much freed land came from freeway parcels and from roadway', async () => {
    await page.viewport(1024, 768);
    const { parcelM2, rowM2 } = freedLandSplit(sites);
    await render(DetailsPanel, {
      props: { summary: fx, sites, day: fx.yearEnds[0], onevidence: vi.fn() }
    });
    await expect
      .element(
        page.getByText(freedLandCopy((parcelM2 / 10000).toFixed(1), (rowM2 / 10000).toFixed(1)))
      )
      .toBeVisible();
  });

  it('a v1 sites file (no parcels information) shows no freed-land line', async () => {
    await page.viewport(1024, 768);
    await render(DetailsPanel, {
      props: {
        summary: fx,
        sites: parseSitesFile(V1_SITES),
        day: fx.yearEnds[0],
        onevidence: vi.fn()
      }
    });
    await expect.element(page.getByText(/Freed land:/)).not.toBeInTheDocument();
    await expect.element(page.getByTestId('lc-panel')).toBeVisible();
  });

  it('shows the garage cost only when summary.garageCost is present', async () => {
    await page.viewport(1024, 768);
    const a = await render(DetailsPanel, {
      props: { summary: fx, sites, day: fx.yearEnds[0], onevidence: vi.fn() }
    });
    await expect.element(page.getByText(/take the place of/)).not.toBeInTheDocument();
    a.unmount();
    const withCost = { ...fx, garageCost: [{ projectId: 'garage', homes: 1234 }] };
    await render(DetailsPanel, {
      props: { summary: withCost, sites, day: fx.yearEnds[0], onevidence: vi.fn() }
    });
    await expect
      .element(page.getByText('Edge garages on freed land take the place of 1,234 homes.'))
      .toBeVisible();
  });
});
