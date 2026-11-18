// The reveal rules: the furthest date reached and the first changed month of an edit (pure).
import { describe, expect, it } from 'vitest';
import type { TimelineView } from '$lib/sim/world/score/types';
import { viewOf } from '$lib/sim/world/score/view';
import {
  editedReveal,
  monthChanged,
  moved,
  revealOpen,
  scanned,
  type Reveal,
  type Side
} from './reveal';
import { calendarMonths, chunk, cut, statics } from './test/fixtures';

const base = calendarMonths(viewOf([chunk(0, 24)], statics()));
/** Same as `base` through month k - 1, shifted from month k on. */
const changedFrom = (k: number): TimelineView =>
  calendarMonths(viewOf([chunk(0, k), chunk(k, 24 - k, { base: 5 })], statics()));
const side = (view: TimelineView, inForce = false): Side => ({ view, inForce });
const M = base.months;
const ASOF = M[0];
const idle = { playing: false, asOf: ASOF };

/** The view with its rows read through a proxy that records the month indexes read. */
function counted(view: TimelineView): { view: TimelineView; reads: number[] } {
  const reads: number[] = [];
  const rows = new Proxy(view.rows, {
    get(target, key, recv) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key));
      return Reflect.get(target, key, recv);
    }
  });
  return { view: { ...view, rows }, reads };
}

/** A reveal that has reached month `reach` and is searching, as `editedReveal` leaves it. */
function searching(reach: number, before: Side = side(base)): Reveal {
  return editedReveal(moved(revealOpen(ASOF), M[reach]), before);
}

describe('revealOpen and moved', () => {
  it('opens with everything ahead unseen', () => {
    const r = revealOpen(ASOF);
    expect(r).toEqual({ reached: ASOF, finding: null, playFrom: null });
  });

  it('moving forward reaches further; moving back leaves it', () => {
    const r = moved(revealOpen(M[0]), M[10]);
    expect(r.reached).toBe(M[10]);
    expect(moved(r, M[3]).reached).toBe(M[10]);
  });

  it('moving clears an offered Play from, and returns the same object when nothing changes', () => {
    const offered: Reveal = { reached: M[10], finding: null, playFrom: 12 };
    expect(moved(offered, M[4])).toEqual({ reached: M[10], finding: null, playFrom: null });
    const plain = revealOpen(M[0]);
    expect(moved(plain, M[0])).toBe(plain);
    const high = moved(plain, M[10]);
    expect(moved(high, M[2])).toBe(high);
  });
});

describe('scanned', () => {
  it('an edit at today finds nothing to pull back', () => {
    const r = editedReveal(revealOpen(ASOF), side(base));
    const out = scanned(r, side(changedFrom(0)), { day: ASOF, ...idle });
    expect(out).toEqual({ reached: ASOF, finding: null, playFrom: null });
  });

  it('pulls back to the first changed month, months before it stay seen', () => {
    const out = scanned(searching(20), side(changedFrom(12)), { day: M[5], ...idle });
    expect(out.reached).toBe(M[12]);
    expect(out.playFrom).toBe(12);
    expect(out.finding).toBeNull();
  });

  it('never pulls back before the playhead', () => {
    const out = scanned(searching(20), side(changedFrom(12)), { day: M[15] + 3, ...idle });
    expect(out.reached).toBe(M[15] + 3);
    expect(out.playFrom).toBe(12);
  });

  it('at the last day the reach stays and Play from is offered', () => {
    const last = M[23] + 20;
    const r = editedReveal(moved(revealOpen(ASOF), last), side(base));
    const out = scanned(r, side(changedFrom(12)), { day: last, ...idle });
    expect(out.reached).toBe(last);
    expect(out.playFrom).toBe(12);
  });

  it('offers no Play from when the change is found while playing', () => {
    const out = scanned(searching(20), side(changedFrom(12)), {
      day: M[5],
      playing: true,
      asOf: ASOF
    });
    expect(out.reached).toBe(M[12]);
    expect(out.playFrom).toBeNull();
  });

  it('a change past the furthest month reached pulls nothing back', () => {
    const r = searching(10);
    const out = scanned(r, side(changedFrom(15)), { day: M[5], ...idle });
    expect(out.finding).toBeNull();
    expect(out.reached).toBe(r.reached);
    expect(out.playFrom).toBeNull();
  });

  it('waits for the fill: compares only the filled months, then goes on', () => {
    const r = searching(20);
    const partial = scanned(r, side(cut(changedFrom(12), 8)), { day: M[5], ...idle });
    expect(partial.finding?.next).toBe(9);
    expect(partial.reached).toBe(r.reached);
    const full = scanned(partial, side(changedFrom(12)), { day: M[5], ...idle });
    expect(full.reached).toBe(M[12]);
    expect(full.playFrom).toBe(12);
  });

  it('a second edit keeps the first view the person saw and starts again from month 0', () => {
    const first = searching(20);
    const partial = scanned(first, side(cut(changedFrom(12), 8)), { day: M[5], ...idle });
    const second = editedReveal(partial, side(changedFrom(12)));
    expect(second.finding?.before.view).toBe(base);
    expect(second.finding?.next).toBe(0);
    expect(second.playFrom).toBeNull();
    // And with nothing in play, a null before starts no search.
    expect(editedReveal(revealOpen(ASOF), null).finding).toBeNull();
  });

  it('approvals count: a change in entitledNew alone is a change', () => {
    const rows = base.rows.map((r, i) => (i === 7 ? { ...r, entitledNew: r.entitledNew + 1 } : r));
    const now = { ...base, rows };
    expect(monthChanged(side(base), side(now), 7)).toBe(true);
    expect(monthChanged(side(base), side(now), 6)).toBe(false);
    const out = scanned(searching(20), side(now), { day: M[5], ...idle });
    expect(out.playFrom).toBe(7);
  });

  it('in-force flips compare the current-law terms as drawn', () => {
    // The plan effect is zero through month 6 and the rows are the same: the first policy leaves
    // those months alone. From month 7 the effect shows in the rows.
    const eff = (k: number) => ({ entitledNew: k > 6 ? 4 : 0, completedNetNew: k > 6 ? 4 : 0 });
    const planEffect = base.planEffect.map((_, k) => eff(k));
    const rows = base.rows.map((r, k) => ({
      ...r,
      completedNet: r.completedNet + eff(k).completedNetNew,
      entitledNew: r.entitledNew + eff(k).entitledNew
    }));
    const a = side({ ...base, planEffect: base.planEffect.map(() => eff(0)) }, false);
    const b = side({ ...base, rows, planEffect }, true);
    for (let k = 0; k <= 6; k++) expect(monthChanged(a, b, k)).toBe(false);
    expect(monthChanged(a, b, 7)).toBe(true);
  });

  it('money and tiers count; a pool missing on one side reads as zeros', () => {
    const withPools = (pools: string[], k = 0) =>
      calendarMonths(viewOf([chunk(0, 24, { pools, base: k })], statics({ finance: true })));
    const a = withPools(['a', 'b']);
    expect(monthChanged(side(a), side(withPools(['a', 'b'])), 5)).toBe(false);
    expect(monthChanged(side(a), side(withPools(['a'])), 5)).toBe(true);
    // A missing pool reads as zeros: equal where the other side's pool is all zero.
    const zeroB = {
      ...a,
      money: {
        ...a.money!,
        pools: a.money!.pools.map((p) =>
          p.id === 'b'
            ? Object.fromEntries(
                Object.entries(p).map(([key, v]) => [key, Array.isArray(v) ? v.map(() => 0) : v])
              )
            : p
        ) as NonNullable<TimelineView['money']>['pools']
      }
    };
    const onlyA = {
      ...a,
      money: { ...a.money!, pools: a.money!.pools.filter((p) => p.id === 'a') }
    };
    expect(monthChanged(side(zeroB), side(onlyA), 5)).toBe(false);
    expect(monthChanged(side(a), side(onlyA), 5)).toBe(true);
    // A money series moves.
    const spent = {
      ...a,
      money: { ...a.money!, publicSpent: a.money!.publicSpent.map((v) => v + 1) }
    };
    expect(monthChanged(side(a), side(spent), 3)).toBe(true);
    const shown = {
      ...a,
      money: { ...a.money!, fundedHomes: a.money!.fundedHomes.map((v) => v + 1) }
    };
    expect(monthChanged(side(a), side(shown), 3)).toBe(true);
    // Money present on one side only.
    expect(monthChanged(side(a), side({ ...a, money: null }), 3)).toBe(true);
    expect(monthChanged(side({ ...a, money: null }), side({ ...a, money: null }), 3)).toBe(false);
    // Tiers.
    const tier = { low: 1, moderate: 2, above: 3 } as unknown as NonNullable<
      TimelineView['tiers']
    >[number];
    const t1 = { ...base, tiers: base.rows.map(() => tier) };
    const t2 = { ...base, tiers: base.rows.map((_, i) => (i === 4 ? { ...tier, low: 9 } : tier)) };
    expect(monthChanged(side(t1), side(t2), 4)).toBe(true);
    expect(monthChanged(side(t1), side(t2), 3)).toBe(false);
  });

  it('a mid-month dataset date: at reached === asOf nothing is compared', () => {
    const mid = M[0] + 10;
    const r = editedReveal(revealOpen(mid), side(base));
    const { view, reads } = counted(changedFrom(0));
    const out = scanned(r, side(view), { day: mid, playing: false, asOf: mid });
    expect(out).toEqual({ reached: mid, finding: null, playFrom: null });
    expect(reads).toEqual([]);
  });

  it('a mid-month dataset date: a day in month 0 after asOf compares month 0', () => {
    const mid = M[0] + 10;
    const day = mid + 5;
    const r = editedReveal(moved(revealOpen(mid), day), side(base));
    const out = scanned(r, side(changedFrom(0)), { day, playing: false, asOf: mid });
    expect(out).toEqual({ reached: day, finding: null, playFrom: 0 });
  });

  it('ending with nothing changed keeps reached from falling behind the playhead', () => {
    const r = searching(10);
    const out = scanned(r, side(changedFrom(15)), { day: M[12], ...idle });
    expect(out.reached).toBe(M[12]);
    expect(out.finding).toBeNull();
    expect(out.playFrom).toBeNull();
  });

  it('months past a shorter before cannot be shown unchanged: the first of them is changed', () => {
    const r = searching(8, side(cut(base, 3)));
    const waiting = scanned(r, side(cut(base, 3)), { day: M[2], ...idle });
    expect(waiting.finding?.next).toBe(4);
    const out = scanned(r, side(cut(base, 10)), { day: M[2], ...idle });
    expect(out).toEqual({ reached: M[4], finding: null, playFrom: 4 });
    const playing = scanned(r, side(cut(base, 10)), { day: M[2], playing: true, asOf: ASOF });
    expect(playing.playFrom).toBeNull();
    expect(playing.reached).toBe(M[4]);
  });

  it('a resumed scan does not read the months already compared', () => {
    const r = searching(20);
    const first = counted(cut(changedFrom(18), 8));
    const partial = scanned(r, side(first.view), { day: M[5], ...idle });
    expect(first.reads.length).toBeGreaterThan(0);
    const second = counted(changedFrom(18));
    const out = scanned(partial, side(second.view), { day: M[5], ...idle });
    expect(out.playFrom).toBe(18);
    expect(second.reads.length).toBeGreaterThan(0);
    expect(Math.min(...second.reads)).toBe(9);
  });

  it('without a search, scanned returns the same object', () => {
    const r = moved(revealOpen(ASOF), M[10]);
    expect(scanned(r, side(changedFrom(5)), { day: M[5], ...idle })).toBe(r);
    const s = searching(10);
    expect(scanned(s, null, { day: M[5], ...idle })).toBe(s);
  });
});
