/**
 * Compiles a filled lever `Resolution` into the plan's and the twin's `SimInput`s (plan 2 Task
 * 10), and the stage lookups each cohort reads. The plan runs on the resolved envelopes and the
 * unscaled calibration: timers reach the engine only as scales (`inFlightScale` for in-flight
 * rows, the `'all'` timers; `newProjects.scale` for new projects, every timer), and the engine
 * multiplies each stage's time by them, so a timer never changes an outcome (paired-draw fix).
 * New projects also take the route shares (ruling 3, "Policy start date"). The lookups are the
 * display view: the rescaled tables (`timersOp`), which agree with the engine within the month
 * grid. The twin is pre-FZP zoning or FZP as written, never the plan's timers, and every lever
 * field (`newProjects`, `inFlightScale`) is set explicitly, because `applyPolicies` copies the
 * whole input. Worker-safe and pure.
 */
import { chanceTable, typicalMonths } from '$lib/timelapse/model';
import { applyPolicies, baseZoning } from '../scenario/policy';
import { REFERENCES } from '../scenario/score';
import type { SimInput, TimelineScore } from '../scenario/types';
import { buildFinance } from './finance';
import type { LayerCtx } from './layers';
import {
  allNeeds,
  leverCapacity,
  resolveEnvelopes,
  type LeverCapacity,
  type Resolution
} from './resolve';
import {
  isIdentity,
  routeSharesOp,
  sameScale,
  scaleTable,
  timersOp,
  type StageScale
} from './timers';
import { DEFAULT_LEVERS, type Compare, type SimLevers } from './types';
import { envelopeOp, localProgramColumn } from './view';

export interface Lookups {
  chance: ReturnType<typeof chanceTable>;
  typicalMonths: ReturnType<typeof typicalMonths>;
}
/** `fresh === inFlight` when new projects run on the in-flight transitions (no `'new'` timer). */
export interface LeverLookups {
  inFlight: Lookups;
  fresh: Lookups;
}
export interface LeverInputs {
  plan: SimInput;
  twin: SimInput;
  lookups: LeverLookups;
  capacity: LeverCapacity;
  unknownLots: number;
  references: TimelineScore['references'];
}

/**
 * `input` without the lever fields, so nothing is inherited from it. `market` and `finance` are
 * the world, not the policy: they must survive `bare()` (F17).
 */
function bare(input: SimInput): SimInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { newProjects, inFlightScale, ...rest } = input;
  return rest;
}

/** The plan input for `levers` under the filled resolution (its Needs already written in). */
function planOf(base: SimInput, ctx: LayerCtx, levers: SimLevers, filled: Resolution): SimInput {
  const lp = localProgramColumn(ctx, levers);
  const inFlight = scaleTable(levers.timers, 'inFlight');
  // No `timersOp`: the engine scales time itself, on the unscaled transitions. Rescaling the
  // calibration as well would apply every timer twice.
  const plan = bare(applyPolicies([envelopeOp(filled.plan.table, lp)], base));
  const newCal = applyPolicies([routeSharesOp(levers.routeShares)], plan).calibration;
  // No baseline finance leaves the key out, so a run without public money is as before (F9).
  const finance = buildFinance(base.finance, levers.finance, base.asOf);
  return {
    ...plan,
    newProjects: { calibration: newCal, scale: scaleTable(levers.timers, 'new') },
    ...(isIdentity(inFlight) ? {} : { inFlightScale: inFlight }),
    ...(finance === undefined ? {} : { finance })
  };
}

const twinMemo = new WeakMap<SimInput, WeakMap<LayerCtx, Map<Compare, SimInput>>>();

/**
 * The twin the plan is compared with. `'preFzp'`: `baseZoning` on the base. `'fzp'`: the plan of
 * `DEFAULT_LEVERS` (FZP as written: no rules, paint, protections or timers) on the base
 * calibration. Neither switches law. Memoised on (base, ctx, compare), so lever documents that
 * differ elsewhere share one twin (and its precompute).
 */
export function twinInput(base: SimInput, ctx: LayerCtx, compare: Compare): SimInput {
  let byCtx = twinMemo.get(base);
  if (!byCtx) twinMemo.set(base, (byCtx = new WeakMap()));
  let byKey = byCtx.get(ctx);
  if (!byKey) byCtx.set(ctx, (byKey = new Map()));
  const hit = byKey.get(compare);
  if (hit) return hit;

  let twin: SimInput;
  if (compare === 'preFzp') {
    twin = bare(applyPolicies([baseZoning], base));
  } else {
    const r = resolveEnvelopes(ctx, DEFAULT_LEVERS, base.asOf);
    const needs = allNeeds(r).length;
    if (needs > 0) throw new Error(`twinInput: the FZP twin has ${needs} needs`);
    twin = planOf(base, ctx, DEFAULT_LEVERS, r);
  }
  byKey.set(compare, twin);
  return twin;
}

function lookupsFor(cal: SimInput['calibration']): Lookups {
  return { chance: chanceTable(cal), typicalMonths: typicalMonths(cal) };
}

const IDENTITY: StageScale = { discretionary: {}, streamlined: {}, permitOnly: {} };

/**
 * The stage lookups of the plan's in-flight rows and of its new projects: the display view of the
 * engine's scaled time, each cohort's calibration rescaled by its own scale (`timersOp`). The
 * engine never reads them. New projects share the in-flight set when they run on the same
 * transitions with the same scale.
 */
export function lookupsOf(plan: SimInput): LeverLookups {
  const inFlightScale = plan.inFlightScale ?? IDENTITY;
  const inFlight = lookupsFor(timersOp(inFlightScale)(plan.calibration, plan.parcels).cal);
  const np = plan.newProjects;
  const shared =
    np === undefined ||
    (np.calibration.transitions === plan.calibration.transitions &&
      sameScale(np.scale, inFlightScale));
  const fresh = shared
    ? inFlight
    : lookupsFor(timersOp(np.scale)(np.calibration, plan.parcels).cal);
  return { inFlight, fresh };
}

/**
 * The plan and twin inputs for `levers` (ruling 3). `filled` is `fillNeeds`' output for these
 * levers. References (ruling 3): the existing ones are FZP-versus-pre-FZP estimates on
 * `planEffect.*`, so all are shown against pre-FZP zoning and only the `completedNet` ones
 * against FZP as written.
 */
export function applyLevers(
  base: SimInput,
  ctx: LayerCtx,
  levers: SimLevers,
  filled: Resolution
): LeverInputs {
  const plan = planOf(base, ctx, levers, filled);
  return {
    plan,
    twin: twinInput(base, ctx, levers.compare),
    lookups: lookupsOf(plan),
    capacity: leverCapacity(filled, base.parcels),
    unknownLots: filled.unknownLots,
    references:
      levers.compare === 'preFzp'
        ? REFERENCES
        : REFERENCES.filter((r) => r.measure === 'completedNet')
  };
}
