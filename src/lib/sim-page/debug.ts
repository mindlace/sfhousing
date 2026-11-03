// e2e debug hook for /sim (sim-ux plan 3, Task 4): `window.__sfhSim`, read-only. Compiled in only
// when VITE_E2E === '1' (like src/lib/fzp/debug.ts); otherwise a constant-false branch Vite drops.

export interface SfhSimDebug {
  /** The live preview's layer: none, live (mid-stroke) or fading (after release). */
  readonly preview: 'none' | 'live' | 'fading';
}

declare global {
  interface Window {
    __sfhSim?: SfhSimDebug;
  }
}

export function installSimDebug(get: () => SfhSimDebug): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhSimDebug = {
    get preview() {
      return get().preview;
    }
  };
  window.__sfhSim = hook;
  return () => {
    if (window.__sfhSim === hook) delete window.__sfhSim;
  };
}
