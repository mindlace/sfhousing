// pathwayForNew, ppaShare, the Local Program proxy and its diagnostic (spec §4.7).
import { describe, expect, it } from 'vitest';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import {
  localProgramDiagnostic,
  pathwayForNew,
  ppaShare,
  streamlinedForLocalProgram
} from '../../lib/fzp-cal/pathway-mix';
import type { NormHistory } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import type { Day, Pathway, Provenance, Stage } from '../../../src/lib/timelapse/types';

const d = isoToDay;
const ASOF = d('2026-09-30');

function hist(id: string, pathway: Pathway | null, eff: Partial<Record<Stage, Day>>): NormHistory {
  const end = { kind: 'open', lastObserved: ASOF } as const;
  return {
    id,
    pathway,
    parcelIds: [],
    eff,
    end,
    purgeCensored: false,
    src: {
      id,
      pathway,
      parcelIds: [],
      entered: eff,
      end,
      unitsAt: { filed: 10 },
      existingUnits: 0,
      storiesProposed: null,
      baseStoriesAtFiling: null,
      sources: [],
      quality: []
    }
  };
}

function many(prefix: string, pathway: Pathway, n: number, filed: string): NormHistory[] {
  return Array.from({ length: n }, (_, i) => hist(`${prefix}${i}`, pathway, { filed: d(filed) }));
}

function checkProvenance(p: Provenance): void {
  expect(p.label.length).toBeGreaterThan(0);
  expect(p.method.length).toBeGreaterThan(0);
  expect(p.sources.length).toBeGreaterThan(0);
  for (const s of p.sources) expect(s.url.startsWith('https:')).toBe(true);
  if (p.tier <= 2) {
    expect(p.n).toBeDefined();
    expect(p.window).toBeDefined();
  }
}

describe('pathwayForNew', () => {
  it('takes pathway shares of non-null histories whose first record is in [2015-01-01, asOf]', () => {
    const norm = [
      ...many('a', 'discretionary', 20, '2018-05-01'),
      ...many('b', 'streamlined', 10, '2020-05-01'),
      ...many('c', 'permitOnly', 20, '2016-05-01'),
      // excluded: first record before 2015, null pathway, after asOf
      ...many('old', 'streamlined', 40, '2014-12-31'),
      hist('nul', null, { filed: d('2019-01-01') }),
      hist('late', 'discretionary', { filed: d('2026-10-01') })
    ];
    const r = pathwayForNew(norm, [], ASOF, LIVE_CAL);
    expect(r.discretionary).toBe(0.4);
    expect(r.streamlined).toBe(0.2);
    expect(r.permitOnly).toBe(0.4);
    expect(r.provenance.tier).toBe(0);
    expect(r.provenance.n).toBe(50);
    expect(r.provenance.window).toEqual(['2015-01-01', '2026-09-30']);
    checkProvenance(r.provenance);
  });

  it('uses the earliest entered day of any stage as the first record', () => {
    const norm = [
      // preApplication in 2014 puts the first record before the window
      ...Array.from({ length: 5 }, (_, i) =>
        hist(`p${i}`, 'discretionary', { preApplication: d('2014-06-01'), filed: d('2016-01-01') })
      ),
      ...many('s', 'streamlined', 5, '2016-01-01')
    ];
    const r = pathwayForNew(norm, [], ASOF, FIXTURE_CAL);
    expect(r.provenance.n).toBe(5);
    expect(r.streamlined).toBe(1);
    expect(r.discretionary).toBe(0);
  });

  it('shares sum to 1 exactly: 6-decimal rounding, residual to the largest', () => {
    const norm = [
      ...many('a', 'discretionary', 1, '2018-01-01'),
      ...many('b', 'streamlined', 1, '2018-01-01'),
      ...many('c', 'permitOnly', 1, '2018-01-01')
    ];
    const r = pathwayForNew(norm, [], ASOF, FIXTURE_CAL);
    // 1/3 each: 0.333333 + 0.333333 + 0.333334; the residual goes to the first largest
    expect(r.discretionary).toBe(0.333334);
    expect(r.streamlined).toBe(0.333333);
    expect(r.permitOnly).toBe(0.333333);
    expect(Math.round((r.discretionary + r.streamlined + r.permitOnly) * 1e6)).toBe(1e6);
    for (const v of [r.discretionary, r.streamlined, r.permitOnly]) {
      expect(Math.round(v * 1e6) / 1e6).toBe(v);
    }
  });

  it('falls back to the in-flight pathway mix (tier 0) below N_SPELLS_MIN', () => {
    const norm = many('a', 'discretionary', 29, '2018-01-01');
    const inFlight: { pathway: Pathway }[] = [
      ...Array.from({ length: 6 }, () => ({ pathway: 'discretionary' as const })),
      ...Array.from({ length: 3 }, () => ({ pathway: 'streamlined' as const })),
      ...Array.from({ length: 1 }, () => ({ pathway: 'permitOnly' as const }))
    ];
    const r = pathwayForNew(norm, inFlight, ASOF, LIVE_CAL);
    expect(r.discretionary).toBe(0.6);
    expect(r.streamlined).toBe(0.3);
    expect(r.permitOnly).toBe(0.1);
    expect(r.provenance.tier).toBe(0);
    expect(r.provenance.n).toBe(10);
    expect(r.provenance.method).toContain('in-flight');
    checkProvenance(r.provenance);
    // exactly N_SPELLS_MIN qualifies: no fallback
    const at = pathwayForNew(many('a', 'discretionary', 30, '2018-01-01'), inFlight, ASOF, LIVE_CAL);
    expect(at.discretionary).toBe(1);
    expect(at.provenance.method).not.toContain('in-flight');
  });

  it('is a tier-4 even split when there is nothing to measure', () => {
    const r = pathwayForNew([], [], ASOF, LIVE_CAL);
    expect(r.discretionary + r.streamlined + r.permitOnly).toBeCloseTo(1, 12);
    expect(r.provenance.tier).toBe(4);
    checkProvenance(r.provenance);
  });
});

describe('ppaShare', () => {
  it('window starts 2023-07-08: a filing on 2023-07-07 is excluded', () => {
    const norm = [
      hist('x', 'discretionary', { preApplication: d('2023-06-01'), filed: d('2023-07-07') }),
      hist('a', 'discretionary', { filed: d('2023-07-08') }),
      hist('b', 'discretionary', { preApplication: d('2023-07-01'), filed: d('2023-07-08') }),
      hist('c', 'streamlined', { filed: d('2024-01-01') })
    ];
    const r = ppaShare(norm, ASOF);
    expect(r.discretionary).toBe(0.5);
    expect(r.streamlined).toBe(0);
    expect(r.permitOnly).toBe(0);
    expect(r.provenance.tier).toBe(0);
    expect(r.provenance.n).toBe(3);
    expect(r.provenance.window).toEqual(['2023-07-08', '2026-09-30']);
    expect(r.provenance.method).toContain(
      'measured after the PPA record series ended (2023-07-07)'
    );
    checkProvenance(r.provenance);
  });

  it('uses the first non-PPA entry, not the PPA entry, as the filing day', () => {
    const norm = [
      hist('a', 'discretionary', { preApplication: d('2023-07-20'), filed: d('2023-09-01') }),
      // filed before the window; a later PPA entry does not move the filing in
      hist('b', 'discretionary', { filed: d('2023-07-01'), preApplication: d('2023-08-01') }),
      // filed after asOf
      hist('c', 'discretionary', { filed: d('2026-10-05') })
    ];
    const r = ppaShare(norm, ASOF);
    expect(r.provenance.n).toBe(1);
    expect(r.discretionary).toBe(1);
  });

  it('with no filings in the window every share is 0, tier 4, not measured', () => {
    const r = ppaShare([hist('a', 'discretionary', { filed: d('2020-01-01') })], ASOF);
    expect(r.discretionary).toBe(0);
    expect(r.streamlined).toBe(0);
    expect(r.permitOnly).toBe(0);
    expect(r.provenance.tier).toBe(4);
    expect(r.provenance.method).toContain('not measured');
    checkProvenance(r.provenance);
  });
});

describe('streamlinedForLocalProgram', () => {
  it('is the tier-2 proxy provenance with the spec text', () => {
    const p = streamlinedForLocalProgram(1234, ASOF, { filings: 3, medianFiledToEntitled: 90 });
    expect(p.tier).toBe(2);
    expect(p.label).toBe('Local Program projects use streamlined-pathway rates (tier 2 proxy)');
    expect(p.method).toBe(
      'Local Program = administrative approval, 180-day clock, no DR or appeal (rule, tier 1: Planning Director Bulletin 11); durations and attrition taken from the streamlined tables, n = 1234'
    );
    expect(p.n).toBe(1234);
    expect(p.window).toEqual(['2015-01-01', '2026-09-30']);
    expect(p.sources[0].url).toContain('planning-director-bulletin-no-11');
    expect(p.sources.some((s) => s.url.startsWith('https://data.sf.gov/d/'))).toBe(true);
    checkProvenance(p);
  });
});

describe('localProgramDiagnostic', () => {
  it('counts filings since 2026-01-12 and their median filed-to-entitled days', () => {
    const norm = [
      hist('before', 'streamlined', { filed: d('2026-01-11'), entitled: d('2026-02-01') }),
      hist('a', 'streamlined', { filed: d('2026-01-12'), entitled: d('2026-03-12') }),
      hist('b', 'streamlined', { filed: d('2026-02-01'), entitled: d('2026-06-01') }),
      hist('c', 'discretionary', { preApplication: d('2026-01-02'), filed: d('2026-03-01') }),
      hist('d', 'streamlined', { filed: d('2026-04-01'), entitled: d('2026-04-11') })
    ];
    const r = localProgramDiagnostic(norm);
    expect(r.filings).toBe(4);
    // a = 59 days, b = 120, d = 10 -> median 59
    expect(r.medianFiledToEntitled).toBe(59);
  });

  it('is null when nothing was entitled yet', () => {
    const r = localProgramDiagnostic([hist('c', 'discretionary', { filed: d('2026-03-01') })]);
    expect(r).toEqual({ filings: 1, medianFiledToEntitled: null });
    expect(localProgramDiagnostic([])).toEqual({ filings: 0, medianFiledToEntitled: null });
  });
});
