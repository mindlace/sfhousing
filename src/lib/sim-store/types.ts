import type { CommitDraft, Dropped, RulesetContent } from '$lib/sim-log';

/** What the page stamps on a commit it authors. */
export interface Stamp {
  datasetVersion: string;
  build: string;
}

/** A commit made in this tab and not yet on the stream (I3: parent is tipSeq + its index). */
export interface Pending {
  draft: CommitDraft;
  /** A restore's target: the id of the commit at that position, null for position 0. */
  targetId: string | null;
}

/** Why re-applying dropped a whole commit; null when only some of its changes went. */
export type DropWhy = 'empty' | 'invalid' | 'too-large' | 'target-gone';

/** What re-applying dropped (R19). Never reported: a move or alignment commit dropped. */
export interface DropReport {
  id: string;
  label: string;
  whole: boolean;
  why: DropWhy | null;
  dropped: Dropped[];
}

/**
 * Moves a ruleset onto dataset `to`, or null when this page cannot (it has no calibration for
 * `to`). Pure and idempotent: align(align(c, to), to) equals align(c, to). Plan 3: reconcilePolicy4.
 */
export type Align = (content: RulesetContent, to: string) => RulesetContent | null;

/** Why the store authors nothing (decision 21). */
export type Stopped = 'future' | 'stale' | 'unknown-dataset';

/** The source of a move or an alignment commit. */
export const MOVE_SOURCE = 'sim.dataset';
export const MOVE_LABEL = 'Moved to new data';
