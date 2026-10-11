import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
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

  it('shows the city-data failure with Retry and no map when the manifest failed', async () => {
    await render(Page, {
      props: { data: data({ manifest: null, manifestError: true }), params: {} }
    });
    await expect.element(page.getByText("Couldn't load city data.")).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeInTheDocument();
    expect(document.querySelector('[data-testid="map-root"]')).toBeNull();
  });
});
