/**
 * The /sim session's restore (plan 5, Task 5): the autosave's outcome, reconciled with the
 * calibration the page runs on (Call 7), as the document SimPage loads and the notices it shows.
 * Pure TS: the notices are data, SimNotices renders them.
 */
import type { AutosaveNotice } from '$lib/sharing/autosave.svelte';
import { copyFor } from '$lib/sharing/copy';
import type { Calibration } from '$lib/timelapse/types';
import { changeText, reconcileTiming } from './reconcile';
import type { SimDoc } from './sim-doc';

export interface SimNotice {
  id: 'corrupt' | 'future' | 'rebased' | 'timing' | 'remix' | 'fzp-kept';
  text: string;
  /** One line each, behind a "Details" disclosure. */
  details?: string[];
  /** A toast dismisses itself; info stays until dismissed. */
  tone?: 'info' | 'toast';
  link?: { href: string; label: string };
}

export const TIMING_NOTICE_TEXT =
  'Some permitting timelines were re-fit to the data this simulation runs on.';

/** Call 13: under `start=fzp` a non-default saved policy is kept until the first change. */
export const FZP_KEPT_TEXT =
  'Showing the Family Zoning Plan comparison. Your saved policy is kept until you change something here.';

const SIM = copyFor('sim');

/** The notice for the autosave's own outcome (N1, N2, N3 in the policy wording), or none. */
function autosaveNotice(n: AutosaveNotice | null): SimNotice | null {
  if (n === null) return null;
  switch (n.kind) {
    case 'corrupt':
      return { id: 'corrupt', text: SIM.n1, tone: 'info' };
    case 'future':
      return { id: 'future', text: SIM.n2, tone: 'info' };
    case 'rebased':
      return { id: 'rebased', text: SIM.n3(n.from, n.to), tone: 'info' };
  }
}

/**
 * The document to load and its notices, in order: the autosave's, the timing refit's, then the
 * Remix toast. `cal` null (the calibration failed to load) skips the reconcile: the timelines
 * cannot run then, and the next load reconciles.
 */
export function restoreSimDoc(
  r: { plan: SimDoc; notice: AutosaveNotice | null },
  cal: Calibration | null,
  remixFrom?: string
): { doc: SimDoc; notices: SimNotice[] } {
  const notices: SimNotice[] = [];
  const first = autosaveNotice(r.notice);
  if (first) notices.push(first);

  let doc = r.plan;
  if (cal !== null) {
    const { timing, changes } = reconcileTiming(doc.policy.timing, cal);
    if (timing !== doc.policy.timing) doc = { ...doc, policy: { ...doc.policy, timing } };
    if (changes.length > 0)
      notices.push({
        id: 'timing',
        text: TIMING_NOTICE_TEXT,
        // The current set and the saved snapshot can report the same change: list it once.
        details: [...new Set(changes.map(changeText))],
        tone: 'info'
      });
  }

  if (remixFrom !== undefined)
    notices.push({ id: 'remix', text: SIM.remixedToast(remixFrom), tone: 'toast' });
  return { doc, notices };
}
