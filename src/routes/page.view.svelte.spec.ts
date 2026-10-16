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

const manifest = manifestJson as unknown as Manifest;

function data(m: Manifest = manifest) {
  return {
    plan: emptyPlan('fixture-0'),
    manifest: m,
    fellBack: false,
    manifestError: false,
    datasetVersion: 'fixture-0',
    appRelease: 'dev'
  };
}

const viewButton = () => page.getByRole('button', { name: 'View' });
const stored = () => JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');

describe('/ View menu', () => {
  beforeEach(() => {
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
    // First in the header actions: left of Saved / Publish.
    const slot = document.querySelector('[data-testid="header-actions"]')!;
    expect(slot.firstElementChild?.contains(viewButton().element())).toBe(true);
    expect(stubProps.view).toEqual({ transitStops: true, transitAccess: true });
  });

  it('has no View button without manifest.transit', async () => {
    const { transit: _omit, ...plain } = manifest;
    await render(PageHost, { props: { data: data(plain as Manifest) } });
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeInTheDocument();
    expect(viewButton().elements()).toHaveLength(0);
  });

  it('starts from the stored prefs, and a toggle updates the map and persists', async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ transitStops: false, transitAccess: true }));
    const first = await render(PageHost, { props: { data: data() } });
    expect(stubProps.view).toEqual({ transitStops: false, transitAccess: true });
    await viewButton().click();
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();

    await page.getByRole('checkbox', { name: /Transit capacity/ }).click();
    await expect.poll(() => stubProps.view).toEqual({ transitStops: false, transitAccess: false });
    expect(stored()).toEqual({ transitStops: false, transitAccess: false });

    // A fresh page load reads the persisted value back.
    await first.unmount();
    await render(PageHost, { props: { data: data() } });
    expect(stubProps.view).toEqual({ transitStops: false, transitAccess: false });
  });
});
