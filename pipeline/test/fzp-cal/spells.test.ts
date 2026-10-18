// Qualifying predicate, normalisation steps 1-4 and spell building (spec §4.4).
import { describe, expect, it } from 'vitest';
import {
  buildSpells,
  gapImputeTally,
  noFcdTally,
  normalise,
  qualifies
} from '../../lib/fzp-cal/spells';
import { CalibrationError } from '../../lib/fzp-cal/types';
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
    quality: [],
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
  it('imputes a missing stage between entered stages and records the history once', () => {
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
    expect([...r.imputed]).toEqual(['p1']);
    expect(Object.keys(r.tallies)).not.toContain('sc.stages.gap-impute');
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

  it('does not impute stages before the first entered stage of a null-pathway history (R7)', () => {
    const h = hist(
      'n1',
      null,
      { entitled: '2016-06-01', permitFiled: '2016-09-01' },
      open('2020-01-01')
    );
    const r = normalise([h], AS_OF);
    expect(r.norm[0].eff.preApplication).toBeUndefined();
    expect(r.norm[0].eff.filed).toBeUndefined();
    expect(r.imputed.size).toBe(0);
    // the same record under a known pathway still back-fills `filed`
    const known = hist(
      'k1',
      'discretionary',
      { entitled: '2016-06-01', permitFiled: '2016-09-01' },
      open('2020-01-01')
    );
    expect(normalise([known], AS_OF).norm[0].eff.filed).toBe(d('2016-06-01'));
  });

  it('imputes only interior gaps of a null-pathway history, complete counting as later (R7)', () => {
    const h = hist(
      'n1',
      null,
      { permitFiled: '2016-01-01', complete: '2018-01-01' },
      { kind: 'complete', day: d('2018-01-01') }
    );
    const r = normalise([h], AS_OF);
    // construction is not imputed for a completion without an FCD (sc.stages.no-fcd-duration)
    expect(r.norm[0].eff).toEqual({
      permitFiled: d('2016-01-01'),
      permitIssued: d('2018-01-01'),
      complete: d('2018-01-01')
    });
    expect(r.perStage['sc.stages.gap-impute']).toEqual({ permitIssued: 1 });
    expect([...r.imputed]).toEqual(['n1']);
    expect(r.norm[0].noFcd).toBe(true);
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
    expect(r.norm[0].eff.construction).toBeUndefined();
    const g = hist('p2', 'discretionary', { filed: '2016-01-01' }, open('2020-01-01'));
    expect(normalise([g], AS_OF).imputed.size).toBe(0);
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
    expect(buildSpells(r.norm, AS_OF).spells.map((s) => s.stage)).toEqual(['permitFiled']);
  });
});

describe('buildSpells', () => {
  const spellsOf = (h: ProjectHistory) => buildSpells(normalise([h], AS_OF).norm, AS_OF).spells;

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
    const s = buildSpells(n, AS_OF).spells;
    expect(s[0]).toMatchObject({ outcome: 'censored', x: d('2017-12-31') - d('2016-01-01') });
  });

  it('throws on a purge-censored history that still ends in an exit', () => {
    const h = hist(
      'p1',
      'discretionary',
      { filed: '2016-01-01' },
      { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d('2018-01-01') }
    );
    const n = normalise([h], AS_OF).norm;
    n[0].purgeCensored = true;
    expect(() => buildSpells(n, AS_OF)).toThrow(CalibrationError);
    expect(() => buildSpells(n, AS_OF)).toThrow(/p1/);
  });

  it('throws on an open end observed before the stage it is in, instead of clamping', () => {
    const h = hist('p1', 'discretionary', { filed: '2016-01-01' }, open('2015-06-01'));
    expect(() => buildSpells(normalise([h], AS_OF).norm, AS_OF)).toThrow(/p1/);
    const late = hist('p2', 'discretionary', { filed: '2026-07-01' }, open('2026-06-01'));
    expect(() => buildSpells(normalise([late], AS_OF).norm, AS_OF)).toThrow(CalibrationError);
  });

  it('throws on a complete end with no entered complete stage', () => {
    const h = hist(
      'p1',
      'permitOnly',
      { permitFiled: '2016-01-01' },
      {
        kind: 'complete',
        day: d('2018-01-01')
      }
    );
    expect(() => normalise([h], AS_OF)).toThrow(CalibrationError);
    expect(() => normalise([h], AS_OF)).toThrow(/p1/);
    const ok = hist(
      'p2',
      'permitOnly',
      { permitFiled: '2016-01-01', complete: '2018-01-01' },
      { kind: 'complete', day: d('2018-01-01') }
    );
    const n = normalise([ok], AS_OF).norm;
    n[0].eff = { permitFiled: d('2016-01-01') };
    expect(() => buildSpells(n, AS_OF)).toThrow(/p2/);
  });

  it('throws on an exit history that also has an observed complete stage', () => {
    const h = hist(
      'p1',
      'permitOnly',
      { permitFiled: '2016-01-01', complete: '2018-01-01' },
      { kind: 'exit', stage: 'permitFiled', reason: 'expired', day: d('2017-01-01') }
    );
    expect(() => normalise([h], AS_OF)).toThrow(CalibrationError);
    expect(() => normalise([h], AS_OF)).toThrow(/p1/);
  });

  it('throws on an exit dated before the stage it exits from', () => {
    const h = hist(
      'p1',
      'discretionary',
      { filed: '2016-01-01' },
      { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d('2018-01-01') }
    );
    const n = normalise([h], AS_OF).norm;
    n[0].end = { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d('2015-01-01') };
    expect(() => buildSpells(n, AS_OF)).toThrow(/p1/);
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
    const s = buildSpells(normalise(hs, AS_OF).norm, AS_OF).spells;
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

describe('gapImputeTally (DQ-4: counted over windowed histories)', () => {
  const tally = (hs: ProjectHistory[]) => {
    const r = normalise(hs, AS_OF);
    const b = buildSpells(r.norm, AS_OF);
    return gapImputeTally(r.imputed, b.spells, b.unobserved);
  };
  // permitFiled -> construction with permitIssued missing: step 1 imputes permitIssued.
  const gapped = (id: string, filed: string, built: string) =>
    hist(id, 'permitOnly', { permitFiled: filed, construction: built }, open('2030-01-01'));

  it('leaves out an imputed history whose spells all end before the pooled window', () => {
    const pre = hist(
      'pre',
      'permitOnly',
      { permitFiled: '2003-01-01', construction: '2005-01-01' },
      { kind: 'exit', stage: 'construction', reason: 'withdrawn', day: d('2005-06-01') }
    );
    const r = normalise([pre], AS_OF);
    expect(r.imputed.has('pre')).toBe(true);
    const b = buildSpells(r.norm, AS_OF);
    expect(gapImputeTally(r.imputed, b.spells, b.unobserved)).toEqual({
      fired: 0,
      of: 0,
      sample: []
    });
  });

  it('counts an imputed history with a 2010 permit-side spell in fired and of', () => {
    expect(tally([gapped('g1', '2010-01-01', '2011-01-01')])).toEqual({
      fired: 1,
      of: 1,
      sample: ['g1']
    });
  });

  it('adds a non-imputed windowed history to of only, with distinct ids and sorted sample', () => {
    const full = hist(
      'a-full',
      'permitOnly',
      { permitFiled: '2010-01-01', permitIssued: '2010-06-01', construction: '2011-01-01' },
      open('2030-01-01')
    );
    const t = tally([
      gapped('z2', '2010-01-01', '2011-01-01'),
      full,
      gapped('b1', '2012-01-01', '2013-01-01')
    ]);
    expect(t).toEqual({ fired: 2, of: 3, sample: ['b1', 'z2'] });
  });
});

describe('no-FCD completions (sc.stages.no-fcd-duration, partner ruling P1)', () => {
  const done = (iso: string): ProjectHistory['end'] => ({ kind: 'complete', day: d(iso) });
  const noFcd = (id: string, extra: Entered = {}, complete = '2012-05-01') =>
    hist(
      id,
      'discretionary',
      {
        filed: '2008-01-01',
        entitled: '2008-06-01',
        permitFiled: '2009-06-01',
        permitIssued: '2010-03-01',
        complete,
        ...extra
      },
      done(complete)
    );

  it('does not impute construction = completion day and moves both spells to unobserved', () => {
    const r = normalise([noFcd('nf')], AS_OF);
    expect(r.imputed.size).toBe(0);
    expect(r.perStage['sc.stages.gap-impute']).toEqual({});
    expect(r.norm[0].noFcd).toBe(true);
    expect(r.norm[0].eff.construction).toBeUndefined();
    const b = buildSpells(r.norm, AS_OF);
    expect(b.spells.map((s) => s.stage)).toEqual(['permitFiled']);
    expect(b.unobserved).toEqual([
      {
        projectId: 'nf',
        pathway: 'discretionary',
        stage: 'permitIssued',
        complete: d('2012-05-01'),
        enteredPermitIssued: d('2010-03-01')
      },
      {
        projectId: 'nf',
        pathway: 'discretionary',
        stage: 'construction',
        complete: d('2012-05-01'),
        enteredPermitIssued: d('2010-03-01')
      }
    ]);
  });

  it('treats a construction start on the completion day as no FCD', () => {
    const r = normalise([noFcd('nf', { construction: '2012-05-01' })], AS_OF);
    expect(r.imputed.size).toBe(0);
    expect(r.norm[0].noFcd).toBe(true);
    const b = buildSpells(r.norm, AS_OF);
    expect(b.spells.map((s) => s.stage)).toEqual(['permitFiled']);
    expect(b.unobserved.map((u) => [u.stage, u.complete, u.enteredPermitIssued])).toEqual([
      ['permitIssued', d('2012-05-01'), d('2010-03-01')],
      ['construction', d('2012-05-01'), d('2010-03-01')]
    ]);
  });

  it('leaves a completion with a real FCD unaffected', () => {
    const r = normalise([noFcd('ok', { construction: '2010-09-01' })], AS_OF);
    expect(r.norm[0].noFcd).toBe(false);
    const b = buildSpells(r.norm, AS_OF);
    expect(b.spells.map((s) => [s.stage, s.outcome])).toEqual([
      ['permitFiled', 'advance'],
      ['permitIssued', 'advance'],
      ['construction', 'advance']
    ]);
    expect(b.unobserved).toEqual([]);
  });

  it('still imputes a missing entitled on a no-FCD completion (gap-impute fires)', () => {
    const h = hist(
      'nf',
      'discretionary',
      {
        filed: '2016-01-01',
        permitFiled: '2016-09-01',
        permitIssued: '2017-03-01',
        complete: '2019-05-01'
      },
      done('2019-05-01')
    );
    const r = normalise([h], AS_OF);
    expect(r.norm[0].eff.entitled).toBe(d('2016-09-01'));
    expect(r.norm[0].eff.construction).toBeUndefined();
    expect(r.perStage['sc.stages.gap-impute']).toEqual({ entitled: 1 });
    expect([...r.imputed]).toEqual(['nf']);
    expect(r.norm[0].noFcd).toBe(true);
    expect(r.perStage['sc.stages.no-fcd-duration']).toEqual({ permitIssued: 1, construction: 1 });
  });

  it('drops the 0-day construction spell of a completion first seen at construction (P1)', () => {
    // null pathway, first entered stage construction on the completion day: R7 forbids
    // back-filling permitIssued, so only the construction advance is unobserved
    const h = hist(
      'nc',
      null,
      { construction: '2012-05-01', complete: '2012-05-01' },
      done('2012-05-01')
    );
    const r = normalise([h], AS_OF);
    expect(r.norm[0].noFcd).toBe(true);
    expect(r.norm[0].eff.permitIssued).toBeUndefined();
    expect(r.perStage['sc.stages.no-fcd-duration']).toEqual({ construction: 1 });
    const b = buildSpells(r.norm, AS_OF);
    expect(b.spells).toEqual([]);
    expect(b.unobserved).toEqual([
      { projectId: 'nc', pathway: null, stage: 'construction', complete: d('2012-05-01') }
    ]);
    expect(noFcdTally(r.norm, b.spells, b.unobserved)).toEqual({
      fired: 1,
      of: 1,
      sample: ['nc']
    });
    // a null-pathway history seen only at completion has no permit-side spell: not no-FCD
    const only = hist('oc', null, { complete: '2012-05-01' }, done('2012-05-01'));
    expect(normalise([only], AS_OF).norm[0].noFcd).toBe(false);
  });

  it('is never set on open or exit histories', () => {
    const issued = { permitFiled: '2016-01-01', permitIssued: '2016-06-01' };
    const r = normalise(
      [
        hist('o', 'permitOnly', issued, open('2020-01-01')),
        hist('x', 'permitOnly', issued, {
          kind: 'exit',
          stage: 'permitIssued',
          reason: 'expired',
          day: d('2018-01-01')
        })
      ],
      AS_OF
    );
    expect(r.norm.map((n) => n.noFcd)).toEqual([false, false]);
    expect(buildSpells(r.norm, AS_OF).unobserved).toEqual([]);
  });

  it('cuts unobserved advances at the pooled window: completion on or after 2007-01-01', () => {
    const pre = hist(
      'pre',
      'permitOnly',
      { permitFiled: '2003-01-01', permitIssued: '2004-01-01', complete: '2006-12-31' },
      done('2006-12-31')
    );
    const b = buildSpells(normalise([pre], AS_OF).norm, AS_OF);
    expect(b.spells).toEqual([]);
    expect(b.unobserved).toEqual([]);
  });

  it('noFcdTally: fired = windowed no-FCD completions, of = histories with a spell or one', () => {
    // b-late's permitFiled spell ends before 2007: it contributes only unobserved advances
    const late = hist(
      'b-late',
      'permitOnly',
      { permitFiled: '2005-01-01', permitIssued: '2006-06-01', complete: '2008-01-01' },
      done('2008-01-01')
    );
    const pre = hist(
      'pre',
      'permitOnly',
      { permitFiled: '2003-01-01', permitIssued: '2004-01-01', complete: '2005-01-01' },
      done('2005-01-01')
    );
    const r = normalise(
      [noFcd('z-nf'), noFcd('a-ok', { construction: '2010-09-01' }), late, pre],
      AS_OF
    );
    const b = buildSpells(r.norm, AS_OF);
    expect(noFcdTally(r.norm, b.spells, b.unobserved)).toEqual({
      fired: 2,
      of: 3,
      sample: ['b-late', 'z-nf']
    });
    // gap-impute counts over the same windowed histories, the unobserved advances included
    expect(gapImputeTally(r.imputed, b.spells, b.unobserved).of).toBe(3);
    expect(gapImputeTally(r.imputed, b.spells, []).of).toBe(2);
  });
});
