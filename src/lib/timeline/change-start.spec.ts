// Where a policy change first takes effect, and where the playhead resets to.
import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import type { Policy, SimPolicy4 } from './policy4';
import { changeStart, resetDay } from './change-start';

const d = (y: number, m: number) => dayFromUtc(y, m, 1);
const ASOF = d(2026, 11);

function policy(id: string, on: boolean, from: number[] = [d(2030, 1)]): Policy {
  return {
    id,
    label: id,
    preset: null,
    on,
    where: { tag: 'baseline' },
    spans: from.map((f) => ({ from: f, to: null, what: { tag: 'protect', years: null } }))
  };
}
const doc = (zoning: Policy[] = [], permitting: Policy[] = []): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting, money: [] }
});

describe('changeStart', () => {
  it('switching a policy on or off returns its first span start', () => {
    const off = doc([policy('a', false)]);
    const on = doc([policy('a', true)]);
    expect(changeStart(off, on, ASOF)).toBe(d(2030, 1));
    expect(changeStart(on, off, ASOF)).toBe(d(2030, 1));
  });

  it('adding a policy that is off, or editing one that is off, changes nothing', () => {
    expect(changeStart(doc(), doc([policy('a', false)]), ASOF)).toBeNull();
    expect(
      changeStart(doc([policy('a', false)]), doc([policy('a', false, [d(2035, 1)])]), ASOF)
    ).toBeNull();
  });

  it('adding or removing a policy that is on returns its start', () => {
    expect(changeStart(doc(), doc([policy('a', true, [d(2035, 1)])]), ASOF)).toBe(d(2035, 1));
    expect(changeStart(doc([policy('a', true, [d(2035, 1)])]), doc(), ASOF)).toBe(d(2035, 1));
  });

  it('moving a span earlier returns the earlier start; both sides count', () => {
    const a = doc([policy('a', true, [d(2035, 1)])]);
    const b = doc([policy('a', true, [d(2030, 1)])]);
    expect(changeStart(a, b, ASOF)).toBe(d(2030, 1));
    expect(changeStart(b, a, ASOF)).toBe(d(2030, 1));
  });

  it('a span from 0 returns asOf', () => {
    expect(changeStart(doc(), doc([policy('a', true, [0])]), ASOF)).toBe(ASOF);
  });

  it('reordering on policies in a kind returns the earlier of their starts', () => {
    const a = policy('a', true, [d(2040, 1)]);
    const b = policy('b', true, [d(2035, 1)]);
    expect(changeStart(doc([a, b]), doc([b, a]), ASOF)).toBe(d(2035, 1));
  });

  it('a change in another kind is found, and the earliest of several wins', () => {
    const before = doc([policy('a', false)], [policy('p', false, [d(2032, 1)])]);
    const after = doc([policy('a', true, [d(2040, 1)])], [policy('p', true, [d(2032, 1)])]);
    expect(changeStart(before, after, ASOF)).toBe(d(2032, 1));
  });

  it('identical documents return null', () => {
    const x = doc([policy('a', true)], [policy('p', true)]);
    expect(changeStart(x, structuredClone(x), ASOF)).toBeNull();
  });
});

describe('resetDay', () => {
  it('is max(asOf, from), whatever the playhead was', () => {
    expect(resetDay(ASOF, d(2045, 1))).toBe(d(2045, 1));
    expect(resetDay(ASOF, 0)).toBe(ASOF);
  });
});
