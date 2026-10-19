// deriveProjects with Rulings L1 (PRJ-named unit-adding permits) and L2 (BP-only projects join
// the PRJ on their lot): stages, population and the T3/T4d effects on the base input.
import { describe, expect, it } from 'vitest';
import { deriveProjects, type DeriveResult } from '../../project-records/derive';
import type { RawRow } from '../../project-records/types';
import { baseInput, baseRaw, day } from './derive-input';

const ts = (iso: string) => `${iso}T00:00:00.000`;

function history(r: DeriveResult, id: string) {
  const h = r.histories.find((x) => x.id === id);
  if (!h) throw new Error(`no history ${id}`);
  return h;
}

/** An entitled PRJ on lot 008 (no units in the base roll) naming `permits`. */
function entitledPrj(id: string, permits: string, over: RawRow = {}): RawRow[] {
  return [
    {
      record_id: id,
      record_status: 'Open',
      block: '3512',
      lot: '008',
      open_date: ts('2018-03-01'),
      building_permits: permits,
      number_of_units_prop: '5',
      new_construction: 'CHECKED',
      ...over
    }
  ];
}

const review = (id: string): RawRow => ({
  b1_alt_id: id,
  start_event_type: 'accepted',
  start_event_date: ts('2018-03-15'),
  end_event_type: 'approval',
  end_event_date: ts('2018-10-01')
});

const alteration = (n: string, over: RawRow = {}): RawRow => ({
  permit_number: n,
  permit_type: '3',
  block: '3512',
  lot: '008',
  status: 'issued',
  status_date: ts('2019-06-03'),
  filed_date: ts('2019-01-15'),
  issued_date: ts('2019-06-03'),
  proposed_units: '5',
  existing_units: '0',
  estimated_cost: '3000000',
  site_permit: 'Y',
  primary_address_flag: 'Y',
  ...over
});

describe('named unit-adding permits (Ruling L1)', () => {
  const ID = 'PRJ:2018-000030PRJ';

  it('a PRJ-named type 3 permit advances the history past entitled', () => {
    const without = baseRaw();
    without['datasf-planning-projects'].push(...entitledPrj('2018-000030PRJ', '201901150030'));
    without['datasf-planning-review'].push(review('2018-000030PRJ'));
    const before = history(deriveProjects(baseInput(without)), ID);
    expect(Object.keys(before.entered)).toEqual(['filed', 'entitled']);

    const raw = structuredClone(without);
    raw['datasf-permits-named'].push(alteration('201901150030'));
    const r = deriveProjects(baseInput(raw));
    const h = history(r, ID);
    expect(h.entered).toMatchObject({
      permitFiled: day('2019-01-15'),
      permitIssued: day('2019-06-03')
    });
    expect(h.unitsAt.permitFiled).toBe(5);
    expect(h.sources).toContainEqual({
      dataset: 'i98e-djp9',
      id: '201901150030',
      key: 'permit_number'
    });
    // A named alteration is never in permits.parquet (one row per type 1/2 permit).
    expect(r.permits.map((p) => p.permit_number)).not.toContain('201901150030');
    expect(r.counts['parse.named.kept']).toBe(1);
  });

  it('an unnamed type 3 permit is dropped and seeds no BP: project', () => {
    const raw = baseRaw();
    raw['datasf-permits-named'].push(alteration('202001010032'));
    const r = deriveProjects(baseInput(raw));
    expect(r.histories.map((h) => h.id)).not.toContain('BP:202001010032');
    expect(r.counts['parse.named.unnamed']).toBe(1);
  });

  it('a named alteration alone does not make a project new construction', () => {
    const raw = baseRaw();
    raw['datasf-planning-projects'].push(
      ...entitledPrj('2018-000030PRJ', '201901150030', { new_construction: '' })
    );
    raw['datasf-planning-review'].push(review('2018-000030PRJ'));
    raw['datasf-permits-named'].push(alteration('201901150030'));
    const r = deriveProjects(baseInput(raw));
    expect(r.histories.map((h) => h.id)).not.toContain(ID);
  });
});

describe('BP-only projects join the PRJ on their lot (Ruling L2)', () => {
  it('a BP filed after the entitled day joins the entitled PRJ on its lot', () => {
    const raw = baseRaw();
    raw['datasf-planning-projects'].push(...entitledPrj('2018-000030PRJ', ''));
    raw['datasf-planning-review'].push(review('2018-000030PRJ'));
    raw['datasf-permits-newcon'].push({
      permit_number: '202003020031',
      permit_type: '2',
      block: '3512',
      lot: '008',
      status: 'filed',
      status_date: ts('2020-03-02'),
      filed_date: ts('2020-03-02'),
      proposed_units: '6',
      site_permit: 'Y',
      primary_address_flag: 'Y'
    });
    const r = deriveProjects(baseInput(raw));
    const ids = r.histories.map((h) => h.id);
    expect(ids).toContain('PRJ:2018-000030PRJ');
    expect(ids).not.toContain('BP:202003020031');
    expect(history(r, 'PRJ:2018-000030PRJ').entered.permitFiled).toBe(day('2020-03-02'));
    expect(r.counts['link.bpMerged']).toBe(1);
  });

  it('the base input merges nothing', () => {
    expect(deriveProjects(baseInput()).counts['link.bpMerged']).toBe(0);
  });
});

describe('named alteration units (Ruling C1a)', () => {
  const ID = 'PRJ:2018-000030PRJ';
  const newcon = (n: string, over: RawRow = {}): RawRow => ({
    permit_number: n,
    permit_type: '1',
    block: '3512',
    lot: '008',
    status: 'issued',
    status_date: ts('2019-12-06'),
    filed_date: ts('2019-12-06'),
    issued_date: ts('2020-03-02'),
    proposed_units: '489',
    estimated_cost: '90000000',
    site_permit: 'Y',
    primary_address_flag: 'Y',
    ...over
  });
  const project = (permits: string, named: RawRow[], nc: RawRow[] = []) => {
    const raw = baseRaw();
    raw['datasf-planning-projects'].push(
      ...entitledPrj('2018-000030PRJ', permits, { number_of_units_prop: '489' })
    );
    raw['datasf-planning-review'].push(review('2018-000030PRJ'));
    raw['datasf-permits-named'].push(...named);
    raw['datasf-permits-newcon'].push(...nc);
    return deriveProjects(baseInput(raw));
  };

  it('beside a type 1/2 permit, a named alteration carries no units (no double count)', () => {
    // The PRJ:2012.1384 shape: a 489-unit type 1 and a same-day type 3 recording 0 -> 468.
    const r = project(
      '201912068933,201912068937',
      [alteration('201912068937', { proposed_units: '468', filed_date: ts('2019-12-06') })],
      [newcon('201912068933')]
    );
    const h = history(r, ID);
    expect(h.unitsAt.permitFiled).toBe(489);
  });

  it('an alteration of an existing building keeps its units beside a type 1/2 (Ruling C1b)', () => {
    // The PRJ:2021-000821PRJ shape: an existing 6-unit building altered to 7, plus a new 1-unit
    // building; the lot gains 2 and the PRJ records 8.
    const r = project(
      '201912068933,201912068937',
      [
        alteration('201912068937', {
          existing_units: '6',
          proposed_units: '7',
          filed_date: ts('2019-12-06')
        })
      ],
      [newcon('201912068933', { proposed_units: '1' })]
    );
    expect(history(r, ID).unitsAt.permitFiled).toBe(8);
    // existing_units 0 or null re-records the new building: no units (C1a).
    for (const existing of ['0', undefined]) {
      const z = project(
        '201912068933,201912068937',
        [
          alteration('201912068937', {
            existing_units: existing,
            proposed_units: '7',
            filed_date: ts('2019-12-06')
          })
        ],
        [newcon('201912068933', { proposed_units: '1' })]
      );
      expect(history(z, ID).unitsAt.permitFiled, String(existing)).toBe(1);
    }
  });

  it('in an alteration-only project the units are the max of the alterations, not the sum', () => {
    const r = project('201901150030,201902010031', [
      alteration('201901150030', { proposed_units: '4' }),
      alteration('201902010031', { proposed_units: '6', filed_date: ts('2019-02-01') })
    ]);
    expect(history(r, ID).unitsAt.permitFiled).toBe(6);
  });

  it('stage evidence is unchanged: the alteration still dates permitIssued', () => {
    const r = project(
      '201912068933,201912068937',
      [
        alteration('201912068937', {
          proposed_units: '468',
          filed_date: ts('2019-06-01'),
          issued_date: ts('2019-09-03')
        })
      ],
      [newcon('201912068933', { issued_date: ts('2020-03-02') })]
    );
    expect(history(r, ID).entered.permitIssued).toBe(day('2019-09-03'));
  });

  it('beside a type 1/2 permit, a named alteration is not capacity-checked', () => {
    // 5,000 units on 3 stories of a ~108 m2 lot would fail capacity; it carries no units here.
    const r = project(
      '201912068933,201912068937',
      [
        alteration('201912068937', {
          proposed_units: '5000',
          number_of_proposed_stories: '3'
        })
      ],
      [newcon('201912068933', { proposed_units: '6', number_of_proposed_stories: '3' })]
    );
    expect(r.counts['quality.pr.units.capacity.fired']).toBe(0);
    expect(r.counts['quality.pr.units.capacity-cap.fired']).toBe(0);
  });
});

describe('the L2 anchor day is the entitled day when there is one (review M3)', () => {
  it('a BP filed within a year of filing but not of entitlement stays apart', () => {
    const raw = baseRaw();
    // Filed 2018-03-01, entitled 2020-01-15: a BP filed 2018-09-01 is a year and more before.
    raw['datasf-planning-projects'].push(...entitledPrj('2018-000030PRJ', ''));
    raw['datasf-planning-review'].push({
      ...review('2018-000030PRJ'),
      end_event_date: ts('2020-01-15')
    });
    raw['datasf-permits-newcon'].push({
      permit_number: '201809010031',
      permit_type: '2',
      block: '3512',
      lot: '008',
      status: 'filed',
      status_date: ts('2018-09-01'),
      filed_date: ts('2018-09-01'),
      proposed_units: '5',
      site_permit: 'Y',
      primary_address_flag: 'Y'
    });
    const r = deriveProjects(baseInput(raw));
    expect(r.histories.map((h) => h.id)).toContain('BP:201809010031');
    expect(r.counts['link.bpMerged']).toBe(0);
  });
});

describe('newcon-source rows are new construction by source (review M4)', () => {
  it('a newcon row with a blank permit_type still makes its project new construction', () => {
    const raw = baseRaw();
    for (const p of raw['datasf-permits-newcon']) {
      if (p.permit_number === '202403150003') delete p.permit_type;
    }
    const r = deriveProjects(baseInput(raw));
    expect(r.file.projects.map((p) => p.id)).toContain('BP:202403150003');
    expect(r.permits.map((p) => p.permit_number)).toContain('202403150003');
  });
});

describe('named alteration completions and the type 1/2 test (Rulings CU1, M1r)', () => {
  const ID = 'PRJ:2018-000030PRJ';
  const run = (permits: string, named: RawRow[], nc: RawRow[], completions: RawRow[]) => {
    const raw = baseRaw();
    raw['datasf-planning-projects'].push(
      ...entitledPrj('2018-000030PRJ', permits, { number_of_units_prop: '135' })
    );
    raw['datasf-planning-review'].push(review('2018-000030PRJ'));
    raw['datasf-permits-named'].push(...named);
    raw['datasf-permits-newcon'].push(...nc);
    raw['datasf-unit-completions'].push(...completions);
    return history(deriveProjects(baseInput(raw)), ID);
  };
  const cfc = (permit: string, units: string): RawRow => ({
    building_permit_application: permit,
    date_issued: ts('2021-06-01'),
    document_type: 'CFC',
    number_of_units_certified: units
  });
  const done = {
    status: 'complete',
    status_date: ts('2021-06-01'),
    completed_date: ts('2021-06-01')
  };

  it('a named alteration completes at existing + certified units, gross like permitFiled', () => {
    // The PRJ:2012.1325 shape: 132 -> 135, j67f certifies the 3 added units.
    const h = run(
      '201901150030',
      [alteration('201901150030', { existing_units: '132', proposed_units: '135', ...done })],
      [],
      [cfc('201901150030', '3')]
    );
    expect(h.unitsAt).toMatchObject({ permitFiled: 135, complete: 135 });
  });

  it('two alterations of one building take the max completion, as permitFiled does', () => {
    const h = run(
      '201901150030,201902010031',
      [
        alteration('201901150030', { existing_units: '1', proposed_units: '3', ...done }),
        alteration('201902010031', {
          existing_units: '1',
          proposed_units: '4',
          filed_date: ts('2019-02-01'),
          ...done
        })
      ],
      [],
      [cfc('201901150030', '2'), cfc('201902010031', '3')]
    );
    expect(h.unitsAt).toMatchObject({ permitFiled: 4, complete: 4 });
  });

  it('a dead type 1/2 permit does not make a 0-existing alteration unitless (Ruling M1r)', () => {
    const h = run(
      '201901150030,201812010031',
      [alteration('201901150030', { existing_units: '0', proposed_units: '7' })],
      [
        {
          permit_number: '201812010031',
          permit_type: '1',
          block: '3512',
          lot: '008',
          status: 'withdrawn',
          status_date: ts('2019-01-01'),
          filed_date: ts('2018-12-01'),
          proposed_units: '7',
          site_permit: 'Y',
          primary_address_flag: 'Y'
        }
      ],
      []
    );
    expect(h.unitsAt.permitFiled).toBe(7);
  });
});
