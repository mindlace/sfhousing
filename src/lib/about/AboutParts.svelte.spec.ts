import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { SHORTCUTS } from '$lib/brush/shortcuts';
import { TIMELINE_SHORTCUTS } from '$lib/timeline/shortcuts';
import { REPO_URL } from '$lib/config';
import { bufferAmount, GOAL_BASE } from '$lib/goal/goal';
import { M1_TARGETS } from '$lib/scoreboard/targets';
import type { ManifestSources } from '$lib/data/manifest';
import AboutData from './AboutData.svelte';
import AboutMeanings from './AboutMeanings.svelte';
import AboutUsing from './AboutUsing.svelte';
import { MAX_SAVES } from '$lib/game/saves';
import { ABOUT_ID, MEANINGS, PART_HEADING, SAVED_GAMES, YOUR_PLANS } from './copy';

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const source = {
  id: 'datasf-parcels',
  url: 'https://data.sfgov.org/x',
  retrievedAt: '2026-10-01T00:00:00Z',
  license: 'PDDL'
};
const overture = [
  { id: 'overture:Esri Community Maps', label: 'Esri Community Maps via Overture Maps' },
  { id: 'overture:Microsoft ML Buildings', label: 'Microsoft ML Buildings via Overture Maps' },
  { id: 'overture:OpenStreetMap', label: 'OpenStreetMap via Overture Maps' },
  { id: 'overture:USGS Lidar', label: 'USGS Lidar via Overture Maps' }
].map((s) => ({
  ...s,
  url: 'https://docs.overturemaps.org/attribution',
  retrievedAt: '2026-10-10T00:00:00Z',
  license: s.id === 'overture:Esri Community Maps' ? 'CC-BY-4.0' : 'ODbL-1.0'
}));
const manifest: ManifestSources = {
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-09T12:00:00Z',
  sources: [source]
};
const scenarios = {
  fzp: {
    parcels: '/data/fixture-0/scenarios/fzp/parcels.bin',
    projects: '/data/fixture-0/scenarios/fzp/projects.json',
    calibration: '/data/fixture-0/scenarios/fzp/calibration.json'
  }
};

function renderData(m: ManifestSources | null) {
  return render(AboutData, { level: 2, datasetVersion: 'fixture-0', manifest: m });
}

const ODBL_ONLY = 'Buildings © Overture Maps Foundation, under the ODbL.';

async function expectNotices() {
  await expect.element(page.getByText('Map data ©')).toBeInTheDocument();
  await expect
    .element(page.getByRole('link', { name: 'OpenStreetMap contributors' }))
    .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  expect(text()).toContain(
    'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).'
  );
  expect(text()).toContain('Buildings © Overture Maps Foundation,');
  expect(text()).not.toContain('CDLA');
  await expect.element(page.getByText('Basemap by Protomaps (protomaps.com)')).toBeInTheDocument();
  await expect
    .element(page.getByText('Parcels, land use, building footprints'))
    .toBeInTheDocument();
  await expect.element(page.getByText('made available under the ODbL 1.0.')).toBeInTheDocument();
  await expect
    .element(page.getByRole('heading', { name: 'Licences and notices' }))
    .toBeInTheDocument();
  await expect.element(page.getByRole('heading', { name: 'Software' })).toBeInTheDocument();
  await expect.element(page.getByRole('link', { name: 'MapLibre GL JS' })).toBeInTheDocument();
  await expect
    .element(page.getByRole('link', { name: 'MIT licensed' }))
    .toHaveAttribute('href', `${REPO_URL}/blob/main/LICENSE`);
  // The repository itself: the dialog on /sim has no footer to link it.
  await expect
    .element(page.getByRole('link', { name: 'code', exact: true }))
    .toHaveAttribute('href', REPO_URL);
  expect(text()).toContain("This project's code is MIT licensed.");
}

describe('AboutMeanings', () => {
  it('meanings: every term in order; the goal reads "82,069 homes by the end of the 40-year window" and "June 2022" from GOAL_BASE', async () => {
    render(AboutMeanings, { level: 2 });
    const terms = [...document.querySelectorAll('dt')].map((d) => d.textContent?.trim());
    expect(terms).toEqual([
      'Room for N homes',
      'Homes by a date',
      'From your policy',
      'Current law',
      'The goal',
      'The goal + 15%',
      'To beat'
    ]);
    expect(MEANINGS.map((m) => m.term)).toEqual(terms);
    const t = text();
    for (const m of MEANINGS) expect(t).toContain(m.body);
    expect(t).toContain(
      'Every eligible lot you painted, rebuilt to its height at once. Homes in replaced buildings are subtracted.'
    );
    expect(t).toContain(
      '82,069 homes by the end of the 40-year window, counted from June 2022, so homes built since ' +
        "then count. It is San Francisco's share of RHNA 2023–2031, the state's Regional Housing " +
        'Needs Allocation, which asks for them by January 2031.'
    );
    expect(t).toContain(
      'The month you reached the goal when you last levelled up. Reach the goal in an earlier month to win the level.'
    );
  });

  it('meanings: the goal links "SF Planning, RHNA Primer" to M1_TARGETS[0].source.url', async () => {
    render(AboutMeanings, { level: 2 });
    await expect
      .element(page.getByRole('link', { name: 'SF Planning, RHNA Primer' }))
      .toHaveAttribute('href', M1_TARGETS[0].source.url);
    expect(text()).toContain('which asks for them by January 2031. SF Planning, RHNA Primer');
  });

  it('meanings: the buffer reads 94,379 from bufferAmount(GOAL_BASE)', async () => {
    render(AboutMeanings, { level: 2 });
    expect(bufferAmount(GOAL_BASE)).toBe(94379);
    expect(text()).toContain('The state asks for room for at least 15% more: 94,379 homes.');
  });
});

describe('AboutData', () => {
  it("data: the version line, the sources table, every notice of today's page, Software and the code line", async () => {
    renderData({ ...manifest, sources: [source, { ...source, id: 'b', label: 'Parcels' }] });
    await expect
      .element(page.getByText('Dataset version fixture-0, built 2026-10-09.'))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'datasf-parcels' }))
      .toHaveAttribute('href', 'https://data.sfgov.org/x');
    await expect
      .element(page.getByRole('link', { name: 'Parcels', exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: 'PDDL' }).first()).toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: '2026-10-01' }).first())
      .toBeInTheDocument();
    await expectNotices();
  });

  const TRANSIT =
    'Transit stops and schedules from SFMTA Muni, BART and Caltrain GTFS feeds. These are facts, credited as a courtesy; vehicle capacities are agency planning figures.';
  const SCENARIO =
    "Housing project records (building permits, Planning applications, approvals and completions, the development pipeline), the assessor's secured roll, the City Lands inventory of city-owned land and the Family Zoning Plan height districts from DataSF, under PDDL, CC0 or public domain. The simulation's comparison estimates are cited from SF Planning and the SF Controller's Office.";
  const POLICY =
    'Street centerlines and historic resource status from DataSF, under PDDL. SB 79 exemption parcel tables from San Francisco Board of Supervisors File No. 260132 (Ordinance No. 082-26), SF public record (Board File 260132). Zoning rules follow California Government Code §§65912.155–65912.162 (SB 79, 2025) and San Francisco Planning Code §207.11.';

  it('data: the transit, housing-records and policy notices follow the manifest', async () => {
    const gtfs = { ...source, id: 'gtfs-muni', label: 'SFMTA Muni GTFS' };
    const policy = {
      fzp: { ...scenarios.fzp, policy: '/data/fixture-0/scenarios/fzp/policy.bin' }
    };
    const r = await renderData({ ...manifest, sources: [source, gtfs], scenarios: policy });
    await expect.element(page.getByText('Map data ©')).toBeInTheDocument();
    expect(text()).toContain(TRANSIT);
    expect(text()).toContain(SCENARIO);
    expect(text()).toContain(POLICY);
    expect(text()).not.toContain('MTC');
    await r.unmount();
    const s = await renderData({ ...manifest, scenarios });
    await expect.element(page.getByText('Map data ©')).toBeInTheDocument();
    expect(text()).toContain(SCENARIO);
    expect(text()).not.toContain(TRANSIT);
    expect(text()).not.toContain('Street centerlines');
    await s.unmount();
    // No fzp scenario: no housing records to credit.
    renderData(manifest);
    await expect.element(page.getByText('Map data ©')).toBeInTheDocument();
    expect(text()).not.toContain('Housing project records');
    expect(text()).not.toContain('Street centerlines');
  });

  it('data: the Overture notice comes from the manifest; "the ODbL" and "CC BY 4.0" link their licences', async () => {
    renderData({ ...manifest, sources: [source, ...overture] });
    await expect.element(page.getByText('Map data ©')).toBeInTheDocument();
    expect(text()).toContain(
      'Buildings © Overture Maps Foundation, from Microsoft ML Buildings, OpenStreetMap and USGS Lidar under the ODbL and Esri Community Maps under CC BY 4.0.'
    );
    await expect
      .element(page.getByRole('link', { name: 'the ODbL', exact: true }))
      .toHaveAttribute('href', 'https://opendatacommons.org/licenses/odbl/1-0/');
    await expect
      .element(page.getByRole('link', { name: 'CC BY 4.0', exact: true }))
      .toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  });

  it('data: a manifest with no overture: source gives the ODbL-only sentence', async () => {
    renderData(manifest);
    await expect.element(page.getByText('Map data ©')).toBeInTheDocument();
    expect(text()).toContain(ODBL_ONLY);
    await expect
      .element(page.getByRole('link', { name: 'the ODbL', exact: true }))
      .toHaveAttribute('href', 'https://opendatacommons.org/licenses/odbl/1-0/');
  });

  it('data: with no manifest, the fallback lines', async () => {
    renderData(null);
    await expect
      .element(page.getByText('Source list unavailable for this dataset version.'))
      .toBeInTheDocument();
    await expect.element(page.getByText('Dataset version fixture-0.')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
    expect(text()).toContain(ODBL_ONLY);
    await expectNotices();
  });

  it("data: every link that is its cell's whole content is at least 24 px tall", async () => {
    renderData({ ...manifest, sources: [source, ...overture] });
    await expect.element(page.getByRole('link', { name: 'datasf-parcels' })).toBeVisible();
    const whole = [...document.querySelectorAll('td a, li > a')].filter(
      (a) => a.parentElement!.textContent!.trim() === a.textContent!.trim()
    );
    expect(whole.length).toBe(1 + overture.length);
    for (const a of whole) {
      expect(a.getBoundingClientRect().height, a.textContent!).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('AboutUsing', () => {
  it('using: the Painting table holds every SHORTCUTS row; Your plans holds both sentences', async () => {
    render(AboutUsing, { level: 2 });
    const table = page.getByRole('table', { name: 'Painting' });
    await expect.element(table).toBeInTheDocument();
    const rows = [...table.element().querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())
    );
    expect(rows).toEqual(SHORTCUTS.map((s) => [s.keys, s.action]));
    await expect
      .element(page.getByRole('heading', { name: 'Keyboard shortcuts' }))
      .toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Your plans' })).toBeInTheDocument();
    expect(YOUR_PLANS).toEqual([
      "Published plans and policies are public and permanent: anyone with the link can see them, and I can't take them back.",
      'Reopening a saved plan uses the current data, so its totals can change.'
    ]);
    for (const s of YOUR_PLANS) await expect.element(page.getByText(s)).toBeInTheDocument();
  });

  it('using: the Timeline table holds every TIMELINE_SHORTCUTS row', async () => {
    render(AboutUsing, { level: 3 });
    const table = page.getByRole('table', { name: 'Timeline' });
    await expect.element(table).toBeInTheDocument();
    const rows = [...table.element().querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())
    );
    expect(rows).toEqual(TIMELINE_SHORTCUTS.map((s) => [s.keys, s.action]));
    // After the Painting table, in the Keyboard shortcuts section.
    const tables = [...document.querySelectorAll('#about-shortcuts table caption')].map((c) =>
      c.textContent?.trim()
    );
    expect(tables).toEqual(['Painting', 'Timeline']);
  });

  it('using: Levels, an ordered list, then its three notes, word for word', async () => {
    render(AboutUsing, { level: 2 });
    const s = document.getElementById('about-levels')!;
    expect(s.tagName).toBe('SECTION');
    expect(s.querySelector('h3')?.textContent?.trim()).toBe('Levels');
    expect([...s.querySelectorAll('ol > li')].map((li) => li.textContent?.trim())).toEqual([
      'Level 1: paint room for the goal. Winning opens the simulation.',
      'Level 2: play current law to the goal.',
      'Level 3: change permitting, and beat the month you reached at level 2.',
      'Level 4: change zoning too, and beat your month to beat.',
      'Level 5: add the public money on offer, and beat your month to beat.'
    ]);
    expect([...s.querySelectorAll('p')].map((p) => p.textContent?.trim())).toEqual([
      'Levelling up is your choice. Your policies stay, and the clock goes back to today.',
      'A month to beat keeps the data it was earned on. After a data update your policy may reach the goal in another month; the month to beat stays.',
      'A published policy plays in full for everyone, whatever their level.'
    ]);
  });

  it('using: Saved games, word for word, the 12 from MAX_SAVES', async () => {
    render(AboutUsing, { level: 2 });
    const s = document.getElementById('about-saved-games')!;
    expect(s.querySelector('h3')?.textContent?.trim()).toBe('Saved games');
    expect([...s.querySelectorAll('p')].map((p) => p.textContent?.trim())).toEqual([
      `Each saved game has its own level, months to beat, plan and policy. You can keep ${MAX_SAVES}.`,
      'Remix makes a new saved game from a published plan or policy, at your current level.',
      'Games are saved in this browser, and to your account from your first win.'
    ]);
    expect(SAVED_GAMES[0]).toContain('You can keep 12.');
  });

  it('using: the order is Keyboard shortcuts, Levels, Saved games, Your plans', async () => {
    render(AboutUsing, { level: 2 });
    const subs = [...document.querySelectorAll('#about-using h3')].map((h) =>
      h.textContent?.trim()
    );
    expect(subs).toEqual(['Keyboard shortcuts', 'Levels', 'Saved games', 'Your plans']);
  });
});

describe('every part', () => {
  const parts = [
    { part: 'meanings', mount: (level: 2 | 3) => render(AboutMeanings, { level }) },
    {
      part: 'data',
      mount: (level: 2 | 3) => render(AboutData, { level, datasetVersion: 'v', manifest })
    },
    { part: 'using', mount: (level: 2 | 3) => render(AboutUsing, { level }) }
  ] as const;

  it("each part's heading is at the given level and its section carries its ABOUT_ID", async () => {
    expect(PART_HEADING).toEqual({
      meanings: 'What the numbers mean',
      assumptions: 'Assumptions',
      data: 'Data and licences',
      using: 'Using it'
    });
    for (const { part, mount } of parts) {
      for (const level of [2, 3] as const) {
        const r = await mount(level);
        const section = document.getElementById(ABOUT_ID[part]);
        expect(section?.tagName, part).toBe('SECTION');
        const h = section!.querySelector('h1, h2, h3, h4, h5, h6')!;
        expect(h.tagName, `${part} at ${level}`).toBe(`H${level}`);
        expect(h.textContent?.trim()).toBe(PART_HEADING[part]);
        for (const sub of section!.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
          if (sub !== h) expect(sub.tagName, sub.textContent!).toBe(`H${level + 1}`);
        }
        if (part === 'using') {
          const s = document.getElementById(ABOUT_ID.shortcuts)!;
          expect(s.tagName).toBe('SECTION');
          expect(s.querySelector(`h${level + 1}`)?.textContent?.trim()).toBe('Keyboard shortcuts');
        }
        await r.unmount();
      }
    }
  });

  it('no part has a dark: class or a gray, white, black or ink utility', async () => {
    const bad = /(^|:)(dark:|(bg|text|border)-(gray-\d+|white|black|ink\b|ink-))/;
    for (const { part, mount } of parts) {
      const r = await mount(2);
      const els = document.getElementById(ABOUT_ID[part])!.querySelectorAll('*');
      for (const el of [document.getElementById(ABOUT_ID[part])!, ...els]) {
        for (const c of el.classList) expect(bad.test(c), `${part}: ${c}`).toBe(false);
      }
      await r.unmount();
    }
  });
});
