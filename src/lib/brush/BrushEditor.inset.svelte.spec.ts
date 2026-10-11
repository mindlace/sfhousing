// The sheet-inset override (setSheetInset), with a stub SimMap handle (a separate file: vi.mock is
// file-wide, and BrushEditor.svelte.spec.ts relies on the real SimMap's no-WebGL fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import type { WorkerLike } from '$lib/sim/client';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import BrushEditor from './BrushEditor.svelte';
import { stubHandle } from './test/sim-map-stub';

vi.mock('$lib/map/SimMap.svelte', async () => import('./test/SimMapStub.svelte'));

const manifest = manifestJson as unknown as Manifest;

const idleWorker = (): WorkerLike => ({
  onmessage: null,
  postMessage() {},
  terminate() {}
});

/** A narrow viewport whose media-query `change` listeners the test can fire. */
function stubNarrowViewport() {
  const listeners = new Set<() => void>();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () =>
      ({
        matches: true,
        addEventListener: (_: string, cb: () => void) => void listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => void listeners.delete(cb)
      }) as unknown as MediaQueryList
  );
  return { fireChange: () => listeners.forEach((cb) => cb()) };
}

beforeEach(() => {
  document.documentElement.style.setProperty('--scorebar-h', '56px');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--scorebar-h');
});

describe('BrushEditor.setSheetInset', () => {
  it('overrides the computed inset, survives a media change, and null re-reads --scorebar-h', async () => {
    const mq = stubNarrowViewport();
    const setBottomInset = vi.spyOn(stubHandle, 'setBottomInset');
    const screen = await render(BrushEditor, {
      props: {
        manifest,
        manifestError: false,
        plan: emptyPlan('fixture-0'),
        currentVersion: 'fixture-0',
        reloadManifest: async () => manifest,
        createWorker: idleWorker
      }
    });
    await expect.poll(() => setBottomInset.mock.calls.length).toBeGreaterThan(0);
    expect(setBottomInset).toHaveBeenLastCalledWith(112); // 56 (--brushbar-h) + 56 (--scorebar-h)

    screen.component.setSheetInset(400);
    expect(setBottomInset).toHaveBeenLastCalledWith(400);

    mq.fireChange();
    expect(setBottomInset).toHaveBeenLastCalledWith(400);

    document.documentElement.style.setProperty('--scorebar-h', '0px');
    screen.component.setSheetInset(null);
    expect(setBottomInset).toHaveBeenLastCalledWith(56);
  });
});
