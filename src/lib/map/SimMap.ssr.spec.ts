import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { parseManifest } from '$lib/data/manifest';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { TOKENS } from './palette';

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

  it('with no theme prop, the frame follows prefers-color-scheme through CSS defaults (F8)', () => {
    const { head, body } = render(SimMap, { props: { manifest: parseManifest(manifestJson) } });
    const css = head.replace(/\s+/g, ' ');
    const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    expect(dark).not.toBe('');
    expect(css).toContain(`--map-land: ${TOKENS.light.land}`);
    expect(dark).toContain(`--map-land: ${TOKENS.dark.land}`);
    expect(dark).toContain(`--map-label: ${TOKENS.dark.label}`);
    // No inline token vars to override the media query before JS resolves a theme.
    const style = /data-testid="map-root"[^>]*style="([^"]*)"/.exec(body)?.[1] ?? body;
    expect(style).not.toContain('--map-land');
  });

  it('an explicit theme prop sets the tokens inline', () => {
    const { body } = render(SimMap, {
      props: { manifest: parseManifest(manifestJson), theme: 'dark' }
    });
    expect(body).toContain(`--map-land: ${TOKENS.dark.land}`);
  });
});
