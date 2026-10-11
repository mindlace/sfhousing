// C1 lives in its own file: vi.mock is file-wide, and the other SimMap tests need real MapLibre.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';

const flags = vi.hoisted(() => ({ imported: false }));
vi.mock('maplibre-gl', () => {
  flags.imported = true;
  return {};
});

const BODY =
  'Your browser or device has WebGL turned off or unavailable. You can still read the scoreboard ' +
  'and share links. Try a current version of Firefox, Chrome, Safari or Edge with hardware ' +
  'acceleration enabled.';

describe('SimMap without WebGL 2 (C1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the fallback panel, fires mapunsupported and never imports maplibre', async () => {
    const original = HTMLCanvasElement.prototype.getContext;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const events: Event[] = [];
    host.addEventListener('mapunsupported', (e) => events.push(e));

    render(SimMap, { target: host, props: { manifest: manifestJson as unknown as Manifest } });

    const alert = page.getByRole('alert');
    await expect.element(alert).toBeVisible();
    await expect
      .element(alert.getByRole('heading', { level: 2 }))
      .toHaveTextContent('This map needs WebGL 2');
    await expect.element(alert).toHaveTextContent(BODY);
    const root = host.querySelector('[data-testid="map-root"]')!;
    expect(root.getAttribute('data-state')).toBe('unsupported');
    expect(events).toHaveLength(1);
    expect(events[0].bubbles).toBe(true);
    expect(flags.imported).toBe(false);
    host.remove();
  });
});
