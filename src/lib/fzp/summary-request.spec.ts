import { describe, expect, it, vi } from 'vitest';
import type { ParcelSummary } from '$lib/sim/protocol';
import { REAL_ACTUAL } from './fixtures/cards';
import {
  SUMMARY_COPY,
  SummaryRequester,
  type SummaryQuery,
  type SummaryState
} from './summary-request';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const summary = (withProject: boolean): ParcelSummary => ({
  parcelId: '3512001',
  neighborhood: 'Mission',
  landUse: 'residential',
  eligible: true,
  existingUnits: 2,
  envelope: null,
  generated: null,
  ...(withProject ? { project: REAL_ACTUAL } : {})
});

const q = (day: number, projectId?: string): SummaryQuery => ({
  parcelId: '3512001',
  day,
  ...(projectId === undefined ? {} : { projectId })
});

function setup(initialUnavailable = false) {
  const calls: { q: SummaryQuery; d: ReturnType<typeof deferred<ParcelSummary | null>> }[] = [];
  const states: SummaryState[] = [];
  let down = initialUnavailable;
  const send = vi.fn((query: SummaryQuery) => {
    const d = deferred<ParcelSummary | null>();
    calls.push({ q: query, d });
    return d.promise;
  });
  const r = new SummaryRequester({
    send,
    unavailable: () => down,
    onstate: (s) => states.push(s)
  });
  return {
    r,
    calls,
    states,
    send,
    setDown: (v: boolean) => (down = v),
    last: () => states[states.length - 1]
  };
}

const tick = () => new Promise<void>((res) => setTimeout(res, 0));

describe('SummaryRequester', () => {
  it('has at most one in flight; the latest queued request wins and older results drop', async () => {
    const t = setup();
    t.r.request(q(1));
    t.r.request(q(2));
    t.r.request(q(3));
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.last()).toEqual({ kind: 'loading' });

    t.calls[0].d.resolve(summary(true));
    await tick();
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.calls[1].q.day).toBe(3);
    // The first result was dropped: nothing but 'loading' reached onstate.
    expect(t.states.every((s) => s.kind === 'loading')).toBe(true);

    t.calls[1].d.resolve(summary(false));
    await tick();
    expect(t.last()).toEqual({ kind: 'none' });
  });

  it('reports a card for a summary with a project', async () => {
    const t = setup();
    t.r.request(q(1, 'pr-1'));
    t.calls[0].d.resolve(summary(true));
    await tick();
    expect(t.last()).toEqual({ kind: 'project', card: REAL_ACTUAL });
  });

  it('reports not-loaded for a null summary', async () => {
    const t = setup();
    t.r.request(q(1));
    t.calls[0].d.resolve(null);
    await tick();
    expect(t.last()).toEqual({ kind: 'not-loaded' });
  });

  it('pending request at crash shows Details unavailable', async () => {
    const t = setup();
    t.r.request(q(1));
    t.setDown(true);
    t.calls[0].d.resolve(null);
    await tick();
    expect(t.last()).toEqual({ kind: 'unavailable' });
  });

  it('a request while unavailable reports unavailable without sending', () => {
    const t = setup(true);
    t.r.request(q(1));
    expect(t.send).not.toHaveBeenCalled();
    expect(t.last()).toEqual({ kind: 'unavailable' });
  });

  it('a rejected send reads as not loaded', async () => {
    const t = setup();
    t.r.request(q(1));
    t.calls[0].d.reject(new Error('disposed'));
    await tick();
    expect(t.last()).toEqual({ kind: 'not-loaded' });
  });

  it('retryIfNotLoaded re-sends the last query with the new day, only when not loaded', async () => {
    const t = setup();
    t.r.retryIfNotLoaded(5);
    expect(t.send).not.toHaveBeenCalled();

    t.r.request(q(1, 'pr-1'));
    t.r.retryIfNotLoaded(5);
    expect(t.send).toHaveBeenCalledTimes(1); // still loading
    t.calls[0].d.resolve(null);
    await tick();

    t.r.retryIfNotLoaded(9);
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.calls[1].q).toEqual({ parcelId: '3512001', day: 9, projectId: 'pr-1' });
    expect(t.r.query).toEqual({ parcelId: '3512001', day: 9, projectId: 'pr-1' });
    t.calls[1].d.resolve(summary(true));
    await tick();

    t.r.retryIfNotLoaded(12);
    expect(t.send).toHaveBeenCalledTimes(2); // a card is showing
  });

  it('reset goes idle, drops the queue and the in-flight result', async () => {
    const t = setup();
    t.r.request(q(1));
    t.r.request(q(2));
    t.r.reset();
    expect(t.last()).toEqual({ kind: 'idle' });
    expect(t.r.query).toBeNull();
    t.calls[0].d.resolve(summary(true));
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.last()).toEqual({ kind: 'idle' });
    t.r.retryIfNotLoaded(3);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('a request after reset, while the old one is in flight, is sent once it settles', async () => {
    const t = setup();
    t.r.request(q(1));
    t.r.reset();
    t.r.request(q(2));
    expect(t.send).toHaveBeenCalledTimes(1);
    t.calls[0].d.resolve(summary(true));
    await tick();
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.calls[1].q.day).toBe(2);
  });
});

describe('SUMMARY_COPY', () => {
  it('matches the spec table', () => {
    expect(SUMMARY_COPY).toEqual({
      loading: 'Loading project details…',
      'not-loaded': 'Project details are still loading for this area.',
      none: 'No project on this parcel at this date.',
      unavailable: 'Details unavailable'
    });
  });
});
