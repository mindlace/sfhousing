// e2e debug hook (spec §6), mirroring src/lib/map/debug.ts. Compiled in only when
// VITE_E2E === '1'; otherwise the body is a constant-false branch that Vite dead-code-eliminates.
import type { OpStats } from '$lib/sim/protocol';

export interface SfhBrushDebug {
  readonly ops: number;
  readonly lastStats: OpStats | null;
  readonly ready: boolean;
  readonly chunks: { pending: number; failed: string[] };
}

declare global {
  interface Window {
    __sfhBrush?: SfhBrushDebug;
  }
}

export function installBrushDebug(get: () => SfhBrushDebug): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhBrushDebug = {
    get ops() {
      return get().ops;
    },
    get lastStats() {
      return get().lastStats;
    },
    get ready() {
      return get().ready;
    },
    get chunks() {
      return get().chunks;
    }
  };
  window.__sfhBrush = hook;
  return () => {
    if (window.__sfhBrush === hook) delete window.__sfhBrush;
  };
}
