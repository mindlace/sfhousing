import type { ProjectHistory } from '../../src/lib/timelapse/types';

/** A project is in the affordable cohort when at least this share of its proposed homes is affordable. */
export const AFFORDABLE_COHORT_SHARE = 0.95;

export type StartCohort = 'affordable' | 'private' | 'noRecord' | 'unknown';

/** Classifies a history by its primary Planning record's proposed homes. */
export function startCohort(p: ProjectHistory['planningProposed']): StartCohort {
  if (p == null) return 'noRecord';
  if (p.units === null || p.units <= 0 || p.affordable === null) return 'unknown';
  return p.affordable >= AFFORDABLE_COHORT_SHARE * p.units ? 'affordable' : 'private';
}

export function isAffordableCohort(p: ProjectHistory['planningProposed']): boolean {
  return startCohort(p) === 'affordable';
}
