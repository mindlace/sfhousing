// RHNA completed net (spec §4.9): net units certified complete since the RHNA projection period
// start, by the Housing Inventory's definition, with a per-year cross-check against its Table 2.
import type { Day } from '../../src/lib/timelapse/time';
import type { ProjectsFile } from '../../src/lib/timelapse/projects';
import { INCOME_TIERS, type TierUnits } from '../../src/lib/timelapse/types';
import { isoOf } from './parse';
import { largestRemainder } from './multiphase';
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
  /**
   * pr.rhna.tier-unrecorded: counted rows with homes to place (`n > 0`) and affordable homes or a
   * positive tier sum, and those of them counted under rule 2; sample is their `bpa`.
   */
  tierUnrecorded: { fired: number; of: number; sample: string[] };
} {
  let units = 0;
  const byTier: TierUnits = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0, unrecorded: 0 };
  const tierUnrecorded = { fired: 0, of: 0, sample: [] as string[] };
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
    addTiers(byTier, r, r.netUnits, tierUnrecorded);
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
      byTier: {
        veryLow: byTier.veryLow,
        low: byTier.low,
        moderate: byTier.moderate,
        aboveModerate: byTier.aboveModerate,
        unrecorded: byTier.unrecorded
      },
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
          "Sum of net_units_completed over xdht-4php rows with first_completion_date in [2022-06-30, asOf], forms 1-2 (new construction), 3 and 8 (alterations, net) and 6 (demolitions, negative), the Housing Inventory definition; cross-checked per calendar year against the Housing Inventory Table 2 net change (tier 1). By tier: extremely low plus very low income as very low, low and moderate income as recorded, the rest of each row's net completed homes as above moderate (the source has no above-moderate column; net losses fall there); a row whose tier columns are blank counts its affordable homes as not recorded; Planning estimates some rows' tiers from similar projects (affordable_is_estimate).",
        n,
        window: ['2022-06-30', isoOf(asOf)]
      }
    },
    byYear,
    lagDays: latest === null ? null : asOf - latest,
    tierUnrecorded
  };
}

/** Spec 4.3 rules 0-2: adds one counted row's `n` net homes to `into`, in the first rule that applies. */
function addTiers(
  into: TierUnits,
  r: HousingRow,
  n: number,
  tally: { fired: number; of: number; sample: string[] }
): void {
  if (n <= 0) {
    into.aboveModerate += n;
    return;
  }
  const t = r.tiers;
  const affordable = r.affordable ?? 0;
  const tierSum = t === null ? 0 : t.extremelyLow + t.veryLow + t.low + t.moderate;
  if (affordable > 0 || tierSum > 0) tally.of += 1;
  if (t !== null) {
    const counts = [t.extremelyLow + t.veryLow, t.low, t.moderate, 0];
    const a = counts[0] + counts[1] + counts[2];
    const placed = a <= n ? counts : largestRemainder(counts, n);
    INCOME_TIERS.forEach((k, i) => (into[k] += placed[i]));
    if (a <= n) into.aboveModerate += n - a;
    return;
  }
  if (affordable > 0) {
    const u = Math.min(affordable, n);
    into.unrecorded += u;
    into.aboveModerate += n - u;
    tally.fired += 1;
    if (r.bpa !== null) tally.sample.push(r.bpa);
    return;
  }
  into.aboveModerate += n;
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
