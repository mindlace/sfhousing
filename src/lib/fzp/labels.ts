/** Display labels (spec §4.9): one table each, so a new stage still renders (as its id). */
import type { ExitReason, Pathway } from '$lib/timelapse/types';

const ENTERED: Record<string, string> = {
  preApplication: 'Pre-application meeting requested',
  filed: 'Planning application filed',
  entitled: 'Planning approval',
  permitFiled: 'Building permit filed',
  permitIssued: 'Building permit issued',
  construction: 'Construction started',
  complete: 'Completed'
};

const IN_STAGE: Record<string, string> = {
  preApplication: 'Pre-application',
  filed: 'In Planning review',
  entitled: 'Approved, building permit not yet filed',
  permitFiled: 'Building permit review',
  permitIssued: 'Permit issued, not started',
  construction: 'Under construction',
  complete: 'Completed'
};

/** Stage rows before `permitFiled` on a phase card belong to the master plan. */
const MASTER_ENTERED: Record<string, string> = {
  preApplication: 'Master plan pre-application meeting requested',
  filed: 'Master plan application filed',
  entitled: 'Master plan approved'
};

/** Timeline row: when the project entered the stage. */
export function enteredLabel(stage: string): string {
  return ENTERED[stage] ?? stage;
}

/** Status and score: what the project is doing now. */
export function inStageLabel(stage: string): string {
  return IN_STAGE[stage] ?? stage;
}

/** Timeline row for a master-plan stage on a phase card. */
export function masterEnteredLabel(stage: string): string {
  return MASTER_ENTERED[stage] ?? stage;
}

export const PATHWAY_LABEL: Record<Pathway, string> = {
  discretionary: 'Discretionary review (Planning Commission or similar)',
  streamlined: "Streamlined approval (state law or the plan's Local Program)",
  permitOnly: 'Building permit only'
};

export const EXIT_LABEL: Record<ExitReason, string> = {
  withdrawn: 'withdrawn',
  disapproved: 'disapproved',
  cancelled: 'cancelled',
  expired: 'permit expired'
};

export const TIER_LABEL: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'San Francisco project records',
  1: 'Official published totals',
  2: 'Inferred from San Francisco records',
  3: 'Research or literature, not SF records',
  4: 'Assumption, not data'
};
