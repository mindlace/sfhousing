// Ruling PV1: placeholder valuations filled from the permit's own estimate, its other rows, else
// the nearest permit of its project (pipeline/project-records/valuation.ts).
import { describe, expect, it } from 'vitest';
import { fillPlaceholderValuations } from '../../project-records/valuation';
import type { LinkedProject, Permit } from '../../project-records/types';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

function permit(number: string, over: Partial<Permit> = {}): Permit {
  return {
    number,
    type: '2',
    named: false,
    sitePermit: false,
    status: 'issued',
    statusDay: null,
    filedDay: d('2020-01-01'),
    issuedDay: null,
    fcdDay: null,
    completedDateDay: null,
    lastActivityDay: null,
    stories: null,
    existingUnits: null,
    proposedUnits: 5,
    valuation: null,
    rows: [],
    ...over
  };
}

/** A placeholder permit: today's value is its own estimate. */
const ph = (number: string, estimate: number | null, otherRows: number | null, filed: string) =>
  permit(number, {
    valuation: estimate,
    placeholder: { estimate, otherRows },
    filedDay: d(filed)
  });

const project = (id: string, permits: Permit[]) => ({ id, permits }) as unknown as LinkedProject;

describe('fillPlaceholderValuations (Ruling PV1)', () => {
  it('(a) its own estimate when real: unchanged, counted ownEstimate', () => {
    const q = ph('1', 250_000, 900_000, '2020-01-01');
    const r = fillPlaceholderValuations([project('P', [q])]);
    expect(q.valuation).toBe(250_000);
    expect(r.filled.get('1')).toBe('ownEstimate');
  });

  it('(b) another row of the same permit, before any project permit', () => {
    const q = ph('1', 500, 900_000, '2020-01-01');
    const sib = permit('2', { valuation: 3_000_000, filedDay: d('2020-01-01') });
    const r = fillPlaceholderValuations([project('P', [q, sib])]);
    expect(q.valuation).toBe(900_000);
    expect(r.filled.get('1')).toBe('ownRows');
  });

  it('(c) the nearest permit of the project by filed day with a real valuation of its own', () => {
    const q = ph('1', null, null, '2020-06-01');
    const far = permit('2', { valuation: 3_000_000, filedDay: d('2019-01-01') });
    const near = permit('3', { valuation: 2_000_000, filedDay: d('2020-09-01') });
    const tiny = permit('4', { valuation: 999, filedDay: d('2020-06-02') });
    // Another placeholder's real estimate counts (here the farthest; see the next tests).
    const other = ph('5', 1_500_000, null, '2018-01-01');
    const r = fillPlaceholderValuations([project('P', [q, far, near, tiny, other])]);
    expect(q.valuation).toBe(2_000_000);
    expect(r.filled.get('1')).toBe('projectPermit');
  });

  it('ties go to the later filed, then the lowest number, in either candidate order', () => {
    // 30 days before and 30 days after 2020-06-01: equidistant, so the later filed wins.
    const before = () => permit('1', { valuation: 1_000, filedDay: d('2020-05-02') });
    const after = () => permit('9', { valuation: 7_000, filedDay: d('2020-07-01') });
    for (const order of [
      (q: Permit) => [q, before(), after()],
      (q: Permit) => [q, after(), before()]
    ]) {
      const q = ph('5', null, null, '2020-06-01');
      fillPlaceholderValuations([project('P', order(q))]);
      expect(q.valuation).toBe(7_000);
    }
    // Same filed day: the lowest number wins.
    const a = () => permit('3', { valuation: 3_000, filedDay: d('2020-07-01') });
    const b = () => permit('2', { valuation: 2_000, filedDay: d('2020-07-01') });
    for (const order of [(q: Permit) => [q, a(), b()], (q: Permit) => [q, b(), a()]]) {
      const q = ph('5', null, null, '2020-06-01');
      fillPlaceholderValuations([project('P', order(q))]);
      expect(q.valuation).toBe(2_000);
    }
  });

  it('a placeholder candidate counts only through its own real estimate, never a filled value', () => {
    // A nearer placeholder with a real estimate wins.
    const q = ph('1', null, null, '2020-06-01');
    const nearPh = ph('2', 1_500_000, null, '2020-06-05');
    const far = permit('3', { valuation: 9_000_000, filedDay: d('2019-01-01') });
    fillPlaceholderValuations([project('P', [q, nearPh, far])]);
    expect(q.valuation).toBe(1_500_000);
    // A nearer placeholder with no real estimate is skipped, although it gets filled itself
    // (from `far`): no chaining, whichever placeholder is filled first.
    for (const order of [
      (x: Permit, y: Permit, z: Permit) => [x, y, z],
      (x: Permit, y: Permit, z: Permit) => [y, x, z]
    ]) {
      const q2 = ph('1', null, null, '2020-06-01');
      const nearNull = ph('2', 500, null, '2020-06-05');
      const far2 = permit('3', { valuation: 9_000_000, filedDay: d('2019-01-01') });
      fillPlaceholderValuations([project('P', order(q2, nearNull, far2))]);
      expect(nearNull.valuation).toBe(9_000_000);
      expect(q2.valuation).toBe(9_000_000);
    }
    const q3 = ph('1', null, null, '2020-06-01');
    const lone = ph('2', null, null, '2020-06-05');
    const r = fillPlaceholderValuations([project('P', [q3, lone])]);
    expect([q3.valuation, lone.valuation]).toEqual([null, null]);
    expect(r.unfilled.size).toBe(2);
  });

  it('none found: today’s value stays (null, or a sub-$1,000 estimate as is)', () => {
    const nul = ph('1', null, null, '2020-01-01');
    const small = ph('2', 600, 400, '2020-01-01');
    const r = fillPlaceholderValuations([project('P', [nul]), project('Q', [small])]);
    expect(nul.valuation).toBeNull();
    expect(small.valuation).toBe(600);
    expect([...r.unfilled].sort()).toEqual(['1', '2']);
    expect(r.filled.size).toBe(0);
  });

  it('a permit is filled once, from the first project in id order', () => {
    const q = ph('1', null, null, '2020-01-01');
    fillPlaceholderValuations([
      project('PRJ:B', [q, permit('3', { valuation: 9_000 })]),
      project('PRJ:A', [q, permit('2', { valuation: 5_000 })])
    ]);
    expect(q.valuation).toBe(5_000);
  });
});
