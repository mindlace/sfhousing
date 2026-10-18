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
