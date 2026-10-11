import { getContext, onDestroy, setContext, type Snippet } from 'svelte';

const KEY = Symbol('header-actions');

export class HeaderActions {
  current = $state<Snippet | null>(null);
}

/** Root layout only. */
export function provideHeaderActions(): HeaderActions {
  return setContext(KEY, new HeaderActions());
}

/** Page components: put `snippet` in the header's right-aligned slot while mounted. */
export function useHeaderActions(snippet: Snippet): void {
  const slot = getContext<HeaderActions | undefined>(KEY);
  if (!slot) return;
  slot.current = snippet;
  onDestroy(() => {
    if (slot.current === snippet) slot.current = null;
  });
}
