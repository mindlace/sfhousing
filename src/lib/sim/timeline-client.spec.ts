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

  it('never drops cells or lookups', () => {
    const events = { onCells: vi.fn(), onLookups: vi.fn() };
    const { w, client } = setup(events);
    client.open(MANIFEST, P1, L1);
    client.setPolicy(P2, L2);
    client.open(MANIFEST, P1, L1);
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

  const compiled = (rev: number): TimelineHostResponse => ({
    type: 'compiled',
    rev,
    capacity: {} as never,
    unknownLots: 0,
    statics: {} as never
  });
  const compiling = (rev: number): TimelineHostResponse => ({
    type: 'compiling',
    rev,
    done: 1,
    total: 2,
    failedCells: []
  });
  const filled = (rev: number, through = 3): TimelineHostResponse => ({
    type: 'filled',
    rev,
    through,
    series
  });
  const refill = (rev: number, from = 4): TimelineHostResponse => ({ type: 'refill', rev, from });

  function recording() {
    const got: TimelineHostResponse[] = [];
    const push = (m: TimelineHostResponse) => got.push(m);
    const events: TimelineClientEvents = {
      onCompiling: push,
      onCompiled: push,
      onFilled: push,
      onRefill: push,
      onError: push
    };
    return { got, events };
  }

  describe('drops by rev (rule 22)', () => {
    it('drops a compiling older than the last setPolicy', () => {
      const { got, events } = recording();
      const { w, client } = setup(events);
      client.open(MANIFEST, P1, L1);
      expect(client.setPolicy(P2, L2)).toBe(2);
      w.emit(compiling(1));
      w.emit(compiling(2));
      expect(got).toEqual([compiling(2)]);
    });

    it('delivers compiled, filled and refill older than the last setPolicy, in arrival order', () => {
      const { got, events } = recording();
      const { w, client } = setup(events);
      client.open(MANIFEST, P1, L1);
      w.emit(compiled(1));
      client.setPolicy(P2, L2);
      client.setPolicy(P2, L2);
      const sent = [filled(1, 3), compiled(2), refill(2, 2), filled(1, 5), filled(3, 4), refill(1)];
      for (const m of sent) w.emit(m);
      expect(got).toEqual([compiled(1), ...sent]);
    });

    it('drops compiled, filled, refill and compiling older than the last open', () => {
      const { got, events } = recording();
      const { w, client } = setup(events);
      client.open(MANIFEST, P1, L1);
      client.setPolicy(P2, L2);
      expect(client.open(MANIFEST, P1, L1)).toBe(3);
      for (const rev of [1, 2]) {
        w.emit(compiling(rev));
        w.emit(compiled(rev));
        w.emit(filled(rev));
        w.emit(refill(rev));
      }
      w.emit(filled(3));
      expect(got).toEqual([filled(3)]);
    });

    it('a rejected setPolicy: its bad-request is delivered and earlier-rev months keep arriving', () => {
      const { got, events } = recording();
      const { w, client } = setup(events);
      client.open(MANIFEST, P1, L1);
      w.emit(compiled(1));
      client.setPolicy(P2, L2);
      const bad: TimelineHostResponse = {
        type: 'error',
        rev: 2,
        code: 'bad-request',
        message: 'x'
      };
      const sent = [filled(1, 1), bad, filled(1, 2), refill(1, 3)];
      for (const m of sent) w.emit(m);
      expect(got).toEqual([compiled(1), ...sent]);
    });

    it('restart counts as an open: older compiled, filled and refill are dropped', () => {
      const { got, events } = recording();
      const first = fakeWorker();
      const c = new TimelineClient(first, events);
      c.open(MANIFEST, P1, L1);
      c.setPolicy(P2, L2);
      const w2 = fakeWorker();
      c.restart(w2);
      w2.emit(compiled(2));
      w2.emit(filled(2));
      w2.emit(refill(2));
      expect(got).toEqual([]);
      w2.emit(filled(3, 1));
      expect(got).toEqual([filled(3, 1)]);
    });
  });

  it('setPolicy before open throws and posts nothing', () => {
    const { w, client } = setup();
    expect(() => client.setPolicy(P2, L2)).toThrow('open first');
    expect(w.posts).toEqual([]);
  });

  it('dispose answers pending lookups no-session', async () => {
    const { client } = setup();
    const pending = client.resolveBrush({} as never);
    client.dispose();
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'no-session' });
  });
});
