export const E2E_GAME_KEY = 'sfhousing:e2e:game';
export const E2E_GOAL_KEY = 'sfhousing:e2e:goal';

/** True when VITE_E2E is '1' and E2E_GAME_KEY is absent: the page gets the open game. */
export function e2eOpen(storage: Storage | null): boolean {
  if (import.meta.env.VITE_E2E !== '1') return false;
  if (storage === null) return true;
  try {
    return storage.getItem(E2E_GAME_KEY) === null;
  } catch {
    return true;
  }
}

/** The amount under E2E_GOAL_KEY when VITE_E2E is '1'; null otherwise. */
export function e2eGoalAmount(storage: Storage | null): number | null {
  if (import.meta.env.VITE_E2E !== '1' || storage === null) return null;
  let value: string | null;
  try {
    value = storage.getItem(E2E_GOAL_KEY);
  } catch {
    return null;
  }
  if (value === null || !/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
