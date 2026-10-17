// RHNA completed net (spec §4.9): net units certified complete since the RHNA projection period
// start, by the Housing Inventory's definition, with a per-year cross-check against its Table 2.
import type { Day } from '../../src/lib/timelapse/time';
import type { ProjectsFile } from '../../src/lib/timelapse/projects';
import { isoOf } from './parse';
import type { HousingRow } from './types';

const DAY_MS = 86_400_000;

function dayOfIso(iso: string): Day {
  return Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
}

/** HCD's projection period beginning, 30 June 2022. */
export const RHNA_SINCE: Day = dayOfIso('2022-06-30');

/** form_no values the Housing Inventory counts: new construction, alterations, demolitions. */
export const RHNA_FORMS: ReadonlySet<string> = new Set(['1', '2', '3', '8', '6']);

const EPS = 1e-9;

export function rhnaCompletedNet(
  rows: HousingRow[],
  asOf: Day
): {
  value: ProjectsFile['rhnaCompletedNet'];
  /** Net units per calendar year wholly inside [since, asOf]. */
  byYear: Record<number, number>;
  lagDays: number | null;
} {
  let units = 0;
  let n = 0;
  let latest: Day | null = null;
  const sums = new Map<number, number>();

  for (const r of rows) {
    const day = r.firstCompletionDay;
    if (day === null || !Number.isFinite(day)) continue;
    if (latest === null || day > latest) latest = day;
    if (r.netUnits === null || r.form === null || !RHNA_FORMS.has(r.form)) continue;
    if (day < RHNA_SINCE || day > asOf) continue;
    units += r.netUnits;
    n += 1;
    const year = new Date(day * DAY_MS).getUTCFullYear();
    sums.set(year, (sums.get(year) ?? 0) + r.netUnits);
  }

  const byYear: Record<number, number> = {};
  const firstYear = new Date(RHNA_SINCE * DAY_MS).getUTCFullYear();
  const lastYear = new Date(asOf * DAY_MS).getUTCFullYear();
  for (let y = firstYear; y <= lastYear; y++) {
    if (dayOfIso(`${y}-01-01`) >= RHNA_SINCE && dayOfIso(`${y}-12-31`) <= asOf) {
      byYear[y] = sums.get(y) ?? 0;
    }
  }

  return {
    value: {
      units,
      since: RHNA_SINCE,
      provenance: {
        tier: 0,
        label: 'Net homes completed since 30 Jun 2022 (actual)',
        sources: [
          {
            label: 'DataSF Housing Production (xdht-4php)',
            url: 'https://data.sf.gov/d/xdht-4php'
          },
          {
            label: 'HCD Final RHNA determination for ABAG (2020-06-09)',
            url: 'https://www.hcd.ca.gov/community-development/housing-element/docs/abagrhna-final060920(r).pdf'
          }
        ],
        method:
          'Sum of net_units_completed over xdht-4php rows with first_completion_date in [2022-06-30, asOf], forms 1-2 (new construction), 3 and 8 (alterations, net) and 6 (demolitions, negative), the Housing Inventory definition; cross-checked per calendar year against the Housing Inventory Table 2 net change (tier 1).',
        n,
        window: ['2022-06-30', isoOf(asOf)]
      }
    },
    byYear,
    lagDays: latest === null ? null : asOf - latest
  };
}

/**
 * V22: each year with a `hiNet` entry within `tol.year` of it, and their total within `tol.total`.
 * `total` is the caller's headline figure, reported in `detail` only.
 */
export function checkRhna(
  byYear: Record<number, number>,
  total: number,
  hiNet: Record<number, number>,
  tol: { year: number; total: number }
): { ok: boolean; detail: string } {
  const years = Object.keys(hiNet)
    .map(Number)
    .sort((a, b) => a - b);
  let ok = true;
  let sumRecords = 0;
  let sumHi = 0;
  const parts: string[] = [];
  for (const y of years) {
    const rec = byYear[y] ?? 0;
    const hi = hiNet[y];
    sumRecords += rec;
    sumHi += hi;
    if (Math.abs(rec - hi) > tol.year * Math.abs(hi) + EPS) ok = false;
    parts.push(`${y} ${rec} vs ${hi}`);
  }
  if (Math.abs(sumRecords - sumHi) > tol.total * Math.abs(sumHi) + EPS) ok = false;
  return {
    ok,
    detail: `${parts.join(', ')}; total ${sumRecords} vs ${sumHi} (all-period ${total})`
  };
}
