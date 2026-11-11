/**
 * The finance engine's queue fixtures: `tinyQueue`, a five-lot city with hand-set hazards and
 * yields, and `tinyStack`, a small public-money stack: a federal pool (uncapped), a state pool and
 * a City pool, each with one affordable grant programme, and optionally a bond pool. The shares
 * are tier 1 dollars per home over the tier 2 total. Test values, not data. Browser-safe.
 */
import { FILL_LEVELS } from '$lib/data/scenario-codec';
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool, PoolKind, Programme } from '$lib/timelapse/types';
import { resolveTerms } from '../../finance';
import type { SimInput } from '../types';
import { miniCalibrationWithRoutes } from './mini-finance';
import { miniCity } from './mini-parcels';
import { MINI_AS_OF } from './mini-projects';
import { selectRows } from './select-rows';

const F = FILL_LEVELS.length;

/** The five lots' parcel ids, ascending, so a lot's parcel rank is its row. */
export const TINY_IDS = ['0100T001', '0100T002', '0100T003', '0100T004', '0100T005'] as const;

export interface TinyQueueOpts {
  /** each lot's initiation log-odds (default −3 each) */
  logOdds?: number[];
  /** the homes of each lot's one gaining level (default 10, 12, 14, 16, 18) */
  units?: number[];
  /** each lot's existing homes (default 0) */
  existing?: number[];
  /** `reservedFrom` by lot (0 = none); absent = no reservations */
  reservedFrom?: Day[];
}

/**
 * Five hostable lots copied from the mini city (rows `TINY_IDS`, no Local Program, envelope 4
 * stories), no pipeline projects, and the mini calibration (with `affordableRoutes`) whose
 * initiation model is one term on `landUseClass`: lot i has class i and log-odds `logOdds[i]`.
 * Each lot's fill levels yield its existing homes, except the top one, which yields `units[i]`:
 * one gaining level, so its size draw always gives `units[i]` homes.
 */
export function tinyQueue(o: TinyQueueOpts = {}): SimInput {
  const logOdds = o.logOdds ?? [-3, -3, -3, -3, -3];
  const units = o.units ?? [10, 12, 14, 16, 18];
  const existing = o.existing ?? [0, 0, 0, 0, 0];
  const src = miniCity().parcels;
  const rows: number[] = [];
  for (let i = 0; i < src.count && rows.length < TINY_IDS.length; i++) {
    if (src.hostable[i] === 1 && src.envelopeStories[i] > 0 && src.localProgram[i] === 0) {
      rows.push(i);
    }
  }
  const parcels = selectRows(src, rows, [...TINY_IDS], () => src.cells[0].cellId);
  TINY_IDS.forEach((_, i) => {
    if (!(units[i] > existing[i])) throw new RangeError(`tinyQueue: lot ${i} gains no home`);
    parcels.landUseClass[i] = i;
    parcels.existingUnits[i] = existing[i];
    parcels.envelopeStories[i] = 4;
    parcels.baseStories[i] = 4;
    for (let f = 0; f < F; f++) {
      parcels.yield[i * F + f] = f === F - 1 ? units[i] : existing[i];
      parcels.baseYield[i * F + f] = f === F - 1 ? units[i] : existing[i];
    }
  });
  const cal = miniCalibrationWithRoutes();
  const calibration = {
    ...cal,
    initiation: {
      ...cal.initiation,
      intercept: 0,
      terms: [{ feature: 'landUseClass' as const, bins: [0, 1, 2, 3, 4], coef: [...logOdds] }]
    }
  };
  return {
    parcels,
    projects: [],
    calibration,
    asOf: MINI_AS_OF,
    districtMaxStories: null,
    ...(o.reservedFrom ? { reservedFrom: Int32Array.from(o.reservedFrom) } : {})
  };
}

export interface TinyStackOpts {
  asOf: Day;
  state?: Inflow[];
  city?: Inflow[];
  cityTo?: Day | null;
  bond?: { share: number; from: Day; to?: Day | null; inflows: Inflow[] };
  off?: { pool: string; from: Day; to: Day | null }[];
  minHomes?: number;
  slope?: number;
}

const TOTAL = 861525;

export function tinyStack(o: TinyStackOpts): NonNullable<SimInput['finance']> {
  const ample = (): Inflow[] => [
    { kind: 'yearly', from: o.asOf, to: null, dollarsPerYear: 1_000_000_000_000 }
  ];
  const pool = (id: string, kind: PoolKind, inflows: Inflow[], uncapped = false): Pool => ({
    id,
    kind,
    label: id,
    inflows,
    uncapped,
    debt: kind === 'goBond' ? { rate: 0.04, termYears: 30 } : null,
    leverage: 1
  });
  const minHomes = o.minHomes ?? 1;
  const grant = (
    id: string,
    poolId: string,
    share: number,
    from: Day,
    to: Day | null
  ): Programme => ({
    id,
    label: id,
    pool: poolId,
    reach: 'affordable',
    instrument: { kind: 'grant', share },
    from,
    to,
    minHomes,
    tiers: { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 }
  });
  const pools = [
    pool('t-fed', 'federal', [], true),
    pool('t-state', 'state', o.state ?? ample()),
    pool('t-city', 'generalRevenue', o.city ?? ample())
  ];
  const programmes = [
    grant('t-fed', 't-fed', 443108 / TOTAL, o.asOf, null),
    grant('t-state', 't-state', 118390 / TOTAL, o.asOf, null),
    grant('t-city', 't-city', 300027 / TOTAL, o.asOf, o.cityTo ?? null)
  ];
  if (o.bond) {
    pools.push(pool('t-bond', 'goBond', o.bond.inflows));
    programmes.push(grant('t-bond-grant', 't-bond', o.bond.share, o.bond.from, o.bond.to ?? null));
  }
  return {
    pools,
    programmes,
    off: o.off ?? [],
    slope: o.slope ?? 3,
    terms: resolveTerms()
  };
}
