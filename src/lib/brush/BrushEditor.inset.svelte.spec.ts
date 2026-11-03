// The map's bottom inset: the dock sheet's height above the score bar below md, 0 from md, and the
// scoreboard sheet's override (setSheetInset), with a stub SimMap handle (a separate file: vi.mock
// is file-wide, and BrushEditor.svelte.spec.ts relies on the real SimMap's no-WebGL fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  // The score bar's height below md, as the Scoreboard publishes it until the header score lands.
  document.documentElement.style.setProperty('--scorebar-h', '56px');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--scorebar-h');
});

describe('BrushEditor map inset', () => {
  it('below md: the sheet over the score bar; setSheetInset overrides it until null', async () => {
    await page.viewport(375, 700);
    const setBottomInset = vi.spyOn(stubHandle, 'setBottomInset');
    const lastInset = () => setBottomInset.mock.lastCall?.[0];
    const screen = await setup();
    await expect.poll(sheet).not.toBeNull();
    // Closed, the sheet is its handle, sitting on the score bar.
    await expect.poll(sheetHeight).toBeGreaterThanOrEqual(44);
    const handleH = sheetHeight();
    await expect.poll(lastInset).toBe(handleH + 56);
    const region = document.getElementById('map-region')!.getBoundingClientRect();
    expect(sheet()!.getBoundingClientRect().bottom).toBeCloseTo(region.bottom - 56, 0);

    // Opened, the inset follows the sheet.
    await page.getByTestId('dock-handle').click();
    await expect.poll(sheetHeight).toBeGreaterThan(handleH);
    await expect.poll(lastInset).toBe(sheetHeight() + 56);

    // The scoreboard's own sheet overrides it, through a resize, until it closes (null).
    screen.component.editor()!.setSheetInset(400);
    expect(lastInset()).toBe(400);
    await page.getByTestId('dock-handle').click();
    await expect.poll(sheetHeight).toBe(handleH);
    expect(lastInset()).toBe(400);
    screen.component.editor()!.setSheetInset(null);
    expect(lastInset()).toBe(handleH + 56);
  });

  it('from md the dock sits beside the map: no inset', async () => {
    await page.viewport(1024, 768);
    document.documentElement.style.removeProperty('--scorebar-h');
    const setBottomInset = vi.spyOn(stubHandle, 'setBottomInset');
    setup();
    await expect.poll(() => document.querySelector('.sfh-dock-panel')).not.toBeNull();
    await expect.poll(() => setBottomInset.mock.calls.length).toBeGreaterThan(0);
    expect(setBottomInset.mock.lastCall?.[0]).toBe(0);
  });
});
