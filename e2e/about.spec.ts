import { expect, test } from '@playwright/test';

const NOTICES = [
  'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).',
  'Buildings © Overture Maps Foundation, from Microsoft ML Buildings, OpenStreetMap and USGS Lidar under the ODbL and Esri Community Maps under CC BY 4.0.',
  'Basemap by Protomaps (protomaps.com): BSD-3-Clause code, ODbL data.',
  'Parcels, land use, building footprints and neighborhoods from DataSF (datasf.org), Public Domain Dedication and License (PDDL) / public domain.',
  'Transit stops and schedules from SFMTA Muni, BART and Caltrain GTFS feeds. These are facts, credited as a courtesy; vehicle capacities are agency planning figures.',
  'Derived data files under /data/ that incorporate OpenStreetMap or Overture data are made available under the ODbL 1.0.',
  "This project's code is MIT licensed."
];

test.describe('server-rendered', () => {
  test.use({ javaScriptEnabled: false });

  test('/about shows the dataset version, the sources, every notice and Software, server-rendered', async ({
    page
  }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('About this model');
    await expect(page.getByText('Dataset version fixture-0, built 2026-10-10.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'DataSF Parcels (Active and Retired)' })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Overture Maps Buildings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SFMTA Muni GTFS' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'DataSF Analysis Neighborhoods' })).toBeVisible();
    await expect(page.getByText(/DataSF Streets/)).toBeVisible();
    for (const notice of NOTICES) await expect(page.getByText(notice)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Software' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'MapLibre GL JS' })).toBeVisible();
  });
});

test('/attribution lands on /about at Data and licences', async ({ page }) => {
  await page.goto('/attribution');
  await expect(page).toHaveURL(/\/about#about-data$/);
  await expect(page.getByRole('heading', { name: 'Data and licences' })).toBeInViewport();
});
