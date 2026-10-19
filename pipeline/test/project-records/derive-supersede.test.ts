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

describe('the inferred lapse runs after supersession (Ruling IL1, review I2)', () => {
  // X: entitled 2021-03-01 on lot 008, no permit, in flight on its 2025 pipeline row. Y: the same
  // address refiled on lot 009 (same block) in 2024. Superseded, X is no longer in flight, so it
  // exits instead of being flagged.
  const run = (withY: boolean) => {
    const raw = baseRaw();
    raw['datasf-planning-projects'].push({
      ...prj('2020-000093PRJ', '008', '2020-06-01', '700 Test Ave', ''),
      building_permits: undefined as unknown as string
    });
    raw['datasf-planning-review'].push({
      b1_alt_id: '2020-000093PRJ',
      start_event_type: 'accepted',
      start_event_date: ts('2020-06-15'),
      end_event_type: 'approval',
      end_event_date: ts('2021-03-01')
    });
    raw['datasf-dev-pipeline'].push({
      blklot: '3512008',
      current_status: 'PL Approved',
      current_status_date: ts('2025-06-01'),
      case_no: '2020-000093PRJ',
      new_pipeline_units: '10'
    });
    if (withY) {
      raw['datasf-planning-projects'].push({
        ...prj('2024-000094PRJ', '009', '2024-06-01', '700 TEST AVE 94110', ''),
        building_permits: undefined as unknown as string
      });
      raw['datasf-dev-pipeline'].push({
        blklot: '3512009',
        current_status: 'PL Filed',
        current_status_date: ts('2026-06-01'),
        case_no: '2024-000094PRJ',
        new_pipeline_units: '10'
      });
    }
    return deriveProjects(baseInput(raw));
  };

  it('in flight alone it is flagged and stays open', () => {
    const r = run(false);
    expect(ids(r)).toContain('PRJ:2020-000093PRJ');
    expect(r.histories.find((h) => h.id === 'PRJ:2020-000093PRJ')?.end.kind).toBe('open');
    expect(r.counts['projects.lapseFlagged']).toBe(1);
  });

  it('superseded, it exits as a lapse a year after its rule expiry', () => {
    const r = run(true);
    expect(ids(r)).not.toContain('PRJ:2020-000093PRJ');
    expect(r.counts['projects.excludedSuperseded']).toBe(1);
    // 2021-03-01 + 3 y + 16 ZA days = 2024-03-17, AB 2729 to 2025-09-17; lastObserved 2025-06-01.
    expect(r.histories.find((h) => h.id === 'PRJ:2020-000093PRJ')?.end).toEqual({
      kind: 'exit',
      stage: 'entitled',
      reason: 'expired',
      day: Date.parse('2025-09-17T00:00:00Z') / 86_400_000 + 365
    });
    expect(r.counts['projects.lapseFlagged']).toBe(0);
  });
});
