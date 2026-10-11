import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { parseManifest } from '$lib/data/manifest';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';

describe('SimMap SSR (C2)', () => {
  it('renders the static frame with no map library markup', () => {
    const { body } = render(SimMap, { props: { manifest: parseManifest(manifestJson) } });
    expect(body).toContain('data-testid="map-root"');
    expect(body).toContain('data-state="loading"');
    expect(body).toContain('aria-label="3D map of San Francisco"');
    expect(body).toContain('role="region"');
    expect(body).toContain('Loading map…');
    expect(body).toContain('The map needs JavaScript and WebGL 2.');
    expect(body).not.toContain('maplibregl');
  });
});
