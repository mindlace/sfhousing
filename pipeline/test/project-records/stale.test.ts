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
  verdictExpiry,
  type AssessorCtx
} from '../../project-records/stale';
import { permitDeadline } from '../../project-records/expiry';
import type { HousingRow, LinkedProject, Permit } from '../../project-records/types';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const ASOF = d('2026-10-10');
const OPEN: ProjectHistory['end'] = { kind: 'open', lastObserved: d('2020-01-01') };

function permit(number: string, over: Partial<Permit> = {}): Permit {
  return {
    number,
    type: '2',
    named: false,
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
    expect(r).toEqual({
      day: d('2006-01-10') + 1080 + 180,
      permits: 2,
      noValuation: 0,
      excludedComplete: false
    });
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

  it('a unit-bearing permit with a completion day excludes the project (I3 rejected)', () => {
    // completed_date on a complete permit; a j67f TCO with units on an issued one.
    const done = permit('5', { status: 'complete', completedDateDay: d('2007-01-10') });
    const r = expiryTest(proj([permit('1'), done]), ASOF);
    expect(r).toMatchObject({ day: null, excludedComplete: true });
    const tco = proj([permit('1'), permit('6')], {
      completions: [{ permit: '6', day: d('2008-02-01'), kind: 'TCO', units: 3 }]
    });
    expect(expiryTest(tco, ASOF)).toMatchObject({ day: null, excludedComplete: true });
    // Status 'complete' with no completion day still excludes; no permit counts toward the
    // no-valuation twin (the excluded history reads no deadline).
    const bare = permit('7', { status: 'complete', valuation: null });
    expect(expiryTest(proj([permit('1', { valuation: null }), bare]), ASOF)).toEqual({
      day: null,
      permits: 0,
      noValuation: 0,
      excludedComplete: true
    });
    // A TCO with no units is no completion day.
    const empty = proj([permit('1'), permit('6')], {
      completions: [{ permit: '6', day: d('2008-02-01'), kind: 'TCO', units: 0 }]
    });
    expect(expiryTest(empty, ASOF)).toMatchObject({ day: deadline, excludedComplete: false });
  });

  it('a site permit valued $2.5M or more gets +50%', () => {
    const big = permit('1', { issuedDay: d('2015-01-01'), valuation: 3e6 });
    expect(expiryTest(proj([big]), ASOF).day).toBe(d('2015-01-01') + 2160 + 720);
    const full = { ...big, sitePermit: false };
    expect(expiryTest(proj([full]), ASOF).day).toBe(d('2015-01-01') + 1440 + 720);
  });

  it('a permit with no valuation takes the middle bracket and is counted', () => {
    const r = expiryTest(proj([permit('1', { valuation: null })]), ASOF);
    expect(r).toEqual({
      day: d('2005-03-01') + 1080 + 180,
      permits: 1,
      noValuation: 1,
      excludedComplete: false
    });
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
  latestRollYear: 2025,
  panelImputed: () => null
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
        housing({ bpa: '7', blklot: '3512099', firstCompletionDay: d('2017-09-01') }),
        // Same day, by lot, no bpa: dates it too, but names no source id.
        housing({ blklot: '3512011', firstCompletionDay: d('2017-09-01') }),
        housing({ bpa: '1', firstCompletionDay: d('2015-01-01') }),
        housing({ blklot: '3512001', firstCompletionDay: d('2016-01-01') })
      ],
      resolve
    );
    // The dating row's bpa is returned for the history's sources.
    expect(evidenceDay(p, entered, 4, { housing: idx, assessor: NO_ASSESSOR })).toEqual({
      day: d('2017-09-01'),
      source: 'xdht',
      bpas: ['7']
    });
  });

  it('(ii) assessor unit gain of at least min(units, ceil(units/2)), dated by the lien day', () => {
    const units = (id: ParcelId, y: number) => (y >= 2019 ? 3 : y >= 2017 ? 1 : 0);
    const a = { ...NO_ASSESSOR, assessorUnits: units };
    const none = indexHousing([], resolve);
    // 5 units need 3; 2017 gains only 1, 2019 gains 3.
    expect(evidenceDay(p, entered, 5, { housing: none, assessor: a })).toEqual({
      day: d('2019-01-01'),
      source: 'assessor',
      bpas: []
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
      source: 'xdht',
      bpas: []
    });
  });

  it('(ii) ignores panel rows imputed for units (bit 3) or carried (bit 5)', () => {
    const none = indexHousing([], resolve);
    // Baseline 2015 is 0; 2017 shows 4 units on a row whose units were replaced (bit 3).
    const units = (_: ParcelId, y: number) => (y >= 2017 ? 4 : 0);
    const mask = (bits: number, from: number, to: number) => (_: ParcelId, y: number) =>
      y >= from && y <= to ? bits : 0;
    const a = { ...NO_ASSESSOR, assessorUnits: units, panelImputed: mask(1 << 3, 2017, 2019) };
    expect(evidenceDay(p, entered, 4, { housing: none, assessor: a })?.day).toBe(d('2020-01-01'));
    // A carried row (bit 5) is ignored too; other bits (e.g. 0, year built) are not.
    const carried = { ...a, panelImputed: mask(1 << 5, 2017, 2018) };
    expect(evidenceDay(p, entered, 4, { housing: none, assessor: carried })?.day).toBe(
      d('2019-01-01')
    );
    const bit0 = { ...a, panelImputed: mask(1, 2017, 2025) };
    expect(evidenceDay(p, entered, 4, { housing: none, assessor: bit0 })?.day).toBe(
      d('2017-01-01')
    );
    // An imputed baseline is no baseline: no gain is read against it.
    const badBase = { ...a, panelImputed: mask(1 << 3, 2015, 2015) };
    expect(evidenceDay(p, entered, 4, { housing: none, assessor: badBase })).toBeNull();
    // year_built from an imputed or carried row does not count.
    const yb = {
      ...NO_ASSESSOR,
      yearBuilt: () => 2016,
      panelImputed: mask(1 << 5, 2016, 2021)
    };
    expect(evidenceDay(p, entered, 4, { housing: none, assessor: yb })?.day).toBe(d('2022-01-01'));
  });

  it('(i) beats (ii)', () => {
    const a = { ...NO_ASSESSOR, yearBuilt: () => 2016 };
    const idx = indexHousing([housing({ bpa: '1', firstCompletionDay: d('2020-02-02') })], resolve);
    expect(evidenceDay(p, entered, 4, { housing: idx, assessor: a })).toEqual({
      day: d('2020-02-02'),
      source: 'xdht',
      bpas: ['1']
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

describe('curated verdicts (Rulings C3, C3d, C3e)', () => {
  const entered = { permitFiled: d('2014-01-01'), construction: d('2015-06-01') };
  /** The open history's lastObserved (here after the check). */
  const SEEN = d('2026-10-01');
  /** No unit-bearing permit: no expiry term, so C3d's date. */
  const NONE = proj([]);
  const v = (o: Partial<ConstructionVerdict>): ConstructionVerdict => ({
    id: 'BP:1',
    verdict: 'unknown',
    checked: '2026-09-01',
    source: 'partner imagery check',
    ...o
  });
  const dead = (p: LinkedProject, e: typeof entered | Record<string, number>, seen: number) =>
    verdictEnd(p, e, v({ verdict: 'dead' }), ASOF, seen);
  const exitDay = (r: ReturnType<typeof verdictEnd>) =>
    r !== null && 'end' in r && r.end.kind === 'exit' ? r.end.day : undefined;

  it('complete: complete at completeDay', () => {
    expect(
      verdictEnd(NONE, entered, v({ verdict: 'complete', completeDay: '2018-05-01' }), ASOF, SEEN)
    ).toEqual({
      end: { kind: 'complete', day: d('2018-05-01') },
      entered: { ...entered, complete: d('2018-05-01') },
      clamped: false
    });
  });

  it('dead with no expiry term: at lastObserved capped at the check (Ruling C3d)', () => {
    expect(dead(NONE, entered, SEEN)).toEqual({
      end: { kind: 'exit', stage: 'construction', reason: 'withdrawn', day: d('2026-09-01') },
      entered,
      clamped: false
    });
    expect(exitDay(dead(NONE, entered, d('2019-03-04')))).toBe(d('2019-03-04'));
    // Never before the last entered day (L1).
    expect(exitDay(dead(NONE, entered, d('2015-01-01')))).toBe(d('2015-06-01'));
  });

  it('dead at construction: not before the statutory expiry of its permit (Ruling C3e)', () => {
    // E2, $200k, not a site permit: 1,080 + 720 days from 2015-01-01.
    const issued = permit('1', {
      issuedDay: d('2015-01-01'),
      filedDay: d('2014-06-01'),
      sitePermit: false
    });
    const expiry = permitDeadline(issued) as number;
    expect(expiry).toBe(d('2015-01-01') + 1080 + 720);
    // Expiry after lastObserved: the expiry.
    expect(exitDay(dead(proj([issued]), entered, d('2017-01-01')))).toBe(expiry);
    // lastObserved after the expiry: lastObserved.
    expect(exitDay(dead(proj([issued]), entered, d('2021-02-01')))).toBe(d('2021-02-01'));
    // The latest deadline over the unit-bearing permits; an unissued one has none.
    const later = permit('2', {
      issuedDay: d('2016-01-01'),
      filedDay: d('2015-06-01'),
      sitePermit: false
    });
    const unissued = permit('3', { issuedDay: null });
    expect(exitDay(dead(proj([issued, later, unissued]), entered, d('2016-01-01')))).toBe(
      permitDeadline(later)
    );
    // Expiry after the check: the check.
    const recent = permit('1', { issuedDay: d('2025-01-01'), filedDay: d('2024-06-01') });
    expect(exitDay(dead(proj([recent]), entered, d('2017-01-01')))).toBe(d('2026-09-01'));
    // The floor: both before the last entered day.
    const late = { permitFiled: d('2014-01-01'), construction: d('2020-06-01') };
    expect(exitDay(dead(proj([issued]), late, d('2016-01-01')))).toBe(d('2020-06-01'));
  });

  it("dead at a stage with no expiry rule (permitFiled, Planning stages): C3d's date", () => {
    const issued = permit('1', {
      issuedDay: d('2015-01-01'),
      filedDay: d('2014-06-01'),
      sitePermit: false
    });
    expect(verdictExpiry(proj([issued]), { permitFiled: d('2014-06-01') })).toBeNull();
    expect(
      verdictExpiry(proj([issued]), { filed: d('2013-01-01'), entitled: d('2013-06-01') })
    ).toBeNull();
    expect(verdictExpiry(proj([issued]), { permitIssued: d('2015-01-01') })).toBe(
      permitDeadline(issued)
    );
    expect(exitDay(dead(proj([issued]), { permitFiled: d('2014-06-01') }, d('2016-01-01')))).toBe(
      d('2016-01-01')
    );
  });

  it('unknown: no change; a day after the snapshot is skipped', () => {
    expect(verdictEnd(NONE, entered, v({}), ASOF, SEEN)).toBeNull();
    expect(
      verdictEnd(NONE, entered, v({ verdict: 'dead', checked: '2026-12-01' }), ASOF, SEEN)
    ).toEqual({
      skip: 'checked 2026-12-01 is after the snapshot'
    });
  });
});
