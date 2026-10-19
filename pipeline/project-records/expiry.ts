/**
 * SF Building Code §106A.4.4 permit expiration (Table B), by era: code-owned rule data for the
 * statutory-expiry rule `pr.stages.statutory-expiry` (spec 4.6, partner Ruling E2). Transcribed
 * from the partner's research (retrieved 2026-10-18; `permit-expiry/RULE.md` and `rule.json`).
 *
 * DataSF `i98e-djp9` carries no expiry, extension or reinstatement field: of its 55 columns only
 * `status`, `status_date`, `issued_date`, `completed_date`, `last_permit_activity_date`,
 * `first_construction_document_date`, `estimated_cost`, `revised_cost` and `site_permit` bear on
 * expiry, and the dataset holds the current status only. An `expired` status's `status_date` is
 * the day DBI posted the expiry in a batch run, not the legal expiry day, so the deadline is
 * computed here from `issued_date` plus this table. A granted extension leaves no field; the only
 * traces are a permit still `issued` past its Table B time or a `last_permit_activity_date` after
 * it, which is why post-deadline activity blocks the exit.
 *
 * Reinstatement: an expired permit with no work started needs a new application at reduced fees
 * within one year (§106A.4.4.1; "Commencement of work not started: ... 50% of current fee", Ord.
 * 221-02 Table 1-B, https://www.sfbos.org/ftp/uploadedfiles/bdsupvrs/ordinances02/o0221-02.pdf);
 * one with work not completed needs an alteration permit for the rest (§106A.4.4.2); such a
 * recommencement appears as a new permit number. The partner's ruling: a permit whose status is
 * `reinstated` blocks the exit, and one whose status is `suspend` does not. Both statuses sit a
 * median 76 and 81 days after issuance live, which fits a suspension during an appeal and its
 * reinstatement (an inference, not documented), not the revival of an expired permit.
 *
 * Only Table B's completion time and the single extension are used. The pre-2009 90-day start
 * rule, the code-compliance and demolition overrides and appeal tolling are not: the source is
 * type 1/2 (new construction) permits only, and no field records an appeal.
 */
import type { Day } from '../../src/lib/timelapse/time';
import type { Permit } from './types';

const day = (iso: string): Day => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

export type Era = 'E0' | 'E1' | 'E2' | 'E3';

export interface ExpiryBracket {
  /** Upper bound of the valuation, dollars, inclusive; null = no upper bound. */
  maxValuation: number | null;
  /** Table B time to complete the work, days from issuance; null = no maximum (E3). */
  completeDays: number | null;
  /** The most one extension may add, days. */
  extensionDays: number;
}

/**
 * E1 starts with Ord. 107-09 (File 090588), finally passed 2009-06-23; the ordinance states no
 * effective date, so about 30 days after passage is taken (approximate).
 * https://sfbos.org/ftp/uploadedfiles/bdsupvrs/ordinances09/o0107-09.pdf
 */
export const E1_FROM: Day = day('2009-07-23');
/**
 * E2 starts with Ord. 16-13 (File 120959), passed 2013-02-05, effective "30 days from the date of
 * passage". https://www.sfbos.org/ftp/uploadedfiles/bdsupvrs/ordinances13/o0016-13.pdf
 */
export const E2_FROM: Day = day('2013-03-07');
/**
 * E3: Ord. 259-25 (File 250811), finally passed 2025-12-16, "effective 180 days after
 * enactment"; per AB-115 it "shall apply only to applications filed on and after June 21, 2026".
 * https://www.sfbos.org/sites/default/files/o0259-25.pdf;
 * https://media.api.sf.gov/documents/BIC_Meeting_7-16-26_Item_5.pdf
 */
export const E3_FILED_FROM: Day = day('2026-06-21');

/** Ord. 107-09, Ord. 16-13 Table B note (1): a site permit valued $2.5M or more gets +50%. */
export const SITE_PERMIT_MIN_VALUATION = 2_500_000;
/** 1,440 days + 50% (Ord. 107-09 struck text; Ord. 16-13 Table B note (1)). */
export const SITE_PERMIT_COMPLETE_DAYS = 2160;

/** Table B brackets per era, ascending by `maxValuation`. */
export const EXPIRY_BRACKETS: Record<Era, readonly ExpiryBracket[]> = {
  // E0, pre-Ord. 107-09: reconstructed from the text Ord. 107-09 struck (pp. 9-12: "$300,000",
  // "Ninety", "not started within 90 days"), https://sfbos.org/ftp/uploadedfiles/bdsupvrs/
  // ordinances09/o0107-09.pdf. The source reads "$1.00 to $300,000" and "$300,000 to
  // $2,499,999", so the $300,000 boundary is ambiguous; it is taken as inclusive of the first
  // bracket. This era's start and any 1980s/1990s version were not found.
  E0: [
    // Ord. 107-09 (struck): $1-$300,000, 360 days, one extension of 90.
    { maxValuation: 300_000, completeDays: 360, extensionDays: 90 },
    // Ord. 107-09 (struck): $300,000-$2,499,999, 1,080 days, one extension of 180.
    { maxValuation: 2_499_999, completeDays: 1080, extensionDays: 180 },
    // Ord. 107-09 (struck): $2,500,000 and up, 1,440 days, one extension of 360.
    { maxValuation: null, completeDays: 1440, extensionDays: 360 }
  ],
  // E1, Ord. 107-09 to Ord. 16-13: https://sfbos.org/ftp/uploadedfiles/bdsupvrs/ordinances09/
  // o0107-09.pdf, §106A.4.4 Table B as amended.
  E1: [
    // Ord. 107-09: $1-$100,000, 360 days, one extension of 180.
    { maxValuation: 100_000, completeDays: 360, extensionDays: 180 },
    // Ord. 107-09: $100,001-$2,499,999, 1,080 days, one extension of 180.
    { maxValuation: 2_499_999, completeDays: 1080, extensionDays: 180 },
    // Ord. 107-09: $2,500,000 and up, 1,440 days, one extension of 360.
    { maxValuation: null, completeDays: 1440, extensionDays: 360 }
  ],
  // E2, Ord. 16-13 to Ord. 259-25: https://www.sfbos.org/ftp/uploadedfiles/bdsupvrs/
  // ordinances13/o0016-13.pdf, §106A.4.4 and Table B. "Unless approved by the Building Official,
  // no more than one extension of time may be granted" (item 3). Permits filed before 2026-06-21
  // keep these rules for life (AB-115).
  E2: [
    // Ord. 16-13: $1-$100,000, 360 days, one extension of 360.
    { maxValuation: 100_000, completeDays: 360, extensionDays: 360 },
    // Ord. 16-13: $100,001-$2,499,999, 1,080 days, one extension of 720.
    { maxValuation: 2_499_999, completeDays: 1080, extensionDays: 720 },
    // Ord. 16-13: $2,500,000 and up, 1,440 days, one extension of 720.
    { maxValuation: null, completeDays: 1440, extensionDays: 720 }
  ],
  // E3, Ord. 259-25: Table B is struck, so there is no completion maximum and no valuation
  // dependence; a permit expires only if work is not commenced within 365 days or is suspended
  // for 365 continuous days, and each inspection rolls the clock 365 days (AB-115). Extensions of
  // 180 days, more for justifiable cause (§106A.4.4 Exc. 1).
  // https://www.sfbos.org/sites/default/files/o0259-25.pdf
  E3: [{ maxValuation: null, completeDays: null, extensionDays: 180 }]
};

/** The middle bracket, used for a permit with no recorded valuation (Ruling E2). */
const MIDDLE_BRACKET = 1;

/**
 * Ruling E2: the era is chosen by `issued_date`, except that E3 needs a filed day on or after
 * 2026-06-21 (AB-115: earlier applications keep the old rules for life). The filed day is
 * `filed_date`, else `permit_creation_date` (`Permit.filedDay`). Null with no issued day.
 */
export function eraOf(p: Pick<Permit, 'issuedDay' | 'filedDay'>): Era | null {
  if (p.issuedDay === null) return null;
  if (p.filedDay !== null && p.filedDay >= E3_FILED_FROM) return 'E3';
  if (p.issuedDay < E1_FROM) return 'E0';
  if (p.issuedDay < E2_FROM) return 'E1';
  return 'E2';
}

/**
 * The era's bracket for a valuation: the first whose `maxValuation` is at least the valuation
 * (null = no bound). A null valuation takes the middle bracket (E3 has only one).
 */
export function bracketOf(era: Era, valuation: number | null): ExpiryBracket {
  const brackets = EXPIRY_BRACKETS[era];
  if (valuation === null) return brackets[Math.min(MIDDLE_BRACKET, brackets.length - 1)];
  const b = brackets.find((x) => x.maxValuation === null || valuation <= x.maxValuation);
  return b as ExpiryBracket;
}

/** Table B completion days, with the site-permit +50% at $2.5M or more; null = no maximum. */
export function completionDays(
  era: Era,
  valuation: number | null,
  sitePermit: boolean
): number | null {
  const b = bracketOf(era, valuation);
  if (b.completeDays === null) return null;
  if (sitePermit && valuation !== null && valuation >= SITE_PERMIT_MIN_VALUATION) {
    return SITE_PERMIT_COMPLETE_DAYS;
  }
  return b.completeDays;
}

/** The most one extension may add, days. */
export function extensionDays(era: Era, valuation: number | null): number {
  return bracketOf(era, valuation).extensionDays;
}

/**
 * A permit's legal completion deadline with the one extension: issued day + completion days +
 * extension days. Null when the permit has no issued day or its era has no completion maximum
 * (E3 never expires under this rule).
 */
export function permitDeadline(
  p: Pick<Permit, 'issuedDay' | 'filedDay' | 'valuation' | 'sitePermit'>
): Day | null {
  const era = eraOf(p);
  if (era === null) return null;
  const complete = completionDays(era, p.valuation, p.sitePermit);
  if (complete === null) return null;
  return (p.issuedDay as Day) + complete + extensionDays(era, p.valuation);
}
