// R1: the run's two stored preferences, per viewer and per browser (not in the saved game).
// A value is '1' (true) or '0' (false); anything else, a missing key, a null storage or a throw
// reads as the default. Best-effort persistence, like src/lib/view/prefs.ts. A write calls every
// listener afterwards, also when the storage is null or the write throws.

export const COLLECT_KEY = 'sfhousing:run:collect';
export const MUTED_KEY = 'sfhousing:run:muted';
export const DEFAULT_COLLECT = false;
export const DEFAULT_MUTED = false;

const listeners = new Set<() => void>();

export function onPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // a failing listener does not stop the next
    }
  }
}

function read(storage: Storage | null, key: string, fallback: boolean): boolean {
  try {
    const raw = storage?.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function write(storage: Storage | null, key: string, value: boolean): void {
  try {
    storage?.setItem(key, value ? '1' : '0');
  } catch {
    // storage unavailable or full: persistence is best-effort
  } finally {
    notify();
  }
}

export function readCollectForMe(storage: Storage | null): boolean {
  return read(storage, COLLECT_KEY, DEFAULT_COLLECT);
}

export function writeCollectForMe(storage: Storage | null, on: boolean): void {
  write(storage, COLLECT_KEY, on);
}

export function readMuted(storage: Storage | null): boolean {
  return read(storage, MUTED_KEY, DEFAULT_MUTED);
}

export function writeMuted(storage: Storage | null, muted: boolean): void {
  write(storage, MUTED_KEY, muted);
}
