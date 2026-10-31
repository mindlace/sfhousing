// Sourced constants for the /sim permitting presets and stage floors (sim-timers plan Task 2,
// Calls 7, 8 and 9). Every value carries a `Provenance`; a value that could not be sourced is
// `{ value: null, reason }`, and the preset or floor that needs it is unavailable. The evidence
// table, with what was read for each value, is `docs/dev/sim-timers.md` "Evidence".
import type { TimedStage } from '$lib/sim/levers/types';
import { MONTH_DAYS } from '$lib/timelapse/time';
import type { Pathway, Provenance } from '$lib/timelapse/types';

export interface Sourced<T> {
  value: T;
  provenance: Provenance;
}
export interface Unsourced {
  value: null;
  reason: string;
}
export type Evidence<T> = Sourced<T> | Unsourced;

const ACCESSED = 'accessed 2026-10-30';

const BLA = {
  label:
    'Budget and Legislative Analyst, "Post-Entitlement Permitting", report to Supervisor ' +
    'Mahmood, 2026-03-05',
  url: 'https://sfbos.archive.sf.gov/sites/default/files/BLA_Post_Entitlement_Permitting_030526.pdf'
};
const GOV_65913_4 = {
  label: 'Cal. Gov. Code § 65913.4 (official text, California Legislative Information)',
  url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65913.4'
};
const GOV_65913_4_MIRROR = {
  label: 'Cal. Gov. Code § 65913.4, 2026 edition as amended by SB 597 (2025), text as read',
  url:
    'https://gocodebook.com/library/us/ca/ca-gov-65913-housing-development-approvals-sb35-sb423/' +
    'title-7.-planning-and-land-use-65000-66499.58/division-1.-planning-and-zoning-65000-66345.4/' +
    'chapter-4.2.-housing-development-approvals-65913-65914.8/65913/65913.4'
};
const HCD_REVIEW = {
  label: 'HCD, San Francisco Housing Policy and Practice Review, 2023-10-25',
  url: 'https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/sf-housing-policy-and-practice-review.pdf'
};
const PROJECTS_JSON = {
  label: 'Dataset 2026-10-29-0fd62c4d, scenarios/fzp/projects.json (SF Planning and DBI records)',
  url: 'https://sfhousing.mindlace.net/data/2026-10-29-0fd62c4d/scenarios/fzp/projects.json'
};
const PLANNING_333 = {
  label: 'SF Planning, Section 333 Public Hearing Notice instructions (v. 05.15.2019)',
  url: 'https://sfplanning.org/sites/default/files/forms/Section333_Instructions_Declaration.pdf'
};

/**
 * The caveats shared by both benchmark figures. The ratio's direction depends on which SF figure
 * is used, so the comparison's limits travel with each value.
 */
const BENCHMARK_CAVEATS =
  'BLA (PDF p. 8): this "is not an exact comparison as each city presents its data slightly ' +
  'differently". San Diego\'s 134 days comes from "publicly available datasets and dashboards" ' +
  '(Exhibit 1 note 3, PDF p. 9), of unknown composition. Sensitivity of San Diego / SF: SF 280 ' +
  'days gives 0.4786; PermitSF 177 days (all in-house permits issued 2024-12-01 to 2025-11-30, ' +
  'Exhibit 2) gives 0.76; SF 114 days (housing permits filed and issued 2024-01-01 to ' +
  '2025-08-12, Exhibit 2) gives 1.18, that is San Diego slower. 280 is used because both 280 and ' +
  "134 measure permits issued in a window, whatever their filing date, and the model's " +
  'permitFiled stage (typical 10 to 13 months, pooled 2007-01-01 to 2026-10-19) has the same ' +
  'pre-2024 composition, when SF permits were often filed concurrently with entitlements.';

/**
 * Median days from building-permit filing to issuance, housing (BLA Exhibit 1, PDF p. 9). The
 * `benchmarkPermits` preset scales `permitFiled` by `sanDiego / sf` (Call 9).
 */
export const BENCHMARK_PERMIT_DAYS: { sf: Sourced<number>; sanDiego: Sourced<number> } = {
  sf: {
    value: 280,
    provenance: {
      tier: 1,
      label: 'San Francisco median days from permit filing to issuance, housing',
      sources: [BLA],
      method:
        `Exhibit 1 (PDF p. 9) and p. 7: DBI in-house building permits for housing, filed before ` +
        `2025-08-12 and issued 2024-01-01 to 2025-08-12, median 280 days from filing to ` +
        `issuance. The report notes this includes pre-entitlement time for permits filed before ` +
        `2024 (PDF p. 9). ${BENCHMARK_CAVEATS} ${ACCESSED}.`,
      window: ['2024-01-01', '2025-08-12']
    }
  },
  sanDiego: {
    value: 134,
    provenance: {
      tier: 1,
      label: 'San Diego median days to permit issuance, housing',
      sources: [BLA],
      method:
        `Exhibit 1 (PDF p. 9) and notes 2 and 3: housing permits issued January 2025 through ` +
        `approximately mid-December 2025, median 134 days, as compiled by the BLA. ` +
        `${BENCHMARK_CAVEATS} ${ACCESSED}.`
    }
  }
};

/**
 * SB 423 approval clock: design review and approval within 90 days of submittal at 150 or fewer
 * units, 180 days above (Gov. Code § 65913.4(d)(1)(A) and (B)).
 */
export const SB423_DEADLINE_DAYS: Sourced<{ small: number; large: number; unitsCutoff: number }> = {
  value: { small: 90, large: 180, unitsCutoff: 150 },
  provenance: {
    tier: 1,
    label: 'SB 423 approval deadline, days from submittal',
    sources: [GOV_65913_4, GOV_65913_4_MIRROR],
    method:
      `§ 65913.4(d)(1): design review "shall be completed" and a compliant development approved ` +
      `(A) within 90 days of submittal of the development to the local government for 150 or ` +
      `fewer housing units, (B) within 180 days of submittal for more than 150. The clock runs ` +
      `from submittal of the development under the section. (c)(1) sets the earlier consistency ` +
      `determination at 60 / 90 days. The official leginfo page returned 403 to the fetch; the ` +
      `text was read on the gocodebook mirror (2026 edition, Stats. 2025 ch. 774). ${ACCESSED}.`
  }
};

/** Share of streamlined projects at or under 150 units (`scripts/timing-evidence.ts`). */
export const SB423_SMALL_SHARE: Evidence<number> = {
  value: 0.7679,
  provenance: {
    tier: 0,
    label: 'Share of streamlined projects with 150 or fewer units',
    sources: [PROJECTS_JSON],
    method:
      'npx tsx scripts/timing-evidence.ts on dataset 2026-10-29-0fd62c4d projects.json ' +
      '(asOf 2026-10-19): 43 of 56 streamlined-pathway pipeline projects have units <= 150 ' +
      '(0.7679), read with parseProjectsFile.',
    n: 56
  }
};

/** Share of discretionary projects that would move to the SB 423 route: not sourced. */
export const SB423_ROUTE_SHIFT: Evidence<number> = {
  value: null,
  reason:
    'No official or per-record estimate of the share of discretionary projects eligible for ' +
    'SB 423 was found (SF Planning SB 423 application form, the HCD Policy and Practice ' +
    'Review, a web search 2026-10-30). The only figure found ("roughly three-quarters ' +
    'of projects eligible") is a press report without a primary source. The SB 423 preset ' +
    'keeps the observed route shares.'
};

/**
 * The `sb423Clock` preset reads the stage month by which this share of outcomes has happened
 * (q90) as the time the deadline must cover. A judgement call (plan Open question 2).
 */
export const SB423_DEADLINE_QUANTILE: Sourced<number> = {
  value: 0.9,
  provenance: {
    tier: 4,
    label: 'Share of streamlined approvals the SB 423 deadline is taken to cover',
    sources: [GOV_65913_4_MIRROR],
    method:
      'Invented parameter (plan Open question 2): the statute sets a deadline, not a ' +
      'distribution; 0.9 treats the deadline as binding on 90% of outcomes and leaves a tail ' +
      `for resubmittals and restarted reviews. ${ACCESSED}.`
  }
};

/** Discretionary filed-to-entitled time, CEQA-exempt over all: not sourced. */
export const CEQA_FILED_RATIO: Evidence<number> = {
  value: null,
  reason:
    'Per record: the locked SF Planning extracts (qvu5-m3a2, y673-d69b) carry no ' +
    'environmental-review type. Report: the UC Berkeley CALES study for HCD gives CEQA pathway ' +
    'shares by year (Table 10) and per-project timelines (Figures 4 and 5) but no entitlement ' +
    'time by CEQA pathway, and finds that CEQA determinations land at the end of entitlement and ' +
    'that more categorical exemptions in 2018 to 2021 came with longer timelines. So no ratio is ' +
    'supported, and the ceqaInfill preset is unavailable.'
};

/** The citation for the definitional `noDiscretionary` preset (Call 9). */
export const NO_DISCRETIONARY_BASIS: Sourced<null> = {
  value: null,
  provenance: {
    tier: 2,
    label: 'No discretionary review: HCD required action "Eliminate Discretion"',
    sources: [HCD_REVIEW],
    method:
      'Required Action 1, "Eliminate Discretion and Subjectivity in Planning Review" (PDF p. ' +
      '18): 1.1, code-compliant housing moves through a local non-discretionary ministerial ' +
      'entitlement process that "must not, by definition, subject code-compliant housing ' +
      'developments to any discretionary decision making"; 1.2, eliminate Planning Commission ' +
      'hearings for code-compliant housing outside Priority Equity Geographies. Moving the ' +
      'discretionary share to streamlined is a definitional inference from the tier-0 shares. ' +
      `${ACCESSED}.`
  }
};

const days = (d: number) => Math.round((d / MONTH_DAYS) * 1000) / 1000;

const PERMIT_FLOOR: Sourced<number> = {
  value: days(13 + 15),
  provenance: {
    tier: 2,
    label: 'Minimum permit review: one completeness check and one first plan review',
    sources: [BLA],
    method:
      'Median 13 calendar days for the completeness check (PermitSF dashboard, PDF p. 11) plus ' +
      'median 15 calendar days to complete first application review (Exhibit 1, PDF p. 9; all ' +
      'in-house permits, p. 8), 28 days / 30.436875 = 0.92 month. The inputs are tier 1; ' +
      'reading two medians as a minimum is an inference (tier 2). The state limit for the ' +
      `completeness check is 15 business days (AB 2234, p. 12). ${ACCESSED}.`
  }
};

const unsourced = (reason: string): Unsourced => ({ value: null, reason });

const PRE_APPLICATION = unsourced(
  'No source for a minimum pre-application (PPA) letter time was found; a service target ' +
    'would be a maximum, not a minimum. The dataset shows no new project starting at ' +
    'pre-application since July 2023.'
);
const PERMIT_ISSUED = unsourced(
  'No source gives a minimum time from permit issuance to construction start.'
);

/**
 * Per pathway and editable stage, the shortest sourced duration in months (Call 7). A stage with
 * `{ value: null }` has no floor; its minimum is the numerical bound.
 */
export const STAGE_FLOORS: Record<Pathway, Partial<Record<TimedStage, Evidence<number>>>> = {
  discretionary: {
    preApplication: PRE_APPLICATION,
    filed: {
      value: days(20),
      provenance: {
        tier: 2,
        label: 'Minimum hearing notice before a discretionary approval',
        sources: [PLANNING_333],
        method:
          'Planning Code § 333 as stated in the Department handout: the notice "shall be affixed ' +
          'to the subject property ... at least 20 days before the hearing", 20 / 30.436875 = ' +
          '0.657 month. Notice cannot precede filing, so a hearing-based approval takes at least ' +
          'this long. Applying it to every discretionary project is an inference (tier 2): not ' +
          'every discretionary approval needs a hearing. The code text on amlegal returned 403 ' +
          `to the fetch. ${ACCESSED}.`
      }
    },
    permitFiled: PERMIT_FLOOR,
    permitIssued: PERMIT_ISSUED
  },
  streamlined: {
    preApplication: PRE_APPLICATION,
    filed: unsourced(
      'Gov. Code § 65913.4 sets only maximums for ministerial review (60 / 90 days to find ' +
        'inconsistency, 90 / 180 days to approve); no statutory minimum was found.'
    ),
    permitFiled: PERMIT_FLOOR,
    permitIssued: PERMIT_ISSUED
  },
  permitOnly: {
    preApplication: PRE_APPLICATION,
    permitFiled: PERMIT_FLOOR,
    permitIssued: PERMIT_ISSUED
  }
};
