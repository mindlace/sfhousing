import type { Provenance } from '../timelapse/types';

// Provenance of the generator's sourced constants (constants.ts). Kept apart from constants.ts,
// which vite.config.ts reaches and which therefore imports nothing outside the generator.

const ORDINANCE_296_18 = {
  label: 'SF Ordinance 296-18 (Central SoMa Plan), Board of Supervisors File 180184',
  url: 'https://sfbos.org/sites/default/files/o0296-18.pdf'
};

export const BLOCK_COVERAGE_PROVENANCE: Provenance = {
  tier: 0,
  label: 'Ground coverage of buildings of 13 stories or more built 2005 to 2016',
  sources: [
    { label: 'DataSF Building Footprints (ynuv-fyni)', url: 'https://data.sf.gov/d/ynuv-fyni' },
    {
      label: 'SF assessor secured roll (DataSF wv5m-vpq2)',
      url: 'https://data.sf.gov/d/wv5m-vpq2'
    }
  ],
  method:
    'Median over lots of footprint area ÷ lot area (0.923, IQR 0.73 to 0.99), lots with a ' +
    'latest-roll building of 13 to 80 stories built 2005 to 2016 (the footprints are the 2016 ' +
    'LiDAR capture); pipeline/lib/coverage-fit.ts',
  n: 32,
  window: ['2005', '2016']
};

export const TOWERS_PLATE_MAX_PROVENANCE: Provenance = {
  tier: 1,
  label: 'Largest floor of a residential tower: 12,000 gross square feet',
  sources: [
    {
      label: `${ORDINANCE_296_18.label}: Planning Code Sec. 270(h)(3)(A)(i), CS Bulk District`,
      url: ORDINANCE_296_18.url
    }
  ],
  method:
    '"For residential and hotel uses, the maximum Gross Floor Area of any floor is 12,000 gross ' +
    'square feet" in the Tower Portion (above 85 ft). The most permissive residential tower ' +
    'floor cap found in the code; Rincon Hill and the Sec. 132.4(d)(3)(B) separation exception ' +
    'use 10,000. Taken as one square plate per tower.'
};

export const TOWERS_SEPARATION_PROVENANCE: Provenance = {
  tier: 1,
  label: 'Separation between towers: 115 feet',
  sources: [
    {
      label: `${ORDINANCE_296_18.label}: Planning Code Sec. 132.4(d)(3)(A)`,
      url: ORDINANCE_296_18.url
    },
    {
      label: 'SF General Plan, Rincon Hill Area Plan, Policy 3.4',
      url: 'https://generalplan.sfplanning.org/Rincon_Hill.htm'
    }
  ],
  method:
    '"The Tower Portion of a project shall have a horizontal separation of at least 115 feet ' +
    'from the Tower Portion of any other Tower" (Central SoMa); "Require towers to be spaced no ' +
    'less than 115 feet apart" (Rincon Hill). The as-of-right rule both share. Commission ' +
    'exceptions down to 80 to 85 ft are discretionary and not modelled. Downtown C-3 sets ' +
    'interior-lot-line setbacks (Sec. 132.1) rather than a spacing on one lot.'
};
