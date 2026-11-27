import type { Limits } from '$lib/game/limits';

/** A game's Limits at round 0 (nothing offered) with `o` laid over it; several specs need it. */
export function limitsWith(o: Partial<Limits> = {}): Limits {
  return {
    open: false,
    whole: false,
    own: false,
    offered: new Set(),
    editable: new Set(),
    stops: new Set(),
    money: false,
    ...o
  };
}
