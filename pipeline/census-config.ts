// Census and DMV sources for the car-ownership model (docs/dev/cars-data.md, verified
// 2026-11-24). The Census data API needs a key, so every source here is a file on www2.census.gov
// (summary files, relationship files, TIGER/Line, PUMS CSV): no key reaches the lock or a URL.
// One lock id per release and table group; each id's single raw file is the SF rows of the
// source, in the shape the normalisers read (see pipeline/sources/census.ts).
export const CENSUS_LICENSE = 'Public domain (U.S. Census Bureau)';
export const DMV_LICENSE = 'No restrictions on public use (California DMV, via data.ca.gov)';

/** San Francisco: FIPS state 06, county 075. */
export const SF_STATE = '06';
export const SF_COUNTY = '075';
export const SF_COUNTY_GEOID = `${SF_STATE}${SF_COUNTY}`;

const SF = 'https://www2.census.gov/programs-surveys/acs/summary_file';
const PUMS = 'https://www2.census.gov/programs-surveys/acs/data/pums';

/**
 * The ACS tables pulled at block group (estimates only; B25044's margins of error come as their
 * own entry, `ACS_MOE_TABLES`).
 */
export const ACS_TABLES = ['B25044', 'B25046', 'B25009', 'B19001', 'B25002', 'B08301'] as const;

/** ACS 5-year releases pulled, by end year. 2021 on come as table-based summary files. */
export const ACS_END_YEARS = [2009, 2013, 2019, 2020, 2021, 2022, 2023, 2024] as const;
/** The latest release that exists (2020-2024; the 2021-2025 one is not out). */
export const ACS_LATEST = 2024;

/**
 * Tables whose block-group margins of error are kept (`census-acs5-bg-moe-<year>`, table-based
 * releases only): B25044, for the car choice's effective sample sizes.
 */
export const ACS_MOE_TABLES = ['B25044'] as const;
/** Releases whose margins are pulled. */
export const ACS_MOE_END_YEARS = [2024] as const;

/** Block-group vintage of an ACS 5-year release: 2000 for 2005-2009, 2010 to 2019, then 2020. */
export function acsBgVintage(endYear: number): 2000 | 2010 | 2020 {
  return endYear <= 2009 ? 2000 : endYear <= 2019 ? 2010 : 2020;
}

export interface CensusBase {
  id: string;
  label: string;
  homepage: string;
  license: string;
}

export interface AcsSpec extends CensusBase {
  kind: 'acs';
  endYear: number;
  bgVintage: 2000 | 2010 | 2020;
  layout: 'table' | 'seq';
  /** layout 'seq': the sequence/table lookup file. */
  lookupUrl?: string;
}

/** Margins of error of `ACS_MOE_TABLES` at block group, from a table-based release. */
export interface AcsMoeSpec extends CensusBase {
  kind: 'acsmoe';
  endYear: number;
}

export interface PumaCol {
  /** Household-file column holding the PUMA code. */
  col: string;
  /** PUMA definition year of that column. */
  vintage: 2000 | 2010 | 2020;
  /** SF's PUMA codes in that vintage. */
  codes: string[];
}

export interface PumsSpec extends CensusBase {
  kind: 'pums';
  endYear: number;
  hhUrl: string;
  personUrl: string;
  /** SF is a PUMA of any listed column; a record's puma is the first column that matches. */
  pumaCols: PumaCol[];
}

export interface Sf3Spec extends CensusBase {
  kind: 'sf3';
  geoUrl: string;
  dataUrl: string;
  /** H044001 to H044015 are the last 15 cells of segment 58. */
  variables: string[];
}

export interface TigerSpec extends CensusBase {
  kind: 'tiger';
  vintage: 2000 | 2010 | 2020;
  url: string;
}

export interface XwalkSpec extends CensusBase {
  kind: 'xwalk';
  from: 2000 | 2010;
  to: 2010 | 2020;
  url: string;
  /** 'block': Census block relationship file (comma, zip); 'blkgrp': block-group file (pipe). */
  layout: 'block' | 'blkgrp';
}

/** Census tract to PUMA relationship file: which PUMA each SF tract (so block group) is in. */
export interface PumaRelSpec extends CensusBase {
  kind: 'puma';
  vintage: 2010 | 2020;
  url: string;
}

export type CensusSpec =
  AcsSpec | AcsMoeSpec | PumsSpec | Sf3Spec | TigerSpec | XwalkSpec | PumaRelSpec;

const HOME = {
  acs: 'https://www.census.gov/programs-surveys/acs/data/summary-file.html',
  pums: 'https://www.census.gov/programs-surveys/acs/microdata.html',
  sf3: 'https://www.census.gov/data/datasets/2000/dec/summary-file-3.html',
  tiger: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
  rel: 'https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.html'
};

const acs = (endYear: number): AcsSpec => ({
  kind: 'acs',
  id: `census-acs5-bg-${endYear}`,
  endYear,
  bgVintage: acsBgVintage(endYear),
  layout: endYear >= 2021 ? 'table' : 'seq',
  lookupUrl:
    endYear >= 2021
      ? undefined
      : endYear === 2009
        ? `${SF}/2009/documentation/5_year/user_tools/Sequence_Number_and_Table_Number_Lookup.txt`
        : `${SF}/${endYear}/documentation/user_tools/ACS_5yr_Seq_Table_Number_Lookup.txt`,
  label: `ACS ${endYear - 4}-${endYear} 5-year block-group tables (${ACS_TABLES.join(', ')})`,
  homepage: HOME.acs,
  license: CENSUS_LICENSE
});

const acsMoe = (endYear: number): AcsMoeSpec => ({
  kind: 'acsmoe',
  id: `census-acs5-bg-moe-${endYear}`,
  endYear,
  label: `ACS ${endYear - 4}-${endYear} 5-year block-group margins of error (${ACS_MOE_TABLES.join(', ')})`,
  homepage: HOME.acs,
  license: CENSUS_LICENSE
});

export const PUMS_2024: PumsSpec = {
  kind: 'pums',
  id: 'census-pums5-2024',
  endYear: 2024,
  hhUrl: `${PUMS}/2024/5-Year/csv_hca.zip`,
  personUrl: `${PUMS}/2024/5-Year/csv_pca.zip`,
  pumaCols: [
    {
      col: 'PUMA',
      vintage: 2020,
      codes: ['07507', '07508', '07509', '07510', '07511', '07512', '07513', '07514']
    }
  ],
  label: 'ACS 2020-2024 5-year PUMS, San Francisco households',
  homepage: HOME.pums,
  license: CENSUS_LICENSE
};

export const PUMS_2013: PumsSpec = {
  kind: 'pums',
  id: 'census-pums5-2013',
  endYear: 2013,
  hhUrl: `${PUMS}/2013/5-Year/csv_hca.zip`,
  personUrl: `${PUMS}/2013/5-Year/csv_pca.zip`,
  // 2009-2011 records carry PUMA00 (and PUMA10 -0009), 2012-2013 records PUMA10.
  pumaCols: [
    {
      col: 'PUMA10',
      vintage: 2010,
      codes: ['07501', '07502', '07503', '07504', '07505', '07506', '07507']
    },
    {
      col: 'PUMA00',
      vintage: 2000,
      codes: ['02201', '02202', '02203', '02204', '02205', '02206', '02207']
    }
  ],
  label: 'ACS 2009-2013 5-year PUMS, San Francisco households',
  homepage: HOME.pums,
  license: CENSUS_LICENSE
};

const SF3: Sf3Spec = {
  kind: 'sf3',
  id: 'census-sf3-2000-bg',
  geoUrl: 'https://www2.census.gov/census_2000/datasets/Summary_File_3/California/cageo_uf3.zip',
  dataUrl: 'https://www2.census.gov/census_2000/datasets/Summary_File_3/California/ca00058_uf3.zip',
  variables: Array.from({ length: 15 }, (_, i) => `H044${String(i + 1).padStart(3, '0')}`),
  label: '2000 Census SF3 H044 tenure by vehicles available, block groups',
  homepage: HOME.sf3,
  license: CENSUS_LICENSE
};

const tiger = (vintage: 2000 | 2010 | 2020, url: string): TigerSpec => ({
  kind: 'tiger',
  id: `census-tiger-bg-${vintage}`,
  vintage,
  url,
  label: `TIGER/Line ${vintage} block groups`,
  homepage: HOME.tiger,
  license: CENSUS_LICENSE
});

const REL = 'https://www2.census.gov/geo/docs/maps-data/data';
const xwalk = (from: 2000 | 2010, to: 2010 | 2020, url: string, layout: XwalkSpec['layout']) =>
  ({
    kind: 'xwalk',
    id: `census-xwalk-${from}-${to}`,
    from,
    to,
    url,
    layout,
    label: `Census ${from} to ${to} block-group relationship (land area)`,
    homepage: HOME.rel,
    license: CENSUS_LICENSE
  }) satisfies XwalkSpec;

const pumaRel = (vintage: 2010 | 2020, url: string): PumaRelSpec => ({
  kind: 'puma',
  id: `census-puma-${vintage}`,
  vintage,
  url,
  label: `Census ${vintage} tract to ${vintage} PUMA relationship`,
  homepage: HOME.rel,
  license: CENSUS_LICENSE
});

const ALL: CensusSpec[] = [
  ...ACS_END_YEARS.map(acs),
  ...ACS_MOE_END_YEARS.map(acsMoe),
  PUMS_2013,
  PUMS_2024,
  SF3,
  tiger(2000, 'https://www2.census.gov/geo/tiger/TIGER2010/BG/2000/tl_2010_06075_bg00.zip'),
  tiger(2010, 'https://www2.census.gov/geo/tiger/TIGER2010/BG/2010/tl_2010_06075_bg10.zip'),
  tiger(2020, 'https://www2.census.gov/geo/tiger/TIGER2020/BG/tl_2020_06_bg.zip'),
  xwalk(2000, 2010, `${REL}/rel/t00t10/TAB2000_TAB2010_ST_06_v2.zip`, 'block'),
  xwalk(2010, 2020, `${REL}/rel2020/blkgrp/tab20_blkgrp20_blkgrp10_st06.txt`, 'blkgrp'),
  pumaRel(2010, `${REL}/rel/2010_Census_Tract_to_2010_PUMA.txt`),
  pumaRel(2020, `${REL}/rel2020/2020_Census_Tract_to_2020_PUMA.txt`)
];

export const CENSUS_IDS: readonly string[] = ALL.map((s) => s.id);
export type CensusId = string;
export const CENSUS_SOURCES: Record<CensusId, CensusSpec> = Object.fromEntries(
  ALL.map((s) => [s.id, s])
);

export const acsSummaryUrl = (endYear: number, table: string): string =>
  `${SF}/${endYear}/table-based-SF/data/5YRData/acsdt5y${endYear}-${table.toLowerCase()}.dat`;
export const acsSeqDir = (endYear: number): string =>
  `${SF}/${endYear}/data/5_year_seq_by_state/California/Tracts_Block_Groups_Only`;

// California DMV light-duty registrations by ZIP (data.ca.gov, CKAN dataset below). One CSV per
// as-of year, listed by the package at fetch time; the lock entry's one raw file keeps the SF rows.
export const DMV_ID = 'ca-dmv-vehicles-zip';
export const DMV_PACKAGE_URL =
  'https://data.ca.gov/api/3/action/package_show?id=vehicle-fuel-type-count-by-zip-code';
export const DMV_SPEC: CensusBase = {
  id: DMV_ID,
  label: 'California DMV vehicle fuel type counts by ZIP code (light duty, SF ZIPs)',
  homepage: 'https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code',
  license: DMV_LICENSE
};
/** SF's ZIP codes are 941xx. */
export const DMV_ZIP_PREFIX = '941';

/** The normalised tables of the sources above; each exists only when its lock entries do. */
export const CENSUS_TABLES = [
  'src_acs_bg',
  'src_acs_bg_moe',
  'src_pums_hh',
  'src_sf3_bg',
  'src_bg_geom',
  'src_bg_xwalk',
  'src_dmv_zip',
  'src_tract_puma'
] as const;
export type CensusTable = (typeof CENSUS_TABLES)[number];

/** The table a lock id feeds. */
export function censusTableOf(id: string): CensusTable | undefined {
  if (id === DMV_ID) return 'src_dmv_zip';
  const k = CENSUS_SOURCES[id]?.kind;
  return k === 'acs'
    ? 'src_acs_bg'
    : k === 'acsmoe'
      ? 'src_acs_bg_moe'
      : k === 'pums'
        ? 'src_pums_hh'
        : k === 'sf3'
          ? 'src_sf3_bg'
          : k === 'tiger'
            ? 'src_bg_geom'
            : k === 'xwalk'
              ? 'src_bg_xwalk'
              : k === 'puma'
                ? 'src_tract_puma'
                : undefined;
}
