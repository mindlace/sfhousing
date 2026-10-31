import { getContext, onDestroy, setContext, type Snippet } from 'svelte';

const KEY = Symbol('header-actions');

export class HeaderActions {
  /** The right-aligned actions: in the header from md, in the phone menu below md. */
  current = $state<Snippet | null>(null);
  /** The page's one always-visible item (the /sim score bar): in the header at every width. */
  pinned = $state<Snippet | null>(null);
  /**
   * The page's non-interactive status (the /sim save state): on the left at every width, after
   * the mode links from md and after the site name below md. Never among the actions.
   */
  status = $state<Snippet | null>(null);
  /**
   * The registration that filled the slots. Not the snippet: two instances of one component
   * (FzpMode on /s/<id>, then on /sim) can register the same snippet object, and the new page
   * mounts before the old one is destroyed.
   */
  owner: object | null = null;
}

/** Root layout only. */
export function provideHeaderActions(): HeaderActions {
  return setContext(KEY, new HeaderActions());
}

/**
 * Page components: put `snippet` in the header's actions slot, and `opts.pinned` and
 * `opts.status` (or nothing) in its pinned and status slots, while mounted. A page that mounts
 * later replaces all three.
 */
export function useHeaderActions(
  snippet: Snippet,
  opts?: { pinned?: Snippet; status?: Snippet }
): void {
  const slot = getContext<HeaderActions | undefined>(KEY);
  if (!slot) return;
  const pinned = opts?.pinned ?? null;
  const status = opts?.status ?? null;
  const owner = {};
  slot.owner = owner;
  slot.current = snippet;
  slot.pinned = pinned;
  slot.status = status;
  onDestroy(() => {
    if (slot.owner !== owner) return;
    slot.owner = null;
    slot.current = null;
    slot.pinned = null;
    slot.status = null;
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
