import { describe, expect, it } from 'vitest';
import { checkRhna, rhnaCompletedNet, RHNA_FORMS, RHNA_SINCE } from '../../project-records/rhna';
import { isoOf } from '../../project-records/parse';
import type { HousingRow } from '../../project-records/types';
import { parseProjectsFile } from '../../../src/lib/timelapse/projects';

function d(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

const ASOF = d('2026-10-10');

function row(form: string | null, netUnits: number | null, iso: string | null): HousingRow {
  return { bpa: null, form, netUnits, firstCompletionDay: iso === null ? null : d(iso) };
}

describe('rhnaCompletedNet', () => {
  it('uses the RHNA period start and the Housing Inventory forms', () => {
    expect(RHNA_SINCE).toBe(d('2022-06-30'));
    expect([...RHNA_FORMS].sort()).toEqual(['1', '2', '3', '6', '8']);
  });

  it('counts rows on since and on asOf, not the day before or after', () => {
    const rows = [
      row('1', 10, '2022-06-30'),
      row('1', 100, '2026-10-10'),
      row('1', 1000, '2022-06-29'),
      row('1', 10000, '2026-10-11')
    ];
    const r = rhnaCompletedNet(rows, ASOF);
    expect(r.value.units).toBe(110);
    expect(r.value.provenance.n).toBe(2);
  });

  it('subtracts demolitions and excludes other forms', () => {
    const rows = [
      row('1', 3, '2024-01-01'),
      row('3', 2, '2024-01-02'),
      row('6', -1, '2024-01-03'),
      row('5', 99, '2024-01-04'),
      row(null, 99, '2024-01-05')
    ];
    const r = rhnaCompletedNet(rows, ASOF);
    expect(r.value.units).toBe(4);
    expect(r.value.provenance.n).toBe(3);
  });

  it('skips rows with null units or null completion day without counting them', () => {
    const r = rhnaCompletedNet(
      [row('1', null, '2024-01-01'), row('2', 5, null), row('2', 5, '2024-01-01')],
      ASOF
    );
    expect(r.value.units).toBe(5);
    expect(r.value.provenance.n).toBe(1);
  });

  it('carries exact provenance and passes the projects.json validator', () => {
    const { value } = rhnaCompletedNet([row('1', 1, '2024-01-01')], ASOF);
    expect(value.since).toBe(RHNA_SINCE);
    expect(value.provenance).toEqual({
      tier: 0,
      label: 'Net homes completed since 30 Jun 2022 (actual)',
      sources: [
        { label: 'DataSF Housing Production (xdht-4php)', url: 'https://data.sf.gov/d/xdht-4php' },
        {
          label: 'HCD Final RHNA determination for ABAG (2020-06-09)',
          url: 'https://www.hcd.ca.gov/community-development/housing-element/docs/abagrhna-final060920(r).pdf'
        }
      ],
      method:
        'Sum of net_units_completed over xdht-4php rows with first_completion_date in [2022-06-30, asOf], forms 1-2 (new construction), 3 and 8 (alterations, net) and 6 (demolitions, negative), the Housing Inventory definition; cross-checked per calendar year against the Housing Inventory Table 2 net change (tier 1).',
      n: 1,
      window: ['2022-06-30', isoOf(ASOF)]
    });
    const file = { schema: 1, asOf: ASOF, rhnaCompletedNet: value, projects: [] };
    const parsed = parseProjectsFile(JSON.parse(JSON.stringify(file)), { asOf: ASOF });
    expect(parsed.rhnaCompletedNet.units).toBe(1);
  });

  it('gives byYear only for calendar years wholly inside the window', () => {
    const rows = [
      row('1', 7, '2022-08-01'), // 2022 starts before since
      row('1', 5, '2023-01-01'),
      row('6', -1, '2023-12-31'),
      row('3', 2, '2024-06-01'),
      row('1', 9, '2025-12-31'),
      row('1', 50, '2026-03-01') // 2026 ends after asOf
    ];
    const r = rhnaCompletedNet(rows, ASOF);
    expect(r.byYear).toEqual({ 2023: 4, 2024: 2, 2025: 9 });
    expect(r.value.units).toBe(72);
  });

  it('lagDays is asOf minus the latest completion over any form, null when none', () => {
    const r = rhnaCompletedNet(
      [row('1', 1, '2026-10-02'), row('5', 1, '2026-10-05'), row('1', 1, '2024-01-01')],
      ASOF
    );
    expect(r.lagDays).toBe(5);
    expect(rhnaCompletedNet([row('1', 1, null)], ASOF).lagDays).toBeNull();
  });
});

describe('checkRhna', () => {
  const hi = { 2023: 1000, 2024: 2000 };
  const tol = { year: 0.1, total: 0.05 };

  it('passes exactly at +10% and -10% per year', () => {
    // 2023 at +10% and 2024 at -10%, offsetting inside the total tolerance
    expect(checkRhna({ 2023: 1100, 2024: 1800 }, 2900, hi, tol).ok).toBe(true);
    expect(checkRhna({ 2023: 900, 2024: 2100 }, 3000, hi, tol).ok).toBe(true);
  });

  it('passes exactly at +5% total', () => {
    expect(checkRhna({ 2023: 1050, 2024: 2100 }, 3150, hi, tol).ok).toBe(true);
  });

  it('fails just beyond the per-year edge', () => {
    const r = checkRhna({ 2023: 1100.5, 2024: 1900 }, 3000.5, hi, tol);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('2023 1100.5 vs 1000');
  });

  it('fails just beyond the total edge', () => {
    const r = checkRhna({ 2023: 1050, 2024: 2101 }, 3151, hi, tol);
    expect(r.ok).toBe(false);
  });

  it('ignores years without hiNet and treats a missing byYear as zero', () => {
    expect(checkRhna({ 2023: 1000, 2022: 5 }, 1005, { 2023: 1000 }, tol).ok).toBe(true);
    const r = checkRhna({}, 0, { 2023: 1000 }, tol);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('2023 0 vs 1000');
  });
});
