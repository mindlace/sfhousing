// `/`'s keyboard undo (no Undo button on a fine pointer): the restored plan is undone by Ctrl+Z and
// the stroke chip says so. A map double hands the page's BrushController the fake map it needs (a
// separate file: vi.mock is file-wide and page.svelte.spec.ts relies on the real SimMap's fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { serializePlan, type Plan } from '$lib/plan';
import { PLAN_KEY } from '$lib/sharing/storage';
import { homeData } from './test/home-data';
import PageHost from './test/PageHost.svelte';
import PaintHeaderHost from './test/PaintHeaderHost.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/sim-page/SimRoute.svelte', () => import('./test/SimRouteStub.svelte'));

const data = () => homeData();
const painted: Plan = {
  schema: 1,
  datasetVersion: 'fixture-0',
  ops: [{ id: 's1', kind: 'paint', stories: 6, radiusM: 20, path: [[-122.4193, 37.76013]] }]
};
const chip = () => page.getByTestId('brush-announcement');
const ctrlZ = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
/** Ctrl+Z (a no-op until the controller has attached to the map), then the chip's text. */
const undoes = () => (ctrlZ(), chip().element().textContent?.trim());

describe('/ keyboard undo', () => {
  beforeEach(async () => {
    stub.reset();
    stub.map.zoom = 18;
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
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('Ctrl+Z undoes the autosaved plan and the chip says so', async () => {
    localStorage.setItem(
      PLAN_KEY,
      JSON.stringify({ v: 1, savedAt: '2026-10-11T00:00:00.000Z', plan: serializePlan(painted) })
    );
    await render(PageHost, { props: { data: data() } });
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toHaveLength(0);
    await expect.poll(undoes).toBe('Undid paint, 6 stories');
  });

  it('with nothing saved Ctrl+Z says nothing', async () => {
    await render(PageHost, { props: { data: data() } });
    await expect.poll(() => stub.map.listenerCount('moveend')).toBeGreaterThan(0);
    ctrlZ();
    await expect.element(chip()).toHaveTextContent('');
    expect(page.getByTestId('stroke-chip').elements()).toHaveLength(0);
  });

  it('Ctrl+Z on the focused header score undoes too', async () => {
    localStorage.setItem(
      PLAN_KEY,
      JSON.stringify({ v: 1, savedAt: '2026-10-11T00:00:00.000Z', plan: serializePlan(painted) })
    );
    render(PaintHeaderHost, { props: { data: data() } });
    const score = page.getByRole('banner').getByTestId('score-bar').element() as HTMLElement;
    score.focus();
    // The controller has attached to the map: the key now reaches it, and one press is enough.
    await expect.poll(() => stub.map.listenerCount('moveend')).toBeGreaterThan(0);
    score.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await expect.element(chip()).toHaveTextContent('Undid paint, 6 stories');
  });
});
