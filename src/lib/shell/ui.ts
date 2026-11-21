// The shared UI parts (docs/dev/ui-parts.md): class constants Tailwind scans, each light utility
// with its dark: partner (accent.spec.ts checks), colours from the tokens in layout.css only.

/**
 * The spacing scale: Tailwind steps 1, 2, 3, 4, 6 (4, 8, 12, 16, 24 px). Shared parts use only these
 * for padding, margin and gap; arbitrary px only for measured geometry (say so in a comment).
 */
export const SPACE_STEPS = [1, 2, 3, 4, 6] as const;

/** Every button kind's focus ring: the accent outline on focus-visible, in both themes. */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:focus-visible:outline-accent-dark';

/** What BUTTON and BUTTON_PRIMARY share: the focus ring and the off states. */
const BUTTON_BASE = `inline-flex items-center justify-center whitespace-nowrap ${FOCUS_RING} disabled:cursor-not-allowed aria-disabled:cursor-not-allowed`;

/**
 * The one target size: at least 24 by 24 px on every pointer, mouse and touch alike (WCAG 2.2 AA,
 * 2.5.8). Every button kind carries it; a control that is none of them takes it beside its own look.
 */
export const TARGET = 'min-h-6 min-w-6';

/**
 * A secondary button: control-line border, surface, ink, text-sm font-semibold, rounded-md, px-2,
 * min 24 px, hover one step raised, focus-visible accent outline,
 * aria-disabled and disabled: muted ink, no hover, cursor not-allowed.
 */
export const BUTTON = `${BUTTON_BASE} ${TARGET} rounded-md border border-control-line bg-surface px-2 text-sm font-semibold text-ink hover:bg-surface-raised disabled:text-ink-muted aria-disabled:text-ink-muted disabled:hover:bg-surface aria-disabled:hover:bg-surface dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:disabled:text-ink-dark-muted dark:aria-disabled:text-ink-dark-muted dark:disabled:hover:bg-surface-dark dark:aria-disabled:hover:bg-surface-dark`;

/**
 * The page's main action (Publish): accent fill and on-accent text, otherwise as BUTTON. Off, it
 * drops the fill for the raised surface and muted ink (>= 4.5:1 in both themes).
 */
export const BUTTON_PRIMARY = `${BUTTON_BASE} ${TARGET} rounded-md bg-accent px-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:bg-surface-raised disabled:text-ink-muted aria-disabled:bg-surface-raised aria-disabled:text-ink-muted disabled:hover:bg-surface-raised aria-disabled:hover:bg-surface-raised dark:bg-accent-dark dark:text-on-accent-dark dark:hover:bg-accent-dark-hover dark:disabled:bg-surface-dark-raised dark:disabled:text-ink-dark-muted dark:aria-disabled:bg-surface-dark-raised dark:aria-disabled:text-ink-dark-muted dark:disabled:hover:bg-surface-dark-raised dark:aria-disabled:hover:bg-surface-dark-raised`;

/** What BUTTON_QUIET and BUTTON_DISMISS share: no border, rounded-full, px-3, min 24 px. */
const QUIET_BASE = `${TARGET} rounded-full px-3 font-semibold ${FOCUS_RING}`;

/** An action inside a message (Retry, Details, a link): no border, underlined, semibold. */
export const BUTTON_QUIET = `${QUIET_BASE} underline`;

/**
 * A message's dismiss (Message draws it, the drawn ×): as BUTTON_QUIET without the underline, its
 * icon centred, one step raised on hover.
 */
export const BUTTON_DISMISS = `${QUIET_BASE} flex shrink-0 items-center justify-center hover:bg-surface-raised dark:hover:bg-line-dark`;

/** Added to a button that sits over the map: a small shadow so it reads on any map. */
export const ON_MAP = 'shadow-sm';

/**
 * Menus, panels and pop-overs: rounded-lg, line border, surface, ink, shadow-lg, p-2, text-sm. In
 * dark it declares the dark color-scheme, so a native scrollbar or control inside follows.
 */
export const SURFACE_POP =
  'rounded-lg border border-line bg-surface p-2 text-sm text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark dark:scheme-dark';

/**
 * An explanation's tooltip: as SURFACE_POP with rounded, px-2 py-1, shadow-md. Explain.svelte draws
 * it from md (each class with `md:`), and layout.css's `.explain-under` repeats the values in CSS.
 */
export const SURFACE_TIP =
  'rounded border border-line bg-surface px-2 py-1 text-sm text-ink shadow-md dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';

/**
 * A modal dialog without its padding, for a dialog that pads its own regions (the Sources dialog's
 * sticky title row and scrolling body). In dark a line border sets it off from the dimmed page, and
 * it declares the dark color-scheme (its scrollbar and fields follow).
 */
export const SURFACE_DIALOG_FLUSH =
  'rounded-lg bg-surface text-ink shadow-xl backdrop:bg-black/40 dark:border dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark dark:scheme-dark';

/** A modal dialog: rounded-lg, surface, ink, shadow-xl, p-4, a 40% black backdrop. */
export const SURFACE_DIALOG = `${SURFACE_DIALOG_FLUSH} p-4`;

/** A few words: rounded-full, one line, surface-raised in dark, shadow, text-sm. */
export const CHIP =
  'pointer-events-auto flex w-max max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-4 text-sm text-ink shadow dark:border-line-dark dark:bg-surface-dark-raised dark:text-ink-dark';

/** A chip that takes no presses (the stroke chip), with even padding (it has no action). */
export const CHIP_STILL =
  'pointer-events-none flex w-max max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1 pr-4 pl-4 text-sm text-ink shadow dark:border-line-dark dark:bg-surface-dark-raised dark:text-ink-dark';

/** A paragraph: rounded-lg, the text wraps (max 28rem), its actions in a row under it. */
export const CARD =
  'pointer-events-auto flex w-full max-w-[28rem] flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-sm text-ink shadow dark:border-line-dark dark:bg-surface-dark-raised dark:text-ink-dark';

export type MessageShape = 'chip' | 'card';

/** The most words a chip holds. */
const CHIP_WORDS = 8;

/** 'chip' for one sentence of at most 8 words with no details; else 'card'. */
export function messageShape(text: string, details = false): MessageShape {
  if (details) return 'card';
  const t = text.trim();
  // A sentence ends at . ! or ? followed by a space or the end ("didn't" and "3.5" do not end one).
  const sentences = t.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim() !== '');
  const words = t.split(/\s+/).filter(Boolean);
  return sentences.length <= 1 && words.length <= CHIP_WORDS ? 'chip' : 'card';
}
