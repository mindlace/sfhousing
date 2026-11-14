import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import type { ScenarioWorkerLike } from './scenario-client';
import type { WorkerRequest } from './scenario/types';
import { FIXTURE_1 } from './test/harness';
import type { TimelineHostRequest, TimelineHostResponse } from './timeline-protocol';
import { TimelineClient, type TimelineClientEvents } from './timeline-client';

interface FakeWorker extends ScenarioWorkerLike {
  posts: (WorkerRequest | TimelineHostRequest)[];
  terminated: boolean;
  emit(resp: TimelineHostResponse): void;
  crash(): void;
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
      w.onmessage?.({ data: resp as never });
    },
    crash() {
      w.onerror?.(new Event('error') as ErrorEvent);
    }
  };
  return w;
}

const MANIFEST = FIXTURE_1.manifest;
const P1 = DEFAULT_POLICY4;
const P2 = { ...DEFAULT_POLICY4 } as SimPolicy4;
const L1 = { a: ['p1'] };
const L2 = { b: ['p2'] };
const series = {} as never;

function setup(events: TimelineClientEvents = {}) {
  const w = fakeWorker();
  const client = new TimelineClient(w, events);
  return { w, client };
}

describe('TimelineClient', () => {
  it('open posts openTimeline with WORLDS and WINDOW_MONTHS', () => {
    const { w, client } = setup();
    expect(client.open(MANIFEST, P1, L1)).toBe(1);
    expect(w.posts[0]).toMatchObject({ type: 'openTimeline', rev: 1, worlds: 48, months: 480 });
  });

  it('drops compiling, compiled, filled and refill older than the last setPolicy', () => {
    const events = {
      onCompiling: vi.fn(),
      onCompiled: vi.fn(),
      onFilled: vi.fn(),
      onRefill: vi.fn()
    };
    const { w, client } = setup(events);
    client.open(MANIFEST, P1, L1);
    expect(client.setPolicy(P2, L2)).toBe(2);
    for (const rev of [1, 2]) {
      w.emit({ type: 'compiling', rev, done: 1, total: 2, failedCells: [] });
      w.emit({
        type: 'compiled',
        rev,
        capacity: {} as never,
        unknownLots: 0,
        statics: {} as never
      });
      w.emit({ type: 'filled', rev, through: 3, series });
      w.emit({ type: 'refill', rev, from: 4 });
    }
    for (const fn of Object.values(events)) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][0].rev).toBe(2);
    }
  });

  it('never drops cells or lookups', () => {
    const events = { onCells: vi.fn(), onLookups: vi.fn() };
    const { w, client } = setup(events);
    client.open(MANIFEST, P1, L1);
    client.setPolicy(P2, L2);
    w.emit({ type: 'cells', render: { revision: 0, cells: [], removedCells: [], demolish: [] } });
    w.emit({ type: 'lookups', month: 1, lookups: {} as never });
    expect(events.onCells).toHaveBeenCalledTimes(1);
    expect(events.onLookups).toHaveBeenCalledTimes(1);
  });

  it('delivers errors of any rev', () => {
    const onError = vi.fn();
    const { w, client } = setup({ onError });
    client.open(MANIFEST, P1, L1);
    client.setPolicy(P2, L2);
    w.emit({ type: 'error', rev: 1, code: 'timeline', message: 'x' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('restart re-opens with the last policy and lots', () => {
    const onCrash = vi.fn();
    const { w, client } = setup({ onCrash });
    client.open(MANIFEST, P1, L1);
    client.setPolicy(P2, L2);
    w.crash();
    expect(client.crashed).toBe(true);
    expect(onCrash).toHaveBeenCalledTimes(1);
    const w2 = fakeWorker();
    client.restart(w2);
    expect(client.crashed).toBe(false);
    expect(w2.posts).toHaveLength(1);
    expect(w2.posts[0]).toMatchObject({ type: 'openTimeline', rev: 3, policy: P2, lots: L2 });
  });

  it('restart before any open posts nothing', () => {
    const { client } = setup();
    const w2 = fakeWorker();
    client.restart(w2);
    expect(w2.posts).toEqual([]);
  });

  it('lookups answer no-session on crash', async () => {
    const { w, client } = setup();
    client.open(MANIFEST, P1, L1);
    const pending = client.resolveBrush({} as never);
    w.crash();
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'no-session' });
    await expect(client.resolveBrush({} as never)).resolves.toMatchObject({ reason: 'no-session' });
  });

  it('resolves a lookup from its answer and posts viewMonth and resyncMap', async () => {
    const { w, client } = setup();
    const p = client.brushCatalog();
    const sent = w.posts[0] as { reqId: number };
    w.emit({ type: 'brushCatalog', reqId: sent.reqId, catalog: null });
    await expect(p).resolves.toBeNull();
    client.viewMonth(7);
    client.resyncMap();
    expect(w.posts.slice(1)).toEqual([{ type: 'viewMonth', month: 7 }, { type: 'resyncMap' }]);
  });
});
