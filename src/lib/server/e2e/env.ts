/**
 * True only in an e2e build (`VITE_E2E=1`, inlined at build time, so a normal build drops
 * every branch it guards) running with `ENVIRONMENT=development`. Every test-only seam on
 * the server checks this; staging and production never pass it.
 */
export function isE2eEnv(platform: App.Platform | undefined): boolean {
  if (import.meta.env.VITE_E2E !== '1') return false;
  const env = platform?.env as { ENVIRONMENT?: string } | undefined;
  return env?.ENVIRONMENT === 'development';
}
