// Editor.setTitle through BrushEditor posts nothing to the worker (a separate file: vi.mock is
// file-wide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Manifest } from '$lib/data/manifest';
import type { SimMapHandle } from '$lib/map/types';
import { emptyPlan } from '$lib/plan';
import type { WorkerLike } from '$lib/sim/client';
import type { SimRequest, SimResponse } from '$lib/sim/protocol';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import type { ControllerMap } from './BrushController.svelte';
import BrushEditor from './BrushEditor.svelte';
import type { Editor } from './editor.svelte';
import { stubHandle } from './test/sim-map-stub';

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

let box: HTMLDivElement;
let canvas: HTMLCanvasElement;
const originalGetMap = stubHandle.getMap;

function fakeMap(): ControllerMap {
  return {
    getCanvas: () => canvas,
    getCanvasContainer: () => box,
    unproject: ([x, y]) => ({ lng: -122.42 + x * 1e-5, lat: 37.76 - y * 1e-5 }),
    getCenter: () => ({ lng: -122.42, lat: 37.76 }),
    getZoom: () => 17,
    getBounds: () => ({
      getWest: () => -122.43,
      getSouth: () => 37.75,
      getEast: () => -122.41,
      getNorth: () => 37.77
    }),
    on: () => {},
    off: () => {}
  };
}

beforeEach(() => {
  box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px';
  canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  box.appendChild(canvas);
  document.body.appendChild(box);
  const map = fakeMap();
  stubHandle.getMap = (() => map) as unknown as SimMapHandle['getMap'];
});

afterEach(() => {
  stubHandle.getMap = originalGetMap;
  box.remove();
  vi.restoreAllMocks();
});

describe('BrushEditor Editor.setTitle', () => {
  it('posts nothing to the worker', async () => {
    const workers: FakeWorker[] = [];
    const editors: Editor[] = [];
    await render(BrushEditor, {
      props: {
        manifest,
        manifestError: false,
        plan: emptyPlan('fixture-0'),
        currentVersion: 'fixture-0',
        reloadManifest: async () => manifest,
        oneditor: (e: Editor) => void editors.push(e),
        createWorker: () => {
          const w = fakeWorker();
          workers.push(w);
          return w;
        }
      }
    });
    await expect.poll(() => workers.length).toBe(1);
    const w = workers[0];
    w.emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    await expect.poll(() => box.style.cursor).toBe('crosshair');

    const before = w.posts.length;
    editors[0].setTitle('t');
    expect(editors[0].plan.title).toBe('t');
    expect(w.posts.slice(before).filter((p) => p.type === 'load')).toEqual([]);
    expect(w.posts.length).toBe(before);
  });
});
