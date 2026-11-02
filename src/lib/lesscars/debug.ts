// e2e debug hook for /lesscars: `window.__sfhLessCars`, read-only. Compiled in only when
// VITE_E2E === '1' (as src/lib/fzp/debug.ts); otherwise a constant-false branch Vite drops.
import type { Day } from '$lib/timelapse/time';

export interface SfhLessCarsDebug {
  readonly phase: 'loading' | 'ready' | 'failed';
  readonly day: Day;
  readonly playing: boolean;
  /** The representative seed, once the worker has loaded the timeline. */
  readonly seed: number | null;
  /** The last applied playback revision, -1 before revision 0. */
  readonly revision: number;
  /** Cell ids received so far. */
  readonly cells: string[];
  readonly reservations: { parcelId: string; kept: boolean }[];
}

declare global {
  interface Window {
    __sfhLessCars?: SfhLessCarsDebug;
  }
}

export function installLessCarsDebug(get: () => SfhLessCarsDebug): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhLessCarsDebug = {
    get phase() {
      return get().phase;
    },
    get day() {
      return get().day;
    },
    get playing() {
      return get().playing;
    },
    get seed() {
      return get().seed;
    },
    get revision() {
      return get().revision;
    },
    get cells() {
      return get().cells;
    },
    get reservations() {
      return get().reservations;
    }
  };
  window.__sfhLessCars = hook;
  return () => {
    if (window.__sfhLessCars === hook) delete window.__sfhLessCars;
  };
}
