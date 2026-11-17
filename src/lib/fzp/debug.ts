// e2e debug hook for /sim's timeline (timeline-ui rule 42): `window.__sfhFzp`, state getters over
// TimelineMode. Compiled in only when VITE_E2E === '1' (like src/lib/map/debug.ts); otherwise a
// constant-false branch Vite drops.
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { FzpPhase, Speed } from './types';

export interface SfhFzpDebug {
  readonly phase: FzpPhase;
  /** The playhead's day. */
  readonly day: Day;
  readonly asOf: Day;
  readonly playing: boolean;
  /** The playback speed Play or Faster last chose. */
  readonly speed: Speed;
  /** The last final calendar-month index of the forecast; -1 before any. */
  readonly filledThrough: number;
  /** The window's last calendar-month index; -1 before the first `compiled`. */
  readonly lastIndex: number;
  /** The document the page shows. */
  readonly policy: SimPolicy4;
  /** The numbers on show are from before the latest change (rule 31). */
  readonly stale: boolean;
  /** Every `refill`'s `from`, in arrival order, since mount. */
  readonly refills: readonly number[];
  /** The world's completed net homes per filled month (no baseline), from month 0. */
  completedNet(): number[];
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
    get day() {
      return get().day;
    },
    get asOf() {
      return get().asOf;
    },
    get playing() {
      return get().playing;
    },
    get speed() {
      return get().speed;
    },
    get filledThrough() {
      return get().filledThrough;
    },
    get lastIndex() {
      return get().lastIndex;
    },
    get policy() {
      return get().policy;
    },
    get stale() {
      return get().stale;
    },
    get refills() {
      return get().refills;
    },
    completedNet() {
      return get().completedNet();
    }
  };
  window.__sfhFzp = hook;
  return () => {
    if (window.__sfhFzp === hook) delete window.__sfhFzp;
  };
}
