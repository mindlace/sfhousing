// Stale open histories (spec 4.6; Rulings E2, C2, C3): the exit test, construction evidence and
// curated verdicts, on hand-built projects.
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '../../../src/lib/data/parcel';
import type { ProjectHistory, Stage } from '../../../src/lib/timelapse/types';
import type { Day } from '../../../src/lib/timelapse/time';
import type { ConstructionVerdict } from '../../enrichment/construction-schema';
import {
  completeAt,
  evidenceApplies,
  evidenceDay,
  expiryApplies,
  expiryExit,
  expiryTest,
  indexHousing,
  verdictEnd,
  type AssessorCtx
} from '../../project-records/stale';
import type { HousingRow, LinkedProject, Permit } from '../../project-records/types';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const ASOF = d('2026-10-10');
const OPEN: ProjectHistory['end'] = { kind: 'open', lastObserved: d('2020-01-01') };

function permit(number: string, over: Partial<Permit> = {}): Permit {
  return {
    number,
    sitePermit: true,
    status: 'issued',
    statusDay: null,
    filedDay: d('2004-06-01'),
    issuedDay: d('2005-03-01'),
    fcdDay: null,
    completedDateDay: null,
    lastActivityDay: null,
    stories: null,
    existingUnits: null,
    proposedUnits: 3,
    valuation: 200_000,
    rows: [],
    ...over
  };
}

function proj(permits: Permit[], over: Partial<LinkedProject> = {}): LinkedProject {
  return {
    id: 'BP:1',
    kind: 'graph',
    anchors: [],
    primary: null,
    satellites: [],
    children: [],
    sourceOnlyChildren: [],
    reviews: [],
    permits,
    live: permits,
    superseded: new Set(),
    lead: permits[0] ?? null,
    completions: [],
    pipelineRows: [],
    blklots: [],
    parcelIds: ['3512011'],
    crossBlock: { applies: false, dropped: [] },
    ...over
  };
}

describe('expiryTest (Ruling E2)', () => {
  // E0, $200k: 360 + 90 days from 2005-03-01.
  const deadline = d('2005-03-01') + 450;

  it('passes when every unit-bearing permit is past its deadline; the day is the latest', () => {
    const later = permit('2', { issuedDay: d('2006-01-10'), valuation: 1_000_000 });
    const r = expiryTest(proj([permit('1'), later]), ASOF);
    expect(r).toEqual({ day: d('2006-01-10') + 1080 + 180, permits: 2, noValuation: 0 });
    expect(expiryTest(proj([permit('1')]), ASOF).day).toBe(deadline);
  });

  it('fails while a deadline is not yet past (asOf on or before it)', () => {
    expect(expiryTest(proj([permit('1')]), deadline).day).toBeNull();
    expect(expiryTest(proj([permit('1')]), deadline + 1).day).toBe(deadline);
  });

  it('lastActivity after the deadline blocks the exit; on the deadline it does not', () => {
    expect(expiryTest(proj([permit('1', { lastActivityDay: deadline + 1 })]), ASOF).day).toBeNull();
    expect(expiryTest(proj([permit('1', { lastActivityDay: deadline })]), ASOF).day).toBe(deadline);
  });

  it('reinstated blocks the exit; suspend does not', () => {
    expect(expiryTest(proj([permit('1', { status: 'reinstated' })]), ASOF).day).toBeNull();
    expect(expiryTest(proj([permit('1', { status: 'suspend' })]), ASOF).day).toBe(deadline);
  });

  it('an E3 permit never expires; a permit with no issued day blocks', () => {
    const e3 = permit('3', { filedDay: d('2026-06-21'), issuedDay: d('2026-07-01') });
    expect(expiryTest(proj([e3]), d('2099-01-01')).day).toBeNull();
    expect(expiryTest(proj([permit('1'), permit('4', { issuedDay: null })]), ASOF).day).toBeNull();
  });

  it('a complete permit is left out: it neither blocks nor dates the exit; one must remain', () => {
    const done = permit('5', { status: 'complete', issuedDay: d('2004-01-01'), valuation: 3e6 });
    expect(expiryTest(proj([permit('1'), done]), ASOF)).toEqual({
      day: deadline,
      permits: 1,
      noValuation: 0
    });
    expect(expiryTest(proj([done]), ASOF).day).toBeNull();
  });

  it('a site permit valued $2.5M or more gets +50%', () => {
    const big = permit('1', { issuedDay: d('2015-01-01'), valuation: 3e6 });
    expect(expiryTest(proj([big]), ASOF).day).toBe(d('2015-01-01') + 2160 + 720);
    const full = { ...big, sitePermit: false };
    expect(expiryTest(proj([full]), ASOF).day).toBe(d('2015-01-01') + 1440 + 720);
  });

  it('a permit with no valuation takes the middle bracket and is counted', () => {
    const r = expiryTest(proj([permit('1', { valuation: null })]), ASOF);
    expect(r).toEqual({ day: d('2005-03-01') + 1080 + 180, permits: 1, noValuation: 1 });
  });

  it('reads the unit-bearing set: a superseded permit is ignored', () => {
    const dead = permit('0', { status: 'expired', issuedDay: d('2025-01-01') });
    const p = proj([dead, permit('1')], { live: [permit('1')], superseded: new Set(['0']) });
    expect(expiryTest(p, ASOF).day).toBe(deadline);
  });

  it('applies to open histories whose last stage is permitIssued or construction', () => {
    const at = (s: Stage): Partial<Record<Stage, Day>> => ({ permitFiled: 1, [s]: 2 });
    expect(expiryApplies(at('permitIssued'), OPEN)).toBe(true);
    expect(expiryApplies(at('construction'), OPEN)).toBe(true);
    expect(expiryApplies({ permitFiled: 1 }, OPEN)).toBe(false);
    expect(expiryApplies(at('permitIssued'), { kind: 'complete', day: 3 })).toBe(false);
  });

  it('exits expired at the last entered stage, no earlier than its entry (L1)', () => {
    const entered = { permitFiled: d('2004-06-01'), permitIssued: d('2005-03-01') };
    expect(expiryExit(entered, deadline)).toEqual({
      kind: 'exit',
      stage: 'permitIssued',
      reason: 'expired',
      day: deadline
    });
    expect(expiryExit(entered, d('2000-01-01'))).toMatchObject({ day: d('2005-03-01') });
  });
});

const NO_ASSESSOR: AssessorCtx = {
  assessorUnits: () => null,
  yearBuilt: () => null,
  lienDay: (y) => d(`${y}-01-01`),
  latestRollYear: 2025
};

function housing(over: Partial<HousingRow>): HousingRow {
  return { bpa: null, blklot: null, form: '1', netUnits: 4, firstCompletionDay: null, ...over };
}

const resolve = (bs: string[]): ParcelId[] => bs.map((b) => (b === '3512099' ? '3512011' : b));

describe('construction evidence (Ruling C2)', () => {
  const started = permit('1', { fcdDay: d('2015-06-01'), issuedDay: d('2015-03-02') });
  const entered = { permitFiled: d('2014-01-01'), construction: d('2015-06-01') };
  const p = proj([started]);

  it('(i) xdht by permit number or by resolved lot, on or after the construction day; earliest', () => {
    const idx = indexHousing(
      [
        housing({ bpa: '1', firstCompletionDay: d('2018-03-01') }),
        housing({ blklot: '3512099', firstCompletionDay: d('2017-09-01') }),
        housing({ bpa: '1', firstCompletionDay: d('2015-01-01') }),
        housing({ blklot: '3512001', firstCompletionDay: d('2016-01-01') })
      ],
      resolve
    );
    expect(evidenceDay(p, entered, 4, { housing: idx, assessor: NO_ASSESSOR })).toEqual({
      day: d('2017-09-01'),
      source: 'xdht'
    });
  });

  it('(ii) assessor unit gain of at least min(units, ceil(units/2)), dated by the lien day', () => {
    const units = (id: ParcelId, y: number) => (y >= 2019 ? 3 : y >= 2017 ? 1 : 0);
    const a = { ...NO_ASSESSOR, assessorUnits: units };
    const none = indexHousing([], resolve);
    // 5 units need 3; 2017 gains only 1, 2019 gains 3.
    expect(evidenceDay(p, entered, 5, { housing: none, assessor: a })).toEqual({
      day: d('2019-01-01'),
      source: 'assessor'
    });
    // 1 unit needs 1: 2017.
    expect(evidenceDay(p, entered, 1, { housing: none, assessor: a })?.day).toBe(d('2017-01-01'));
  });

  it('(ii) a parcel year_built at or after the construction year, first roll year after it', () => {
    const a = { ...NO_ASSESSOR, yearBuilt: (_: ParcelId, y: number) => (y >= 2018 ? 2015 : 1950) };
    const none = indexHousing([], resolve);
    expect(evidenceDay(p, entered, 4, { housing: none, assessor: a })?.day).toBe(d('2018-01-01'));
    // The construction year itself is not a candidate roll year.
    const same = { ...NO_ASSESSOR, yearBuilt: () => 2015 };
    expect(evidenceDay(p, entered, 4, { housing: none, assessor: same })?.day).toBe(
      d('2016-01-01')
    );
  });

  it('(i) counts only new-construction completions: form 1 or 2 with net units > 0 (Ruling C4)', () => {
    const idx = indexHousing(
      [
        housing({ bpa: '1', form: '6', netUnits: -1, firstCompletionDay: d('2016-01-01') }),
        housing({
          blklot: '3512011',
          form: '8',
          netUnits: -1,
          firstCompletionDay: d('2016-02-01')
        }),
        housing({ bpa: '1', form: '3', netUnits: 2, firstCompletionDay: d('2016-03-01') }),
        housing({ bpa: '1', form: '2', netUnits: 0, firstCompletionDay: d('2016-04-01') }),
        housing({ bpa: '1', form: '2', netUnits: null, firstCompletionDay: d('2016-05-01') }),
        housing({ blklot: '3512011', form: '1', netUnits: 3, firstCompletionDay: d('2019-06-01') })
      ],
      resolve
    );
    expect(evidenceDay(p, entered, 4, { housing: idx, assessor: NO_ASSESSOR })).toEqual({
      day: d('2019-06-01'),
      source: 'xdht'
    });
  });

  it('(i) beats (ii)', () => {
    const a = { ...NO_ASSESSOR, yearBuilt: () => 2016 };
    const idx = indexHousing([housing({ bpa: '1', firstCompletionDay: d('2020-02-02') })], resolve);
    expect(evidenceDay(p, entered, 4, { housing: idx, assessor: a })).toEqual({
      day: d('2020-02-02'),
      source: 'xdht'
    });
  });

  it('no evidence gives null', () => {
    expect(
      evidenceDay(p, entered, 4, { housing: indexHousing([], resolve), assessor: NO_ASSESSOR })
    ).toBeNull();
  });

  it('applies to open histories at construction with no terminal (dead) permit', () => {
    expect(evidenceApplies(p, entered, OPEN)).toBe(true);
    expect(evidenceApplies(p, { permitIssued: 1 }, OPEN)).toBe(false);
    // A complete permit of its own is not terminal (one building of several is finished).
    const done = permit('2', { status: 'complete' });
    expect(evidenceApplies(proj([started, done]), entered, OPEN)).toBe(true);
    const dead = permit('3', { status: 'cancelled' });
    expect(evidenceApplies(proj([started, dead], { live: [started] }), entered, OPEN)).toBe(false);
    // A superseded dead permit is not terminal.
    const sup = proj([dead, started], { live: [started], superseded: new Set(['3']) });
    expect(evidenceApplies(sup, entered, OPEN)).toBe(true);
  });

  it('completeAt forward-clamps a day before the latest entered stage', () => {
    expect(completeAt(entered, d('2014-01-01'))).toEqual({
      entered: { ...entered, complete: d('2015-06-01') },
      clamped: true
    });
    expect(completeAt(entered, d('2018-01-01')).clamped).toBe(false);
  });
});

describe('curated verdicts (Ruling C3)', () => {
  const entered = { permitFiled: d('2014-01-01'), construction: d('2015-06-01') };
  const v = (o: Partial<ConstructionVerdict>): ConstructionVerdict => ({
    id: 'BP:1',
    verdict: 'unknown',
    checked: '2026-09-01',
    source: 'partner imagery check',
    ...o
  });

  it('complete: complete at completeDay', () => {
    expect(
      verdictEnd(entered, v({ verdict: 'complete', completeDay: '2018-05-01' }), ASOF)
    ).toEqual({
      end: { kind: 'complete', day: d('2018-05-01') },
      entered: { ...entered, complete: d('2018-05-01') },
      clamped: false
    });
  });

  it('dead: exit withdrawn at the last entered stage, dated by the check', () => {
    expect(verdictEnd(entered, v({ verdict: 'dead' }), ASOF)).toEqual({
      end: { kind: 'exit', stage: 'construction', reason: 'withdrawn', day: d('2026-09-01') },
      entered,
      clamped: false
    });
  });

  it('unknown: no change; a day after the snapshot is skipped', () => {
    expect(verdictEnd(entered, v({}), ASOF)).toBeNull();
    expect(verdictEnd(entered, v({ verdict: 'dead', checked: '2026-12-01' }), ASOF)).toEqual({
      skip: 'checked 2026-12-01 is after the snapshot'
    });
  });
});
