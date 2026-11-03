// The View menu on the main page (transit spec §6.3): shown only with a transit network, seeded from
// and persisted to `sfhousing:view`, and passed through BrushEditor to the map. A stub SimMap
// records the `view` it receives (a separate file: vi.mock is file-wide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import { stubProps } from '$lib/brush/test/sim-map-stub';
import { VIEW_KEY } from '$lib/view/prefs';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import PageHost from './test/PageHost.svelte';

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
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        postMessage() {}
        terminate() {}
      }
    );
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
