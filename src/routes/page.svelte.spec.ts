import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan, serializePlan, type Plan } from '$lib/plan';
import { MSG } from '$lib/brush/messages';
import { COPY, n3, remixedToast } from '$lib/sharing/copy';
import { PLAN_KEY } from '$lib/sharing/storage';
import { replaceStateCalls } from '../test-stubs/app/navigation';
import { page as appPage } from '../test-stubs/app/state';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import Page from './+page.svelte';
import PaintHeaderHost from './test/PaintHeaderHost.svelte';

const manifest = manifestJson as unknown as Manifest;
const plan = emptyPlan('fixture-0');

function data(over: { manifest?: Manifest | null; manifestError?: boolean } = {}) {
  return {
    plan,
    manifest: over.manifest === undefined ? manifest : over.manifest,
    fellBack: false,
    manifestError: over.manifestError ?? false,
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    user: null,
    signInAvailable: true
  };
}

describe('/ editor page', () => {
  beforeEach(async () => {
    // From md the dock is open, so the Paint tab's tools and Undo are on screen.
    await page.viewport(1024, 768);
    // The page spawns the sim worker; a stub keeps these tests about the page shell.
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        postMessage() {}
        terminate() {}
      }
    );
    // No WebGL needed: SimMap takes its fallback path without importing MapLibre.
    const original = HTMLCanvasElement.prototype.getContext;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    appPage.state = {};
    replaceStateCalls.length = 0;
  });

  it('renders the heading, the map region and the Paint dock', async () => {
    await render(Page, { props: { data: data(), params: {} } });
    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('SF Housing Simulator');
    const region = document.getElementById('map-region');
    expect(region).not.toBeNull();
    await expect
      .element(page.getByRole('region', { name: '3D map of San Francisco' }))
      .toBeInTheDocument();
    expect(region!.querySelector('[data-testid="map-root"]')).not.toBeNull();
    await expect
      .element(page.getByRole('region', { name: 'Paint', exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeInTheDocument();
    expect(document.querySelector('.brush-toolbar')).toBeNull();
  });

  it('the header has no Paint button; the dock folds by its own button and opens from the rail', async () => {
    render(PaintHeaderHost, { props: { data: data() } });
    const banner = page.getByRole('banner');
    await expect.element(page.getByRole('region', { name: 'Paint', exact: true })).toBeVisible();
    expect(banner.getByRole('button', { name: 'Paint', exact: true }).elements()).toHaveLength(0);
    expect(document.querySelector('.sfh-dock-panel')).not.toBeNull();

    await page.getByRole('button', { name: 'Collapse Paint' }).click();
    expect(document.querySelector('.sfh-dock-panel')).toBeNull();
    const rail = page.getByRole('button', { name: 'Paint tools' });
    await expect.element(rail).toBeVisible();
    await expect.poll(() => document.activeElement === rail.element()).toBe(true);

    await rail.click();
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeVisible();
    expect(document.querySelector('.sfh-dock-panel')).not.toBeNull();
    // The user opened it: focus moves into the dock, on its selected tab.
    await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('tab');
  });

  it('the header score reads room for homes and its share of the goal, and opens Details', async () => {
    render(PaintHeaderHost, { props: { data: data() } });
    const banner = page.getByRole('banner');
    const score = banner.getByTestId('score-bar');
    await expect.element(score).toHaveTextContent('Room for 0 homes');
    await expect.element(banner.getByTestId('score-detail')).toHaveTextContent('0% of the goal');
    expect(banner.getByRole('meter').elements()).toHaveLength(0);
    await score.click();
    const results = page.getByRole('region', { name: 'Details' });
    await expect
      .element(results.getByText('Paint a height on the map to add homes.'))
      .toBeVisible();
  });

  it('shows the city-data failure with Retry and no map when the manifest failed', async () => {
    await render(Page, {
      props: { data: data({ manifest: null, manifestError: true }), params: {} }
    });
    await expect.element(page.getByText("Couldn't load city data.")).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeInTheDocument();
    expect(document.querySelector('[data-testid="map-root"]')).toBeNull();
  });

  describe('autosave restore (plan-sharing §4.5)', () => {
    const painted = (datasetVersion: string): Plan => ({
      schema: 1,
      datasetVersion,
      ops: [{ id: 's1', kind: 'paint', stories: 6, radiusM: 20, path: [[-122.4193, 37.76013]] }]
    });
    const seed = (plan: Plan) =>
      localStorage.setItem(
        PLAN_KEY,
        JSON.stringify({ v: 1, savedAt: '2026-10-11T00:00:00.000Z', plan: serializePlan(plan) })
      );
    // A fine pointer has no Undo button: the keyboard does it (`page.undo.svelte.spec.ts`, which
    // has a map double for the controller the keys need).
    const noUndoButton = () =>
      expect(page.getByRole('button', { name: /^Undo/ }).elements()).toHaveLength(0);

    it('loads the autosaved plan (no Undo button on a fine pointer), no notice', async () => {
      seed(painted('fixture-0'));
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeVisible();
      noUndoButton();
      // Only a restored plan hides the starting sentence.
      expect(page.getByText(MSG.start).elements()).toHaveLength(0);
      expect(page.getByRole('button', { name: 'Dismiss' }).elements()).toHaveLength(0);
      // The restored plan is not re-written: the autosave's first schedule() is a no-op. A page
      // hide flushes any pending write at once, so nothing pending leaves the record as it was.
      window.dispatchEvent(new Event('pagehide'));
      expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).savedAt).toBe('2026-10-11T00:00:00.000Z');
    });

    it('starts empty with nothing saved (no Undo button)', async () => {
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeVisible();
      noUndoButton();
      await expect.element(page.getByText(MSG.start)).toBeVisible();
    });

    it('shows N1 for a corrupt record and preserves it', async () => {
      localStorage.setItem(PLAN_KEY, '{not json');
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(COPY.n1)).toBeVisible();
      noUndoButton();
      // The corrupt record is not a plan: the page starts empty.
      await expect.element(page.getByText(MSG.start)).toBeVisible();
      const kept = Object.keys(localStorage).filter((k) => k.startsWith('sfhousing:plan:corrupt:'));
      expect(kept).toHaveLength(1);
    });

    it('rebases an older-dataset plan, shows N3 and writes it back', async () => {
      seed(painted('fixture-9'));
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(n3('fixture-9', 'fixture-0'))).toBeVisible();
      const rec = JSON.parse(localStorage.getItem(PLAN_KEY)!);
      expect(JSON.parse(rec.plan).datasetVersion).toBe('fixture-0');
    });

    it('a notice can be dismissed', async () => {
      localStorage.setItem(PLAN_KEY, '{not json');
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(COPY.n1)).toBeVisible();
      await page.getByRole('button', { name: 'Dismiss' }).click();
      await expect.element(page.getByText(COPY.n1)).not.toBeInTheDocument();
    });

    it('Remix hand-off: shows the toast once and clears the history state', async () => {
      seed(painted('fixture-0'));
      appPage.state = { sfhRemix: { from: 'My plan' } };
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(remixedToast('My plan'))).toBeVisible();
      expect(replaceStateCalls).toEqual([{ url: '', state: {} }]);
    });

    it('Remix hand-off with the plan in history state (storage write failed) loads it', async () => {
      appPage.state = {
        sfhRemix: { from: 'abc123', plan: serializePlan(painted('fixture-0')) }
      };
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(remixedToast('abc123'))).toBeVisible();
    });
  });
});
