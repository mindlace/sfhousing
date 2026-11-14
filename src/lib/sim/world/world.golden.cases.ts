/**
 * The run of the cross-engine world golden (spec "Tests that must pass": the same inputs give
 * byte-identical event streams in Node and in the browser). The builder
 * (`fixtures/build-world-golden.ts`, Node) writes `fixtures/world-events-mini-seed1.json` from
 * `goldenWorldEvents`; `world.golden.shared.ts` (the server test and the client project's browser
 * spec) reruns it and compares. Browser-safe: the mini city only (the bench city and the fixture
 * loader are Node-only). Test support only: nothing in the app imports it.
 */
import { staticsOf } from './statics';
import { miniInput } from './test/mini';
import { Recorder, runWorld } from './test/run';
import { changingAt, everyStage, frameOf, marketAt } from './test/timeline';
import type { WorldEvent } from './types';

export const WORLD_GOLDEN_SEED = 1;
export const WORLD_GOLDEN_THROUGH = 300;
/** The month the frame changes: the market shifts by 0.4 and every stage runs at 0.7. */
export const WORLD_GOLDEN_CHANGE = 121;

export type GoldenWorldEvent = WorldEvent & { month: number };

/**
 * The mini city without public money, seed 1, stepped through month 300 under a timeline whose
 * frame changes at month 121; every event with the month of the call that sent it, as the golden
 * file holds it (a JSON round trip).
 */
export function goldenWorldEvents(): GoldenWorldEvent[] {
  const input = miniInput();
  const statics = staticsOf(input);
  const f = frameOf(input);
  const g = frameOf(input, {
    id: 1,
    market: marketAt(input, input.asOf) + 0.4,
    speed: everyStage(0.7)
  });
  const rec = new Recorder();
  runWorld(
    statics,
    changingAt(WORLD_GOLDEN_CHANGE, f, g, new Int32Array(0)),
    WORLD_GOLDEN_SEED,
    WORLD_GOLDEN_THROUGH,
    rec
  );
  return JSON.parse(JSON.stringify(rec.events)) as GoldenWorldEvent[];
}
