import { getContext, onDestroy, setContext, type Snippet } from 'svelte';

const KEY = Symbol('header-actions');

export class HeaderActions {
  /** The right-aligned actions: in the header from md, in the phone menu below md. */
  current = $state<Snippet | null>(null);
  /** The page's one always-visible item (the /sim score bar): in the header at every width. */
  pinned = $state<Snippet | null>(null);
}

/** Root layout only. */
export function provideHeaderActions(): HeaderActions {
  return setContext(KEY, new HeaderActions());
}

/**
 * Page components: put `snippet` in the header's actions slot, and `opts.pinned` (or nothing) in
 * its pinned slot, while mounted. A page that mounts later replaces both.
 */
export function useHeaderActions(snippet: Snippet, opts?: { pinned?: Snippet }): void {
  const slot = getContext<HeaderActions | undefined>(KEY);
  if (!slot) return;
  const pinned = opts?.pinned ?? null;
  slot.current = snippet;
  slot.pinned = pinned;
  onDestroy(() => {
    if (slot.current === snippet) {
      slot.current = null;
      if (slot.pinned === pinned) slot.pinned = null;
    }
  });
}
