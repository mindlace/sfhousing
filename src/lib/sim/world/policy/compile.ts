/**
 * The policy compiler (policy-timeline spec, S13). Task 9 declares only its context; Task 10
 * adds `compileTimeline`. Worker-safe.
 */
import type { LayerCtx } from '$lib/sim/levers/layers';
import type { SimInput } from '$lib/sim/scenario/types';
import type { YieldSource } from './zoning-view';

export type { YieldSource } from './zoning-view';

/** The worker's loaded dataset (S13, amended 2026-11-13). */
export interface CompileCtx {
  input: SimInput;
  layers: LayerCtx;
  windowMonths: number;
  yields: YieldSource;
  /** The clock that bounds a slice; default `performance.now`. */
  now?: () => number;
}
