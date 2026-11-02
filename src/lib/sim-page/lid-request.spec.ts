import { describe, expect, it } from 'vitest';
import type { HeightLids } from '$lib/map/height/types';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import type { HeightLidsResult } from '$lib/sim/scenario/types';
import { LidRequest, clampBbox } from './lid-request';

type BBox = [number, number, number, number];
const lidsOf = (limitsRev: number) => ({ limitsRev }) as unknown as HeightLids;
const ok = (rev: number, missing = 0): HeightLidsResult => ({
  ok: true,
  lids: lidsOf(rev),
  missing
});
const fail = (reason: 'no-session' | 'superseded' | 'too-large'): HeightLidsResult => ({
  ok: false,
  reason,
  message: reason
});

function setup() {
  const sent: BBox[] = [];
  const resolvers: ((r: HeightLidsResult) => void)[] = [];
  const shown: (HeightLids | null)[] = [];
  const r = new LidRequest({
    request: (bbox) => {
      sent.push(bbox);
      return new Promise((res) => resolvers.push(res));
    },
    show: (l) => shown.push(l)
  });
  /** Answers the latest request. */
  const answer = async (res: HeightLidsResult) => {
    resolvers.at(-1)!(res);
    await tick();
  };
  return { r, sent, resolvers, shown, answer };
}
const tick = () => new Promise((res) => setTimeout(res, 0));
const A: BBox = [-122.42, 37.77, -122.41, 37.78];
const B: BBox = [-122.43, 37.77, -122.42, 37.78];
const C: BBox = [-122.44, 37.77, -122.43, 37.78];

describe('clampBbox', () => {
  it('clampBbox keeps a small bbox and clamps a 6 km one to 3 km around its centre', () => {
    expect(clampBbox(A, 3000)).toEqual(A);
    // 6 km wide and 1 km tall around (-122.42, 37.77): a 2560 px view at z14.5.
    const halfW = 3000 / M_PER_DEG_LNG;
    const halfH = 500 / M_PER_DEG_LAT;
    const wide: BBox = [-122.42 - halfW, 37.77 - halfH, -122.42 + halfW, 37.77 + halfH];
    const c = clampBbox(wide, 3000);
    expect((c[2] - c[0]) * M_PER_DEG_LNG).toBeCloseTo(3000, 3);
    expect((c[0] + c[2]) / 2).toBeCloseTo(-122.42, 9);
    expect(c[1]).toBe(wide[1]);
    expect(c[3]).toBe(wide[3]);
    // Tall too (very pitched): both axes clamp.
    const big: BBox = [-122.5, 37.7, -122.4, 37.8];
    const d = clampBbox(big, 3000);
    expect((d[2] - d[0]) * M_PER_DEG_LNG).toBeCloseTo(3000, 3);
    expect((d[3] - d[1]) * M_PER_DEG_LAT).toBeCloseTo(3000, 3);
    expect((d[1] + d[3]) / 2).toBeCloseTo(37.75, 9);
  });
});

describe('clampBbox around the view centre (R14)', () => {
  it('pitched: the far edge runs out, the box keeps the view centre and the near part of the view', () => {
    // 1 km before the centre (the near, bottom edge) to 3.6 km beyond it; 2 km wide.
    const centre: [number, number] = [-122.42, 37.76];
    const kmLat = 1000 / M_PER_DEG_LAT;
    const kmLng = 1000 / M_PER_DEG_LNG;
    const view: BBox = [
      centre[0] - kmLng,
      centre[1] - 1 * kmLat,
      centre[0] + kmLng,
      centre[1] + 3.6 * kmLat
    ];
    const c = clampBbox(view, 3000, centre);
    expect((c[3] - c[1]) * M_PER_DEG_LAT).toBeCloseTo(3000, 3);
    // the near part of the view, whole: the bottom edge stays
    expect(c[1]).toBe(view[1]);
    expect(c[1] <= centre[1] && centre[1] <= c[3]).toBe(true);
    expect([c[0], c[2]]).toEqual([view[0], view[2]]);
    // the bbox-centre clamp would have lost the near 0.8 km
    expect(clampBbox(view, 3000)[1]).toBeGreaterThan(centre[1] - 0.3 * kmLat);
  });

  it('a centre in the middle of a wide view clamps around it, both axes', () => {
    const centre: [number, number] = [-122.45, 37.75];
    const big: BBox = [-122.5, 37.7, -122.4, 37.8];
    const d = clampBbox(big, 3000, centre);
    expect((d[0] + d[2]) / 2).toBeCloseTo(centre[0], 9);
    expect((d[1] + d[3]) / 2).toBeCloseTo(centre[1], 9);
  });
});

describe('LidRequest', () => {
  it('one request in flight; the latest bbox goes after the answer; older answers are dropped', async () => {
    const t = setup();
    t.r.want(A);
    t.r.want(B);
    t.r.want(C);
    expect(t.sent).toEqual([A]);
    await t.answer(ok(1)); // A's answer: superseded by a newer want, dropped
    expect(t.shown).toEqual([]);
    expect(t.sent).toEqual([A, C]);
    const last = ok(1);
    await t.answer(last);
    expect(t.shown).toEqual([last.ok && last.lids]);
    expect(t.sent).toEqual([A, C]);
    // The same bbox again: nothing to ask.
    t.r.want(C);
    expect(t.sent).toHaveLength(2);
  });

  it('want(null) clears; an answer arriving after it is dropped', async () => {
    const t = setup();
    t.r.want(A);
    t.r.want(null);
    expect(t.shown).toEqual([null]);
    await t.answer(ok(1));
    expect(t.shown).toEqual([null]);
    t.r.want(null); // already clear
    expect(t.shown).toEqual([null]);
    expect(t.sent).toEqual([A]);
  });

  it('limitsChanged and chunksChanged (after missing > 0) ask again; chunksChanged after missing 0 does not', async () => {
    const t = setup();
    t.r.limitsChanged(1); // nothing wanted yet: nothing to ask
    expect(t.sent).toEqual([]);
    t.r.want(A);
    await t.answer(ok(1, 0));
    t.r.chunksChanged();
    expect(t.sent).toHaveLength(1);
    t.r.limitsChanged(2);
    expect(t.sent).toEqual([A, A]);
    t.r.limitsChanged(2); // the same revision again
    expect(t.sent).toHaveLength(2);
    await t.answer(ok(2, 3));
    t.r.chunksChanged();
    expect(t.sent).toEqual([A, A, A]);
    // A superseded answer is ignored: what is shown stays.
    await t.answer(fail('superseded'));
    expect(t.shown.at(-1)).toMatchObject({ limitsRev: 2 });
  });

  it('no-session shows null; sessionChanged asks again', async () => {
    const t = setup();
    t.r.sessionChanged(); // nothing failed: nothing to ask
    t.r.want(A);
    await t.answer(ok(1));
    t.r.sessionChanged();
    expect(t.sent).toHaveLength(1);
    t.r.limitsChanged(2);
    await t.answer(fail('no-session'));
    expect(t.shown.at(-1)).toBeNull();
    t.r.chunksChanged(); // a chunk is no reason: the session is gone
    expect(t.sent).toHaveLength(2);
    t.r.sessionChanged();
    expect(t.sent).toEqual([A, A, A]);
    const back = ok(2);
    await t.answer(back);
    expect(t.shown.at(-1)).toBe(back.ok && back.lids);
  });

  it('M4: a new session forgets the last revision, so its first heights asks again even at the same rev', async () => {
    const t = setup();
    t.r.want(A);
    t.r.limitsChanged(1);
    await t.answer(ok(1));
    await t.answer(ok(1));
    expect(t.sent).toHaveLength(2);
    // a new client counts revisions from the start again: its rev 1 is new limits
    t.r.sessionChanged();
    t.r.limitsChanged(1);
    expect(t.sent).toEqual([A, A, A]);
    t.r.limitsChanged(1); // the same revision of the same session: no new request
    expect(t.sent).toHaveLength(3);
  });

  it('a rejected request shows null and is asked again on a new session', async () => {
    const shown: (HeightLids | null)[] = [];
    const rejecters: ((e: unknown) => void)[] = [];
    const r = new LidRequest({
      request: () => new Promise((_res, rej) => rejecters.push(rej)),
      show: (l) => shown.push(l)
    });
    r.want(A);
    rejecters[0](new Error('gone'));
    await tick();
    expect(shown).toEqual([null]);
    r.sessionChanged();
    expect(rejecters).toHaveLength(2);
  });
});
