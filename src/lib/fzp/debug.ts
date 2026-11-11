// e2e debug hook for /fzp (spec §4.4): `window.__sfhFzp`: state getters, plus `selectRank` (the run-switch bench drives it). Compiled in only when
// VITE_E2E === '1' (like src/lib/map/debug.ts); otherwise a constant-false branch Vite drops.
import type { LeverStatus } from '$lib/sim-page/lever-status';
import type { SimPhase } from '$lib/sim-page/run-phase.svelte';
import type { TimelineScore } from '$lib/sim/protocol';
import type { Day } from '$lib/timelapse/time';
import type { FzpPhase, Speed } from './types';

export interface SfhFzpDebug {
  readonly phase: FzpPhase;
  readonly seed: number | null;
  readonly representative: boolean;
  readonly day: Day;
  /** The furthest day reached; the results reveal nothing after it. */
  readonly highWater: Day;
  readonly asOf: Day;
  readonly horizon: Day;
  readonly playing: boolean;
  /** The playback speed Play or Faster last chose. */
  readonly speed: Speed;
  readonly score: TimelineScore | null;
  /** /sim's phase, 'setup' or 'run'; null without one (a session with no `runPhase`). */
  readonly runPhase: SimPhase | null;
  /** /sim's lever revision (`off` on a session without levers); done/total while resolving. */
  readonly levers: {
    status: LeverStatus['kind'];
    done: number;
    total: number;
    sentRev: number | null;
  };
  /** The band's seeds, best first; null until the current levers' band has finished. */
  readonly ranks: readonly number[] | null;
  /**
   * Shows the run at `position` (0 = Best): the representative run (a null seed) at the median
   * position, else `ranks[position]`. A no-op while `ranks` is null.
   */
  selectRank(position: number): void;
  /** The latest `selectRank`'s `performance.now()` stamps; null before any. */
  readonly switchTrace: {
    seed: number | null;
    rev: number;
    requestedAt: number;
    /** The first non-stale timeline at `rev`. */
    answeredAt: number | null;
    /** The first timeline at `rev` that is `complete`. */
    completeAt: number | null;
  } | null;
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
    get highWater() {
      return get().highWater;
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
    get speed() {
      return get().speed;
    },
    get score() {
      return get().score;
    },
    get runPhase() {
      return get().runPhase;
    },
    get levers() {
      return get().levers;
    },
    get ranks() {
      return get().ranks;
    },
    selectRank(position) {
      get().selectRank(position);
    },
    get switchTrace() {
      return get().switchTrace;
    }
  };
  window.__sfhFzp = hook;
  return () => {
    if (window.__sfhFzp === hook) delete window.__sfhFzp;
  };
}
