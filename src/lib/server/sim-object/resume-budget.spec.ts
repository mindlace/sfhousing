import { describe, expect, it } from 'vitest';
import { ResumeBudgets, paysAsWriter } from './resume-budget';

const T0 = 1_700_000_000_000;
const att = { identity: 'id-1', write: true, resumed: false };

describe('paysAsWriter', () => {
  it("pays from the writers' budget only for a valid attachment with write", () => {
    expect(paysAsWriter(() => att)).toBe(true);
    expect(paysAsWriter(() => ({ ...att, resumed: true }))).toBe(true);
    expect(paysAsWriter(() => ({ ...att, write: false }))).toBe(false);
    expect(paysAsWriter(() => ({ identity: null, write: false, resumed: false }))).toBe(false);
  });

  it('fails closed: an attachment it cannot read pays as a reader', () => {
    for (const bad of [null, undefined, 'junk', { ...att, extra: 1 }, { ...att, write: 'yes' }]) {
      expect(paysAsWriter(() => bad)).toBe(false);
    }
    expect(
      paysAsWriter(() => {
        throw new Error('closed');
      })
    ).toBe(false);
  });
});

describe('ResumeBudgets.boundsFor', () => {
  /** Two budgets of 100 bytes that never refill, so a spent one shows who paid. */
  const small = () =>
    new ResumeBudgets(
      T0,
      { writers: { burst: 100, perSecond: 0 }, readers: { burst: 100, perSecond: 0 } },
      70
    );

  it('chooses the budget page by page, from the attachment as it is when the page is paid', () => {
    let current: unknown = att;
    const b = small().boundsFor(
      () => current,
      () => T0
    );
    expect(b.maxBytes).toBe(70);
    expect(b.take(60)).toBe(true); // writers: 40 left
    current = { ...att, write: false };
    expect(b.take(60)).toBe(true); // readers: 40 left
    current = att;
    expect(b.take(60)).toBe(false); // writers again: only 40
    current = { ...att, write: false };
    expect(b.take(40)).toBe(true); // readers' last 40
  });

  it('an attachment read that throws pays as a reader, and never from the writers', () => {
    const budgets = small();
    const b = budgets.boundsFor(
      () => {
        throw new Error('closed');
      },
      () => T0
    );
    expect(b.take(100)).toBe(true);
    expect(b.take(1)).toBe(false);
    const writer = budgets.boundsFor(
      () => att,
      () => T0
    );
    expect(writer.take(100)).toBe(true);
  });

  it('refills each budget with the clock it is given', () => {
    let now = T0;
    const b = new ResumeBudgets(
      T0,
      { writers: { burst: 10, perSecond: 10 }, readers: { burst: 10, perSecond: 10 } },
      10
    ).boundsFor(
      () => att,
      () => now
    );
    expect(b.take(10)).toBe(true);
    expect(b.take(1)).toBe(false);
    now = T0 + 500;
    expect(b.take(5)).toBe(true);
  });
});
