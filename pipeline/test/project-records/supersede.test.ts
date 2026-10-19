// Ruling SP1: supersession of refiled in-flight Planning projects (same address, block, units).
import { describe, expect, it } from 'vitest';
import {
  normalisedLabel,
  supersessions,
  type SupersedeCandidate
} from '../../project-records/supersede';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

function c(o: Partial<SupersedeCandidate> & { id: string }): SupersedeCandidate {
  return {
    recordId: o.id.replace(/^PRJ:/, ''),
    label: '667 Folsom St',
    parcelIds: ['3750081'],
    units: 230,
    openDay: d('2020-01-01'),
    ...o
  };
}

describe('normalisedLabel', () => {
  it('upper-cases and collapses whitespace; null and 0 UNKNOWN never match', () => {
    expect(normalisedLabel('  667  Folsom\tSt ')).toBe('667 FOLSOM ST');
    expect(normalisedLabel(null)).toBeNull();
    expect(normalisedLabel('   ')).toBeNull();
    expect(normalisedLabel('0 Unknown St')).toBeNull();
    expect(normalisedLabel('0 UNKNOWN')).toBeNull();
  });
});

describe('supersessions (Ruling SP1)', () => {
  it('same address, same block, units within 25%: the latest-opened is kept', () => {
    const r = supersessions([
      c({ id: 'PRJ:2015-002604PRJ', parcelIds: ['3750078', '3750082'], openDay: d('2015-02-20') }),
      c({ id: 'PRJ:2023-001682PRJ', parcelIds: ['3750081'], openDay: d('2023-02-01') })
    ]);
    expect([...r.superseded]).toEqual([['PRJ:2015-002604PRJ', 'PRJ:2023-001682PRJ']]);
    expect(r.tested).toBe(2);
  });

  it('ties on the open day go to the higher record id', () => {
    const r = supersessions([
      c({ id: 'PRJ:2021-009384PRJ' }),
      c({ id: 'PRJ:2021-009386PRJ' }),
      c({ id: 'PRJ:2021-009385PRJ' })
    ]);
    // A chain of three keeps one.
    expect(Object.fromEntries(r.superseded)).toEqual({
      'PRJ:2021-009384PRJ': 'PRJ:2021-009386PRJ',
      'PRJ:2021-009385PRJ': 'PRJ:2021-009386PRJ'
    });
  });

  it('a different block, or units outside 25%, is not superseded', () => {
    expect(
      supersessions([c({ id: 'PRJ:A' }), c({ id: 'PRJ:B', parcelIds: ['3751001'] })]).superseded
        .size
    ).toBe(0);
    expect(
      supersessions([
        c({ id: 'PRJ:A', units: 1, openDay: d('2021-01-27') }),
        c({ id: 'PRJ:B', units: 4, openDay: d('2021-01-21') })
      ]).superseded.size
    ).toBe(0);
    // 0.75 x max is inside: 3 of 4.
    expect(
      supersessions([c({ id: 'PRJ:A', units: 3 }), c({ id: 'PRJ:B', units: 4 })]).superseded.size
    ).toBe(1);
  });

  it('a null or 0 UNKNOWN label never matches', () => {
    for (const label of [null, '0 UNKNOWN']) {
      const r = supersessions([c({ id: 'PRJ:A', label }), c({ id: 'PRJ:B', label })]);
      expect(r.superseded.size, String(label)).toBe(0);
      expect(r.tested).toBe(2);
    }
  });

  it('split parts of one Planning record never supersede each other', () => {
    const r = supersessions([
      c({ id: 'PRJ:2013.0196:BP:201412163800', recordId: '2013.0196' }),
      c({ id: 'PRJ:2013.0196:BP:201602129567', recordId: '2013.0196' })
    ]);
    expect(r.superseded.size).toBe(0);
  });

  it('in a chain where only some pairs match, each superseded project names its keeper', () => {
    // C (latest) keeps B (within 25% of C); A matches B but not C, so A is kept too.
    const r = supersessions([
      c({ id: 'PRJ:A', units: 6, openDay: d('2019-01-01') }),
      c({ id: 'PRJ:B', units: 8, openDay: d('2020-01-01') }),
      c({ id: 'PRJ:C', units: 10, openDay: d('2021-01-01') })
    ]);
    expect(Object.fromEntries(r.superseded)).toEqual({ 'PRJ:B': 'PRJ:C' });
  });
});
