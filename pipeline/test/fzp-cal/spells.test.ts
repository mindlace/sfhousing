// Qualifying predicate, normalisation steps 1-4 and spell building (spec §4.4).
import { describe, expect, it } from 'vitest';
import { buildSpells, normalise, qualifies } from '../../lib/fzp-cal/spells';
import { isoToDay } from '../../project-records/multiphase';
import type { Day, ProjectHistory, Stage } from '../../../src/lib/timelapse/types';

const d = isoToDay;
const AS_OF = d('2026-06-30');

type Entered = Partial<Record<Stage, string>>;

function hist(
  id: string,
  pathway: ProjectHistory['pathway'],
  entered: Entered,
  end: ProjectHistory['end'],
  extra: Partial<ProjectHistory> = {}
): ProjectHistory {
  const e: Partial<Record<Stage, Day>> = {};
  for (const [s, iso] of Object.entries(entered)) e[s as Stage] = d(iso as string);
  return {
    id,
    pathway,
    parcelIds: [],
    entered: e,
    end,
    unitsAt: { filed: 10 },
    existingUnits: 0,
    storiesProposed: null,
    baseStoriesAtFiling: null,
    sources: [],
    ...extra
  };
}

const open = (iso: string): ProjectHistory['end'] => ({ kind: 'open', lastObserved: d(iso) });

describe('qualifies', () => {
  it('needs at least one net unit at the first recorded stage', () => {
    expect(
      qualifies(
        hist('a', 'discretionary', {}, open('2020-01-01'), {
          unitsAt: { filed: 5 },
          existingUnits: 4
        })
      )
    ).toBe(true);
    expect(
      qualifies(
        hist('a', 'discretionary', {}, open('2020-01-01'), {
          unitsAt: { filed: 5 },
          existingUnits: 5
        })
      )
    ).toBe(false);
    expect(
      qualifies(
        hist('a', 'discretionary', {}, open('2020-01-01'), { unitsAt: {}, existingUnits: 0 })
      )
    ).toBe(false);
  });

  it('reads the first recorded stage in STAGE_ORDER, not the largest', () => {
    const h = hist('a', 'discretionary', {}, open('2020-01-01'), {
      unitsAt: { permitFiled: 50, filed: 6 },
      existingUnits: 5
    });
    expect(qualifies(h)).toBe(true);
  });
});

describe('normalise', () => {
  it('imputes a missing stage between entered stages and tallies it once per history', () => {
    const h = hist(
      'p1',
      'discretionary',
      {
        filed: '2016-01-01',
        entitled: '2016-06-01',
        permitFiled: '2016-09-01',
        construction: '2017-05-01'
      },
      open('2020-01-01')
    );
    const other = hist('p0', 'discretionary', { filed: '2016-01-01' }, open('2020-01-01'));
    const r = normalise([other, h], AS_OF);
    expect(r.norm[1].eff.permitIssued).toBe(d('2017-05-01'));
    expect(r.tallies['sc.stages.gap-impute']).toEqual({ fired: 1, of: 2, sample: ['p1'] });
    expect(r.perStage['sc.stages.gap-impute']).toEqual({ permitIssued: 1 });
    expect(r.norm[1].src).toBe(h);
    expect(h.entered.permitIssued).toBeUndefined();
  });

  it('imputes a missing first stage before the first entered one, but never preApplication', () => {
    const h = hist(
      'p1',
      'discretionary',
      { entitled: '2016-06-01', permitFiled: '2016-09-01' },
      open('2020-01-01')
    );
    const r = normalise([h], AS_OF);
    expect(r.norm[0].eff.filed).toBe(d('2016-06-01'));
    expect(r.norm[0].eff.preApplication).toBeUndefined();
    expect(r.perStage['sc.stages.gap-impute']).toEqual({ filed: 1 });
  });

  it('counts complete as a later entered stage and never imputes after the last entered one', () => {
    const h = hist(
      'p1',
      'permitOnly',
      { permitFiled: '2016-01-01', complete: '2018-01-01' },
      { kind: 'complete', day: d('2018-01-01') }
    );
    const r = normalise([h], AS_OF);
    expect(r.norm[0].eff.permitIssued).toBe(d('2018-01-01'));
    expect(r.norm[0].eff.construction).toBe(d('2018-01-01'));
    const g = hist('p2', 'discretionary', { filed: '2016-01-01' }, open('2020-01-01'));
    expect(normalise([g], AS_OF).tallies['sc.stages.gap-impute'].fired).toBe(0);
  });

  it('applies the running maximum and counts a history once', () => {
    const h = hist(
      'p1',
      'discretionary',
      { filed: '2016-06-01', entitled: '2016-03-01', permitFiled: '2016-02-01' },
      open('2020-01-01')
    );
    const r = normalise([h], AS_OF);
    expect(r.norm[0].eff.entitled).toBe(d('2016-06-01'));
    expect(r.norm[0].eff.permitFiled).toBe(d('2016-06-01'));
    expect(r.tallies['sc.stages.running-max']).toEqual({ fired: 1, of: 1, sample: ['p1'] });
    expect(r.perStage['sc.stages.running-max']).toEqual({ entitled: 1, permitFiled: 1 });
  });

  it('places an exit at the last entered stage, clamped to its start', () => {
    const h = hist(
      'p1',
      'discretionary',
      { filed: '2016-01-01', entitled: '2016-06-01' },
      { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d('2016-03-01') }
    );
    const ok = hist(
      'p2',
      'discretionary',
      { filed: '2016-01-01' },
      { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d('2016-03-01') }
    );
    const r = normalise(
      [h, ok, hist('p3', 'discretionary', { filed: '2016-01-01' }, open('2020-01-01'))],
      AS_OF
    );
    expect(r.norm[0].end).toEqual({
      kind: 'exit',
      stage: 'entitled',
      reason: 'withdrawn',
      day: d('2016-06-01')
    });
    expect(r.norm[1].end).toEqual(ok.end);
    expect(r.tallies['sc.exit.last-stage']).toEqual({ fired: 1, of: 2, sample: ['p1'] });
    expect(r.perStage['sc.exit.last-stage']).toEqual({ entitled: 1 });
  });

  it('nulls a permitOnly history filed before 2015 as a method count, not a tally', () => {
    const old = hist('p1', 'permitOnly', { permitFiled: '2010-05-01' }, open('2020-01-01'));
    const recent = hist('p2', 'permitOnly', { permitFiled: '2016-05-01' }, open('2020-01-01'));
    const disc = hist('p3', 'discretionary', { filed: '2010-05-01' }, open('2020-01-01'));
    const r = normalise([old, recent, disc], AS_OF);
    expect(r.norm.map((n) => n.pathway)).toEqual([null, 'permitOnly', 'discretionary']);
    expect(r.method.permitOnlyPre2015).toEqual({ fired: 1, of: 2 });
    expect(r.method.ppaPooled).toBe(0);
    expect(Object.keys(r.tallies)).not.toContain('permitOnlyPre2015');
  });

  it('ignores stage keys outside the pathway (Review Focus 1)', () => {
    const h = hist(
      'p1',
      'permitOnly',
      { filed: '2016-01-01', permitFiled: '2016-05-01' },
      open('2020-01-01')
    );
    const r = normalise([h], AS_OF);
    expect(r.norm[0].eff.filed).toBeUndefined();
    expect(buildSpells(r.norm, AS_OF).map((s) => s.stage)).toEqual(['permitFiled']);
  });
});

describe('buildSpells', () => {
  const spellsOf = (h: ProjectHistory) => buildSpells(normalise([h], AS_OF).norm, AS_OF);

  it('builds advance, exit and censored spells with e, x and a', () => {
    const exit = hist(
      'p1',
      'discretionary',
      { filed: '2016-01-01', entitled: '2016-04-01' },
      { kind: 'exit', stage: 'entitled', reason: 'expired', day: d('2017-04-01') }
    );
    const s = spellsOf(exit);
    expect(s.map((x) => [x.stage, x.outcome, x.e, x.x, x.a])).toEqual([
      ['filed', 'advance', d('2016-01-01'), d('2016-04-01') - d('2016-01-01'), 0],
      ['entitled', 'expired', d('2016-04-01'), d('2017-04-01') - d('2016-04-01'), 0]
    ]);
    const cens = spellsOf(hist('p2', 'discretionary', { filed: '2016-01-01' }, open('2030-01-01')));
    expect(cens).toHaveLength(1);
    expect(cens[0]).toMatchObject({ outcome: 'censored', x: AS_OF - d('2016-01-01') });
  });

  it('does not build a spell for the terminal stage', () => {
    const h = hist(
      'p1',
      'permitOnly',
      {
        permitFiled: '2016-01-01',
        permitIssued: '2016-03-01',
        construction: '2016-06-01',
        complete: '2018-01-01'
      },
      { kind: 'complete', day: d('2018-01-01') }
    );
    expect(spellsOf(h).map((x) => x.stage)).toEqual([
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
  });

  it('left-truncates a 2004 permit still in permitIssued at 2007-01-01', () => {
    const h = hist(
      'p1',
      'permitOnly',
      { permitFiled: '2004-01-01', permitIssued: '2004-03-01' },
      open('2010-01-01')
    );
    const s = spellsOf(h);
    expect(s.map((x) => x.stage)).toEqual(['permitIssued']);
    expect(s[0].a).toBe(d('2007-01-01') - d('2004-03-01'));
    expect(s[0].x).toBe(d('2010-01-01') - d('2004-03-01'));
  });

  it('keeps a zero-duration spell as an advance', () => {
    const h = hist(
      'p1',
      'discretionary',
      { filed: '2016-01-01', entitled: '2016-06-01', permitFiled: '2016-06-01' },
      open('2020-01-01')
    );
    const e = spellsOf(h).find((x) => x.stage === 'entitled');
    expect(e).toMatchObject({ x: 0, outcome: 'advance' });
  });

  it('drops spells ending before the window and spells entered at or after asOf', () => {
    const early = hist(
      'p1',
      'discretionary',
      { filed: '2010-01-01', entitled: '2012-01-01' },
      open('2013-01-01')
    );
    expect(spellsOf(early)).toEqual([]);
    const late = hist('p2', 'discretionary', { filed: '2026-06-30' }, open('2026-06-30'));
    expect(spellsOf(late)).toEqual([]);
  });

  it('censors a purge-censored exit at its end day', () => {
    const h = hist(
      'p1',
      'discretionary',
      { filed: '2016-01-01' },
      { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d('2018-01-01') }
    );
    const n = normalise([h], AS_OF).norm;
    n[0].purgeCensored = true;
    n[0].end = { kind: 'open', lastObserved: d('2017-12-31') };
    const s = buildSpells(n, AS_OF);
    expect(s[0]).toMatchObject({ outcome: 'censored', x: d('2017-12-31') - d('2016-01-01') });
  });

  it('sorts by pathway (null last), stage, then project id', () => {
    const hs = [
      hist('b', null, { filed: '2016-01-01' }, open('2020-01-01')),
      hist('z', 'discretionary', { filed: '2016-01-01' }, open('2020-01-01')),
      hist('a', 'streamlined', { filed: '2016-01-01' }, open('2020-01-01')),
      hist(
        'y',
        'discretionary',
        { filed: '2016-01-01', entitled: '2016-02-01' },
        open('2020-01-01')
      ),
      hist('c', 'discretionary', { filed: '2016-01-01' }, open('2020-01-01'))
    ];
    const s = buildSpells(normalise(hs, AS_OF).norm, AS_OF);
    expect(s.map((x) => `${x.pathway}:${x.stage}:${x.projectId}`)).toEqual([
      'discretionary:filed:c',
      'discretionary:filed:y',
      'discretionary:filed:z',
      'discretionary:entitled:y',
      'streamlined:filed:a',
      'null:filed:b'
    ]);
  });
});
