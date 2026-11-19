/** One notice: a rounded-full line on a themed surface, with a shadow; text-sm. */
export const PILL =
  'pointer-events-auto flex w-max max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1 pl-4 pr-1 text-sm text-ink shadow dark:border-line-dark dark:bg-surface-dark-raised dark:text-ink-dark';

/**
 * The stroke chip over `/`'s map: a pill's look that takes no presses (a stroke can start under
 * it) and has no action button, so its right padding matches its left.
 */
export const CHIP =
  'pointer-events-none flex w-max max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1 pl-4 pr-4 text-sm text-ink shadow dark:border-line-dark dark:bg-surface-dark-raised dark:text-ink-dark';

/** A pill's action button (Retry, Details, ×): min 44 px target, underlined, semibold. */
export const PILL_ACTION = 'min-h-11 min-w-11 rounded-full px-3 font-semibold underline';
