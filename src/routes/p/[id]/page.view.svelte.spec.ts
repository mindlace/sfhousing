// The View menu on the shared-plan page (transit spec §6.3): the viewer's own `sfhousing:view`
// prefs apply here as on `/`, and View shows only when the rendered manifest has a transit network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import { stubProps } from '$lib/brush/test/sim-map-stub';
import { VIEW_KEY } from '$lib/view/prefs';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import PageHost from './test/PageHost.svelte';

vi.mock('$lib/map/SimMap.svelte', async () => import('$lib/brush/test/SimMapStub.svelte'));

const manifest = manifestJson as unknown as Manifest;

function data(m: Manifest = manifest) {
  return {
    id: 'abc123',
    plan: emptyPlan('fixture-0'),
    createdAt: '2026-10-01T00:00:00.000Z',
    currentDatasetVersion: 'fixture-0',
    datasetNotice: 'none' as const,
    manifest: m,
    fellBack: false,
    manifestError: false,
    datasetVersion: 'fixture-0',
    appRelease: 'dev'
  };
}

const viewButton = () => page.getByRole('button', { name: 'View' });
const stored = () => JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');

describe('/p/[id] View menu', () => {
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

  it('honours the stored prefs, and a toggle updates the map and persists', async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ transitStops: false, transitAccess: true }));
    await render(PageHost, { props: { data: data() } });
    expect(stubProps.view).toEqual({ transitStops: false, transitAccess: true });
    await viewButton().click();
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'Transit stops' }).click();
    await expect.poll(() => stubProps.view).toEqual({ transitStops: true, transitAccess: true });
    expect(stored()).toEqual({ transitStops: true, transitAccess: true });
  });

  it('has no View button without manifest.transit', async () => {
    const { transit: _omit, ...plain } = manifest;
    await render(PageHost, { props: { data: data(plain as Manifest) } });
    await expect.element(page.getByRole('heading', { name: 'Shared plan' })).toBeInTheDocument();
    expect(viewButton().elements()).toHaveLength(0);
  });
});
