// The published car-ownership coefficients the fit is set beside (spec "Choice model": "their
// published coefficients are the starting point and the cross-check, not the answer"). Read from
// the models' own files at a pinned commit on 2026-11-24; each value is the term's utility for
// 1, 2 and 3 cars against 0 cars (TM2's base alternative is 2 cars: its values here are the
// alternative's coefficient minus the 0-car one). Not fitted: report only.
import type { Provenance } from '../../../src/lib/timelapse/types';

export interface Prior {
  model: 'MTC TM2' | 'ActivitySim';
  term: string;
  definition: string;
  /** 1, 2 and 3 cars against 0 cars. */
  coef: [number, number, number];
}

const TM2_URL =
  'https://github.com/BayAreaMetro/travel-model-two/blob/3b765dd96f28c46dea92c77b8113b6fa6685cb57/uec/AutoOwnership.xls';
const ASIM_COEF_URL =
  'https://github.com/ActivitySim/activitysim-prototype-mtc/blob/04ce2e1de63920e644eac3de3862c56a653c091c/configs/auto_ownership_coefficients.csv';
const ASIM_SPEC_URL =
  'https://github.com/ActivitySim/activitysim-prototype-mtc/blob/04ce2e1de63920e644eac3de3862c56a653c091c/configs/auto_ownership.csv';

export const PRIOR_PROVENANCE: Provenance = {
  tier: 3,
  label: 'estimated model (MTC TM2 / ActivitySim)',
  sources: [
    {
      label: 'MTC Travel Model Two, uec/AutoOwnership.xls, sheet "Auto Ownership" (nested logit)',
      url: TM2_URL
    },
    {
      label: 'ActivitySim prototype_mtc, configs/auto_ownership_coefficients.csv (MNL)',
      url: ASIM_COEF_URL
    },
    {
      label: 'ActivitySim prototype_mtc, configs/auto_ownership.csv (expressions)',
      url: ASIM_SPEC_URL
    }
  ],
  method:
    "Coefficients read from each model's file at the pinned commit; conventional-vehicle " +
    'alternatives for TM2 (1_CAR_1CV, 2_CARS_2CV, 3_CARS_3CV), differenced against 0_CARS. TM2 ' +
    'nests car counts (nesting coefficients 0.3 and 0.668), so its values are not MNL-comparable ' +
    'in scale.'
};

export const PRIORS: readonly Prior[] = [
  // MTC TM2, rows 50-52 (income dummies, base $60-100k), 59 (population density), 62 (auto minus
  // transit accessibility, sign flipped to transit), 30 (workers/drivers, 1-driver households).
  {
    model: 'MTC TM2',
    term: 'income < $30k',
    definition: 'dummy, against $60-100k',
    coef: [-2.0228, -2.6549, -3.2561]
  },
  {
    model: 'MTC TM2',
    term: 'income $30-60k',
    definition: 'dummy, against $60-100k',
    coef: [-0.5756, -0.9182, -1.2239]
  },
  {
    model: 'MTC TM2',
    term: 'income $100k+',
    definition: 'dummy, against $60-100k',
    coef: [0, 0.4431, 0.5301]
  },
  {
    model: 'MTC TM2',
    term: 'population density',
    definition: 'population density within 1/2 mile of the home MGRA (4D file)',
    coef: [-0.0235, -0.0462, -0.0462]
  },
  {
    model: 'MTC TM2',
    term: 'transit accessibility',
    definition: 'household transit accessibility logsum (enters as auto minus transit)',
    coef: [-0.1917, -0.2008, -0.2008]
  },
  {
    model: 'MTC TM2',
    term: 'workers per driver',
    definition: 'workers / drivers, 1-driver households',
    coef: [1.4643, 1.9393, 1.9393]
  },
  // ActivitySim prototype_mtc (MNL; 0 cars the base).
  {
    model: 'ActivitySim',
    term: 'constant',
    definition: 'alternative-specific constant',
    coef: [1.1865, -1.0846, -3.2502]
  },
  {
    model: 'ActivitySim',
    term: 'San Francisco',
    definition: 'county constant',
    coef: [0.4259, 0.4683, 0.1458]
  },
  {
    model: 'ActivitySim',
    term: 'workers',
    definition: 'number of workers, capped at 3',
    coef: [0, 0.2936, 0.6389]
  },
  {
    model: 'ActivitySim',
    term: 'drivers 2',
    definition: 'dummy, 2 adults 16+ (against 1)',
    coef: [0, 3.0773, 3.1962]
  },
  {
    model: 'ActivitySim',
    term: 'drivers 3',
    definition: 'dummy, 3 adults 16+ (against 1)',
    coef: [0, 3.5401, 5.5131]
  },
  {
    model: 'ActivitySim',
    term: 'income $0-30k',
    definition: 'piecewise linear, per $1,000',
    coef: [0.0383, 0.054, 0.0559]
  },
  {
    model: 'ActivitySim',
    term: 'income $30-125k',
    definition: 'piecewise linear, per $1,000',
    coef: [0, 0.0083, 0.011]
  },
  {
    model: 'ActivitySim',
    term: 'density index to 10',
    definition: 'MTC household-and-job density index, up to 10',
    coef: [0, -0.2028, -0.3654]
  },
  {
    model: 'ActivitySim',
    term: 'density index above 10',
    definition: 'the same index in excess of 10',
    coef: [-0.0152, -0.1106, -0.1766]
  },
  {
    model: 'ActivitySim',
    term: 'retail transit accessibility',
    definition: 'retail jobs reachable by transit (logsum), households with workers',
    coef: [-0.5117, -0.5117, -0.5117]
  }
];
