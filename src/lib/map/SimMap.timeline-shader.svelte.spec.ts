// A real timelapse shader compile error reaches the error state (timelapse-render §4.8
// "Errors", ruling R13). Own file: vi.mock is file-wide.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { DAYS, timelineSmall } from './fixtures/timeline-small';
import { timelineLookups } from './fixtures/timeline-lookups';
import type { SimMapHandle } from './types';

const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

// The real lazy modules, with the TimelapseExtension's vertex injection made invalid GLSL. The
// prototype is patched (this file's module instance only) rather than subclassed: the Svelte
// plugin warns on nested class declarations.
vi.mock('./timelapse-loader', async (importOriginal) => {
  const real = await importOriginal<typeof import('./timelapse-loader')>();
  return {
    loadTimelapse: async () => {
      const mods = await real.loadTimelapse();
      const proto = mods[0].TimelapseExtension.prototype;
      const getShaders = proto.getShaders;
      proto.getShaders = function (this: ThisParameterType<typeof getShaders>, extension) {
        const s = getShaders.call(this, extension);
        const end = `${s.inject['vs:#main-end']}\n  undeclared_x = 1.0;\n`;
        return { ...s, inject: { ...s.inject, 'vs:#main-end': end } };
      };
      return mods;
    }
  };
});

const ERROR_COPY = "The map couldn't load. Reload the page to try again.";

let hosts: HTMLElement[] = [];
let rejections: unknown[] = [];
const onRejection = (e: PromiseRejectionEvent) => rejections.push(e.reason);

beforeEach(() => {
  rejections = [];
  window.addEventListener('unhandledrejection', onRejection);
});

afterEach(() => {
  window.removeEventListener('unhandledrejection', onRejection);
  for (const h of hosts) h.remove();
  hosts = [];
  vi.restoreAllMocks();
});

describe('SimMap timelapse shader errors', { timeout: 30_000 }, () => {
  it('a GLSL error shows the error state, logged once, with no unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // luma's shader source dump and debug hint.
    for (const m of ['log', 'info', 'debug'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    const target = document.createElement('div');
    target.style.cssText = 'width:600px;height:400px';
    document.body.appendChild(target);
    hosts.push(target);
    let resolveReady!: (h: SimMapHandle) => void;
    const ready = new Promise<SimMapHandle>((r) => (resolveReady = r));
    await render(SimMap, { target, props: { manifest, onready: resolveReady } });
    const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
    const h = await ready;
    h.setTimelineLookups(timelineLookups);
    h.setTime(DAYS.a.construction);
    h.applyTimeline(timelineSmall);
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('error');
    await expect.element(page.getByRole('alert')).toHaveTextContent(ERROR_COPY);
    // Further frames and calls add nothing: the controller is destroyed and logs once.
    h.setTime(DAYS.a.construction + 100);
    await new Promise((r) => setTimeout(r, 500));
    const shaderLogs = error.mock.calls.filter((c) => c[0] === '[map] timelapse shader');
    expect(shaderLogs).toHaveLength(1);
    expect(String(shaderLogs[0][1])).toMatch(/link error|during compilation of/i);
    expect(rejections).toEqual([]);
    expect(root.dataset.state).toBe('error');
  });
});
