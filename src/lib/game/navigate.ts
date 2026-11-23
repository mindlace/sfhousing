import type { Level } from './levels';

/** The current game's page: '/' at level 1, '/sim' above it. */
export function gamePath(level: Level): '/' | '/sim' {
  return level === 1 ? '/' : '/sim';
}

/** The page after a remix: '/' for a plan, '/sim' for a policy. */
export function remixPath(kind: 'plan' | 'sim'): '/' | '/sim' {
  return kind === 'plan' ? '/' : '/sim';
}

/** A full page load: window.location.assign(path), even when the path is the one on screen. */
export function loadPage(path: '/' | '/sim'): void {
  window.location.assign(path);
}
