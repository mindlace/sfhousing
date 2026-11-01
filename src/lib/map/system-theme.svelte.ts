import type { Theme } from './types';

/**
 * The OS colour scheme as a reactive `Theme`. Per call: each call installs its own
 * `matchMedia('(prefers-color-scheme: dark)')` listener, cleaned up with the calling component
 * via `$effect`. Call it during component init. `resolved` is false until the client has read the
 * media query (SSR, first paint), when `current` is only the 'light' default.
 */
export function useSystemTheme(): { readonly current: Theme; readonly resolved: boolean } {
  let current = $state<Theme>('light');
  let resolved = $state(false);
  $effect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    current = mq.matches ? 'dark' : 'light';
    resolved = true;
    const on = (e: MediaQueryListEvent) => (current = e.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  return {
    get current() {
      return current;
    },
    get resolved() {
      return resolved;
    }
  };
}
