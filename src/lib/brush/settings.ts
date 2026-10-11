import { clampRadius, clampStories } from './radius';

export interface BrushSettings {
  stories: number;
  radiusM: number;
}

export const SETTINGS_KEY = 'sfhousing:brush';
export const DEFAULT_SETTINGS: BrushSettings = { stories: 6, radiusM: 30 };

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSettings(
  storage: Pick<Storage, 'getItem'> | null = defaultStorage()
): BrushSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
    return {
      stories: num(v?.stories) ? clampStories(v!.stories as number) : DEFAULT_SETTINGS.stories,
      radiusM: num(v?.radiusM) ? clampRadius(v!.radiusM as number) : DEFAULT_SETTINGS.radiusM
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(
  s: BrushSettings,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage()
): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify({ stories: s.stories, radiusM: s.radiusM }));
  } catch {
    // storage unavailable or full: persistence is best-effort
  }
}
