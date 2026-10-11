import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { GeneratedUpdate } from '$lib/map/types';
import { emptyPlan, type Plan, type PlanOp } from '$lib/plan';
import type { Score } from '$lib/scoreboard';
import { SimClient, type SimClientEvents, type WorkerLike } from './client';
import type { ChunksResponse, DiffPhase, DiffResponse, SimRequest, SimResponse } from './protocol';
import { FIXTURE_1 } from './test/harness';

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

const PLAN: Plan = emptyPlan('fixture-1');
const MANIFEST: Manifest = FIXTURE_1.manifest;
const OP: PlanOp = { kind: 'paint', id: 'a', stories: 6, radiusM: 20, path: [[-122.419, 37.76]] };

function diff(rev: number, phase: DiffPhase): DiffResponse {
  return {
    type: 'diff',
    rev,
    phase,
    render: {} as GeneratedUpdate,
    complete: true,
    score: {} as Score
  };
}

function setup(events: SimClientEvents = {}) {
  const w = fakeWorker();
  const client = new SimClient(w, events, () => PLAN);
  const loads = () => w.posts.filter((p) => p.type === 'load');
  return { w, client, loads };
}

describe('SimClient', () => {
  it('numbers rev requests from 1, incrementing per request', () => {
    const { w, client } = setup();
    expect(client.init(MANIFEST)).toBe(1);
    expect(client.load(PLAN)).toBe(2);
    expect(client.preview(OP)).toBe(3);
    expect(client.cancelPreview()).toBe(4);
    expect(client.commit(OP)).toBe(5);
    client.prefetch([0, 0, 1, 1]); // no rev
    client.retryChunks(); // no rev
    expect(client.undo('a')).toBe(6);
    expect(w.posts.map((p) => ('rev' in p ? p.rev : p.type))).toEqual([
      1,
      2,
      3,
      4,
      5,
      'prefetch',
      'retryChunks',
      6
    ]);
    expect(w.posts[0]).toEqual({ type: 'init', rev: 1, manifest: MANIFEST, mode: 'max' });
    expect(w.posts[5]).toEqual({ type: 'prefetch', bbox: [0, 0, 1, 1] });
    expect(w.posts[7]).toEqual({ type: 'undo', rev: 6, opId: 'a' });
  });

  it('dedupes resync: one load per episode, re-armed by the load diff', () => {
    const { w, client, loads } = setup();
    client.init(MANIFEST);
    client.resync();
    client.resync();
    client.resync();
    expect(loads()).toEqual([{ type: 'load', rev: 2, plan: PLAN }]);
    w.emit(diff(1, 'load')); // an older load diff does not clear the latch
    client.resync();
    expect(loads()).toHaveLength(1);
    w.emit(diff(2, 'load'));
    client.resync();
    expect(loads()).toHaveLength(2);
    expect(loads()[1].rev).toBe(3);
  });

  it('clears the resync latch on an error at or after the resync rev', () => {
    const { w, client, loads } = setup();
    client.init(MANIFEST);
    client.resync(); // rev 2
    w.emit({ type: 'error', rev: 2, code: 'internal', message: 'x' });
    client.resync();
    expect(loads()).toHaveLength(2);
  });

  it('answers a bad-request error with onError then exactly one load', () => {
    const order: string[] = [];
    const w = fakeWorker();
    const client = new SimClient(
      w,
      {
        onError: (e) => {
          const loadsSoFar = w.posts.filter((p) => p.type === 'load').length;
          order.push(`error:${e.code}:${loadsSoFar}`);
        }
      },
      () => PLAN
    );
    client.init(MANIFEST);
    client.undo('nope'); // rev 2
    w.emit({ type: 'error', rev: 2, code: 'bad-request', message: 'not last' });
    w.emit({ type: 'error', rev: 2, code: 'bad-request', message: 'again' });
    // onError runs before the resync load is posted; the second error is in the same episode.
    expect(order).toEqual(['error:bad-request:0', 'error:bad-request:1']);
    expect(w.posts.filter((p) => p.type === 'load')).toEqual([
      { type: 'load', rev: 3, plan: PLAN }
    ]);
  });

  it('answers an internal error with exactly one load per episode (F-2)', () => {
    const onError = vi.fn();
    const { w, client, loads } = setup({ onError });
    client.init(MANIFEST);
    client.commit(OP); // rev 2
    w.emit({ type: 'error', rev: 2, code: 'internal', message: 'loader failed' });
    w.emit({ type: 'error', rev: 2, code: 'internal', message: 'again' });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(loads()).toEqual([{ type: 'load', rev: 3, plan: PLAN }]);
  });

  it('does not loop when the resync load itself fails internally', () => {
    const { w, client, loads } = setup();
    client.init(MANIFEST);
    client.resync(); // rev 2
    w.emit({ type: 'error', rev: 2, code: 'internal', message: 'still broken' });
    expect(loads()).toHaveLength(1);
  });

  it('does not resync on manifest-invalid', () => {
    const { w, client, loads } = setup();
    client.init(MANIFEST);
    w.emit({ type: 'error', rev: 1, code: 'manifest-invalid', message: 'bad' });
    expect(loads()).toHaveLength(0);
  });

  it('does not loop when the resync load itself is a bad request', () => {
    const onError = vi.fn();
    const { w, client, loads } = setup({ onError });
    client.init(MANIFEST);
    client.resync(); // rev 2
    w.emit({ type: 'error', rev: 2, code: 'bad-request', message: 'invalid plan' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(loads()).toHaveLength(1);
    client.resync(); // the latch is clear: a later episode still resyncs
    expect(loads()).toHaveLength(2);
  });

  it('init clears the resync latch', () => {
    const { client, loads } = setup();
    client.init(MANIFEST);
    client.resync();
    client.init(MANIFEST);
    client.resync();
    expect(loads()).toHaveLength(2);
  });

  it('resolves parcelSummary by reqId, out of order', async () => {
    const { w, client } = setup();
    const a = client.parcelSummary('111');
    const b = client.parcelSummary('222');
    const reqs = w.posts.filter((p) => p.type === 'parcelSummary');
    expect(reqs).toHaveLength(2);
    const [ra, rb] = reqs as Extract<SimRequest, { type: 'parcelSummary' }>[];
    expect(ra.parcelId).toBe('111');
    expect(rb.parcelId).toBe('222');
    expect(ra.reqId).not.toBe(rb.reqId);
    const sb = {
      parcelId: '222',
      neighborhood: 'N',
      landUse: 'RES',
      eligible: true,
      existingUnits: 1,
      envelope: null,
      generated: null
    };
    w.emit({ type: 'parcelSummary', reqId: rb.reqId, summary: sb });
    w.emit({ type: 'parcelSummary', reqId: ra.reqId, summary: null });
    await expect(b).resolves.toEqual(sb);
    await expect(a).resolves.toBeNull();
  });

  it('dispose terminates and resolves pending summaries with null', async () => {
    const { w, client } = setup();
    const p = client.parcelSummary('111');
    client.dispose();
    expect(w.terminated).toBe(true);
    await expect(p).resolves.toBeNull();
  });

  it('isStalePreview: older than the latest barrier rev is stale, later is not', () => {
    const { client } = setup();
    client.init(MANIFEST); // 1
    const p1 = client.preview(OP); // 2
    const c = client.commit(OP); // 3
    const p2 = client.preview(OP); // 4
    expect(client.isStalePreview(diff(p1, 'preview'))).toBe(true);
    expect(client.isStalePreview(diff(p2, 'preview'))).toBe(false);
    expect(client.isStalePreview(diff(c, 'commit'))).toBe(false); // only previews are stale
    client.cancelPreview(); // 5
    expect(client.isStalePreview(diff(p2, 'preview'))).toBe(true);
  });

  it('takes datasetVersion from ready and forwards events', () => {
    const events = {
      onReady: vi.fn(),
      onDiff: vi.fn(),
      onChunks: vi.fn(),
      onError: vi.fn()
    };
    const { w, client } = setup(events);
    expect(client.datasetVersion).toBeNull();
    client.init(MANIFEST);
    const ready = { type: 'ready', rev: 1, datasetVersion: 'fixture-1', chunkCount: 4 } as const;
    w.emit(ready);
    expect(client.datasetVersion).toBe('fixture-1');
    expect(events.onReady).toHaveBeenCalledWith(ready);
    const d = diff(1, 'chunk');
    w.emit(d);
    expect(events.onDiff).toHaveBeenCalledWith(d);
    const ch: ChunksResponse = { type: 'chunks', status: {}, pending: 0, failed: [] };
    w.emit(ch);
    expect(events.onChunks).toHaveBeenCalledWith(ch);
    expect(events.onError).not.toHaveBeenCalled();
  });
});

describe('SimClient worker crash', () => {
  it.each(['onerror', 'onmessageerror'] as const)(
    '%s clears the resync latch, resolves pending summaries with null and reports a crash',
    async (handler) => {
      const onCrash = vi.fn();
      const { w, client, loads } = setup({ onCrash });
      client.init(MANIFEST);
      client.resync(); // latch armed
      const pending = client.parcelSummary('111');
      expect(client.crashed).toBe(false);

      w[handler]?.({} as ErrorEvent & MessageEvent);
      expect(onCrash).toHaveBeenCalledTimes(1);
      expect(client.crashed).toBe(true);
      await expect(pending).resolves.toBeNull();
      // Crashed: summaries answer null at once and resync sends nothing.
      await expect(client.parcelSummary('222')).resolves.toBeNull();
      client.resync();
      expect(loads()).toHaveLength(1);
    }
  );

  it('restart swaps in a fresh worker, keeps the rev sequence and re-arms resync', () => {
    const { w, client, loads } = setup({ onCrash: () => {} });
    client.init(MANIFEST); // 1
    client.resync(); // 2
    w.onerror?.({} as ErrorEvent);

    const w2 = fakeWorker();
    client.restart(w2);
    expect(w.terminated).toBe(true);
    expect(w.onmessage).toBeNull();
    expect(client.crashed).toBe(false);
    expect(client.init(MANIFEST)).toBe(3);
    expect(w2.posts).toEqual([{ type: 'init', rev: 3, manifest: MANIFEST, mode: 'max' }]);

    client.resync(); // the latch was cleared by the crash
    expect(loads()).toHaveLength(1); // the first worker's
    expect(w2.posts.filter((p) => p.type === 'load')).toHaveLength(1);
    // Messages from the new worker reach the client.
    w2.emit({ type: 'ready', rev: 3, datasetVersion: 'fixture-1', chunkCount: 1 });
    expect(client.datasetVersion).toBe('fixture-1');
  });

  it.each(['onerror', 'onmessageerror'] as const)(
    'after %s the worker is terminated and its late messages, a ready above all, are ignored',
    (handler) => {
      const onReady = vi.fn();
      const onDiff = vi.fn();
      const { w, client } = setup({ onCrash: () => {}, onReady, onDiff });
      client.init(MANIFEST);
      const onmessage = w.onmessage;
      w[handler]?.({} as ErrorEvent & MessageEvent);
      expect(w.terminated).toBe(true);
      expect(w.onmessage).toBeNull();

      // A message already queued before the detach still reaches the old handler.
      onmessage?.({ data: { type: 'ready', rev: 1, datasetVersion: 'fixture-1', chunkCount: 1 } });
      onmessage?.({ data: diff(1, 'load') });
      expect(onReady).not.toHaveBeenCalled();
      expect(onDiff).not.toHaveBeenCalled();
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
