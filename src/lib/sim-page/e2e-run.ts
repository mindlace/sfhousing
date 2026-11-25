export const E2E_RUN_MS_KEY = 'sfhousing:e2e:run-ms';

/** The run's wall time under E2E_RUN_MS_KEY (100 to 20,000 ms) when VITE_E2E is '1'; null otherwise. */
export function e2eRunMs(storage: Storage | null): number | null {
  if (import.meta.env.VITE_E2E !== '1' || storage === null) return null;
  let value: string | null;
  try {
    value = storage.getItem(E2E_RUN_MS_KEY);
  } catch {
    return null;
  }
  if (value === null || !/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return n >= 100 && n <= 20_000 ? n : null;
}
