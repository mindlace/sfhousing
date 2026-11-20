// The two flags of a project slot on the map (map-on-screen Task 1): your zoning sets its lot's
// height limit, or a pool you added funds it. Asked by the map stream when it packs a row's cell.
// Worker-safe and pure, under the determinism lint rule (no transcendental Math).
import { SLOT_FLAG } from '$lib/map/types';
import { STAGE_ORDER } from '$lib/timelapse/types';
import { monthOfDay } from '../months';
import type { FinanceFrame, PolicyFrame } from '../policy/frame';
import { limitsAt } from '../policy/limits';
import type { Statics } from '../statics';
import { NO_DAY, ORIGIN_MASTER, ORIGIN_SIM, type World } from '../types';

export interface FlagSources {
  /** The plan's frame of model month m (m >= 1), from the timeline in use. */
  frameAt(m: number): PolicyFrame;
  /** Ids of the dataset's baseline pools (`SimInput.finance.pools`). */
  basePools: ReadonlySet<string>;
}

const NS = STAGE_ORDER.length;

/** Programme id to its pool id, per finance frame (the same ids in every frame of one timeline). */
const POOL_OF = new WeakMap<FinanceFrame, Map<string, string>>();

function poolOf(finance: FinanceFrame, programme: string): string | undefined {
  let m = POOL_OF.get(finance);
  if (m === undefined) {
    m = new Map(finance.programmes.map((g) => [g.id, g.pool]));
    POOL_OF.set(finance, m);
  }
  return m.get(programme);
}

/**
 * SLOT_FLAG.zoning: an ORIGIN_SIM row whose lot (`src[row]`) has, in the frame of the model month
 * of its first entered stage (max(1, monthOfDay(asOf, day))), an owner other than 'fzp'.
 * SLOT_FLAG.money: funded[row] === 1 and some id of programmes[row] names, in that frame's
 * finance, a programme whose pool is not in basePools. 0 for a master row, and for a row that
 * has entered no stage (it is not drawn).
 */
export function slotFlags(world: World, statics: Statics, row: number, src: FlagSources): number {
  const p = world.projects;
  const origin = p.origin[row];
  if (origin === ORIGIN_MASTER) return 0;
  let first = NO_DAY;
  for (let j = 0; j < NS; j++) {
    const d = p.entered[row * NS + j];
    if (d !== NO_DAY && (first === NO_DAY || d < first)) first = d;
  }
  if (first === NO_DAY) return 0;
  const frame = src.frameAt(Math.max(1, monthOfDay(statics.asOf, first)));
  let out = 0;
  if (origin === ORIGIN_SIM && limitsAt(frame, p.src[row]).owner.kind !== 'fzp') {
    out |= SLOT_FLAG.zoning;
  }
  if (p.funded[row] === 1 && frame.finance !== null && p.programmes[row] !== '') {
    for (const id of p.programmes[row].split(',')) {
      const pool = poolOf(frame.finance, id);
      if (pool !== undefined && !src.basePools.has(pool)) {
        out |= SLOT_FLAG.money;
        break;
      }
    }
  }
  return out;
}
