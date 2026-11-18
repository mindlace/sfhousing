// Pure rules for stale numbers (timeline-ui rules 25, 31). Browser-safe.
import type { TimelineView } from '$lib/sim/world/score/types';

/** What the page knows about the latest edit. `pending`: an edit not yet settled (sent or still debouncing). */
export interface EditState {
  /** The view as it was when the first unsettled edit was made; null when no edit is in play. */
  held: TimelineView | null;
  /** True from an edit R until a `refill` with rev >= R arrives (or its `bad-request`). `compiled` never settles (it precedes the refill). */
  pending: boolean;
  /**
   * After a rejected edit (rule 34): stale also until `filledThrough` is back to this, the held
   * view's, so the previous forecast is whole again. -1 when no rejection is in play; a refill (an
   * acceptance, carry 4) clears it.
   */
  floor: number;
}

export const NO_EDIT: EditState = { held: null, pending: false, floor: -1 };

/** An edit was made: the first held view is kept while edits stack. */
export function edited(s: EditState, current: TimelineView | null): EditState {
  return { held: s.held ?? current, pending: true, floor: s.floor };
}

/** A `refill` at or past the latest edit's rev arrived (or its `bad-request`). */
export function settled(s: EditState): EditState {
  return { ...s, pending: false };
}

/**
 * A `refill` arrived, at any rev: the months from its `from` are being rebuilt for that rev's
 * document. The view before it is held (the first held view is kept) until the fill passes the
 * playhead again; a refill at an older rev than the newest sent (an edit taken up again after a
 * later one was rejected) so puts the page back into stale. Pending is left alone.
 */
export function refilled(s: EditState, before: TimelineView | null): EditState {
  return { ...s, held: s.held ?? before, floor: -1 };
}

/** An edit was rejected (rule 34): stale until the fill is back to the held view's months. */
export function rejected(s: EditState): EditState {
  return { ...s, floor: s.held === null ? -1 : s.held.filledThrough };
}

/** The view to show at month `i`, and whether it is the dimmed numbers from before the change. */
export function shownAt(
  s: EditState,
  current: TimelineView | null,
  i: number
): { view: TimelineView | null; stale: boolean } {
  const inPlay = s.held !== null || s.pending;
  const stale =
    inPlay &&
    (s.pending || current === null || current.filledThrough < i || current.filledThrough < s.floor);
  return { view: stale ? s.held : current, stale };
}

/** The state after a view arrives: held is dropped once not stale at `i`. */
export function afterView(s: EditState, current: TimelineView | null, i: number): EditState {
  const stale = shownAt(s, current, i).stale;
  return {
    held: stale ? s.held : null,
    pending: s.pending,
    floor: stale ? s.floor : -1
  };
}
