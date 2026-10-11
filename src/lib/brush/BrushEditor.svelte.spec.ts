import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import type { Manifest } from '$lib/data/manifest';
import type { GeneratedUpdate } from '$lib/map/types';
import { emptyPlan, type Plan } from '$lib/plan';
import type { Score } from '$lib/scoreboard';
import type { WorkerLike } from '$lib/sim/client';
import type { SimRequest, SimResponse } from '$lib/sim/protocol';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import BrushEditor from './BrushEditor.svelte';
import type { Editor } from './editor.svelte';
import { MSG } from './messages';

const manifest = manifestJson as unknown as Manifest;
const plan = emptyPlan('fixture-0');

interface FakeWorker extends WorkerLike {
  posts: SimRequest[];
  terminated: boolean;
  emit(resp: SimResponse): void;
}

function fakeWorker(): FakeWorker {
  const w: FakeWorker = {
    posts: [],
    terminated: false,
    onmessage: null,
    postMessage(msg) {
      w.posts.push(msg);
    },
    terminate() {
      w.terminated = true;
    },
    emit(resp) {
      w.onmessage?.({ data: resp });
    }
  };
  return w;
}

/** No WebGL 2: SimMap takes its fallback path (no handle), so these tests see only the wiring. */
function stubNoWebGL2() {
  const original = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    if (type === 'webgl2') return null;
    return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
  } as typeof original);
}

interface SetupOpts {
  manifest?: Manifest | null;
  manifestError?: boolean;
  readOnly?: boolean;
  reloadManifest?: () => Promise<Manifest>;
}

async function setup(opts: SetupOpts = {}) {
  const workers: FakeWorker[] = [];
  const createWorker = vi.fn(() => {
    const w = fakeWorker();
    workers.push(w);
    return w;
  });
  const reloadManifest = vi.fn(opts.reloadManifest ?? (async () => manifest));
  const onscore = vi.fn();
  const editors: Editor[] = [];
  const oneditor = vi.fn((e: Editor) => void editors.push(e));
  const screen = await render(BrushEditor, {
    props: {
      manifest: opts.manifest === undefined ? manifest : opts.manifest,
      manifestError: opts.manifestError ?? false,
      plan,
      currentVersion: 'fixture-0',
      readOnly: opts.readOnly,
      reloadManifest,
      onscore,
      oneditor,
      createWorker
    }
  });
  const posts = (type: SimRequest['type'], i = workers.length - 1) =>
    workers[i].posts.filter((p) => p.type === type);
  return { workers, createWorker, reloadManifest, onscore, oneditor, editors, screen, posts };
}

const status = (text: string) => page.getByText(text, { exact: true });
const retryButton = () => page.getByRole('button', { name: 'Retry', exact: true });
/** DOM click: the WebGL fallback overlay may sit above the toolbar at desktop widths. */
const click = async (loc: ReturnType<typeof page.getByRole>) =>
  (loc.element() as HTMLElement).click();

const diff = (rev: number): SimResponse => ({
  type: 'diff',
  rev,
  phase: 'load',
  render: { revision: 0 } as GeneratedUpdate,
  complete: true,
  score: { total: 1 } as unknown as Score
});

beforeEach(() => {
  stubNoWebGL2();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BrushEditor wiring', () => {
  it('spawns a worker and posts init with the manifest', async () => {
    const { workers, posts } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    expect(posts('init')).toEqual([{ type: 'init', rev: 1, manifest, mode: 'max' }]);
    await expect.element(status(MSG.loadingCity)).toBeInTheDocument();
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeDisabled();
  });

  it('on ready, loads the editor plan and enables Paint', async () => {
    const { workers, posts } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    expect(posts('load')).toEqual([{ type: 'load', rev: 2, plan }]);
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeEnabled();
    await expect.element(status(MSG.loadingCity)).not.toBeInTheDocument();
  });

  it('forwards each diff score to onscore', async () => {
    const { workers, onscore } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    workers[0].emit(diff(2));
    expect(onscore).toHaveBeenCalledWith({ total: 1 });
  });

  it('shows the failed status on error manifest-invalid, and Retry reloads and re-inits', async () => {
    const { workers, reloadManifest, posts } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    workers[0].emit({ type: 'error', rev: 1, code: 'manifest-invalid', message: 'bad' });
    await expect.element(status(MSG.cityFailed)).toBeInTheDocument();

    await click(retryButton());
    await expect.poll(() => posts('init').length).toBe(2);
    expect(reloadManifest).toHaveBeenCalledTimes(1);
    expect(posts('init')[1]).toMatchObject({ type: 'init', manifest });
    await expect.element(status(MSG.loadingCity)).toBeInTheDocument();
  });

  it('a same-version reload keeps the mounted manifest object (no SimMap remount)', async () => {
    const clone = structuredClone(manifest);
    const { workers, reloadManifest, posts } = await setup({ reloadManifest: async () => clone });
    await expect.poll(() => workers.length).toBe(1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    workers[0].emit({ type: 'error', rev: 1, code: 'manifest-invalid', message: 'bad' });
    await expect.element(retryButton()).toBeInTheDocument();
    await click(retryButton());
    await expect.poll(() => posts('init').length).toBe(2);
    expect(reloadManifest).toHaveBeenCalledTimes(1);
    const init = posts('init')[1] as Extract<SimRequest, { type: 'init' }>;
    expect(init.manifest).toBe(manifest);
  });

  it('a Retry whose reload rejects returns to the failed status', async () => {
    const { workers } = await setup({
      reloadManifest: async () => {
        throw new Error('offline');
      }
    });
    await expect.poll(() => workers.length).toBe(1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    workers[0].emit({ type: 'error', rev: 1, code: 'manifest-invalid', message: 'bad' });
    await expect.element(retryButton()).toBeInTheDocument();
    await click(retryButton());
    await expect.element(status(MSG.cityFailed)).toBeInTheDocument();
    await expect.element(retryButton()).toBeInTheDocument();
  });

  it('shows Loading parcels… while chunks are pending', async () => {
    const { workers } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    workers[0].emit({ type: 'chunks', status: { a: 'loading' }, pending: 1, failed: [] });
    await expect.element(status(MSG.loadingParcels)).toBeInTheDocument();
    workers[0].emit({ type: 'chunks', status: { a: 'ready' }, pending: 0, failed: [] });
    await expect.element(status(MSG.loadingParcels)).not.toBeInTheDocument();
  });

  it('terminates the worker on unmount', async () => {
    const { workers, screen } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    await screen.unmount();
    expect(workers[0].terminated).toBe(true);
  });
});

describe('BrushEditor manifest failure', () => {
  it('starts failed with no map and no init, and Retry loads the manifest then inits', async () => {
    const { workers, reloadManifest, posts } = await setup({ manifest: null, manifestError: true });
    await expect.poll(() => workers.length).toBe(1);
    expect(posts('init')).toEqual([]);
    await expect.element(status(MSG.cityFailed)).toBeInTheDocument();
    expect(document.querySelector('[data-testid="map-root"]')).toBeNull();

    await click(retryButton());
    await expect.poll(() => posts('init').length).toBe(1);
    expect(reloadManifest).toHaveBeenCalledTimes(1);
    await expect
      .element(page.getByRole('region', { name: '3D map of San Francisco' }))
      .toBeInTheDocument();
  });

  it('read-only: the editor itself shows the failed status and Retry', async () => {
    const { workers, reloadManifest, posts } = await setup({
      manifest: null,
      manifestError: true,
      readOnly: true
    });
    await expect.poll(() => workers.length).toBe(1);
    await expect.element(status(MSG.readOnly)).toBeInTheDocument();
    await expect.element(status(MSG.cityFailed)).toBeInTheDocument();
    await click(retryButton());
    await expect.poll(() => posts('init').length).toBe(1);
    expect(reloadManifest).toHaveBeenCalledTimes(1);
  });
});

describe('BrushEditor worker crash', () => {
  it('fails on a crash; Retry spawns a fresh worker and re-inits with the same manifest', async () => {
    const { workers, createWorker, reloadManifest, posts } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    workers[0].onerror?.(new ErrorEvent('error', { message: 'boom' }));
    await expect.element(status(MSG.cityFailed)).toBeInTheDocument();
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeDisabled();

    await click(retryButton());
    await expect.poll(() => createWorker.mock.calls.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    expect(reloadManifest).not.toHaveBeenCalled();
    expect(posts('init', 1)).toEqual([{ type: 'init', rev: 3, manifest, mode: 'max' }]);

    workers[1].emit({ type: 'ready', rev: 3, datasetVersion: 'fixture-0', chunkCount: 4 });
    expect(posts('load', 1)).toEqual([{ type: 'load', rev: 4, plan }]);
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeEnabled();
  });
});

describe('BrushEditor exposes the Editor; Editor.load drives the worker', () => {
  const p2: Plan = {
    schema: 1,
    datasetVersion: 'fixture-0',
    ops: [{ kind: 'erase', radiusM: 30, path: [[-122.4187, 37.76014]], id: 'abcdefghijk1' }]
  };
  const ready = (w: FakeWorker) =>
    w.emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
  const radios = () => [...document.querySelectorAll('[role="radio"]')].map((r) => r.textContent);

  it('fires oneditor once during setup, with the same editor getEditor() returns', async () => {
    const { oneditor, editors, screen } = await setup();
    expect(oneditor).toHaveBeenCalledTimes(1);
    expect(screen.component.getEditor()).toBe(editors[0]);
    expect(editors[0].plan).toBe(plan);
  });

  it('a load after ready posts a load with the new plan', async () => {
    const { workers, editors, posts } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    ready(workers[0]);
    expect(posts('load')).toEqual([{ type: 'load', rev: 2, plan }]);
    editors[0].load(p2);
    expect(posts('load')).toEqual([
      { type: 'load', rev: 2, plan },
      { type: 'load', rev: 3, plan: p2 }
    ]);
    expect(editors[0].plan).toBe(p2);
  });

  it('a load before ready posts nothing extra; ready sends one load with the latest plan', async () => {
    const { workers, editors, posts } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    editors[0].load(p2);
    expect(posts('load')).toEqual([]);
    ready(workers[0]);
    expect(posts('load')).toEqual([{ type: 'load', rev: 2, plan: p2 }]);
  });

  it('a read-only load shows the read-only toolbar and refuses commits; an editable load restores it', async () => {
    const { workers, editors } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    ready(workers[0]);
    const ed = editors[0];
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeEnabled();

    ed.load(p2, { readOnly: true });
    await expect.element(status(MSG.readOnly)).toBeInTheDocument();
    await expect.element(page.getByRole('radio', { name: 'Paint' })).not.toBeInTheDocument();
    expect(radios()).toHaveLength(1);
    await expect
      .element(page.getByRole('radio', { name: 'Move' }))
      .toHaveAttribute('aria-checked', 'true');
    expect(ed.readOnly).toBe(true);
    expect(ed.commit(p2.ops[0])).toEqual({ ok: false, reason: 'read-only' });

    ed.load(p2, { readOnly: false });
    await expect.element(status(MSG.readOnly)).not.toBeInTheDocument();
    const fine = matchMedia('(pointer: fine)').matches;
    await expect
      .element(page.getByRole('radio', { name: fine ? 'Paint' : 'Move' }))
      .toHaveAttribute('aria-checked', 'true');
    expect(radios().length).toBeGreaterThan(1);
    expect(ed.readOnly).toBe(false);
    expect(ed.commit(p2.ops[0])).toEqual({ ok: true });
  });

  it('an editable load keeps the tool the user chose', async () => {
    const { workers, editors } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    ready(workers[0]);
    await expect.element(page.getByRole('radio', { name: 'Erase' })).toBeEnabled();
    await click(page.getByRole('radio', { name: 'Erase' }));
    await expect
      .element(page.getByRole('radio', { name: 'Erase' }))
      .toHaveAttribute('aria-checked', 'true');
    editors[0].load(p2);
    await expect
      .element(page.getByRole('radio', { name: 'Erase' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('stops following loads after unmount', async () => {
    const { workers, editors, posts, screen } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    ready(workers[0]);
    await screen.unmount();
    const n = workers[0].posts.length;
    editors[0].load(p2);
    expect(workers[0].posts.length).toBe(n);
    expect(posts('load')).toHaveLength(1);
  });
});
