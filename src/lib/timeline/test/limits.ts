import { BASE_HANDS, type Limits } from '$lib/game/limits';

/** A closed Limits (nothing bought) with `o` laid over it; six specs need the same object. */
export function limitsWith(o: Partial<Limits> = {}): Limits {
  return {
    open: false,
    presets: new Set<string>(),
    measures: new Set<string>(),
    stops: new Set(),
    bands: 0,
    stories: 0,
    reachM: 0,
    custom: false,
    hands: BASE_HANDS,
    ...o
  };
}
