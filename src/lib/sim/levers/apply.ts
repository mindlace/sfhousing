/**
 * Compiles a filled lever `Resolution` into the plan's and the twin's `SimInput`s (plan 2 Task
 * 10), and the stage lookups each cohort reads. The plan runs on the resolved envelopes, its
 * in-flight rows on the `'all'` timers and its new projects on every timer plus the route shares
 * (ruling 3, "Policy start date"). The twin is pre-FZP zoning or current law, never the plan's
 * timers, and every lever field (`lawSwitch`, `newProjects`, `inFlightScale`) is set explicitly,
 * because `applyPolicies` copies the whole input. Worker-safe and pure.
 */
import { chanceTable, typicalMonths } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/types';
import { applyPolicies, baseZoning } from '../scenario/policy';
import { REFERENCES } from '../scenario/score';
import type { SimInput, TimelineScore } from '../scenario/types';
import type { LayerCtx } from './layers';
import {
  allNeeds,
  leverCapacity,
  resolveEnvelopes,
  type LeverCapacity,
  type Resolution
} from './resolve';
import { isIdentity, routeSharesOp, scaleTable, timersOp } from './timers';
import { CURRENT_LAW_SWITCH, DEFAULT_LEVERS, type SimLevers } from './types';
import { envelopeOp, localProgramColumn, parcelsView } from './view';

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

/** `input` without the lever fields, so nothing is inherited from it. */
function bare(input: SimInput): SimInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lawSwitch, newProjects, inFlightScale, ...rest } = input;
  return rest;
}

/**
 * The plan input for `levers` under the filled resolution (its Needs already written in). Each
 * view gets its period's Local Program column (Call 22).
 */
function planOf(base: SimInput, ctx: LayerCtx, levers: SimLevers, filled: Resolution): SimInput {
  const lp = localProgramColumn(ctx, levers, filled.beforePeriod);
  const inFlight = scaleTable(levers.timers, 'inFlight');
  const fresh = scaleTable(levers.timers, 'new');
  const plan = bare(applyPolicies([envelopeOp(filled.before.table, lp), timersOp(inFlight)], base));
  // Without a 'new' timer both cohorts have the same scales, so new projects reuse the plan's
  // rescaled transitions (and `lookupsOf` shares one set). Otherwise every edit applies to the
  // base calibration once: rescaling the in-flight calibration again would double the 'all' ones.
  const shares = routeSharesOp(levers.routeShares);
  const newCal = levers.timers.some((t) => t.reach === 'new')
    ? applyPolicies([timersOp(fresh), shares], base).calibration
    : applyPolicies([shares], plan).calibration;
  return {
    ...plan,
    newProjects: { calibration: newCal, scale: fresh },
    ...(isIdentity(inFlight) ? {} : { inFlightScale: inFlight }),
    ...(filled.after
      ? {
          lawSwitch: {
            day: filled.after.day,
            parcels: parcelsView(
              base.parcels,
              filled.after.period.table,
              localProgramColumn(ctx, levers, 'after')
            )
          }
        }
      : {})
  };
}

const twinMemo = new WeakMap<SimInput, WeakMap<LayerCtx, Map<string, SimInput>>>();

/**
 * The twin the plan is compared with. `'preFzp'`: `baseZoning` on the base, no switch.
 * `'currentLaw'`: the plan of `{ ...DEFAULT_LEVERS, assumeAlternativePlanKept }` on the base
 * calibration, with its own switch. Memoised on (base, ctx, compare, assumeAlternativePlanKept,
 * horizon), so lever documents that differ elsewhere share one twin (and its precompute).
 */
export function twinInput(
  base: SimInput,
  ctx: LayerCtx,
  levers: SimLevers,
  horizon: Day
): SimInput {
  const assume = levers.assumeAlternativePlanKept;
  const key = levers.compare === 'preFzp' ? 'preFzp' : `currentLaw:${assume}:${horizon}`;
  let byCtx = twinMemo.get(base);
  if (!byCtx) twinMemo.set(base, (byCtx = new WeakMap()));
  let byKey = byCtx.get(ctx);
  if (!byKey) byCtx.set(ctx, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;

  let twin: SimInput;
  if (levers.compare === 'preFzp') {
    twin = bare(applyPolicies([baseZoning], base));
  } else {
    const law: SimLevers = {
      ...structuredClone(DEFAULT_LEVERS),
      assumeAlternativePlanKept: assume
    };
    const window = { asOf: base.asOf, horizon, switchDay: CURRENT_LAW_SWITCH.day };
    const r = resolveEnvelopes(ctx, law, window);
    const needs = allNeeds(r).length;
    if (needs > 0) throw new Error(`twinInput: the current-law twin has ${needs} needs`);
    twin = planOf(base, ctx, law, r);
  }
  byKey.set(key, twin);
  return twin;
}

function lookupsFor(cal: SimInput['calibration']): Lookups {
  return { chance: chanceTable(cal), typicalMonths: typicalMonths(cal) };
}

/** The stage lookups of the plan's in-flight rows and of its new projects. */
export function lookupsOf(plan: SimInput): LeverLookups {
  const inFlight = lookupsFor(plan.calibration);
  const newCal = plan.newProjects?.calibration ?? plan.calibration;
  const fresh = newCal.transitions === plan.calibration.transitions ? inFlight : lookupsFor(newCal);
  return { inFlight, fresh };
}

/**
 * The plan and twin inputs for `levers` (ruling 3). `filled` is `fillNeeds`' output for these
 * levers; `horizon` is the run's, which the current-law twin resolves its switch against.
 * References (ruling 3): the existing ones are FZP-versus-pre-FZP estimates on `planEffect.*`,
 * so all are shown against pre-FZP zoning and only the `completedNet` ones against current law.
 */
export function applyLevers(
  base: SimInput,
  ctx: LayerCtx,
  levers: SimLevers,
  filled: Resolution,
  horizon: Day
): LeverInputs {
  const plan = planOf(base, ctx, levers, filled);
  return {
    plan,
    twin: twinInput(base, ctx, levers, horizon),
    lookups: lookupsOf(plan),
    capacity: leverCapacity(filled, base.parcels),
    unknownLots: filled.unknownLots,
    references:
      levers.compare === 'preFzp'
        ? REFERENCES
        : REFERENCES.filter((r) => r.measure === 'completedNet')
  };
}
