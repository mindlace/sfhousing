// e2e debug hook for /fzp (spec §4.4): `window.__sfhFzp`, read-only. Compiled in only when
// VITE_E2E === '1' (like src/lib/map/debug.ts); otherwise a constant-false branch Vite drops.
import type { TimelineScore } from '$lib/sim/protocol';
import type { Day } from '$lib/timelapse/time';
import type { FzpPhase } from './types';

export interface SfhFzpDebug {
  readonly phase: FzpPhase;
  readonly seed: number | null;
  readonly representative: boolean;
  readonly day: Day;
  readonly asOf: Day;
  readonly horizon: Day;
  readonly playing: boolean;
  readonly score: TimelineScore | null;
}

declare global {
  interface Window {
    __sfhFzp?: SfhFzpDebug;
  }
}

export function installFzpDebug(get: () => SfhFzpDebug): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhFzpDebug = {
    get phase() {
      return get().phase;
    },
    get seed() {
      return get().seed;
    },
    get representative() {
      return get().representative;
    },
    get day() {
      return get().day;
    },
    get asOf() {
      return get().asOf;
    },
    get horizon() {
      return get().horizon;
    },
    get playing() {
      return get().playing;
    },
    get score() {
      return get().score;
    }
  };
  window.__sfhFzp = hook;
  return () => {
    if (window.__sfhFzp === hook) delete window.__sfhFzp;
  };
}
