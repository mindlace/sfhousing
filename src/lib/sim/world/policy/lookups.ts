// The stage tables for one policy frame (policy-timeline spec S13, `lookupsAt`). Pure TS.
import { lookupsOf, type LeverLookups } from '$lib/sim/levers/apply';
import type { StageScale } from '$lib/sim/levers/timers';
import { MAX_SCALE, MIN_SCALE, type TimedStage } from '$lib/sim/levers/types';
import type { SimInput } from '$lib/sim/scenario/types';
import type { PolicyFrame } from './frame';

const ROUTES = ['discretionary', 'streamlined', 'permitOnly'] as const;

/** `speed` times every `speedNew` scale, per route and stage, clamped to `[MIN_SCALE, MAX_SCALE]`. */
function newScale(frame: PolicyFrame): StageScale {
  const out: StageScale = { discretionary: {}, streamlined: {}, permitOnly: {} };
  for (const r of ROUTES) {
    const stages = new Set<TimedStage>(Object.keys(frame.speed[r]) as TimedStage[]);
    for (const n of frame.speedNew) {
      for (const s of Object.keys(n.scale[r]) as TimedStage[]) stages.add(s);
    }
    for (const s of stages) {
      let x = frame.speed[r][s] ?? 1;
      for (const n of frame.speedNew) x *= n.scale[r][s] ?? 1;
      out[r][s] = Math.min(MAX_SCALE, Math.max(MIN_SCALE, x));
    }
  }
  return out;
}

/** Entries kept: the tables are large. Oldest out first. */
const MEMO_SIZE = 8;
const memo = new Map<number, LeverLookups>();

/**
 * The stage tables the map's bars and the cards read for `frame`, as `lookupsOf` computes them:
 * `speed` for rows in flight, `speed` times every `speedNew` scale for new projects. Memoised by
 * frame id (arrivals, the only content outside the id, do not enter the tables).
 */
export function lookupsAt(frame: PolicyFrame): LeverLookups {
  const hit = memo.get(frame.id);
  if (hit) return hit;
  // `lookupsOf` reads only these fields of its input.
  const input = {
    parcels: frame.view.parcels,
    calibration: frame.calibration,
    inFlightScale: frame.speed,
    newProjects: { calibration: frame.newCalibration, scale: newScale(frame) }
  } as unknown as SimInput;
  const out = lookupsOf(input);
  if (memo.size >= MEMO_SIZE) memo.delete(memo.keys().next().value!);
  memo.set(frame.id, out);
  return out;
}
