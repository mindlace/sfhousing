import { expect, test } from '@playwright/test';
import { M1_TARGETS } from '../src/lib/scoreboard/targets';
import { expectNoA11yViolations } from './helpers/a11y';
import { gotoEditor, openResults } from './helpers/sharing';

// `ABOUT_ID` and `WORKED_OUT` (src/lib/about/copy.ts): Playwright cannot resolve that module's
// `$lib` imports, so the values are written out here.
const ABOUT_ID = { meanings: 'about-meanings', assumptions: 'about-assumptions' } as const;
const WORKED_OUT = 'How this is worked out';

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

test("from Paint, About's goal links the SF Planning RHNA Primer", async ({ page }) => {
  await gotoEditor(page);
  const results = await openResults(page);
  await results.getByRole('link', { name: WORKED_OUT, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/about#${ABOUT_ID.meanings}$`));
  const meanings = page.locator(`#${ABOUT_ID.meanings}`);
  await expect(
    meanings.getByRole('heading', { level: 2, name: 'What the numbers mean' })
  ).toBeInViewport();
  const goal = meanings.locator('dt', { hasText: /^The goal$/ }).locator('xpath=..');
  const primer = goal.getByRole('link', { name: 'SF Planning, RHNA Primer', exact: true });
  await expect(primer).toBeVisible();
  await expect(primer).toHaveAttribute('href', M1_TARGETS[0].source.url);
});

test('"RHNA" appears on /about only in part 1\'s goal and in the assumptions\' citations', async ({
  page
}) => {
  await page.goto(`/about#${ABOUT_ID.assumptions}`);
  await expect(page.locator('#src-targets')).toBeVisible();
  await expect(
    page.locator('#src-quality').getByRole('table', { name: 'Data checks that changed a value' })
  ).toBeVisible();
  // Every text node in the page that says RHNA, and where it sits. Allowed: the goal's term in
  // part 1 (its long form and its source), a source link in the assumptions, and the assumptions'
  // entries for the targets themselves (the plan's citations: name, source and method).
  const found = await page.evaluate((ids) => {
    const where: { text: string; ok: boolean }[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.textContent ?? '';
      if (!/RHNA/.test(text)) continue;
      const el = n.parentElement!;
      if (!el.checkVisibility()) continue;
      const goal = el.closest(`#${ids.meanings} dd`);
      const goalTerm = goal?.parentElement?.querySelector('dt')?.textContent?.trim() === 'The goal';
      const assumptions = el.closest(`#${ids.assumptions}`);
      const citation =
        !!assumptions && (!!el.closest('a[href]') || !!el.closest('[id^="src-target-"]'));
      where.push({ text: text.trim().slice(0, 80), ok: goalTerm || citation });
    }
    return where;
  }, ABOUT_ID);
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((f) => !f.ok)).toEqual([]);
});

test.describe('the assumptions', () => {
  const dataRequests = (page: import('@playwright/test').Page) => {
    const paths: string[] = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith('/data/')) paths.push(path);
    });
    return paths;
  };
  const checksTable = (page: import('@playwright/test').Page) =>
    page.locator('#src-quality').getByRole('table', { name: 'Data checks that changed a value' });

  test('/about: Show the assumptions loads them; the published estimates sit in Targets and published estimates', async ({
    page
  }) => {
    const data = dataRequests(page);
    await page.goto('/about');
    const show = page.locator('#about-assumptions').getByText('Show the assumptions', {
      exact: true
    });
    await expect(show).toBeVisible();
    // Hydrated: a press before then would open the native disclosure with nothing behind it.
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
    // Closed, /about fetches no data: several specs use it as a neutral page.
    expect(data).toEqual([]);
    await show.click();
    const targets = page.locator('#src-targets');
    await expect(
      targets.getByRole('heading', { level: 3, name: 'Targets and published estimates' })
    ).toBeVisible();
    for (const id of [
      'target-rhna',
      'target-rhna-buffer',
      'reference-planning-citywide',
      'reference-controller-high',
      'reference-controller-low'
    ]) {
      await expect(targets.locator(`#src-${id}`)).toBeVisible();
    }
    await expect(checksTable(page)).toBeVisible();
    expect(data.filter((p) => p.endsWith('/calibration.json'))).toHaveLength(1);
    expect(data.filter((p) => p.endsWith('/projects.json'))).toHaveLength(1);
  });

  test('a press before hydration still loads the assumptions', async ({ page }) => {
    // Hold the app's scripts until the disclosure has been pressed.
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    // Scripts only: a held stylesheet would block the first paint, and so the press.
    await page.route('**/_app/**/*.js', async (route) => {
      await held;
      await route.continue();
    });
    // Module scripts hold DOMContentLoaded back, so wait for the server-rendered summary instead.
    await page.goto('/about', { waitUntil: 'commit' });
    await expect(page.locator('#about-assumptions summary')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-hydrated', '');
    await page.locator('#about-assumptions summary').click();
    await expect(page.locator('#about-assumptions details')).toHaveAttribute('open', '');
    release();
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
    await expect(page.locator('#src-transitions')).toBeVisible();
    await expect(page.locator('#about-assumptions details')).toHaveAttribute('open', '');
  });

  test('/about#about-assumptions opens them on load', async ({ page }) => {
    await page.goto('/about#about-assumptions');
    await expect(page.locator('#about-assumptions details')).toHaveAttribute('open', '');
    await expect(page.locator('#src-transitions')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Assumptions', exact: true })
    ).toBeInViewport();
  });

  test('/about#src-transitions lands on the entry once it loads', async ({ page }) => {
    await page.goto('/about#src-transitions');
    await expect(
      page.getByRole('heading', { level: 3, name: 'How projects move through the stages' })
    ).toBeInViewport();
  });

  test('/about with the assumptions open passes axe with structure', async ({ page }) => {
    await page.goto('/about#about-assumptions');
    await expect(checksTable(page)).toBeVisible();
    await expectNoA11yViolations(page, { structure: true });
  });
});
