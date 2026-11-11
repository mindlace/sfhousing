/**
 * A small public-money stack for the finance engine's tests: a federal pool (uncapped), a state
 * pool and a City pool, each with one affordable grant programme, and optionally a bond pool.
 * The shares are tier 1 dollars per home over the tier 2 total (test values).
 */
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool, PoolKind, Programme } from '$lib/timelapse/types';
import { resolveTerms } from '../../finance';
import type { SimInput } from '../types';

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
