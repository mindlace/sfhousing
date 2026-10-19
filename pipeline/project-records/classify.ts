/**
 * Population test and pathway classification (spec 4.3, 4.4). Net-unit population is decided
 * later (needs units and assessor values); this module covers the type 1/2 permit / new-construction
 * PRJ condition and the pathway.
 */
import type { Pathway } from '../../src/lib/timelapse/types';
import type { Day } from '../../src/lib/timelapse/time';
import type { LinkedProject, Permit, Prj } from './types';

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

/** Ruling SE2: the statutes with a self-executing expiry (Gov. Code 65913.4(g), 65912.114(l)). */
const STATUTORY_RE = /\bSB[\s-]?35\b|\bSB[\s-]?423\b|\bAB[\s-]?2011\b/i;
/** Housing Choice-SF (Planning Code 206.10): standard conditions of approval (rule.json). */
const HCSF_RE = /Housing[\s-]+Choice\s*[-–—]?\s*(SF|San Francisco)|\bHCSF\b|Section\s+206\.10/i;

/**
 * Ruling SE2: which lapse rule a streamlined project's approval takes. `statutory` (the `sb35` flag,
 * or SB 35 / SB 423 / AB 2011 text) takes the streamlined expiry; `hcsf` (Housing Choice-SF text)
 * takes the inferred lapse of a discretionary approval; `none` (HSD, AB 2162) takes no lapse rule.
 * Statutory wins over HC-SF, which wins over none, across the anchors.
 */
export function lapseInstrument(proj: LinkedProject): 'statutory' | 'hcsf' | 'none' {
  const text = (a: Prj) => (streamlinedByText(a.description) ? (a.description as string) : null);
  if (proj.anchors.some((a) => a.sb35 || STATUTORY_RE.test(text(a) ?? ''))) return 'statutory';
  if (proj.anchors.some((a) => HCSF_RE.test(text(a) ?? ''))) return 'hcsf';
  return 'none';
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

/**
 * A new-construction (type 1/2) permit (spec 4.3): every `datasf-permits-newcon` row, by source
 * membership (Ruling L2b, M4); a named alteration (types 3/8, Ruling L1) is not one.
 */
export function isNewConstructionPermit(q: Permit): boolean {
  return !q.named;
}

/** Spec 4.3 first condition: a permit, or an anchor PRJ flagged new construction with units. */
export function isNewConstruction(proj: LinkedProject): boolean {
  return (
    proj.permits.some(isNewConstructionPermit) ||
    proj.anchors.some((a) => a.newConstruction && a.unitsProp !== null && a.unitsProp >= 1)
  );
}
