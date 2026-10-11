import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import Page from './+page.svelte';

const manifest = manifestJson as unknown as Manifest;

describe('/ shell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an accessible page heading and the map region', async () => {
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
    render(Page, {
      props: { data: { manifest, datasetVersion: 'fixture-0', appRelease: 'dev' }, params: {} }
    });
    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('SF Housing Simulator');
    const region = document.getElementById('map-region');
    expect(region).not.toBeNull();
    await expect
      .element(page.getByRole('region', { name: '3D map of San Francisco' }))
      .toBeInTheDocument();
    expect(region!.querySelector('[data-testid="map-root"]')).not.toBeNull();
  });
});
