// The timeline's keys: the rows About's Timeline table lists, and the rule for Space as Play.
import { isEditableTarget, SPACE_NATIVE } from '$lib/brush/shortcuts';

/** About's Timeline table (The strings). The arrows and paging keys are the date slider's own. */
export const TIMELINE_SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Play or pause (not while painting)' },
  { keys: '← / →', action: 'A month back or on (date slider)' },
  { keys: 'Page Down / Page Up', action: 'A year back or on (date slider)' },
  { keys: 'Home / End', action: 'Today / the last month (date slider)' }
];

/**
 * Space pressed to play or pause: key ' ', keydown, not a repeat, no modifier, not handled,
 * target neither editable (isEditableTarget) nor inside SPACE_NATIVE, and no modal dialog open.
 * The date slider (role="slider") is not in SPACE_NATIVE, so Space plays from it too.
 */
export function isPlayKey(e: KeyboardEvent, modalOpen: boolean): boolean {
  if (e.key !== ' ' || e.type !== 'keydown' || e.repeat || e.defaultPrevented) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (modalOpen || isEditableTarget(e.target)) return false;
  const t = e.target as { closest?: (sel: string) => unknown } | null;
  return !(typeof t?.closest === 'function' && t.closest(SPACE_NATIVE));
}
