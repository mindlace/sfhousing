// Initiation detection basis: record (F >= 2015) vs permit (raw first filing P) (spec §4.6).
import { describe, expect, it } from 'vitest';
import { firstFiledDays, initiationEvents, monthIndex } from '../../lib/fzp-cal/panel';
import type { NormHistory, PermitRow } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import type { Day, ProjectHistory, Stage } from '../../../src/lib/timelapse/types';

const d = isoToDay;
const m = (iso: string) => monthIndex(d(iso));
const noArea = () => 0;

function hist(
  id: string,
  entered: Partial<Record<Stage, Day>>,
  eff: Partial<Record<Stage, Day>> = entered
): NormHistory {
  const end: ProjectHistory['end'] = { kind: 'open', lastObserved: d('2026-09-30') };
  // A variable, not a returned literal: NormHistory is gaining fields concurrently (noFcd).
  const h = {
    id,
    pathway: 'discretionary' as const,
    parcelIds: ['A'],
    eff: { ...eff },
    end,
    purgeCensored: false,
    noFcd: false,
    src: {
      id,
      pathway: 'discretionary' as const,
      parcelIds: ['A'],
      entered,
      end,
      unitsAt: { filed: 10 },
      existingUnits: 0,
      storiesProposed: null,
      baseStoriesAtFiling: null,
      sources: [],
      quality: []
    }
  };
  return h;
}

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
    site_permit: true,
    status: 'filed',
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

describe('firstFiledDays', () => {
  it('takes the minimum non-null filed_day per project, superseded refiles included', () => {
    const p = firstFiledDays([
      permit({ project_id: 'h', filed_day: d('2012-06-01') }),
      permit({ project_id: 'h', filed_day: d('2010-02-01'), superseded: true, live: false }),
      permit({ project_id: 'h', filed_day: null }),
      permit({ project_id: 'g', filed_day: null }),
      permit({ project_id: null, filed_day: d('2001-01-01') })
    ]);
    expect(p.get('h')).toBe(d('2010-02-01'));
    expect(p.has('g')).toBe(false);
    expect(p.size).toBe(1);
  });
});

describe('detection basis', () => {
  it('F >= 2015-01-01 is basis record with the event at F', () => {
    const ev = initiationEvents(
      [hist('h', { filed: d('2015-01-01') })],
      new Map([['h', d('2013-01-01')]]),
      noArea
    );
    expect(ev.timeline.get('A')?.[m('2015-01-01')]).toBe(1);
    expect(ev.timeline.get('A')?.[m('2013-01-01')]).toBe(0);
  });

  it('F < 2015 is basis permit with the event at P; months between F and P are at risk', () => {
    const ev = initiationEvents(
      [hist('h', { filed: d('2010-05-01') })],
      new Map([['h', d('2012-02-15')]]),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(t[m('2010-05-01')]).toBe(0);
    expect(t[m('2012-01-01')]).toBe(0);
    expect(t[m('2012-02-01')]).toBe(2);
    expect(t[m('2012-03-01')]).toBe(-1);
  });

  it('IA-11: two filings 2011-03-01 and 2012-06-01, permitFiled clamped to 2012-09-01', () => {
    const permits = [
      permit({ project_id: 'h', filed_day: d('2012-06-01') }),
      permit({ project_id: 'h', filed_day: d('2011-03-01') })
    ];
    const ev = initiationEvents(
      [hist('h', { permitFiled: d('2012-09-01') })],
      firstFiledDays(permits),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(t[m('2011-03-01')]).toBe(2);
    expect(t[m('2011-02-01')]).toBe(0);
    expect(t[m('2011-04-01')]).toBe(-1);
    expect(t[m('2012-09-01')]).toBe(-1);
  });

  it('a superseded refile filed earliest still sets P', () => {
    const permits = [
      permit({ project_id: 'h', filed_day: d('2013-07-01') }),
      permit({ project_id: 'h', filed_day: d('2009-11-20'), superseded: true, live: false })
    ];
    const ev = initiationEvents(
      [hist('h', { filed: d('2009-01-01') })],
      firstFiledDays(permits),
      noArea
    );
    expect(ev.timeline.get('A')?.[m('2009-11-01')]).toBe(2);
    expect(ev.timeline.get('A')?.[m('2013-07-01')]).toBe(-1);
  });

  it('no permit row before 2015: no event and no coverage', () => {
    const ev = initiationEvents([hist('h', { filed: d('2010-05-01') })], new Map(), noArea);
    expect(ev.noPermit).toBe(1);
    expect(Array.from(ev.timeline.get('A') ?? []).every((v) => v === 0)).toBe(true);
  });

  it('a P before the panel gives no event month and coverage from the panel start', () => {
    const ev = initiationEvents(
      [hist('h', { filed: d('2004-05-01') })],
      new Map([['h', d('2005-03-01')]]),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(ev.outOfRange).toBe(1);
    expect(Array.from(t).every((v) => v === -1)).toBe(true);
  });

  it('F is read from the raw entered days: an imputed earlier filed day does not move it', () => {
    // Raw: entitled 2014-03 then permitFiled 2016-02; gap imputation set eff.filed = entitled.
    const raw = { entitled: d('2014-03-01'), permitFiled: d('2016-02-01') };
    const ev = initiationEvents(
      [hist('h', raw, { ...raw, filed: d('2014-03-01') })],
      new Map([['h', d('2016-01-10')]]),
      noArea
    );
    const t = ev.timeline.get('A') as Int8Array;
    expect(t[m('2016-02-01')]).toBe(1);
    expect(t[m('2016-01-01')]).toBe(0);
    expect(t[m('2014-03-01')]).toBe(0);
  });
});
