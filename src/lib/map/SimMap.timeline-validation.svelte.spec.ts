// SimMap's timeline handle validates before it stores or queues (ruling R18, spec §4.1
// "Validation", §4.4.3): a bad call throws the same error before the TimelineController exists
// as after. Entering timeline mode drops queued generated updates (final review Minor 3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { timelineSmall } from './fixtures/timeline-small';
import { timelineLookups } from './fixtures/timeline-lookups';
import type { SimMapHandle, TimelineUpdate } from './types';
import type { TimelineLookups } from './timelapse/types';

// See SimMap.svelte.spec.ts: the committed fixture dataset is served by Vitest's dev server.
const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

let hosts: HTMLElement[] = [];

beforeEach(() => {
  vi.stubEnv('VITE_E2E', '1'); // installs window.__sfhMap (debug.ts)
});

afterEach(() => {
  for (const h of hosts) h.remove();
  hosts = [];
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function mount() {
  const target = document.createElement('div');
  target.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(target);
  hosts.push(target);
  let resolveReady!: (h: SimMapHandle) => void;
  const ready = new Promise<SimMapHandle>((r) => (resolveReady = r));
  const screen = await render(SimMap, {
    target,
    props: { manifest, onready: (h: SimMapHandle) => resolveReady(h) }
  });
  const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
  const handle = screen.component as unknown as SimMapHandle;
  const whenReady = async () => {
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('ready');
    return ready;
  };
  return { handle, whenReady };
}

const dbg = () => window.__sfhMap!;
async function converged() {
  await expect.poll(() => dbg().timelineSnapshot()?.pending, { timeout: 10_000 }).toBe(0);
}

/** A chance row of 2049 months: above WebGL2's guaranteed 2048. */
const longLookups: TimelineLookups = {
  ...timelineLookups,
  chance: {
    ...timelineLookups.chance,
    discretionary: { ...timelineLookups.chance.discretionary, filed: new Float32Array(2049) }
  }
};

/** timelineSmall with its first cell's slotPathway truncated. */
const cell = timelineSmall.cells[0];
const malformed: TimelineUpdate = {
  ...timelineSmall,
  cells: [{ ...cell, slotPathway: new Uint8Array(0) }, ...timelineSmall.cells.slice(1)]
};
const MALFORMED = new RegExp(`timeline cell ${cell.cellId}: slotPathway has length 0`);

describe('SimMap timeline handle validation (ruling R18)', { timeout: 60_000 }, () => {
  it('setTimelineLookups throws the RangeError before the map is ready, and keeps nothing', async () => {
    // A rejected call keeps nothing (R18), so the timeline below installs before any lookups
    // arrived: §4.4.3's dev warning is expected, once. Asserted here and kept off stderr.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handle, whenReady } = await mount();
    expect(() => handle.setTimelineLookups(longLookups)).toThrow(RangeError);
    const h = await whenReady();
    h.applyTimeline(timelineSmall);
    await converged();
    // The rejected lookups were not kept: no bars, and the no-lookups warning fired once.
    expect(dbg().timelineSnapshot()).toMatchObject({ revision: 0, cells: 2, bars: 0 });
    const noLookups = warn.mock.calls.filter((c) =>
      String(c[0]).includes('timeline installed before setTimelineLookups')
    );
    expect(noLookups).toHaveLength(1);
    // The controller throws the same error.
    expect(() => h.setTimelineLookups(longLookups)).toThrow(RangeError);
  });

  it('applyTimeline throws the TypeError naming the cell before the map is ready', async () => {
    const error = vi.spyOn(console, 'error');
    const { handle, whenReady } = await mount();
    expect(() => handle.applyTimeline(malformed)).toThrow(TypeError);
    expect(() => handle.applyTimeline(malformed)).toThrow(MALFORMED);
    const h = await whenReady();
    // Nothing was queued and timeline mode was not entered: the editor's controller runs.
    expect(dbg().timelineSnapshot()).toBeNull();
    expect(dbg().snapshot()).not.toBeNull();
    expect(error.mock.calls.some((c) => String(c[0]).includes('timeline'))).toBe(false);
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(timelineSmall);
    await converged();
    // Once the controller exists, the same call throws the same error.
    expect(() => h.applyTimeline({ ...malformed, revision: 1 })).toThrow(MALFORMED);
    expect(dbg().timelineSnapshot()!.revision).toBe(0);
  });
});

describe('SimMap entering timeline mode (final review Minor 3)', { timeout: 60_000 }, () => {
  it('drops generated updates queued before the first applyTimeline', async () => {
    const { handle, whenReady } = await mount();
    handle.applyGenerated({
      revision: 0,
      cells: [],
      removedCells: [],
      hide: { add: [], remove: [] }
    });
    expect(dbg().pendingGenerated).toBe(1);
    handle.setTimelineLookups(timelineLookups);
    handle.applyTimeline(timelineSmall);
    expect(dbg().pendingGenerated).toBe(0);
    await whenReady();
    await converged();
    expect(dbg().pendingGenerated).toBe(0);
    expect(dbg().timelineSnapshot()).toMatchObject({ revision: 0, cells: 2 });
  });
});
