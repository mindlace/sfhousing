// Policy documents for server tests (publish, serve, shared page): schema 4 (what publish takes
// now), and schema 3 for rows stored before it.
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { monthFirstDay } from '$lib/sim/world/months';
import type { CustomBrush, SimPolicy, Stroke } from '$lib/sim-page/policy';
import { DEFAULT_POLICY, serializeSimDoc, type SimDoc } from '$lib/sim-page/sim-doc';
import type { TimingSet } from '$lib/sim-page/timing';
import type { Day } from '$lib/timelapse/time';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import { serializeSimDoc4, type SimDoc4 } from '$lib/timeline/sim-doc4';
import { upgradePolicy } from '$lib/timeline/upgrade';

/** fixture-0's dataset date, and the first day of its model month `m`. */
export const FIXTURE0_AS_OF: Day = fixtureCalibration().asOf;
export const month = (m: number): Day => monthFirstDay(FIXTURE0_AS_OF, m);

export const simDoc4 = (
  policy: SimPolicy4 = DEFAULT_POLICY4,
  extra: Partial<SimDoc4> = {}
): SimDoc4 => ({
  schema: 4,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  policy,
  ...extra
});

/** A painted zoning policy: one span from `from` holding one brush of `strokes`. */
export const paintedPolicy4 = (strokes: Stroke[] = [stroke(3)], from: Day = month(1)): Policy => ({
  id: 'painted-1',
  label: 'Painted area',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [{ from, to: null, what: { tag: 'brushes', brushes: [freehand('a', strokes)] } }]
});

/** A schema 4 document with one painted policy in force. */
export const painted4 = (from: Day = month(1)): SimPolicy4 => ({
  schema: 4,
  kinds: { ...DEFAULT_POLICY4.kinds, zoning: [paintedPolicy4([stroke(3)], from)] }
});

export const painted4Text = (extra: Partial<SimDoc4> = {}, from?: Day): string =>
  serializeSimDoc4(simDoc4(painted4(from), extra));

/** 5,001 one-point strokes in one brush (schema 4): over OPS_MAX but under the byte cap. */
export const manyStrokes4Text = (): string =>
  JSON.stringify(
    simDoc4({
      schema: 4,
      kinds: {
        ...DEFAULT_POLICY4.kinds,
        zoning: [paintedPolicy4(Array.from({ length: 5001 }, () => stroke(1)))]
      }
    })
  );

export const simDoc = (
  policy: SimPolicy = DEFAULT_POLICY,
  extra: Partial<SimDoc> = {}
): SimDoc => ({
  schema: 3,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  policy,
  ...extra
});

export const stroke = (n = 2, radiusM = 50): Stroke => ({
  path: Array.from({ length: n }, (_, i) => [-122.4 + i * 1e-5, 37.7] as [number, number]),
  radiusM
});

/** A custom paint brush allowing 6 stories. */
export const freehand = (id: string, strokes: Stroke[]): CustomBrush => ({
  id,
  kind: 'paint',
  strokes,
  stories: 6
});

/** A policy that is not the default: one custom paint brush. */
export const paintedPolicy = (): SimPolicy => ({
  ...DEFAULT_POLICY,
  custom: [freehand('a', [stroke(3)])]
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
      custom: [freehand('a', [stroke(3)])],
      timing: { current: tamperedTiming(), saved: null }
    })
  );

/** 5,001 one-point strokes in one brush: over OPS_MAX but under the byte cap. */
export const manyStrokesText = (): string =>
  JSON.stringify(
    simDoc({
      ...DEFAULT_POLICY,
      custom: [
        freehand(
          'a',
          Array.from({ length: 5001 }, () => stroke(1))
        )
      ]
    })
  );

/** A schema 3 policy as schema 4 on fixture-0 (upgraded, not reconciled), as text. */
export const upgraded4Text = (p: SimPolicy, extra: Partial<SimDoc4> = {}): string =>
  serializeSimDoc4(simDoc4(upgradePolicy(p, FIXTURE0_AS_OF), extra));

/** A tampered `benchmarkPermits` timing set in a schema 4 permitting policy. */
export const tampered4Text = (): string =>
  JSON.stringify(
    simDoc4(
      upgradePolicy(
        {
          ...DEFAULT_POLICY,
          custom: [freehand('a', [stroke(3)])],
          timing: { current: tamperedTiming(), saved: null }
        },
        FIXTURE0_AS_OF
      )
    )
  );
