// Recording RunLayer double for TimelineMode tests (RunLayerStub.svelte): the latest props it got
// and every `feed` object it saw. Reset it per test.
import type { Hands } from '$lib/game/limits';
import type { RunTake } from '$lib/game/run-result';
import type { RunFeed } from '$lib/game/run/drops';
import type { Sound } from '$lib/game/run/sound';

/** RunLayer's props (R1's RunLayerProps). */
export interface RunLayerStubProps {
  feed: RunFeed;
  hands: Hands;
  collectForMe: boolean;
  sound: Sound;
  ontake(t: RunTake): void;
}

export const runLayer: {
  /** The latest props, as passed; null before the first mount. */
  props: RunLayerStubProps | null;
  /** Every `feed` prop value seen, by identity. */
  feeds: Set<RunFeed>;
  reset(): void;
} = {
  props: null,
  feeds: new Set(),
  reset() {
    runLayer.props = null;
    runLayer.feeds = new Set();
  }
};
