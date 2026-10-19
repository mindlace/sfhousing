import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { Day } from '$lib/timelapse/time';
import { spawnSimWorker } from './client';
import type { ChunksResponse, ParcelSummary } from './protocol';
import {
  ScenarioClient,
  type ScenarioClientEvents,
  type ScenarioWorkerLike
} from './scenario-client';
import type { ScenarioResponse, TimelineResponse, WorkerRequest } from './scenario/types';
import { FIXTURE_1 } from './test/harness';

interface FakeWorker extends ScenarioWorkerLike {
  posts: WorkerRequest[];
  terminated: boolean;
  emit(resp: ScenarioResponse): void;
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

const MANIFEST: Manifest = FIXTURE_1.manifest;
const HORIZON = 20_000 as Day;

function timeline(rev: number, seed: number, revision = 0): TimelineResponse {
  return {
    type: 'timeline',
    rev,
    seed,
    render: { revision, cells: [], removedCells: [], demolish: [] },
    score: {} as TimelineResponse['score'],
    bandRuns: 0,
    bandRunsTotal: 8,
    complete: true
  };
}

function setup(events: ScenarioClientEvents = {}) {
  const w = fakeWorker();
  const client = new ScenarioClient(w, events);
  const rerolls = () => w.posts.filter((p) => p.type === 'reroll');
  return { w, client, rerolls };
}

describe('ScenarioClient', () => {
  it('numbers rev requests from 1; prefetch, retryChunks and parcelSummary carry no rev', () => {
    const { w, client } = setup();
    expect(client.initScenario(MANIFEST, HORIZON)).toBe(1);
    expect(client.reroll(7)).toBe(2);
    client.prefetch([0, 0, 1, 1]);
    client.retryChunks();
    void client.parcelSummary('111', 100 as Day);
    expect(client.reroll(null)).toBe(3);
    expect(w.posts[0]).toEqual({
      type: 'initScenario',
      rev: 1,
      manifest: MANIFEST,
      scenario: 'fzp',
      seed: null,
      horizon: HORIZON
    });
    expect(w.posts[1]).toEqual({ type: 'reroll', rev: 2, seed: 7 });
    expect(w.posts[5]).toEqual({ type: 'reroll', rev: 3, seed: null });
  });

  it('initScenario forwards a given seed', () => {
    const { w, client } = setup();
    client.initScenario(MANIFEST, HORIZON, 42);
    expect(w.posts[0]).toMatchObject({ type: 'initScenario', seed: 42 });
  });

  it('prefetch(bbox) and retryChunks() post the existing request shapes', () => {
    const { w, client } = setup();
    client.prefetch([-122.5, 37.7, -122.4, 37.8]);
    client.retryChunks();
    expect(w.posts).toEqual([
      { type: 'prefetch', bbox: [-122.5, 37.7, -122.4, 37.8] },
      { type: 'retryChunks' }
    ]);
  });

  describe('the barrier', () => {
    it('initScenario and reroll set it: a timeline older than the latest is stale', () => {
      const { client } = setup();
      const i = client.initScenario(MANIFEST, HORIZON); // 1
      expect(client.isStale(timeline(i, 1))).toBe(false);
      const r = client.reroll(5); // 2
      expect(client.isStale(timeline(i, 1))).toBe(true);
      expect(client.isStale(timeline(r, 5))).toBe(false);
      expect(client.isStale(timeline(r + 1, 5))).toBe(false);
      const r2 = client.reroll(null); // 3
      expect(client.isStale(timeline(r, 5, 3))).toBe(true);
      expect(client.isStale(timeline(r2, 9))).toBe(false);
    });

    it('is not moved by non-rev requests', () => {
      const { client } = setup();
      const i = client.initScenario(MANIFEST, HORIZON);
      client.prefetch([0, 0, 1, 1]);
      client.retryChunks();
      void client.parcelSummary('1', 0 as Day);
      expect(client.isStale(timeline(i, 1))).toBe(false);
    });
  });

  describe('resync', () => {
    it('is a no-op before any timeline has arrived', () => {
      const { w, client, rerolls } = setup();
      client.resync();
      client.initScenario(MANIFEST, HORIZON);
      client.resync();
      expect(rerolls()).toHaveLength(0);
      expect(w.posts).toHaveLength(1);
    });

    it('sends one reroll(currentSeed) per episode', () => {
      const { w, client, rerolls } = setup();
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 123));
      client.resync();
      client.resync();
      client.resync();
      expect(rerolls()).toEqual([{ type: 'reroll', rev: 2, seed: 123 }]);
    });

    it('currentSeed is the seed of the latest non-stale timeline', () => {
      const { w, client, rerolls } = setup();
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 10));
      client.reroll(20); // 2
      w.emit(timeline(1, 99, 4)); // stale: ignored
      client.resync();
      expect(rerolls().at(-1)).toEqual({ type: 'reroll', rev: 3, seed: 10 });
      w.emit(timeline(3, 10)); // ends the episode
      w.emit(timeline(2, 20));
      // rev 2 < barrier 3: stale, so the seed stays 10
      client.resync();
      expect(rerolls().at(-1)).toEqual({ type: 'reroll', rev: 4, seed: 10 });
    });

    it('a later non-stale timeline updates the seed, including band-only updates', () => {
      const { w, client, rerolls } = setup();
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 10));
      client.reroll(null); // 2
      w.emit(timeline(2, 55));
      w.emit(timeline(2, 55, 1));
      client.resync();
      expect(rerolls().at(-1)).toEqual({ type: 'reroll', rev: 3, seed: 55 });
    });

    it('the episode ends on a non-stale revision-0 timeline with rev at or after the resync rev', () => {
      const { w, client, rerolls } = setup();
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 10));
      client.resync(); // 2
      w.emit(timeline(1, 10, 5)); // stale
      client.resync();
      expect(rerolls()).toHaveLength(1);
      w.emit(timeline(2, 10, 3)); // non-stale, but not revision 0
      client.resync();
      expect(rerolls()).toHaveLength(1);
      w.emit(timeline(2, 10, 0)); // the snapshot answering the resync
      client.resync();
      expect(rerolls()).toHaveLength(2);
      expect(rerolls()[1]).toEqual({ type: 'reroll', rev: 3, seed: 10 });
    });

    it('a revision-0 timeline older than the resync rev does not end the episode', () => {
      const { w, client, rerolls } = setup();
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 10));
      client.resync(); // 2
      w.emit(timeline(1, 10, 0));
      client.resync();
      expect(rerolls()).toHaveLength(1);
    });

    it('an error answering the resync ends the episode without another resync', () => {
      const onError = vi.fn();
      const { w, client, rerolls } = setup({ onError });
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 10));
      client.resync(); // 2
      w.emit({ type: 'error', rev: 2, code: 'internal', message: 'still broken' });
      expect(onError).toHaveBeenCalledTimes(1);
      expect(rerolls()).toHaveLength(1);
      client.resync(); // a later episode may resync again
      expect(rerolls()).toHaveLength(2);
    });

    it('an error older than the resync rev does not end the episode', () => {
      const { w, client, rerolls } = setup();
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 10));
      client.resync(); // 2
      w.emit({ type: 'error', rev: 1, code: 'internal', message: 'late' });
      client.resync();
      expect(rerolls()).toHaveLength(1);
    });

    it('initScenario clears the episode and the current seed', () => {
      const { w, client, rerolls } = setup();
      client.initScenario(MANIFEST, HORIZON); // 1
      w.emit(timeline(1, 10));
      client.resync(); // 2
      client.initScenario(MANIFEST, HORIZON); // 3
      client.resync(); // no timeline yet for the new scenario
      expect(rerolls()).toHaveLength(1);
      w.emit(timeline(3, 77));
      client.resync();
      expect(rerolls()).toHaveLength(2);
      expect(rerolls()[1]).toEqual({ type: 'reroll', rev: 4, seed: 77 });
    });
  });

  describe('errors', () => {
    it.each([
      'manifest-invalid',
      'scenario-missing',
      'scenario-invalid',
      'bad-request',
      'internal'
    ] as const)('forwards %s to onError and never resyncs', (code) => {
      const onError = vi.fn();
      const { w, client, rerolls } = setup({ onError });
      client.initScenario(MANIFEST, HORIZON);
      w.emit(timeline(1, 10));
      client.reroll(10); // 2
      const e = { type: 'error', rev: 2, code, message: 'x' } as const;
      w.emit(e);
      w.emit(e);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(e);
      expect(rerolls()).toHaveLength(1); // only the explicit reroll
    });
  });

  describe('parcelSummary', () => {
    it('forwards day and projectId, and omits projectId when undefined', () => {
      const { w, client } = setup();
      void client.parcelSummary('111', 500 as Day);
      void client.parcelSummary('222', 600 as Day, 'P-1');
      const reqs = w.posts.filter((p) => p.type === 'parcelSummary');
      expect(reqs[0]).toEqual({ type: 'parcelSummary', reqId: 1, parcelId: '111', day: 500 });
      expect('projectId' in reqs[0]).toBe(false);
      expect(reqs[1]).toEqual({
        type: 'parcelSummary',
        reqId: 2,
        parcelId: '222',
        day: 600,
        projectId: 'P-1'
      });
    });

    it('resolves by reqId, out of order', async () => {
      const { w, client } = setup();
      const a = client.parcelSummary('111', 1 as Day);
      const b = client.parcelSummary('222', 1 as Day);
      const reqs = w.posts.filter((p) => p.type === 'parcelSummary');
      const sb = { parcelId: '222', eligible: true } as unknown as ParcelSummary;
      w.emit({ type: 'parcelSummary', reqId: reqs[1].reqId, summary: sb });
      w.emit({ type: 'parcelSummary', reqId: reqs[0].reqId, summary: null });
      w.emit({ type: 'parcelSummary', reqId: 999, summary: sb }); // unknown: ignored
      await expect(b).resolves.toEqual(sb);
      await expect(a).resolves.toBeNull();
    });

    it('dispose terminates and resolves pending summaries with null', async () => {
      const { w, client } = setup();
      const p = client.parcelSummary('111', 1 as Day);
      client.dispose();
      expect(w.terminated).toBe(true);
      expect(w.onmessage).toBeNull();
      await expect(p).resolves.toBeNull();
      await expect(client.parcelSummary('2', 1 as Day)).resolves.toBeNull();
    });
  });

  it('takes datasetVersion from ready and forwards events', () => {
    const events = { onReady: vi.fn(), onTimeline: vi.fn(), onChunks: vi.fn(), onError: vi.fn() };
    const { w, client } = setup(events);
    expect(client.datasetVersion).toBeNull();
    client.initScenario(MANIFEST, HORIZON);
    const ready = { type: 'ready', rev: 1, datasetVersion: 'fixture-1', chunkCount: 4 } as const;
    w.emit(ready);
    expect(client.datasetVersion).toBe('fixture-1');
    expect(events.onReady).toHaveBeenCalledWith(ready);
    const t = timeline(1, 3);
    w.emit(t);
    expect(events.onTimeline).toHaveBeenCalledWith(t);
    const ch: ChunksResponse = { type: 'chunks', status: {}, pending: 0, failed: [] };
    w.emit(ch);
    expect(events.onChunks).toHaveBeenCalledWith(ch);
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('passes a stale timeline to onTimeline; the caller decides with isStale', () => {
    const onTimeline = vi.fn();
    const { w, client } = setup({ onTimeline });
    client.initScenario(MANIFEST, HORIZON);
    client.reroll(1);
    const old = timeline(1, 3);
    w.emit(old);
    expect(onTimeline).toHaveBeenCalledWith(old);
    expect(client.isStale(old)).toBe(true);
  });

  it('accepts spawnSimWorker() without a cast (type-level)', () => {
    // Never called: compiling it is the assertion (svelte-check).
    const accepts = (w: ReturnType<typeof spawnSimWorker>) => {
      const c = new ScenarioClient(w, {});
      c.restart(w);
    };
    // Negative control: a bare ScenarioWorkerLike parameter rejects it, so the union is needed.
    const bare = (w: ScenarioWorkerLike) => w;
    const rejects = (w: ReturnType<typeof spawnSimWorker>) => {
      // @ts-expect-error WorkerLike.onmessage is typed for SimResponse
      bare(w);
    };
    expect(typeof accepts).toBe('function');
    expect(typeof rejects).toBe('function');
  });
});

describe('ScenarioClient worker crash', () => {
  let err: MockInstance<typeof console.error>;
  beforeEach(() => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    err.mockRestore();
  });
  const expectCrashLogged = () => {
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('[sim] worker crashed'),
      expect.anything()
    );
  };

  it.each(['onerror', 'onmessageerror'] as const)(
    '%s clears the episode, resolves pending summaries with null and reports a crash',
    async (handler) => {
      const onCrash = vi.fn();
      const { w, client, rerolls } = setup({ onCrash });
      client.initScenario(MANIFEST, HORIZON);
      w.emit(timeline(1, 10));
      client.resync(); // episode armed
      const pending = client.parcelSummary('111', 1 as Day);
      expect(client.crashed).toBe(false);

      w[handler]?.({} as ErrorEvent & MessageEvent);
      expect(onCrash).toHaveBeenCalledTimes(1);
      expectCrashLogged();
      expect(client.crashed).toBe(true);
      expect(w.terminated).toBe(true);
      await expect(pending).resolves.toBeNull();
      await expect(client.parcelSummary('222', 1 as Day)).resolves.toBeNull();
      client.resync();
      expect(rerolls()).toHaveLength(1);
    }
  );

  it('restart swaps in a fresh worker, keeps the rev sequence, and initScenario alone follows', () => {
    const { w, client } = setup({ onCrash: () => {} });
    client.initScenario(MANIFEST, HORIZON); // 1
    w.emit(timeline(1, 10));
    client.resync(); // 2
    w.onerror?.({} as ErrorEvent);
    expectCrashLogged();

    const w2 = fakeWorker();
    client.restart(w2);
    expect(w.terminated).toBe(true);
    expect(w.onmessage).toBeNull();
    expect(client.crashed).toBe(false);
    expect(client.datasetVersion).toBeNull();
    expect(w2.posts).toEqual([]); // restart sends nothing
    expect(client.initScenario(MANIFEST, HORIZON, 10)).toBe(3);
    expect(w2.posts).toEqual([
      {
        type: 'initScenario',
        rev: 3,
        manifest: MANIFEST,
        scenario: 'fzp',
        seed: 10,
        horizon: HORIZON
      }
    ]);
    // The crashed worker's timelines are stale; the new worker's reach the client.
    expect(client.isStale(timeline(2, 10))).toBe(true);
    w2.emit({ type: 'ready', rev: 3, datasetVersion: 'fixture-1', chunkCount: 1 });
    expect(client.datasetVersion).toBe('fixture-1');
  });

  it('crash then restart: currentSeed survives, so Retry re-inits with it; resync waits for a timeline', () => {
    const { w, client } = setup({ onCrash: () => {} });
    client.initScenario(MANIFEST, HORIZON);
    w.emit(timeline(1, 10));
    w.onerror?.({} as ErrorEvent);
    const w2 = fakeWorker();
    expect(client.currentSeed).toBe(10);
    client.restart(w2);
    expect(client.currentSeed).toBe(10);
    client.resync();
    expect(w2.posts).toEqual([]); // no timeline from the new worker yet
    client.initScenario(MANIFEST, HORIZON, client.currentSeed);
    expect(w2.posts).toEqual([
      {
        type: 'initScenario',
        rev: 2,
        manifest: MANIFEST,
        scenario: 'fzp',
        seed: 10,
        horizon: HORIZON
      }
    ]);
    client.resync(); // still no timeline from the re-init
    expect(w2.posts).toHaveLength(1);
    w2.emit(timeline(2, 10));
    client.resync();
    expect(w2.posts[1]).toEqual({ type: 'reroll', rev: 3, seed: 10 });
  });

  it('currentSeed is null before any timeline and ignores stale ones', () => {
    const { w, client } = setup();
    expect(client.currentSeed).toBeNull();
    client.initScenario(MANIFEST, HORIZON); // 1
    client.reroll(5); // 2
    w.emit(timeline(1, 99)); // stale
    expect(client.currentSeed).toBeNull();
    w.emit(timeline(2, 5));
    expect(client.currentSeed).toBe(5);
    client.initScenario(MANIFEST, HORIZON, 8);
    expect(client.currentSeed).toBe(5); // kept until a new accepted timeline replaces it
  });

  it.each(['onerror', 'onmessageerror'] as const)(
    'after %s the worker is terminated and its late messages are ignored',
    (handler) => {
      const onReady = vi.fn();
      const onTimeline = vi.fn();
      const { w, client } = setup({ onCrash: () => {}, onReady, onTimeline });
      client.initScenario(MANIFEST, HORIZON);
      const onmessage = w.onmessage;
      w[handler]?.({} as ErrorEvent & MessageEvent);
      expectCrashLogged();
      expect(w.onmessage).toBeNull();

      onmessage?.({ data: { type: 'ready', rev: 1, datasetVersion: 'x', chunkCount: 1 } });
      onmessage?.({ data: timeline(1, 1) });
      expect(onReady).not.toHaveBeenCalled();
      expect(onTimeline).not.toHaveBeenCalled();
      expect(client.datasetVersion).toBeNull();
      expect(client.crashed).toBe(true);
    }
  );

  it('a crash after dispose is ignored', () => {
    const onCrash = vi.fn();
    const { w, client } = setup({ onCrash });
    const onerror = w.onerror;
    client.dispose();
    onerror?.({} as ErrorEvent);
    expect(onCrash).not.toHaveBeenCalled();
    expect(w.onerror).toBeNull();
  });
});
