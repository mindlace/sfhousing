import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** The large download caches that live once per machine, not once per worktree. */
export const SHARED_DIRS = ['raw', 'ept', 'lidar-work'] as const;

/** The per-worktree cache the shared dirs used to live in. */
export const LOCAL_CACHE = resolve(import.meta.dirname, '../.cache');

/** `SFH_CACHE_DIR`, else `$XDG_CACHE_HOME/sfhousing` (absolute only), else `~/.cache/sfhousing`. */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (env.SFH_CACHE_DIR) return resolve(env.SFH_CACHE_DIR);
  if (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME)) {
    return join(env.XDG_CACHE_HOME, 'sfhousing');
  }
  return join(home, '.cache', 'sfhousing');
}

export interface SharedCache {
  root: string;
  raw: string;
  ept: string;
  lidarWork: string;
  boxesIndex: string;
}

export function sharedCache(root: string = cacheRoot()): SharedCache {
  return {
    root,
    raw: join(root, 'raw'),
    ept: join(root, 'ept'),
    lidarWork: join(root, 'lidar-work'),
    boxesIndex: join(root, 'boxes-index')
  };
}

/** A line naming shared dirs still sitting in a worktree's local cache, or null. */
export function localCacheNotice(
  local: string = LOCAL_CACHE,
  root: string = cacheRoot()
): string | null {
  if (resolve(local) === resolve(root)) return null;
  const held = SHARED_DIRS.filter((d) => {
    const p = join(local, d);
    return existsSync(p) && statSync(p).isDirectory() && readdirSync(p).length > 0;
  });
  if (held.length === 0) return null;
  return `${local} holds ${held.join(', ')}: move them to ${root} with npm run pipeline -- cache import ${local}`;
}
