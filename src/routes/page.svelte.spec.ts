import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan, serializePlan, type Plan } from '$lib/plan';
import { COPY, n3, remixedToast } from '$lib/sharing/copy';
import { PLAN_KEY } from '$lib/sharing/storage';
import { replaceStateCalls } from '../test-stubs/app/navigation';
import { page as appPage } from '../test-stubs/app/state';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import Page from './+page.svelte';

const manifest = manifestJson as unknown as Manifest;
const plan = emptyPlan('fixture-0');

function data(over: { manifest?: Manifest | null; manifestError?: boolean } = {}) {
  return {
    plan,
    manifest: over.manifest === undefined ? manifest : over.manifest,
    fellBack: false,
    manifestError: over.manifestError ?? false,
    datasetVersion: 'fixture-0',
    appRelease: 'dev'
  };
}

describe('/ editor page', () => {
  beforeEach(() => {
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

  it('renders the heading, the map region and the brush toolbar', async () => {
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
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeInTheDocument();
  });

  it('renders the scoreboard region with the empty state', async () => {
    await render(Page, { props: { data: data(), params: {} } });
    await expect
      .element(page.getByRole('region', { name: 'Housing scoreboard' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('Paint a height on the map to add homes.')).toBeVisible();
  });

  it('shows the city-data failure with Retry and no map when the manifest failed', async () => {
    await render(Page, {
      props: { data: data({ manifest: null, manifestError: true }), params: {} }
    });
    await expect.element(page.getByText("Couldn't load city data.")).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeInTheDocument();
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
    const undo = () => page.getByRole('button', { name: /^Undo/ });

    it('loads the autosaved plan into the editor (Undo enabled), no notice', async () => {
      seed(painted('fixture-0'));
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(undo()).toBeEnabled();
      expect(page.getByRole('button', { name: 'Dismiss' }).elements()).toHaveLength(0);
      // The restored plan is not re-written: the autosave's first schedule() is a no-op.
      await new Promise((r) => setTimeout(r, 700));
      expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).savedAt).toBe('2026-10-11T00:00:00.000Z');
    });

    it('starts empty with nothing saved (Undo disabled)', async () => {
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(undo()).toBeDisabled();
    });

    it('shows N1 for a corrupt record and preserves it', async () => {
      localStorage.setItem(PLAN_KEY, '{not json');
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(COPY.n1)).toBeVisible();
      await expect.element(undo()).toBeDisabled();
      const kept = Object.keys(localStorage).filter((k) => k.startsWith('sfhousing:plan:corrupt:'));
      expect(kept).toHaveLength(1);
    });

    it('rebases an older-dataset plan, shows N3 and writes it back', async () => {
      seed(painted('fixture-9'));
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(n3('fixture-9', 'fixture-0'))).toBeVisible();
      await expect.element(undo()).toBeEnabled();
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
      appPage.state = { sfhRemix: { from: 'My plan' } } as App.PageState;
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(remixedToast('My plan'))).toBeVisible();
      expect(replaceStateCalls).toEqual([{ url: '', state: {} }]);
      await expect.element(undo()).toBeEnabled();
    });

    it('Remix hand-off with the plan in history state (storage write failed) loads it', async () => {
      appPage.state = {
        sfhRemix: { from: 'abc123', plan: serializePlan(painted('fixture-0')) }
      } as App.PageState;
      await render(Page, { props: { data: data(), params: {} } });
      await expect.element(page.getByText(remixedToast('abc123'))).toBeVisible();
      await expect.element(undo()).toBeEnabled();
    });
  });
});
