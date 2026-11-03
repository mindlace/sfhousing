// The View menu on the main page (transit spec §6.3): shown only with a transit network, seeded from
// and persisted to `sfhousing:view`, and passed through BrushEditor to the map. A stub SimMap
// records the `view` it receives (a separate file: vi.mock is file-wide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import { stubProps } from '$lib/brush/test/sim-map-stub';
import { meterValueText, primaryTarget } from '$lib/scoreboard/view';
import { VIEW_KEY } from '$lib/view/prefs';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import PageHost from './test/PageHost.svelte';
import { PageWorker, pageWorkers, scoreDiff, scoreOf } from './test/page-worker';

vi.mock('$lib/map/SimMap.svelte', async () => import('$lib/brush/test/SimMapStub.svelte'));
// Retry after a failed manifest load reloads it through here.
vi.mock('$lib/sim/manifest', async () => ({
  loadManifest: async () => ({
    manifest: (await import('../../e2e/fixtures/data/fixture-0/manifest.json')).default,
    fellBack: false
  })
}));

const manifest = manifestJson as unknown as Manifest;

function data(m: Manifest | null = manifest) {
  return {
    plan: emptyPlan('fixture-0'),
    manifest: m,
    fellBack: false,
    manifestError: m === null,
    datasetVersion: 'fixture-0',
    appRelease: 'dev'
  };
}

const viewButton = () => page.getByRole('button', { name: 'View' });
const stored = () => JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');

describe('/ View menu', () => {
  beforeEach(async () => {
    // From md the dock is open, so the Paint tab's tools are on screen.
    await page.viewport(1024, 768);
    pageWorkers.length = 0;
    vi.stubGlobal('Worker', PageWorker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    stubProps.view = undefined;
  });

  it('shows View in the header and passes the default view to the map', async () => {
    await render(PageHost, { props: { data: data() } });
    await expect.element(viewButton()).toBeInTheDocument();
    // In the header actions after Paint, left of Publish.
    const slot = document.querySelector('[data-testid="header-actions"]')!;
    const items = [...slot.children];
    const at = (el: Element) => items.findIndex((c) => c.contains(el));
    const paint = page.getByRole('button', { name: 'Paint', exact: true });
    expect(at(paint.element())).toBe(0);
    expect(at(viewButton().element())).toBe(1);
    expect(at(page.getByRole('button', { name: /Publish/ }).element())).toBe(2);
    expect(stubProps.view).toEqual({
      transitStops: false,
      transitAccess: true,
      heightLimits: true
    });
  });

  it('has no View button without manifest.transit', async () => {
    const { transit: _omit, ...plain } = manifest;
    await render(PageHost, { props: { data: data(plain as Manifest) } });
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeInTheDocument();
    expect(viewButton().elements()).toHaveLength(0);
  });

  it('starts from the stored prefs, and a toggle updates the map and persists', async () => {
    // /sim's heightLimits: / never shows it, and writes back the value it read.
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ transitStops: false, transitAccess: true, heightLimits: false })
    );
    const first = await render(PageHost, { props: { data: data() } });
    expect(stubProps.view).toEqual({
      transitStops: false,
      transitAccess: true,
      heightLimits: false
    });
    expect(page.getByRole('checkbox', { name: 'Zoning height limits' }).query()).toBeNull();
    await viewButton().click();
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();

    await page.getByRole('checkbox', { name: /Transit capacity/ }).click();
    await expect
      .poll(() => stubProps.view)
      .toEqual({ transitStops: false, transitAccess: false, heightLimits: false });
    expect(stored()).toEqual({ transitStops: false, transitAccess: false, heightLimits: false });

    // A fresh page load reads the persisted value back.
    await first.unmount();
    await render(PageHost, { props: { data: data() } });
    expect(stubProps.view).toEqual({
      transitStops: false,
      transitAccess: false,
      heightLimits: false
    });
  });

  it('gates View on the manifest the map renders: a reload after a failed load brings it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render(PageHost, { props: { data: data(null) } });
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect.element(retry).toBeInTheDocument();
    expect(viewButton().elements()).toHaveLength(0);
    (retry.element() as HTMLElement).click();
    await expect.element(viewButton()).toBeInTheDocument();
  });
});

describe('/ score: the header score and the Results face', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
    pageWorkers.length = 0;
    vi.stubGlobal('Worker', PageWorker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const pinned = () => page.getByTestId('header-pinned');
  const scoreButton = () => page.getByTestId('score-bar');
  const results = () => page.getByRole('region', { name: 'Results' });

  it("the header score shows the net homes and the RHNA bar; pressing it shows Results with the scoreboard's content and a Paint button that flips back", async () => {
    await render(PageHost, { props: { data: data() } });
    // Before the worker's first score: the empty score.
    await expect.element(scoreButton()).toHaveTextContent('0 homes added');
    await expect.poll(() => pageWorkers.length).toBe(1);
    const w = pageWorkers[0];
    w.ready();
    const s = scoreOf(1234);
    w.emit(scoreDiff(s));
    await expect.element(scoreButton()).toHaveTextContent('1,234 homes added');
    const meter = pinned().getByRole('meter');
    await expect
      .element(meter)
      .toHaveAttribute('aria-valuetext', meterValueText(primaryTarget(s)!));
    // A painted plan has no FZP comparison: no "vs FZP" delta.
    expect(document.querySelector('[data-testid="score-delta"]')).toBeNull();
    // It controls the Paint dock, which is on its Paint tab.
    const dock = page.getByRole('region', { name: 'Paint', exact: true });
    expect(scoreButton().element().getAttribute('aria-controls')).toBe(dock.element().id);
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'false');
    expect(results().elements()).toHaveLength(0);

    await scoreButton().click();
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(results().getByTestId('score-net')).toHaveTextContent('1,234');
    await expect
      .element(results().getByText('Theoretical max buildout', { exact: true }))
      .toBeVisible();
    await expect.element(results().getByTestId('target-rhna')).toBeVisible();
    await expect.element(results().getByText('By neighborhood')).toBeVisible();
    await expect.element(results().getByText('What does this number mean?')).toBeVisible();
    expect(page.getByRole('radiogroup', { name: 'Brush tool' }).elements()).toHaveLength(0);
    const flip = page.getByRole('button', { name: 'Back to painting' });
    await expect.element(flip).toHaveTextContent('Paint');

    await flip.click();
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeVisible();
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'false');
    expect(results().elements()).toHaveLength(0);

    // The score toggles: Results, then the Paint tab again.
    await scoreButton().click();
    await expect.element(results()).toBeVisible();
    await scoreButton().click();
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeVisible();

    // Folded to the rail, the score opens the dock on Results, and focus moves in (as on /sim).
    await page.getByRole('button', { name: 'Paint', exact: true }).click();
    await expect.element(page.getByTestId('dock-rail')).toBeVisible();
    await scoreButton().click();
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(results().getByTestId('score-net')).toHaveTextContent('1,234');
    await expect.poll(() => document.activeElement).toBe(flip.element());
  });

  it("Results' Retry for failed parcel areas asks the worker again", async () => {
    await render(PageHost, { props: { data: data() } });
    await expect.poll(() => pageWorkers.length).toBe(1);
    const w = pageWorkers[0];
    w.ready();
    w.emit({ type: 'chunks', status: { a: 'error' }, pending: 0, failed: ['a'] });
    await scoreButton().click();
    const retry = results().getByRole('button', { name: 'Retry' });
    await expect.element(retry).toBeVisible();
    await retry.click();
    expect(w.allOf('retryChunks')).toHaveLength(1);
  });

  it('there is no Housing scoreboard region', async () => {
    await render(PageHost, { props: { data: data() } });
    await expect.element(scoreButton()).toBeInTheDocument();
    expect(page.getByRole('region', { name: 'Housing scoreboard' }).elements()).toHaveLength(0);
    expect(document.querySelector('.sfh-scoreboard, [data-testid="scorebar-text"]')).toBeNull();
    // One score on the page: the header's.
    expect(page.getByTestId('score-live').elements()).toHaveLength(1);
  });
});
