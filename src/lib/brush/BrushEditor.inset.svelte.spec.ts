// The map's bottom inset: below md the dock sheet's height (its handle while closed), with the
// sheet at the map region's bottom (no bar under it on `/`: the score is in the header); 0 from md.
// A stub SimMap handle records it (a separate file: vi.mock is file-wide, and
// BrushEditor.svelte.spec.ts relies on the real SimMap's no-WebGL fallback).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import type { WorkerLike } from '$lib/sim/client';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import BrushEditorHost from './test/BrushEditorHost.svelte';
import { stubHandle } from './test/sim-map-stub';

vi.mock('$lib/map/SimMap.svelte', async () => import('./test/SimMapStub.svelte'));

const manifest = manifestJson as unknown as Manifest;

const idleWorker = (): WorkerLike => ({
  onmessage: null,
  postMessage() {},
  terminate() {}
});

const sheet = () => document.querySelector<HTMLElement>('.sfh-dock-sheet');
const sheetHeight = () => sheet()?.getBoundingClientRect().height ?? -1;

async function setup() {
  return render(BrushEditorHost, {
    props: {
      manifest,
      manifestError: false,
      plan: emptyPlan('fixture-0'),
      currentVersion: 'fixture-0',
      reloadManifest: async () => manifest,
      createWorker: idleWorker
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BrushEditor map inset', () => {
  it("below md: the sheet sits at the region's bottom and the inset follows its height", async () => {
    await page.viewport(375, 700);
    const setBottomInset = vi.spyOn(stubHandle, 'setBottomInset');
    const lastInset = () => setBottomInset.mock.lastCall?.[0];
    await setup();
    await expect.poll(sheet).not.toBeNull();
    // Closed, the sheet is its handle, on the region's bottom edge.
    await expect.poll(sheetHeight).toBeGreaterThanOrEqual(44);
    const handleH = sheetHeight();
    await expect.poll(lastInset).toBe(handleH);
    const region = document.getElementById('map-region')!.getBoundingClientRect();
    expect(sheet()!.getBoundingClientRect().bottom).toBeCloseTo(region.bottom, 0);
    expect(getComputedStyle(sheet()!).bottom).toBe('0px');

    // Opened, the inset follows the sheet; closed again, the handle.
    await page.getByTestId('dock-handle').click();
    await expect.poll(sheetHeight).toBeGreaterThan(handleH);
    await expect.poll(lastInset).toBe(sheetHeight());
    await page.getByTestId('dock-handle').click();
    await expect.poll(sheetHeight).toBe(handleH);
    await expect.poll(lastInset).toBe(handleH);
  });

  it('from md the dock sits beside the map: no inset', async () => {
    await page.viewport(1024, 768);
    const setBottomInset = vi.spyOn(stubHandle, 'setBottomInset');
    setup();
    await expect.poll(() => document.querySelector('.sfh-dock-panel')).not.toBeNull();
    await expect.poll(() => setBottomInset.mock.calls.length).toBeGreaterThan(0);
    expect(setBottomInset.mock.lastCall?.[0]).toBe(0);
  });
});
