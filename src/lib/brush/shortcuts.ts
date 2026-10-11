import type { BrushTool } from './sampler';

export type ShortcutAction =
  | { type: 'tool'; tool: BrushTool }
  | { type: 'stories'; delta: 1 | -1 }
  | { type: 'radius'; dir: 'up' | 'down' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'cancel' }
  | { type: 'stamp' }
  | { type: 'space'; down: boolean };

export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target: EventTarget | null;
  type: 'keydown' | 'keyup';
}

/** Elements where shortcuts never fire: input, textarea, select, [contenteditable]. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t) return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  if (typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * `mapFocused` gates Enter → stamp and turns off the stories keys (MapLibre zooms on + / - there;
 * ruling F-1); `modalOpen` suppresses everything.
 */
export function actionForKey(
  e: KeyLike,
  ctx: { mapFocused: boolean; modalOpen?: boolean }
): ShortcutAction | null {
  if (ctx.modalOpen || isEditableTarget(e.target)) return null;

  if (e.key === ' ') {
    if (e.type === 'keyup') return { type: 'space', down: false };
    return e.repeat ? null : { type: 'space', down: true };
  }
  if (e.type !== 'keydown') return null;

  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (key === 'y' && e.ctrlKey && !e.metaKey) return { type: 'redo' };
    return null;
  }
  if (mod || e.altKey) return null;

  switch (key) {
    case 'v':
    case 'h':
      return { type: 'tool', tool: 'move' };
    case 'b':
      return { type: 'tool', tool: 'paint' };
    case 'e':
      return { type: 'tool', tool: 'erase' };
    case '-':
      return ctx.mapFocused ? null : { type: 'stories', delta: -1 };
    case '=':
    case '+':
      return ctx.mapFocused ? null : { type: 'stories', delta: 1 };
    case '[':
      return { type: 'radius', dir: 'down' };
    case ']':
      return { type: 'radius', dir: 'up' };
    case 'escape':
      return { type: 'cancel' };
    case 'enter':
      return ctx.mapFocused ? { type: 'stamp' } : null;
    default:
      return null;
  }
}

/** The §4.7 table, for the disclosure. */
export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'V or H', action: 'Move' },
  { keys: 'B', action: 'Paint' },
  { keys: 'E', action: 'Erase' },
  { keys: 'Space (hold)', action: 'Temporary Move' },
  { keys: '- / = (or +)', action: 'Stories −1 / +1 (map not focused; there they zoom)' },
  { keys: '[ / ]', action: 'Radius ÷1.25 / ×1.25' },
  { keys: '⌘Z / Ctrl+Z', action: 'Undo' },
  { keys: '⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y', action: 'Redo' },
  { keys: 'Esc', action: 'Cancel the stroke in progress' },
  { keys: 'Enter (map focused, Paint or Erase)', action: 'Keyboard stamp at the map centre' }
];
