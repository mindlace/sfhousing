// Per-viewer map layer toggles (transit spec T6, §6.3). Best-effort persistence.

export interface ViewPrefs {
  transitStops: boolean;
  transitAccess: boolean;
}

export const VIEW_KEY = 'sfhousing:view';
export const DEFAULT_VIEW: ViewPrefs = { transitStops: false, transitAccess: true };

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readViewPrefs(
  storage: Pick<Storage, 'getItem'> | null = defaultStorage()
): ViewPrefs {
  try {
    const raw = storage?.getItem(VIEW_KEY);
    if (!raw) return { ...DEFAULT_VIEW };
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
    return {
      transitStops: bool(v?.transitStops, DEFAULT_VIEW.transitStops),
      transitAccess: bool(v?.transitAccess, DEFAULT_VIEW.transitAccess)
    };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

export function writeViewPrefs(
  v: ViewPrefs,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage()
): void {
  try {
    storage?.setItem(
      VIEW_KEY,
      JSON.stringify({ transitStops: v.transitStops, transitAccess: v.transitAccess })
    );
  } catch {
    // storage unavailable or full: persistence is best-effort
  }
}
