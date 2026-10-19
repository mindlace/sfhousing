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

describe('SummaryRequester: a card on show', () => {
  async function withCard() {
    const t = setup();
    t.r.request(q(1, 'pr-1'));
    t.calls[0].d.resolve(summary(true));
    await tick();
    expect(t.last()).toEqual({ kind: 'project', card: REAL_ACTUAL });
    t.states.length = 0;
    return t;
  }

  it('keeps the card on show while a same-target request is in flight', async () => {
    const t = await withCard();
    t.r.request(q(2, 'pr-1'));
    t.r.request(q(3, 'pr-1'));
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.states).toEqual([]); // no loading emitted
    t.calls[1].d.resolve(summary(true));
    await tick();
    expect(t.send).toHaveBeenCalledTimes(3);
    expect(t.states).toEqual([]); // the stale answer was dropped
    t.calls[2].d.resolve(summary(true));
    await tick();
    expect(t.states).toEqual([{ kind: 'project', card: REAL_ACTUAL }]);
  });

  it('moves to not-loaded or none when a same-target answer has no card', async () => {
    const a = await withCard();
    a.r.request(q(2, 'pr-1'));
    a.calls[1].d.resolve(null);
    await tick();
    expect(a.states).toEqual([{ kind: 'not-loaded' }]);

    const b = await withCard();
    b.r.request(q(2, 'pr-1'));
    b.calls[1].d.resolve(summary(false));
    await tick();
    expect(b.states).toEqual([{ kind: 'none' }]);
  });

  it('shows loading for a different project or a different parcel', async () => {
    const a = await withCard();
    a.r.request(q(2, 'pr-2'));
    expect(a.states).toEqual([{ kind: 'loading' }]);

    const b = await withCard();
    b.r.request({ parcelId: '3512999', day: 2, projectId: 'pr-1' });
    expect(b.states).toEqual([{ kind: 'loading' }]);

    const c = await withCard();
    c.r.request(q(2)); // no projectId is a different target from 'pr-1'
    expect(c.states).toEqual([{ kind: 'loading' }]);
  });

  it('shows loading for a same-target request when no card is shown', async () => {
    const t = setup();
    t.r.request(q(1, 'pr-1'));
    t.calls[0].d.resolve(summary(false));
    await tick();
    t.states.length = 0;
    t.r.request(q(2, 'pr-1'));
    expect(t.states).toEqual([{ kind: 'loading' }]);
  });

  it('shows loading after a reset even for the same target', async () => {
    const t = await withCard();
    t.r.reset();
    t.states.length = 0;
    t.r.request(q(2, 'pr-1'));
    expect(t.states).toEqual([{ kind: 'loading' }]);
  });
});

describe('SummaryRequester: robustness', () => {
  it('treats a send that throws synchronously as not loaded and keeps working', async () => {
    const states: SummaryState[] = [];
    const answers: ParcelSummary[] = [];
    let explode = true;
    const send = vi.fn((_q: SummaryQuery) => {
      if (explode) throw new Error('worker gone');
      return Promise.resolve(answers[0] ?? null);
    });
    const r = new SummaryRequester({
      send,
      unavailable: () => false,
      onstate: (s) => states.push(s)
    });
    r.request(q(1));
    await tick();
    expect(states[states.length - 1]).toEqual({ kind: 'not-loaded' });
    explode = false;
    answers.push(summary(true));
    r.request(q(2));
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(states[states.length - 1]).toEqual({ kind: 'project', card: REAL_ACTUAL });
  });

  it('drops an older answer after a newer request was made while unavailable', async () => {
    const t = setup();
    t.r.request(q(1));
    t.setDown(true);
    t.r.request(q(2));
    expect(t.last()).toEqual({ kind: 'unavailable' });
    t.calls[0].d.resolve(summary(true));
    await tick();
    expect(t.last()).toEqual({ kind: 'unavailable' });
    expect(t.states.some((s) => s.kind === 'project')).toBe(false);
    // The requester is not wedged: after Retry a new request is sent.
    t.setDown(false);
    t.r.request(q(3));
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.calls[1].q.day).toBe(3);
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
