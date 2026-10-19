// Rulings SP1-SP3 through deriveProjects (review M5): the PRJ address is the key (not a
// permit-derived label), the earliest filed day reads every permit, supersession runs before DA
// netting, and a superseded project's pipeline rows leave V21.
import { describe, expect, it } from 'vitest';
import { deriveProjects } from '../../project-records/derive';
import type { RawRow } from '../../project-records/types';
import { baseInput, baseRaw } from './derive-input';

const ts = (iso: string) => `${iso}T00:00:00.000`;

const prj = (id: string, lot: string, open: string, address: string, permits: string): RawRow => ({
  record_id: id,
  record_status: 'Open',
  project_address: address,
  block: '3512',
  lot,
  open_date: ts(open),
  building_permits: permits,
  number_of_units_prop: '10',
  new_construction: 'CHECKED'
});

const permit = (n: string, lot: string, filed: string, units: number, num: string): RawRow => ({
  permit_number: n,
  permit_type: '2',
  block: '3512',
  lot,
  status: 'filed',
  status_date: ts(filed),
  filed_date: ts(filed),
  proposed_units: String(units),
  street_number: num,
  street_name: 'Test',
  street_suffix: 'Av',
  site_permit: 'Y',
  primary_address_flag: 'Y'
});

/** X (opened first, permit labelled 502) and Y (refiled, labelled 500), same PRJ address. */
function scenario(o: {
  x: boolean;
  y: boolean;
  lot: string;
  xFiled?: string;
  xSecond?: string;
  xRow?: boolean;
}) {
  const raw = baseRaw();
  if (o.x) {
    const permits = o.xSecond ? '202606050001,202606050003' : '202606050001';
    raw['datasf-planning-projects'].push(
      prj('2026-000091PRJ', o.lot, '2026-06-01', '500 TEST AVE 94110', permits)
    );
    raw['datasf-permits-newcon'].push(
      permit('202606050001', o.lot, o.xFiled ?? '2026-06-05', 10, '502')
    );
    if (o.xSecond) {
      raw['datasf-permits-newcon'].push(permit('202606050003', o.lot, o.xSecond, 1, '502'));
    }
    if (o.xRow) {
      raw['datasf-dev-pipeline'].push({
        blklot: `3512${o.lot}`,
        current_status: 'PL Filed',
        current_status_date: ts('2026-07-01'),
        case_no: '2026-000091PRJ',
        new_pipeline_units: '10'
      });
    }
  }
  if (o.y) {
    raw['datasf-planning-projects'].push(
      prj('2026-000092PRJ', o.lot, '2026-08-01', '500 Test Ave', '202608050002')
    );
    raw['datasf-permits-newcon'].push(permit('202608050002', o.lot, '2026-08-05', 12, '500'));
  }
  return deriveProjects(baseInput(raw));
}

const ids = (r: ReturnType<typeof deriveProjects>) => r.file.projects.map((p) => p.id);

describe('supersession in deriveProjects (Rulings SP1-SP3, review M5)', () => {
  it('keys on the PRJ address although the permit labels differ', () => {
    const r = scenario({ x: true, y: true, lot: '008' });
    expect(ids(r)).toContain('PRJ:2026-000092PRJ');
    expect(ids(r)).not.toContain('PRJ:2026-000091PRJ');
    expect(r.counts['projects.excludedSuperseded']).toBe(1);
  });

  it('the earliest filed day reads every permit: a shared filing day makes them siblings', () => {
    // X's 10-unit permit is filed 2026-09-01; its 1-unit permit on 2026-08-05, Y's filing day.
    const r = scenario({
      x: true,
      y: true,
      lot: '008',
      xFiled: '2026-09-01',
      xSecond: '2026-08-05'
    });
    expect(ids(r)).toEqual(expect.arrayContaining(['PRJ:2026-000091PRJ', 'PRJ:2026-000092PRJ']));
    // Without the shared day, X is superseded.
    const apart = scenario({
      x: true,
      y: true,
      lot: '008',
      xFiled: '2026-09-01',
      xSecond: '2026-08-06'
    });
    expect(ids(apart)).not.toContain('PRJ:2026-000091PRJ');
  });

  it('runs before DA netting: a superseded project nets no master', () => {
    const key = 'multiphase.netted.2010.0002PRX';
    const both = scenario({ x: true, y: true, lot: '006' });
    const yOnly = scenario({ x: false, y: true, lot: '006' });
    expect(ids(both)).not.toContain('PRJ:2026-000091PRJ');
    expect(both.counts[key]).toBe(yOnly.counts[key]);
    expect(both.counts[key]).toBeGreaterThan(
      scenario({ x: false, y: false, lot: '006' }).counts[key]
    );
  });

  it("a superseded project's pipeline rows leave V21", () => {
    const both = scenario({ x: true, y: true, lot: '008', xRow: true });
    const yOnly = scenario({ x: false, y: true, lot: '008' });
    expect(ids(both)).not.toContain('PRJ:2026-000091PRJ');
    expect(both.checks.coverage).toEqual(yOnly.checks.coverage);
    // Not superseded, its row counts.
    const xOnly = scenario({ x: true, y: false, lot: '008', xRow: true });
    expect(xOnly.checks.coverage.rows).toBe(yOnly.checks.coverage.rows + 1);
  });
});
