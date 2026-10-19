// Rulings SP1, SP2: supersession of refiled in-flight Planning projects (address, block, units,
// strictly later open day).
import { describe, expect, it } from 'vitest';
import {
  normalisedAddress,
  supersedeKey,
  supersessions,
  type SupersedeCandidate
} from '../../project-records/supersede';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

function c(o: Partial<SupersedeCandidate> & { id: string }): SupersedeCandidate {
  return {
    recordId: o.id.replace(/^PRJ:/, ''),
    address: null,
    label: '667 Folsom St',
    parcelIds: ['3750081'],
    units: 230,
    openDay: d('2020-01-01'),
    firstPermitFiled: null,
    ...o
  };
}

describe('normalisedAddress', () => {
  it('upper-cases and collapses whitespace; null and 0 UNKNOWN never match', () => {
    expect(normalisedAddress('  667  Folsom\tSt ')).toBe('667 FOLSOM ST');
    expect(normalisedAddress(null)).toBeNull();
    expect(normalisedAddress('   ')).toBeNull();
    expect(normalisedAddress('0 Unknown St')).toBeNull();
    expect(normalisedAddress('0 UNKNOWN')).toBeNull();
  });

  it('strips a trailing 5-digit ZIP (Ruling SP2)', () => {
    expect(normalisedAddress('2513 Irving St 94122')).toBe('2513 IRVING ST');
    expect(normalisedAddress('249 MISSISSIPPI ST  94107 ')).toBe('249 MISSISSIPPI ST');
    // Only a trailing 5-digit group: a 4- or 6-digit tail, or a leading number, stays.
    expect(normalisedAddress('100 Main St 9410')).toBe('100 MAIN ST 9410');
    expect(normalisedAddress('100 Main St 941070')).toBe('100 MAIN ST 941070');
    expect(normalisedAddress('94107')).toBeNull();
    expect(normalisedAddress('0 UNKNOWN 94107')).toBeNull();
  });

  it("also strips ZIP+4 and a trailing ', SAN FRANCISCO[, CA]' (Ruling M6)", () => {
    expect(normalisedAddress('209 Forest Rd, San Francisco, CA 94134')).toBe('209 FOREST RD');
    expect(normalisedAddress('2175 BAYSHORE BLVD 94134-1234')).toBe('2175 BAYSHORE BLVD');
    expect(normalisedAddress('2175 Bayshore Blvd, San Francisco')).toBe('2175 BAYSHORE BLVD');
    expect(normalisedAddress('2175 Bayshore Blvd SAN FRANCISCO CA 94134')).toBe(
      '2175 BAYSHORE BLVD'
    );
    expect(normalisedAddress('94134-1234')).toBeNull();
  });

  it("keys on the primary PRJ's address, falling back to the label (Ruling SP2)", () => {
    expect(supersedeKey({ address: '2513 Irving St 94122', label: '2513 Irving St' })).toBe(
      '2513 IRVING ST'
    );
    expect(supersedeKey({ address: null, label: '2513 Irving St 94122' })).toBe('2513 IRVING ST');
    expect(supersedeKey({ address: '  ', label: '2513 Irving St' })).toBe('2513 IRVING ST');
    expect(supersedeKey({ address: null, label: null })).toBeNull();
  });
});

describe('supersessions (Rulings SP1, SP2)', () => {
  it('same address, same block, units within 25%: the latest-opened is kept', () => {
    const r = supersessions([
      c({ id: 'PRJ:2015-002604PRJ', parcelIds: ['3750078', '3750082'], openDay: d('2015-02-20') }),
      c({ id: 'PRJ:2023-001682PRJ', parcelIds: ['3750081'], openDay: d('2023-02-01') })
    ]);
    expect([...r.superseded]).toEqual([['PRJ:2015-002604PRJ', 'PRJ:2023-001682PRJ']]);
    expect(r.tested).toBe(2);
  });

  it('same-day filings are siblings, never superseded (Ruling SP2)', () => {
    // 666 Hamilton / 40 Nevada: several buildings filed on one day under one address.
    const r = supersessions([
      c({ id: 'PRJ:2021-009384PRJ' }),
      c({ id: 'PRJ:2021-009386PRJ' }),
      c({ id: 'PRJ:2021-009385PRJ' })
    ]);
    expect(r.superseded.size).toBe(0);
    // A later refile supersedes every same-day sibling it matches.
    const later = supersessions([
      c({ id: 'PRJ:2021-009384PRJ' }),
      c({ id: 'PRJ:2021-009385PRJ' }),
      c({ id: 'PRJ:2023-000001PRJ', openDay: d('2023-01-01') })
    ]);
    expect(Object.fromEntries(later.superseded)).toEqual({
      'PRJ:2021-009384PRJ': 'PRJ:2023-000001PRJ',
      'PRJ:2021-009385PRJ': 'PRJ:2023-000001PRJ'
    });
  });

  it('earliest permits filed the same day are siblings, never superseded (Ruling SP3)', () => {
    // 40 Nevada: PRJs opened 2020-12-18 and 2022-09-23, permits on two lots filed 2020-08-27.
    const pair = (a: number | null, b: number | null) =>
      supersessions([
        c({ id: 'PRJ:2020-011739PRJ', openDay: d('2020-12-18'), firstPermitFiled: a }),
        c({ id: 'PRJ:2022-009282PRJ', openDay: d('2022-09-23'), firstPermitFiled: b })
      ]).superseded.size;
    expect(pair(d('2020-08-27'), d('2020-08-27'))).toBe(0);
    expect(pair(d('2020-08-27'), d('2022-10-01'))).toBe(1);
    // No permit on either side is no evidence of a sibling.
    expect(pair(null, null)).toBe(1);
    expect(pair(d('2020-08-27'), null)).toBe(1);
  });

  it('a null open day is never a keeper, and is superseded by a dated refile', () => {
    expect(
      supersessions([c({ id: 'PRJ:A', openDay: null }), c({ id: 'PRJ:B', openDay: null })])
        .superseded.size
    ).toBe(0);
    expect([
      ...supersessions([c({ id: 'PRJ:A', openDay: null }), c({ id: 'PRJ:B' })]).superseded
    ]).toEqual([['PRJ:A', 'PRJ:B']]);
  });

  it('matches on the PRJ address with its ZIP stripped, not the label (Ruling SP2)', () => {
    // 2513 Irving: the permit-derived labels differ; the PRJ addresses match once ZIPs go.
    const r = supersessions([
      c({
        id: 'PRJ:2019-000001PRJ',
        address: '2513 IRVING ST 94122',
        label: '2513 IRVING ST',
        openDay: d('2019-01-01')
      }),
      c({
        id: 'PRJ:2022-000002PRJ',
        address: '2513 Irving St',
        label: '2517 IRVING ST',
        openDay: d('2022-01-01')
      })
    ]);
    expect([...r.superseded]).toEqual([['PRJ:2019-000001PRJ', 'PRJ:2022-000002PRJ']]);
    // Equal labels do not match when the PRJ addresses differ.
    expect(
      supersessions([
        c({ id: 'PRJ:A', address: '1 A St', openDay: d('2019-01-01') }),
        c({ id: 'PRJ:B', address: '2 B St', openDay: d('2022-01-01') })
      ]).superseded.size
    ).toBe(0);
    // The label (ZIP stripped) stands in when a PRJ has no address.
    expect(
      supersessions([
        c({ id: 'PRJ:A', label: '667 FOLSOM ST 94107', openDay: d('2019-01-01') }),
        c({ id: 'PRJ:B', address: '667 Folsom St', openDay: d('2022-01-01') })
      ]).superseded.size
    ).toBe(1);
  });

  it('a different block, or units outside 25%, is not superseded', () => {
    expect(
      supersessions([
        c({ id: 'PRJ:A' }),
        c({ id: 'PRJ:B', parcelIds: ['3751001'], openDay: d('2021-01-01') })
      ]).superseded.size
    ).toBe(0);
    expect(
      supersessions([
        c({ id: 'PRJ:A', units: 1, openDay: d('2021-01-27') }),
        c({ id: 'PRJ:B', units: 4, openDay: d('2021-01-21') })
      ]).superseded.size
    ).toBe(0);
    // 0.75 x max is inside: 3 of 4.
    expect(
      supersessions([
        c({ id: 'PRJ:A', units: 3 }),
        c({ id: 'PRJ:B', units: 4, openDay: d('2021-01-01') })
      ]).superseded.size
    ).toBe(1);
  });

  it('a null or 0 UNKNOWN label never matches', () => {
    for (const label of [null, '0 UNKNOWN']) {
      const r = supersessions([
        c({ id: 'PRJ:A', label }),
        c({ id: 'PRJ:B', label, openDay: d('2021-01-01') })
      ]);
      expect(r.superseded.size, String(label)).toBe(0);
      expect(r.tested).toBe(2);
    }
  });

  it('split parts of one Planning record never supersede each other', () => {
    // Different open days (as two primaries never are), so only the record-id guard holds them.
    const r = supersessions([
      c({ id: 'PRJ:2013.0196:BP:201412163800', recordId: '2013.0196', openDay: d('2014-01-01') }),
      c({ id: 'PRJ:2013.0196:BP:201602129567', recordId: '2013.0196', openDay: d('2016-01-01') })
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
