import { describe, expect, it } from 'vitest';
import type { LotOutlinesResult } from '$lib/sim/scenario/types';
import { OutlineRequest } from './outline-request';

type Ok = Extract<LotOutlinesResult, { ok: true }>;
const answer = (lots: string[], missing = 0): Ok => ({
  ok: true,
  lots,
  ringLot: new Uint32Array(),
  starts: Uint32Array.from([0]),
  positions: new Float64Array(),
  missing
});

function setup() {
  const sent: string[][] = [];
  const resolvers: ((r: LotOutlinesResult) => void)[] = [];
  const shown: (Ok | null)[] = [];
  const r = new OutlineRequest({
    request: (lots) => {
      sent.push(lots);
      return new Promise((res) => resolvers.push(res));
    },
    show: (o) => shown.push(o)
  });
  return { r, sent, resolvers, shown };
}
const tick = () => new Promise((res) => setTimeout(res, 0));

describe('OutlineRequest', () => {
  it('want(null) clears and sends nothing', () => {
    const t = setup();
    t.r.want(new Set(['a']));
    t.r.want(null);
    expect(t.shown).toEqual([null]);
    expect(t.sent).toEqual([['a']]);
    t.r.want(null); // already clear
    expect(t.shown).toEqual([null]);
  });

  it('the same set again sends no new request', () => {
    const t = setup();
    t.r.want(new Set(['a', 'b']));
    t.r.want(new Set(['b', 'a']));
    expect(t.sent).toEqual([['a', 'b']]);
  });

  it('shows only the latest of two wants, even if the older answers last', async () => {
    const t = setup();
    t.r.want(new Set(['a']));
    t.r.want(new Set(['b']));
    const second = answer(['b']);
    t.resolvers[1](second);
    await tick();
    t.resolvers[0](answer(['a']));
    await tick();
    expect(t.shown).toEqual([second]);
  });

  it('an answer after the eraser was left is dropped', async () => {
    const t = setup();
    t.r.want(new Set(['a']));
    t.r.want(null);
    t.resolvers[0](answer(['a']));
    await tick();
    expect(t.shown).toEqual([null]);
  });

  it('re-requests on chunks when the answer had missing lots', async () => {
    const t = setup();
    t.r.want(new Set(['a', 'b']));
    t.resolvers[0](answer(['a'], 1));
    await tick();
    t.r.chunksChanged();
    expect(t.sent).toEqual([
      ['a', 'b'],
      ['a', 'b']
    ]);
    const full = answer(['a', 'b']);
    t.resolvers[1](full);
    await tick();
    expect(t.shown.at(-1)).toBe(full);
  });

  it('sends nothing on chunks when nothing was missing', async () => {
    const t = setup();
    t.r.want(new Set(['a']));
    t.resolvers[0](answer(['a'], 0));
    await tick();
    t.r.chunksChanged();
    expect(t.sent).toHaveLength(1);
  });

  it('asks again on a chunk after a no-session answer', async () => {
    const t = setup();
    t.r.want(new Set(['a']));
    t.resolvers[0]({ ok: false, reason: 'no-session', message: 'x' });
    await tick();
    t.r.chunksChanged();
    expect(t.sent).toHaveLength(2);
  });

  it('an empty set shows nothing and sends nothing', () => {
    const t = setup();
    t.r.want(new Set());
    expect(t.sent).toEqual([]);
    expect(t.shown).toEqual([null]);
  });
});
