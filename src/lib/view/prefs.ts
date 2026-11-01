// Per-viewer map layer toggles (transit spec T6, §6.3; the height fog, sim-runs plan 2 Task 4).
// One record shared by / and /sim, so a viewer's transit choice follows them between modes; / never
// shows or uses `heightFog` and writes back the value it read. Best-effort persistence.

export interface ViewPrefs {
  transitStops: boolean;
  transitAccess: boolean;
  /** /sim only: the height-limit fog in Setup. */
  heightFog: boolean;
}

export const VIEW_KEY = 'sfhousing:view';
export const DEFAULT_VIEW: ViewPrefs = {
  transitStops: false,
  transitAccess: true,
  heightFog: true
};
/** Every layer off: FzpMode's default, and what /sim's map gets during a run. */
export const HIDDEN_VIEW: ViewPrefs = {
  transitStops: false,
  transitAccess: false,
  heightFog: false
};

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
      transitAccess: bool(v?.transitAccess, DEFAULT_VIEW.transitAccess),
      heightFog: bool(v?.heightFog, DEFAULT_VIEW.heightFog)
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
      JSON.stringify({
        transitStops: v.transitStops,
        transitAccess: v.transitAccess,
        heightFog: v.heightFog
      })
    );
  } catch {
    // storage unavailable or full: persistence is best-effort
  }
}
