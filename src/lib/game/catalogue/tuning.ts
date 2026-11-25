import type { NodeId, Units } from '../state';

/** Paid on the run that first meets a rung (G6). */
export const RUNG_LUMP: Units = Object.freeze({ home: 2000 });

/** Each side goal's target and reward, by its id (G6). */
export const SIDE_TUNING: Record<string, { target: number; reward: Units }> = {
  'policy-homes-1': { target: 10_000, reward: { home: 500 } },
  'collect-share-1': { target: 30, reward: { home: 300 } },
  'approved-homes': { target: 15_000, reward: { home: 400 } },
  'collect-run': { target: 24_000, reward: { home: 500 } },
  'policy-homes-2': { target: 10_000, reward: { home: 1000 } },
  'new-money': { target: 100, reward: { home: 800 } },
  'collect-share-2': { target: 60, reward: { home: 600 } },
  'building-homes': { target: 3_000, reward: { home: 800 } },
  'policy-homes-3': { target: 7_000, reward: { home: 1500 } }
};

/** Each node's price in homes, one per level in order. */
export const PRICES: Readonly<Record<NodeId, readonly number[]>> = {
  'sb423-clock': [8_000],
  'benchmark-permits': [18_000],
  'no-discretionary': [30_000],
  'stop-rail': [6_000],
  'stop-metro': [10_000],
  'taller-1': [8_000, 12_000],
  'reach-1': [16_000],
  bands: [6_000, 9_000],
  'stop-rapid': [28_000],
  'taller-2': [26_000, 36_000],
  'stop-frequent': [45_000],
  'reach-2': [42_000],
  'taller-3': [16_000, 30_000],
  'reach-3': [20_000],
  'housing-bond': [7_000],
  'general-revenue': [16_000],
  'revolving-fund': [12_000],
  'public-bank': [24_000],
  'federal-support': [32_000],
  'state-double': [40_000],
  'hands-radius': [2_000, 9_000, 20_000, 40_000],
  'hands-linger': [8_000, 18_000, 35_000],
  'hands-auto': [22_000]
};
