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

/**
 * Focuses the header's phone Menu button (SiteHeader marks it `data-header-menu`). For a page
 * whose overlay was opened from the Menu and must hand focus back once the Menu has closed.
 * Returns false when there is no Menu button.
 */
export function focusHeaderMenu(): boolean {
  const b = document.querySelector<HTMLElement>('[data-header-menu]');
  b?.focus();
  return b !== null;
}

const OVERLAY_OPEN = 'sfh-header-overlay-open';

/**
 * The header's overlays (the phone Menu, the pinned /sim score details) open in the same place
 * under the header, so at most one is open. Each one calls `openOnly(id)` when it opens, by any
 * input; every other overlay's `close` runs. Returns `openOnly` and installs the listener for the
 * component's lifetime (call during component init).
 */
export function headerOverlay(id: string, close: () => void): () => void {
  $effect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener(OVERLAY_OPEN, on);
    return () => window.removeEventListener(OVERLAY_OPEN, on);
  });
  return () => window.dispatchEvent(new CustomEvent(OVERLAY_OPEN, { detail: id }));
}
