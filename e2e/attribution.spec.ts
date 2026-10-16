import { expect, test } from '@playwright/test';

const NOTICES = [
  'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).',
  'Buildings © Overture Maps Foundation; OSM-derived data under ODbL, other data under CDLA Permissive 2.0.',
  'Basemap by Protomaps (protomaps.com): BSD-3-Clause code, ODbL data.',
  'Parcels, land use, building footprints and neighborhoods from DataSF (datasf.org), Public Domain Dedication and License (PDDL) / public domain.',
  'Transit stops and schedules from SFMTA Muni, BART and Caltrain GTFS feeds. These are facts, credited as a courtesy; vehicle capacities are agency planning figures.',
  'Derived data files under /data/ that incorporate OpenStreetMap or Overture data are made available under the ODbL 1.0.',
  "This project's code is MIT licensed."
];

test('attribution page shows dataset version, sources and fixed notices', async ({ page }) => {
  await page.goto('/attribution');
  await expect(page.getByText('Dataset version fixture-0, built 2026-10-10.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'DataSF Parcels (Active and Retired)' })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overture Maps Buildings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SFMTA Muni GTFS' })).toBeVisible();
  for (const notice of NOTICES) await expect(page.getByText(notice)).toBeVisible();
});
