// Policy documents for server tests (publish, serve, shared page).
import { defaultEffect, type SimPolicy, type Stroke, type ZoningBrush } from '$lib/sim-page/policy';
import { DEFAULT_POLICY, serializeSimDoc, type SimDoc } from '$lib/sim-page/sim-doc';
import type { TimingSet } from '$lib/sim-page/timing';

export const simDoc = (
  policy: SimPolicy = DEFAULT_POLICY,
  extra: Partial<SimDoc> = {}
): SimDoc => ({
  schema: 1,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  policy,
  ...extra
});

export const stroke = (n = 2, radiusM = 50): Stroke => ({
  path: Array.from({ length: n }, (_, i) => [-122.4 + i * 1e-5, 37.7] as [number, number]),
  radiusM
});

export const freehand = (id: string, strokes: Stroke[]): ZoningBrush => ({
  id,
  kind: 'freehand',
  strokes,
  effect: defaultEffect('raise', 6)
});

/** A policy that is not the default: one freehand brush. */
export const paintedPolicy = (): SimPolicy => ({
  ...DEFAULT_POLICY,
  brushes: [freehand('a', [stroke(3)])]
});

export const paintedText = (extra: Partial<SimDoc> = {}): string =>
  serializeSimDoc(simDoc(paintedPolicy(), extra));

/** A `benchmarkPermits` timing set whose preset scale has been tampered with. */
const tamperedTiming = (): TimingSet => ({
  preset: 'benchmarkPermits',
  presetTimers: [
    { pathway: 'discretionary', stage: 'permitFiled', scale: 0.2, reach: 'all' },
    { pathway: 'streamlined', stage: 'permitFiled', scale: 0.2, reach: 'all' },
    { pathway: 'permitOnly', stage: 'permitFiled', scale: 0.2, reach: 'all' }
  ],
  presetRouteShares: null,
  edits: [],
  routeShares: { discretionary: 10, streamlined: 60, permitOnly: 30 },
  localProgramStreamlined: true
});

export const tamperedText = (): string =>
  JSON.stringify(
    simDoc({
      ...DEFAULT_POLICY,
      brushes: [freehand('a', [stroke(3)])],
      timing: { current: tamperedTiming(), saved: null }
    })
  );

/** 5,001 one-point strokes in one brush: over OPS_MAX but under the byte cap. */
export const manyStrokesText = (): string =>
  JSON.stringify(
    simDoc({
      ...DEFAULT_POLICY,
      brushes: [
        freehand(
          'a',
          Array.from({ length: 5001 }, () => stroke(1))
        )
      ]
    })
  );
