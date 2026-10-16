// BrushEditor with a stub SimMap handle (a separate file: vi.mock is file-wide, and
// BrushEditor.svelte.spec.ts relies on the real SimMap's no-WebGL fallback).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import type { WorkerLike } from '$lib/sim/client';
import type { SimRequest, SimResponse } from '$lib/sim/protocol';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import BrushEditor from './BrushEditor.svelte';
import { MSG } from './messages';
import { chunkStatus } from './test/sim-map-stub';

vi.mock('$lib/map/SimMap.svelte', async () => import('./test/SimMapStub.svelte'));

const manifest = manifestJson as unknown as Manifest;

interface FakeWorker extends WorkerLike {
  posts: SimRequest[];
  emit(resp: SimResponse): void;
}

function fakeWorker(): FakeWorker {
  const w: FakeWorker = {
    posts: [],
    onmessage: null,
    postMessage(msg) {
      w.posts.push(msg);
    },
    terminate() {},
    emit(resp) {
      w.onmessage?.({ data: resp });
    }
  };
  return w;
}

afterEach(() => {
  vi.restoreAllMocks();
  chunkStatus.clear();
});

describe('BrushEditor worker restart (F-3)', () => {
  it('resets every chunk status the crashed worker set, so no stale error chip remains', async () => {
    const workers: FakeWorker[] = [];
    await render(BrushEditor, {
      props: {
        manifest,
        manifestError: false,
        plan: emptyPlan('fixture-0'),
        currentVersion: 'fixture-0',
        reloadManifest: async () => manifest,
        createWorker: () => {
          const w = fakeWorker();
          workers.push(w);
          return w;
        }
      }
    });
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    workers[0].emit({
      type: 'chunks',
      status: { '50_25': 'error', '50_26': 'loading', '51_25': 'ready' },
      pending: 1,
      failed: ['50_25']
    });
    expect(chunkStatus.get('50_25')).toBe('error');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    workers[0].onerror?.(new ErrorEvent('error', { message: 'boom' }));
    await expect.element(page.getByText(MSG.cityFailed, { exact: true })).toBeInTheDocument();
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    (retry.element() as HTMLElement).click();
    await expect.poll(() => workers.length).toBe(2);

    expect(Object.fromEntries(chunkStatus)).toEqual({
      '50_25': 'ready',
      '50_26': 'ready',
      '51_25': 'ready'
    });
    // The new worker's reports still reach map-view.
    workers[1].emit({ type: 'chunks', status: { '50_25': 'loading' }, pending: 1, failed: [] });
    expect(chunkStatus.get('50_25')).toBe('loading');
  });
});

describe('BrushEditor onmanifest', () => {
  it('reports the manifest SimMap renders: none on a failed load, then the reloaded one', async () => {
    const seen: (Manifest | null)[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render(BrushEditor, {
      props: {
        manifest: null,
        manifestError: true,
        plan: emptyPlan('fixture-0'),
        currentVersion: 'fixture-0',
        reloadManifest: async () => manifest,
        createWorker: fakeWorker,
        onmanifest: (m) => seen.push(m)
      }
    });
    expect(seen).toEqual([null]);
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    (retry.element() as HTMLElement).click();
    await expect.poll(() => seen.at(-1)).toBe(manifest);
  });

  it('reports the initial manifest synchronously, before mount', async () => {
    const seen: (Manifest | null)[] = [];
    await render(BrushEditor, {
      props: {
        manifest,
        manifestError: false,
        plan: emptyPlan('fixture-0'),
        currentVersion: 'fixture-0',
        reloadManifest: async () => manifest,
        createWorker: fakeWorker,
        onmanifest: (m) => seen.push(m)
      }
    });
    expect(seen).toEqual([manifest]);
  });
});
