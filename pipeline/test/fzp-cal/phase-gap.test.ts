// phaseGap: gaps between successive phases' permit filings (spec §4.7a).
import { describe, expect, it } from 'vitest';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import { phaseGap } from '../../lib/fzp-cal/phase-gap';
import type { PermitRow } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';

const d = isoToDay;
const ASOF = d('2026-09-30');

let seq = 0;
function permit(over: Partial<PermitRow>): PermitRow {
  seq++;
  return {
    permit_number: `P${seq}`,
    project_id: null,
    prj_record_id: null,
    dva_record_id: null,
    prx_case_no: null,
    da: null,
    parcel_ids: [],
    proposed_units: 50,
    site_permit: false,
    status: 'issued',
    live: true,
    superseded: false,
    filed_day: null,
    issued_day: null,
    construction_day: null,
    complete_day: null,
    status_day: null,
    ...over
  };
}

/** A DA whose phases are filed at the given ISO dates. */
function da(key: string, dates: string[], over: Partial<PermitRow> = {}): PermitRow[] {
  return dates.map((iso) => permit({ da: key, filed_day: d(iso), ...over }));
}

const WINDOW_SENTENCE =
  'window 1989-01-01 on, decoupled from the transition windows (2007-01-01 on, set by the first assessor roll): phase gaps use permit filing days only, not existing units';

describe('phaseGap rung 1 (DA groups)', () => {
  it('forms one group from a DA spread over two project_ids', () => {
    const rows = [
      permit({ da: 'DA1', project_id: 'A', filed_day: d('2010-01-01') }),
      permit({ da: 'DA1', project_id: 'B', filed_day: d('2010-01-11') }),
      permit({ da: 'DA1', project_id: 'A', filed_day: d('2010-02-10') })
    ];
    const r = phaseGap(rows, ASOF, FIXTURE_CAL);
    expect(r.rung).toBe(1);
    expect(r.groups).toBe(1);
    expect(r.phaseGap.days).toEqual([10, 30]);
  });

  it('keys groups by coalesce(prx_case_no, dva_record_id, da)', () => {
    const rows = [
      permit({ prx_case_no: 'K', dva_record_id: 'V', da: 'D', filed_day: d('2010-01-01') }),
      permit({ prx_case_no: null, dva_record_id: 'K', da: 'D', filed_day: d('2010-01-05') }),
      // same prx as the first -> same group
      permit({ prx_case_no: 'K', dva_record_id: null, da: null, filed_day: d('2010-01-21') }),
      // no key: not in any DA group
      permit({ filed_day: d('2010-02-01') })
    ];
    const r = phaseGap(rows, ASOF, FIXTURE_CAL);
    expect(r.groups).toBe(1);
    expect(r.phaseGap.days).toEqual([4, 16]);
  });

  it('drops < 10 units, superseded, null-filed and out-of-window permits; merges same-day', () => {
    const rows = [
      ...da('DA', ['2010-01-01', '2010-01-01', '2010-01-31']), // same day merged -> one gap of 30
      permit({ da: 'DA', filed_day: d('2010-01-10'), proposed_units: 9 }),
      permit({ da: 'DA', filed_day: d('2010-01-15'), proposed_units: null }),
      permit({ da: 'DA', filed_day: d('2010-01-20'), superseded: true }),
      permit({ da: 'DA', filed_day: null }),
      permit({ da: 'DA', filed_day: d('1988-12-31') }),
      permit({ da: 'DA', filed_day: d('2026-10-01') })
    ];
    const r = phaseGap(rows, ASOF, FIXTURE_CAL);
    expect(r.rung).toBe(1);
    expect(r.phaseGap.days).toEqual([30]);
    expect(r.phaseGap.provenance.n).toBe(1);
  });

  it('a 1995 permit contributes a gap; the method states the decoupled window', () => {
    const rows = da('OLD', ['1995-03-01', '1995-06-01']);
    const r = phaseGap(rows, ASOF, FIXTURE_CAL);
    expect(r.phaseGap.days).toEqual([92]);
    const p = r.phaseGap.provenance;
    expect(p.tier).toBe(2);
    expect(p.label).toBe(
      'Gaps between phase permit filings in past SF Development Agreement projects (tier 2)'
    );
    expect(p.method).toContain(WINDOW_SENTENCE);
    expect(p.method).toContain('decoupled from the transition windows');
    expect(p.n).toBe(1);
    expect(p.window).toEqual(['1989-01-01', '2026-09-30']);
    expect(p.sources.length).toBeGreaterThan(0);
    for (const s of p.sources) expect(s.url.startsWith('https://')).toBe(true);
  });

  it('gaps are ascending across groups, and the method gives groups, gaps, median and IQR', () => {
    const rows = [
      ...da('A', ['2010-01-01', '2010-03-02', '2010-03-12']), // 60, 10
      ...da('B', ['2012-01-01', '2012-01-31']), // 30
      ...da('C', ['2014-01-01', '2014-01-21']), // 20
      ...da('LONE', ['2016-01-01']) // single phase: no gap, not a group
    ];
    const r = phaseGap(rows, ASOF, FIXTURE_CAL);
    expect(r.phaseGap.days).toEqual([10, 20, 30, 60]);
    expect(r.groups).toBe(3);
    const m = r.phaseGap.provenance.method;
    expect(m).toContain('3 DA groups');
    expect(m).toContain('4 gaps');
    expect(m).toContain('median 25');
    expect(m).toContain('IQR 17.5 to 37.5');
  });
});

describe('phaseGap ladder', () => {
  it('rung 1 needs phaseMinGaps gaps; fewer falls to rung 2 by project_id (tier 2, not DA-specific)', () => {
    const rows = [
      ...da('DA', ['2010-01-01', '2010-02-01']),
      // project-only multi-building project, no DA key
      permit({ project_id: 'PRJ', filed_day: d('2015-01-01') }),
      permit({ project_id: 'PRJ', filed_day: d('2015-07-01') }),
      permit({ project_id: 'PRJ', filed_day: d('2016-01-01') })
    ];
    expect(phaseGap(rows, ASOF, FIXTURE_CAL).rung).toBe(1);
    const live = phaseGap(rows, ASOF, { ...LIVE_CAL, phaseMinGaps: 2 });
    // rung 1 has 1 gap < 2; rung 2 (by project_id) has 2 gaps and passes
    expect(live.rung).toBe(2);
    expect(live.groups).toBe(1);
    expect(live.phaseGap.days).toEqual([181, 184]);
    const p = live.phaseGap.provenance;
    expect(p.tier).toBe(2);
    expect(p.method).toContain('not DA-specific');
    expect(p.method).toContain(WINDOW_SENTENCE);
    expect(p.n).toBe(2);
    expect(p.window).toEqual(['1989-01-01', '2026-09-30']);
  });

  it('rung 2 keeps only projects with >= 2 qualifying permits', () => {
    const rows = [
      // project P1: two qualifying permits plus a 9-unit one -> counts 2
      permit({ project_id: 'P1', filed_day: d('2015-01-01') }),
      permit({ project_id: 'P1', filed_day: d('2015-01-31') }),
      permit({ project_id: 'P1', filed_day: d('2015-03-01'), proposed_units: 9 }),
      // project P2: one qualifying permit + one superseded -> dropped
      permit({ project_id: 'P2', filed_day: d('2016-01-01') }),
      permit({ project_id: 'P2', filed_day: d('2016-06-01'), superseded: true }),
      // project P3: two permits on the same day: >= 2 qualifying but one phase, no gap
      permit({ project_id: 'P3', filed_day: d('2017-01-01') }),
      permit({ project_id: 'P3', filed_day: d('2017-01-01') })
    ];
    const r = phaseGap(rows, ASOF, FIXTURE_CAL);
    expect(r.rung).toBe(2);
    expect(r.groups).toBe(1);
    expect(r.phaseGap.days).toEqual([30]);
  });

  it('rung 3 is [730], tier 4, made up', () => {
    const rows = [
      permit({ project_id: 'ONE', filed_day: d('2015-01-01') }),
      permit({ da: 'SOLO', filed_day: d('2015-01-01') })
    ];
    const r = phaseGap(rows, ASOF, FIXTURE_CAL);
    expect(r.rung).toBe(3);
    expect(r.groups).toBe(0);
    expect(r.phaseGap.days).toEqual([730]);
    const p = r.phaseGap.provenance;
    expect(p.tier).toBe(4);
    expect(p.method).toContain('made up: no multi-phase history found');
    expect(p.sources.length).toBeGreaterThan(0);
    for (const s of p.sources) expect(s.url.startsWith('https://')).toBe(true);
  });

  it('Review Focus 5: no permits at all gives rung 3', () => {
    const r = phaseGap([], ASOF, FIXTURE_CAL);
    expect(r.rung).toBe(3);
    expect(r.phaseGap.days).toEqual([730]);
    expect(r.phaseGap.provenance.tier).toBe(4);
  });

  it('is independent of input order', () => {
    const rows = [
      ...da('A', ['2010-01-01', '2010-03-02', '2010-03-12']),
      ...da('B', ['2012-01-01', '2012-01-31'])
    ];
    const a = phaseGap(rows, ASOF, FIXTURE_CAL);
    const b = phaseGap([...rows].reverse(), ASOF, FIXTURE_CAL);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
