/**
 * Population test and pathway classification (spec 4.3, 4.4). Net-unit population is decided
 * later (needs units and assessor values); this module covers the type 1/2 permit / new-construction
 * PRJ condition and the pathway.
 */
import type { Pathway } from '../../src/lib/timelapse/types';
import type { Day } from '../../src/lib/timelapse/time';
import type { LinkedProject, Prj } from './types';

/** Spec 4.4 rule 1 text indicator, verbatim. */
export const STREAMLINED_RE =
  /\bSB[\s-]?35\b|\bSB[\s-]?423\b|\bAB[\s-]?2011\b|\bAB[\s-]?2162\b|Housing[\s-]+Choice\s*[-–—]?\s*(SF|San Francisco)|\bHCSF\b|Section\s+206\.10|Housing Sustainability District/i;

/** Spec 4.4 rule 1 negation, verbatim. */
export const STREAMLINED_NEGATION_RE =
  /\b(not|ineligible)\b[^.]{0,40}\b(SB[\s-]?35|SB[\s-]?423|AB[\s-]?2011)/i;

/** Spec 4.4 rule 2 child types (PPA included). */
export const DISCRETIONARY_CHILD_TYPES: ReadonlySet<string> = new Set([
  'CUA',
  'VAR',
  'DNX',
  'ENX',
  'OFA',
  'AHB',
  'PHA',
  'DVA',
  'MAP',
  'PCA',
  'GPA',
  'CTZ',
  'COA',
  'PTA',
  'DRP',
  'DRM',
  'PPA'
]);

/** Tier 4, made up (spec 4.4 rule 3): intake lag between a referral PRJ opening and DBI filing. */
export const REFERRAL_TOLERANCE_DAYS = 30;

export function streamlinedByText(desc: string | null): boolean {
  return desc !== null && STREAMLINED_RE.test(desc) && !STREAMLINED_NEGATION_RE.test(desc);
}

function streamlinedEvidence(a: Prj): boolean {
  return a.sb35 || a.hsd || a.ab2162 || streamlinedByText(a.description);
}

function discretionaryEvidence(proj: LinkedProject, a: Prj): boolean {
  return (
    proj.reviews.some((r) => r.recordId === a.recordId) ||
    proj.children.some(
      (c) =>
        DISCRETIONARY_CHILD_TYPES.has(c.type) && (c.parentId === a.recordId || c.type === 'PPA')
    )
  );
}

function earliestPermitFiled(proj: LinkedProject): Day | null {
  let min: Day | null = null;
  for (const p of proj.permits) {
    if (p.filedDay !== null && (min === null || p.filedDay < min)) min = p.filedDay;
  }
  return min;
}

/** Spec 4.4: streamlined, discretionary, permitOnly, else null (unclassifiable). */
export function pathwayOf(proj: LinkedProject): Pathway | null {
  if (proj.kind === 'pipelineOnly' || proj.kind === 'ppaOnly') return 'discretionary';
  if (proj.anchors.some(streamlinedEvidence)) return 'streamlined';
  if (proj.anchors.some((a) => discretionaryEvidence(proj, a))) return 'discretionary';
  if (proj.anchors.length === 0) return 'permitOnly';
  const earliest = earliestPermitFiled(proj);
  if (
    earliest !== null &&
    proj.anchors.every((a) => a.openDay !== null && a.openDay >= earliest - REFERRAL_TOLERANCE_DAYS)
  ) {
    return 'permitOnly';
  }
  return null;
}

/** Spec 4.3 first condition: a permit, or an anchor PRJ flagged new construction with units. */
export function isNewConstruction(proj: LinkedProject): boolean {
  return (
    proj.permits.length > 0 ||
    proj.anchors.some((a) => a.newConstruction && a.unitsProp !== null && a.unitsProp >= 1)
  );
}
