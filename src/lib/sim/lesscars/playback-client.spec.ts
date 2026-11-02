import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LessCarsPlanFile, LessCarsSitesFile } from '$lib/data/lesscars/codec';
import type { Manifest } from '$lib/data/manifest';
import type { TimelineUpdate } from '$lib/map/types';
import { PlaybackClient } from './playback-client';
import { FakePlaybackWorker } from './test/fake-playback-worker';
import type { PlaybackCard } from './types';

const m = { datasetVersion: 'v' } as unknown as Manifest;
const plan = {} as LessCarsPlanFile;
const sites = {} as LessCarsSitesFile;
const render = (revision = 0): TimelineUpdate =>
  ({ revision, cells: [], removedCells: [], demolish: [] }) as unknown as TimelineUpdate;
const card = { projectId: 'p' } as PlaybackCard;

describe('PlaybackClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('drops responses from an older init', () => {
    const w = new FakePlaybackWorker();
    const onTimeline = vi.fn();
    const onError = vi.fn();
    const c = new PlaybackClient(w, { onTimeline, onError });
    c.init(m, plan, sites);
    c.init(m, plan, sites);
    w.emit({ type: 'playback', rev: 1, render: render(), complete: true });
    w.emit({ type: 'playback', rev: 2, render: render(), complete: true });
    w.emit({ type: 'error', rev: 1, code: 'scenario-invalid', message: 'old' });
    expect(onTimeline.mock.calls.map(([r]) => r.rev)).toEqual([2]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('resync re-sends initPlayback once per episode', () => {
    const w = new FakePlaybackWorker();
    const c = new PlaybackClient(w, {});
    c.init(m, plan, sites);
    c.resync();
    c.resync();
    expect(w.posts.flatMap((x) => (x.type === 'initPlayback' ? [x.rev] : []))).toEqual([1, 2]);
    w.emit({ type: 'playback', rev: 2, render: render(0), complete: true });
    c.resync();
    expect(w.posts.filter((x) => x.type === 'initPlayback')).toHaveLength(3);
  });

  it('resync before init does nothing', () => {
    const w = new FakePlaybackWorker();
    new PlaybackClient(w, {}).resync();
    expect(w.posts).toEqual([]);
  });

  it('card resolves with the answer, and null on crash', async () => {
    const w = new FakePlaybackWorker();
    const onCrash = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = new PlaybackClient(w, { onCrash });
    const p = c.card('lc-build:lc:hwy:1', 25000);
    w.emit({ type: 'playbackCard', reqId: w.lastReqId(), card });
    expect(await p).toBe(card);
    const q = c.card('x', 1);
    w.crash();
    expect(await q).toBeNull();
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith('[lesscars] playback worker crashed', expect.anything());
    expect(w.terminated).toBe(true);
    expect(await c.card('y', 1)).toBeNull();
  });

  it('restart resolves pending cards null and keeps revs rising', async () => {
    const w = new FakePlaybackWorker();
    const w2 = new FakePlaybackWorker();
    const onTimeline = vi.fn();
    const c = new PlaybackClient(w, { onTimeline });
    c.init(m, plan, sites);
    const p = c.card('a', 1);
    c.restart(w2);
    expect(await p).toBeNull();
    expect(w.terminated).toBe(true);
    expect(c.init(m, plan, sites)).toBe(2);
    w2.emit({ type: 'playback', rev: 2, render: render(), complete: true });
    expect(onTimeline).toHaveBeenCalledTimes(1);
  });

  it('forwards ready, loaded and chunks, and current errors', () => {
    const w = new FakePlaybackWorker();
    const ev = { onReady: vi.fn(), onLoaded: vi.fn(), onChunks: vi.fn(), onError: vi.fn() };
    const c = new PlaybackClient(w, ev);
    c.init(m, plan, sites);
    w.emit({ type: 'ready', datasetVersion: 'v' } as never);
    w.emit({ type: 'playbackLoaded', rev: 1, seed: 3, places: {}, reservations: [] });
    w.emit({ type: 'chunks' } as never);
    w.emit({ type: 'error', rev: 1, code: 'scenario-invalid', message: 'bad' });
    expect(ev.onReady).toHaveBeenCalledTimes(1);
    expect(ev.onLoaded).toHaveBeenCalledTimes(1);
    expect(ev.onChunks).toHaveBeenCalledTimes(1);
    expect(ev.onError).toHaveBeenCalledTimes(1);
  });

  it('dispose silences the worker', () => {
    const w = new FakePlaybackWorker();
    const c = new PlaybackClient(w, {});
    c.init(m, plan, sites);
    c.dispose();
    expect(w.terminated).toBe(true);
    expect(w.onmessage).toBeNull();
  });
});
