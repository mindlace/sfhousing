/**
 * San Francisco Planning entitlement performance periods: code-owned rule data for the inferred
 * lapse of a discretionary approval (`pr.stages.inferred-lapse`, Ruling IL1) and the statutory
 * expiry of a streamlined one (`pr.stages.streamlined-expiry`, Ruling SE1), spec 4.6. Transcribed
 * from the partner's research (retrieved 2026-10-18; `entitlement-expiry/rule.json`, citation ids
 * in brackets below).
 *
 * - Discretionary approvals (CU 303, 309, 329, demolition 317, Housing Choice-SF 206.10): the
 *   standard conditions of approval give a 3-year performance period from the effective date in
 *   which DBI must issue a building or site permit [sf-2014.0192C, sf-2018-008669CUA,
 *   sf-2026-002251CUA]. Since May 2014 the lapse is not self-executing: the Commission holds a
 *   revocation hearing or sets an extension, and extensions (CUA-02 / DNX-02 / ENX-02 records,
 *   and since 2026-08-22 administrative MOD extensions under Ord. 136-26 [ord-136-26]) are common
 *   and carry no status field. Hence an inference (tier 3) with a year of grace.
 * - Streamlined approvals (SB 35 / AB 2011, Gov. Code 65913.4(g), 65912.114(l)): expire by
 *   statute after 3 years, with one possible 1-year extension [gov-65913.4-current,
 *   sb35-2017-archived, ab2011]; never for subsidised projects with 50% or more units at or below
 *   80% AMI. Litigation tolling (AB 1174 [ab1174-2021]) is not recorded in any field and is not
 *   modelled.
 * - Automatic extensions [rule.json automaticExtensions]: AB 1561 (Gov. Code 65914.5 [ab1561]),
 *   +18 months for entitlements in effect on 2020-03-04 that would expire before 2021-12-31; the
 *   Zoning Administrator's COVID letter (LOD 2021-001320OTH [sf-za-lod-2021-001320OTH]), +the
 *   days a discretionary period overlaps 2020-03-17..2021-03-16, concurrent with AB 1561 (the
 *   later of the two applies); AB 2729 (Gov. Code 65914.4 [ab2729, sf-ab2729-news]), +18 months
 *   for entitlements in effect on 2024-01-01 that expire before 2025-12-31.
 *
 * Calendar convention: days are UTC epoch days. `+ n years` keeps month and day (Feb 29 becomes
 * Feb 28); `+ n months` keeps the day, clamped to the month's last day (the measurement clamped to
 * the 28th; no candidate it listed falls on the 29th-31st). The COVID overlap counts both end days
 * (`min(period end, 2021-03-16) - max(entitled, 2020-03-17) + 1`), as the measurement did, so a
 * period that spans the whole window gains 365 days.
 */
import type { Day } from '../../src/lib/timelapse/time';

const DAY_MS = 86_400_000;
const day = (iso: string): Day => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** The standard performance period and the SB 35 term, years [rule.json pathways]. */
export const PERFORMANCE_YEARS = 3;
/** SB 35's one-time extension, assumed granted (Ruling SE1) [gov-65913.4-current]. */
export const STREAMLINED_EXTENSION_YEARS = 1;
/** Ruling IL1: the grace after max(rule expiry, last observed) before an inferred lapse exits. */
export const LAPSE_GRACE_DAYS = 365;

/** AB 1561 [ab1561]: in effect on this day ... */
export const AB1561_IN_EFFECT: Day = day('2020-03-04');
/** ... and expiring before this day. */
export const AB1561_EXPIRES_BEFORE: Day = day('2021-12-31');
/** The extension AB 1561 and AB 2729 each grant, months. */
export const STATUTORY_EXTENSION_MONTHS = 18;
/** ZA LOD 2021-001320OTH [sf-za-lod-2021-001320OTH]: the overlap window, both days included. */
export const ZA_COVID_FROM: Day = day('2020-03-17');
export const ZA_COVID_TO: Day = day('2021-03-16');
/** AB 2729 [ab2729]: in effect on this day ... */
export const AB2729_IN_EFFECT: Day = day('2024-01-01');
/** ... and expiring before this day. */
export const AB2729_EXPIRES_BEFORE: Day = day('2025-12-31');

function addMonths(d: Day, months: number): Day {
  const t = new Date(d * DAY_MS);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(t.getUTCDate(), last)) / DAY_MS;
}

function addYears(d: Day, years: number): Day {
  return addMonths(d, 12 * years);
}

/** AB 1561: in effect on 2020-03-04 and due before 2021-12-31. */
function ab1561(entitled: Day, due: Day): Day {
  return entitled <= AB1561_IN_EFFECT && AB1561_IN_EFFECT <= due && due < AB1561_EXPIRES_BEFORE
    ? addMonths(due, STATUTORY_EXTENSION_MONTHS)
    : due;
}

/** AB 2729: in effect on 2024-01-01 and due before 2025-12-31. */
function ab2729(entitled: Day, due: Day): Day {
  return entitled <= AB2729_IN_EFFECT && AB2729_IN_EFFECT <= due && due < AB2729_EXPIRES_BEFORE
    ? addMonths(due, STATUTORY_EXTENSION_MONTHS)
    : due;
}

/**
 * rule.json `modelingRule.discretionaryExpiryDay`: entitled + 3 years; then the later of AB 1561
 * and the ZA COVID overlap (concurrent, not stacked); then AB 2729.
 */
export function discretionaryExpiry(entitled: Day): Day {
  const base = addYears(entitled, PERFORMANCE_YEARS);
  const overlap = Math.max(0, Math.min(base, ZA_COVID_TO) - Math.max(entitled, ZA_COVID_FROM) + 1);
  const due = Math.max(ab1561(entitled, base), base + overlap);
  return ab2729(entitled, due);
}

/**
 * rule.json `modelingRule.streamlinedExpiryDay` (Ruling SE1): entitled + 3 years with AB 1561 and
 * AB 2729 applied to that date (the ZA letter covers discretionary periods only), then the
 * one-time 1-year extension.
 */
export function streamlinedExpiry(entitled: Day): Day {
  const due = ab2729(entitled, ab1561(entitled, addYears(entitled, PERFORMANCE_YEARS)));
  return addYears(due, STREAMLINED_EXTENSION_YEARS);
}

/**
 * Ruling SE1: SB 35 approvals of subsidised projects with 50% or more affordable units never
 * expire. `number_affordable_units_prop * 2 >= number_of_units_prop` is an upper bound (no
 * subsidy or AMI field); false when either count is missing or the project proposes none.
 */
export function affordableExempt(affordable: number | null, units: number | null): boolean {
  return affordable !== null && units !== null && units > 0 && affordable * 2 >= units;
}
