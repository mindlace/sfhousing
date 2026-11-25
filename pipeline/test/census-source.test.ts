import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ACS_TABLES,
  CENSUS_IDS,
  CENSUS_SOURCES,
  DMV_ID,
  acsBgVintage,
  acsSummaryUrl,
  censusTableOf
} from '../census-config';
import { openDuck, type Duck } from '../lib/duck';
import { readLock, rawPath, type Lock, type LockEntry } from '../lib/lock';
import { AS_OF_SOURCE_IDS } from '../project-records/parse';
import { fetchCensus, fetchDmv, loadCensus, normaliseCensus } from '../sources/census';
import { loadNormalised, normaliseAll } from '../sources/normalise';
import { SB79_EXEMPTIONS_CSV } from '../sources/sfbos';
import { MINI } from './helpers';

const tmp = () => mkdtempSync(join(tmpdir(), 'sfh-census-'));
const NOW = new Date('2026-11-24T12:00:00Z');

type Body = string | Uint8Array;
/** Fake Http: exact-URL routes; anything else is a 404. */
function fakeHttp(routes: Record<string, Body>) {
  const urls: string[] = [];
  return {
    urls,
    get: async (url: string) => {
      urls.push(url);
      const b = routes[url];
      return {
        status: b === undefined ? 404 : 200,
        headers: new Headers(),
        body: typeof b === 'string' ? strToU8(b) : (b ?? new Uint8Array())
      };
    }
  };
}

const zip = (name: string, text: string) => zipSync({ [name]: strToU8(text) });

/** Normalise one entry's raw file the way the build does, then load the census tables. */
async function normalised(db: Duck, entries: LockEntry[], rawDir: string) {
  const norm = tmp();
  const lock: Lock = { sources: entries };
  const rows = await normaliseCensus(db, lock, rawDir, norm);
  await loadCensus(db, norm);
  return rows;
}

async function tableExists(db: Duck, name: string): Promise<boolean> {
  const r = await db.all<{ n: number }>(
    `SELECT count(*) n FROM information_schema.tables WHERE table_name = '${name}'`
  );
  return r[0].n > 0;
}

describe('census config', () => {
  it('names every source by release and table group', () => {
    expect(CENSUS_IDS).toContain('census-acs5-bg-2024');
    expect(CENSUS_IDS).toContain('census-pums5-2024');
    expect(CENSUS_IDS).toContain('census-sf3-2000-bg');
    expect(CENSUS_IDS).toContain('census-tiger-bg-2020');
    expect(CENSUS_IDS).toContain('census-xwalk-2000-2010');
    expect(DMV_ID).toBe('ca-dmv-vehicles-zip');
  });

  it('records the public-domain licence and no API key anywhere', () => {
    for (const id of CENSUS_IDS) {
      expect(CENSUS_SOURCES[id].license).toBe('Public domain (U.S. Census Bureau)');
      expect(JSON.stringify(CENSUS_SOURCES[id])).not.toMatch(/key=|api\.census\.gov/);
    }
  });

  it('puts block groups on the decennial geography of their release', () => {
    expect(acsBgVintage(2009)).toBe(2000);
    expect(acsBgVintage(2013)).toBe(2010);
    expect(acsBgVintage(2019)).toBe(2010);
    expect(acsBgVintage(2020)).toBe(2020);
    expect(acsBgVintage(2024)).toBe(2020);
  });

  it('keeps every Census and DMV source out of the as-of sources', () => {
    for (const id of [...CENSUS_IDS, DMV_ID]) expect(AS_OF_SOURCE_IDS).not.toContain(id);
  });
});

describe('fetchCensus: ACS table-based releases', () => {
  const routes = () =>
    Object.fromEntries(
      ACS_TABLES.map((t) => [
        acsSummaryUrl(2024, t),
        `GEO_ID|${t}_E001|${t}_M001|${t}_E002|${t}_M002\n` +
          `1500000US060750101011|517|134|22|32\n` +
          `1500000US060750101012|699|151|-|14\n` +
          `1500000US060750101013|-666666666|-555555555|-|-\n` +
          `1500000US060014001001|10|2|3|1\n`
      ])
    );

  it('keeps the SF block groups and records the licence and the release', async () => {
    const dir = tmp();
    const http = fakeHttp(routes());
    const e = await fetchCensus('census-acs5-bg-2024', dir, http, NOW);
    expect(e.id).toBe('census-acs5-bg-2024');
    expect(e.license).toBe('Public domain (U.S. Census Bureau)');
    expect(e.upstreamVersion).toContain('2020-2024');
    expect(e.retrievedAt).toBe(NOW.toISOString());
    // 6 tables x (2 estimates for the first BG + 1 for the second: its "-" is not a number)
    expect(e.rowCount).toBe(ACS_TABLES.length * 3);
    expect(e.files).toHaveLength(1);
    expect(JSON.stringify(e)).not.toMatch(/key=/);
    expect(http.urls).toHaveLength(ACS_TABLES.length);
  });

  it('a non-200 throws naming the URL', async () => {
    const http = fakeHttp({});
    await expect(fetchCensus('census-acs5-bg-2024', tmp(), http, NOW)).rejects.toThrow(
      acsSummaryUrl(2024, 'B25044')
    );
  });

  it('normalises to src_acs_bg with 12-digit geoids', async () => {
    const dir = tmp();
    const e = await fetchCensus('census-acs5-bg-2024', dir, fakeHttp(routes()), NOW);
    const db = await openDuck();
    await normalised(db, [e], dir);
    const rows = await db.all<{
      release: number;
      geoid: string;
      variable: string;
      estimate: number;
    }>(`SELECT * FROM src_acs_bg WHERE variable = 'B25044_001' ORDER BY geoid`);
    expect(rows).toEqual([
      { release: 2024, geoid: '060750101011', variable: 'B25044_001', estimate: 517 },
      { release: 2024, geoid: '060750101012', variable: 'B25044_001', estimate: 699 }
    ]);
    const [bad] = await db.all<{ n: number }>(
      `SELECT count(*) n FROM src_acs_bg WHERE length(geoid) <> 12`
    );
    expect(bad.n).toBe(0);
    expect(await tableExists(db, 'src_pums_hh')).toBe(false);
    db.close();
  });
});

describe('fetchCensus: B25044 margins of error', () => {
  const routes = () => ({
    [acsSummaryUrl(2024, 'B25044')]:
      'GEO_ID|B25044_E001|B25044_M001|B25044_E003|B25044_M003\n' +
      '1500000US060750101011|517|134|22|32\n' +
      '1500000US060750101012|699|151|0|14\n' +
      '1500000US060750101013|-666666666|-555555555|-|-\n' +
      '1500000US060014001001|10|2|3|1\n'
  });

  it('keeps the SF block groups B25044 margins and normalises to src_acs_bg_moe', async () => {
    expect(CENSUS_IDS).toContain('census-acs5-bg-moe-2024');
    expect(censusTableOf('census-acs5-bg-moe-2024')).toBe('src_acs_bg_moe');
    const dir = tmp();
    const http = fakeHttp(routes());
    const e = await fetchCensus('census-acs5-bg-moe-2024', dir, http, NOW);
    expect(e.license).toBe('Public domain (U.S. Census Bureau)');
    expect(e.upstreamVersion).toContain('margins of error');
    expect(e.rowCount).toBe(4);
    expect(http.urls).toEqual([acsSummaryUrl(2024, 'B25044')]);
    const db = await openDuck();
    await normalised(db, [e], dir);
    const rows = await db.all(`SELECT * FROM src_acs_bg_moe ORDER BY geoid, variable`);
    expect(rows).toEqual([
      { release: 2024, geoid: '060750101011', variable: 'B25044_001', moe: 134 },
      { release: 2024, geoid: '060750101011', variable: 'B25044_003', moe: 32 },
      { release: 2024, geoid: '060750101012', variable: 'B25044_001', moe: 151 },
      { release: 2024, geoid: '060750101012', variable: 'B25044_003', moe: 14 }
    ]);
    db.close();
  });

  it('a file with no SF margins throws', async () => {
    const http = fakeHttp({
      [acsSummaryUrl(2024, 'B25044')]: 'GEO_ID|B25044_E001|B25044_M001\n1500000US060014001001|1|1\n'
    });
    await expect(fetchCensus('census-acs5-bg-moe-2024', tmp(), http, NOW)).rejects.toThrow(
      /no San Francisco/
    );
  });
});

describe('fetchCensus: ACS sequence-based releases', () => {
  const SEQ =
    'https://www2.census.gov/programs-surveys/acs/summary_file/2013/data/5_year_seq_by_state/California/Tracts_Block_Groups_Only';
  const lookup =
    'File ID,Table ID,Sequence Number,Line Number,Start Position,Total Cells in Table,Total Cells in Sequence,Table Title,Subject Area\n' +
    'ACSSF,B25044,0113, ,7,3 CELLS, ,TENURE BY VEHICLES AVAILABLE,Housing\n' +
    'ACSSF,B25044,0113, , ,, ,Universe:  Occupied housing units,\n' +
    'ACSSF,B25046,0113, ,10,2 CELLS, ,AGGREGATE VEHICLES,Housing\n' +
    ['B25009', 'B19001', 'B25002', 'B08301']
      .map((t, i) => `ACSSF,${t},${200 + i}, ,7,2 CELLS, ,TITLE, Housing\n`)
      .join('');
  const row = (seq: string, rec: string, cells: string[]) =>
    `ACSSF,2013e5,ca,000,${seq},${rec},${cells.join(',')}\n`;

  it('reads cells by the lookup start position at the SF block groups', async () => {
    const dir = tmp();
    const geoTxt =
      'ACSSF CA150000000001                      15000US060750101001\n' +
      'ACSSF CA150000000002                      15000US060014001001\n';
    const routes: Record<string, Body> = {
      'https://www2.census.gov/programs-surveys/acs/summary_file/2013/documentation/user_tools/ACS_5yr_Seq_Table_Number_Lookup.txt':
        lookup,
      [`${SEQ}/g20135ca.txt`]: geoTxt,
      [`${SEQ}/20135ca0113000.zip`]: zip(
        'e20135ca0113000.txt',
        row('0113', '0000001', ['458', '183', '275', '9', '1000']) +
          row('0113', '0000002', ['5', '1', '4', '1', '2'])
      )
    };
    for (let i = 0; i < 4; i++) {
      routes[`${SEQ}/20135ca0${200 + i}000.zip`] = zip(
        `e20135ca0${200 + i}000.txt`,
        row(`0${200 + i}`, '0000001', ['11', '12']) + row(`0${200 + i}`, '0000002', ['1', '2'])
      );
    }
    const e = await fetchCensus('census-acs5-bg-2013', dir, fakeHttp(routes), NOW);
    expect(e.upstreamVersion).toContain('2009-2013');
    const db = await openDuck();
    await normalised(db, [e], dir);
    const got = await db.all<{ geoid: string; variable: string; estimate: number }>(
      `SELECT geoid, variable, estimate FROM src_acs_bg WHERE variable LIKE 'B2504%' ORDER BY variable`
    );
    expect(got).toEqual([
      { geoid: '060750101001', variable: 'B25044_001', estimate: 458 },
      { geoid: '060750101001', variable: 'B25044_002', estimate: 183 },
      { geoid: '060750101001', variable: 'B25044_003', estimate: 275 },
      { geoid: '060750101001', variable: 'B25046_001', estimate: 9 },
      { geoid: '060750101001', variable: 'B25046_002', estimate: 1000 }
    ]);
    db.close();
  });
});

describe('fetchCensus: PUMS', () => {
  const HH13 =
    'PUMA00,PUMA10,SERIALNO,WGTP,VEH,MV,NP,HINCP,ADJINC,TEN,YBL\n' +
    '-0009,07501,A1,10,2,3,03,100000,1085467,1,02\n' +
    '02203,-0009,A2,5,0,4,01,20000,1085467,3,05\n' +
    '-0009,06101,B1,7,1,3,02,50000,1085467,1,01\n' +
    '-0009,07502,V1,4,,,,,1085467,,02\n';
  const PERSON13 = 'SERIALNO,ESR\nA1,1\nA1,6\nA1,2\nA2,3\nA2,\nB1,1\n';
  const spec = CENSUS_SOURCES['census-pums5-2013'];
  if (spec.kind !== 'pums') throw new Error('pums spec');

  it('keeps SF occupied households on either PUMA vintage and counts workers per household', async () => {
    const dir = tmp();
    const http = fakeHttp({
      [spec.hhUrl]: zip('ss13hca.csv', HH13),
      [spec.personUrl]: zip('ss13pca.csv', PERSON13)
    });
    const e = await fetchCensus('census-pums5-2013', dir, http, NOW);
    expect(e.license).toBe('Public domain (U.S. Census Bureau)');
    expect(e.upstreamVersion).toContain('2009-2013');
    expect(e.rowCount).toBe(2);
    const db = await openDuck();
    await normalised(db, [e], dir);
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM src_pums_hh ORDER BY serialno`
    );
    expect(rows).toEqual([
      {
        release: 2013,
        puma: '07501',
        serialno: 'A1',
        wgtp: 10,
        veh: 2,
        mv: 3,
        np: 3,
        workers: 2,
        hincp_adj: 108547,
        ten: 1,
        ybl: 2,
        puma_vintage: 2010,
        ybl_src: 'YBL'
      },
      {
        release: 2013,
        puma: '02203',
        serialno: 'A2',
        wgtp: 5,
        veh: 0,
        mv: 4,
        np: 1,
        workers: 0,
        hincp_adj: 21709,
        ten: 3,
        ybl: 5,
        puma_vintage: 2000,
        ybl_src: 'YBL'
      }
    ]);
    db.close();
  });

  it('reads YRBLT when the file has no YBL (2020-2024)', async () => {
    const s = CENSUS_SOURCES['census-pums5-2024'];
    if (s.kind !== 'pums') throw new Error('pums spec');
    const dir = tmp();
    const http = fakeHttp({
      [s.hhUrl]: zip(
        'psam_h06.csv',
        'PUMA,SERIALNO,WGTP,VEH,MV,NP,HINCP,ADJINC,TEN,YRBLT\n07508,2020HU1,6,3,4,4,1130000,1222017,1,2000\n06501,2020HU2,6,3,4,4,1,1222017,1,2000\n'
      ),
      [s.personUrl]: zip('psam_p06.csv', 'SERIALNO,ESR\n2020HU1,1\n2020HU1,4\n')
    });
    const e = await fetchCensus('census-pums5-2024', dir, http, NOW);
    const db = await openDuck();
    await normalised(db, [e], dir);
    const [r] = await db.all<Record<string, unknown>>(`SELECT * FROM src_pums_hh`);
    expect(r).toMatchObject({
      release: 2024,
      puma: '07508',
      puma_vintage: 2020,
      workers: 2,
      ybl: 2000,
      ybl_src: 'YRBLT',
      hincp_adj: 1380879
    });
    db.close();
  });
});

describe('fetchCensus: 2000 SF3, crosswalks, TIGER', () => {
  /** A 2000 SF3 geography line: fixed columns, state at 29, county at 31, tract at 55. */
  const geoLine = (sumlev: string, rec: string, county: string, tract: string, bg: string) => {
    const a = Array(80).fill(' ');
    const put = (at: number, s: string) => [...s].forEach((c, i) => (a[at + i] = c));
    put(0, 'uSF3  CA');
    put(8, sumlev);
    put(11, '00');
    put(13, '000');
    put(18, rec);
    put(29, '06');
    put(31, county);
    put(55, tract);
    put(61, bg);
    return a.join('').trimEnd();
  };
  const cells = (n0: number) =>
    Array.from({ length: 216 }, (_, i) => (i >= 201 ? n0 + i - 201 : 0));

  it('reads H044 as the last 15 cells at the SF block groups', async () => {
    const spec = CENSUS_SOURCES['census-sf3-2000-bg'];
    if (spec.kind !== 'sf3') throw new Error('sf3 spec');
    const dir = tmp();
    const http = fakeHttp({
      [spec.geoUrl]: zip(
        'cageo.uf3',
        [
          geoLine('150', '0006935', '075', '010100', '1'),
          geoLine('150', '0006936', '001', '400100', '1'),
          geoLine('140', '0006937', '075', '010100', ' ')
        ].join('\n') + '\n'
      ),
      [spec.dataUrl]: zip(
        'ca00058.uf3',
        ['0006935', '0006936', '0006937']
          .map((r, i) => `uSF3,CA,000,58,${r},${cells(100 * (i + 1)).join(',')}`)
          .join('\n') + '\n'
      )
    });
    const e = await fetchCensus('census-sf3-2000-bg', dir, http, NOW);
    expect(e.rowCount).toBe(15);
    const db = await openDuck();
    await normalised(db, [e], dir);
    const rows = await db.all<{ geoid: string; variable: string; value: number }>(
      `SELECT * FROM src_sf3_bg ORDER BY variable`
    );
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({ geoid: '060750101001', variable: 'H044001', value: 100 });
    expect(rows[14]).toEqual({ geoid: '060750101001', variable: 'H044015', value: 114 });
    db.close();
  });

  it('turns block relationship files into land-area weights per block group', async () => {
    const spec = CENSUS_SOURCES['census-xwalk-2000-2010'];
    if (spec.kind !== 'xwalk') throw new Error('xwalk spec');
    const hdr =
      'STATE_2000,COUNTY_2000,TRACT_2000,BLK_2000,BLKSF_2000,AREALAND_2000,AREAWATER_2000,BLOCK_PART_FLAG_O,STATE_2010,COUNTY_2010,TRACT_2010,BLK_2010,BLKSF_2010,AREALAND_2010,AREAWATER_2010,BLOCK_PART_FLAG_R,AREALAND_INT,AREAWATER_INT';
    const dir = tmp();
    const http = fakeHttp({
      [spec.url]: zip(
        'TAB.txt',
        [
          hdr,
          '06,075,010100,1000,,300,0,p,06,075,010100,1000,,100,0,,100,0',
          '06,075,010100,1001,,300,0,p,06,075,010101,2000,,200,0,,200,0',
          '06,001,400100,1000,,500,0,p,06,001,400100,1000,,500,0,,500,0'
        ]
          .map((l) => l.padEnd(200))
          .join('\n') + '\n'
      )
    });
    const e = await fetchCensus('census-xwalk-2000-2010', dir, http, NOW);
    expect(e.rowCount).toBe(2);
    const db = await openDuck();
    await normalised(db, [e], dir);
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM src_bg_xwalk ORDER BY to_geoid`
    );
    expect(rows).toEqual([
      {
        from_vintage: 2000,
        from_geoid: '060750101001',
        to_vintage: 2010,
        to_geoid: '060750101001',
        weight: 1 / 3
      },
      {
        from_vintage: 2000,
        from_geoid: '060750101001',
        to_vintage: 2010,
        to_geoid: '060750101012',
        weight: 2 / 3
      }
    ]);
    db.close();
  });

  it('reads the block-group relationship file (BOM, pipes) for 2010 to 2020', async () => {
    const spec = CENSUS_SOURCES['census-xwalk-2010-2020'];
    if (spec.kind !== 'xwalk') throw new Error('xwalk spec');
    const hdr =
      '﻿OID_BLKGRP_20|GEOID_BLKGRP_20|NAMELSAD_BLKGRP_20|AREALAND_BLKGRP_20|AREAWATER_BLKGRP_20|MTFCC_BLKGRP_20|FUNCSTAT_BLKGRP_20|OID_BLKGRP_10|GEOID_BLKGRP_10|NAMELSAD_BLKGRP_10|AREALAND_BLKGRP_10|AREAWATER_BLKGRP_10|MTFCC_BLKGRP_10|FUNCSTAT_BLKGRP_10|AREALAND_PART|AREAWATER_PART';
    const r = (to: string, from: string, land: number) =>
      `1|${to}|x|9|0|G|S|2|${from}|x|9|0|G|S|${land}|0`;
    const dir = tmp();
    const http = fakeHttp({
      [spec.url]: [
        hdr,
        r('060750101011', '060750101001', 60),
        r('060750101012', '060750101001', 20),
        r('060750101013', '060750101001', 20),
        r('060014001001', '060014001001', 5)
      ].join('\n')
    });
    const e = await fetchCensus('census-xwalk-2010-2020', dir, http, NOW);
    expect(e.rowCount).toBe(3);
    const db = await openDuck();
    await normalised(db, [e], dir);
    const w = await db.all<{ weight: number }>(`SELECT weight FROM src_bg_xwalk ORDER BY to_geoid`);
    expect(w.map((x) => x.weight)).toEqual([0.6, 0.2, 0.2]);
    db.close();
  });

  it('keeps the TIGER zip byte for byte, counts SF block groups and reads them as EPSG:7131', async () => {
    const spec = CENSUS_SOURCES['census-tiger-bg-2020'];
    if (spec.kind !== 'tiger') throw new Error('tiger spec');
    const work = tmp();
    const db = await openDuck();
    // A two-feature state file (one SF, one Alameda) written as a real shapefile.
    await db.run(
      `COPY (SELECT * FROM (VALUES
          ('06','075','060750101001', 876543::BIGINT, ST_GeomFromText('POLYGON((-122.43 37.77,-122.42 37.77,-122.42 37.78,-122.43 37.78,-122.43 37.77))')),
          ('06','001','060014001001', 5::BIGINT, ST_GeomFromText('POLYGON((-122.2 37.8,-122.19 37.8,-122.19 37.81,-122.2 37.81,-122.2 37.8))'))
        ) t(STATEFP, COUNTYFP, GEOID, ALAND, geom))
       TO '${join(work, 'bg.shp')}' (FORMAT GDAL, DRIVER 'ESRI Shapefile', SRS 'EPSG:4269')`
    );
    const parts: Record<string, Uint8Array> = {};
    for (const ext of ['shp', 'shx', 'dbf', 'prj']) {
      parts[`tl_2020_06_bg.${ext}`] = readFileSync(join(work, `bg.${ext}`));
    }
    const bytes = zipSync(parts);
    const dir = tmp();
    const e = await fetchCensus('census-tiger-bg-2020', dir, fakeHttp({ [spec.url]: bytes }), NOW);
    expect(e.rowCount).toBe(1);
    expect(e.files[0].bytes).toBe(bytes.length);
    await normalised(db, [e], dir);
    const rows = await db.all<{ vintage: number; geoid: string; x: number; aland: number }>(
      `SELECT vintage, geoid, ST_X(ST_Centroid(geom)) x, aland FROM src_bg_geom`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vintage).toBe(2020);
    expect(rows[0].geoid).toBe('060750101001');
    // TIGER's land area (m²), the zones' area for the car model's density.
    expect(rows[0].aland).toBe(876543);
    // EPSG:7131 is in metres, a few thousand to the east of its origin in SF
    expect(Math.abs(rows[0].x)).toBeGreaterThan(1000);
    db.close();
  });
});

describe('fetchCensus: tract to PUMA relationship files', () => {
  it('keeps the SF tracts with their PUMA, keyed by vintage', async () => {
    const spec = CENSUS_SOURCES['census-puma-2020'];
    if (spec.kind !== 'puma') throw new Error('puma spec');
    const dir = tmp();
    const http = fakeHttp({
      [spec.url]:
        '\uFEFFSTATEFP,COUNTYFP,TRACTCE,PUMA5CE\r\n06,001,400100,00101\r\n' +
        '06,075,010101,07509\r\n06,075,060700,07507\r\n'
    });
    const e = await fetchCensus('census-puma-2020', dir, http, NOW);
    expect(e.rowCount).toBe(2);
    expect(e.license).toBe('Public domain (U.S. Census Bureau)');
    const db = await openDuck();
    await normalised(db, [e], dir);
    const rows = await db.all(`SELECT * FROM src_tract_puma ORDER BY tract`);
    expect(rows).toEqual([
      { vintage: 2020, tract: '06075010101', puma: '07509' },
      { vintage: 2020, tract: '06075060700', puma: '07507' }
    ]);
    db.close();
  });

  it('names a 2010 file too, and a file with no SF tracts throws', async () => {
    expect(CENSUS_IDS).toContain('census-puma-2010');
    const spec = CENSUS_SOURCES['census-puma-2010'];
    if (spec.kind !== 'puma') throw new Error('puma spec');
    const http = fakeHttp({
      [spec.url]: 'STATEFP,COUNTYFP,TRACTCE,PUMA5CE\n06,001,400100,00101\n'
    });
    await expect(fetchCensus('census-puma-2010', tmp(), http, NOW)).rejects.toThrow(
      /census-puma-2010: no San Francisco/
    );
  });
});

describe('fetchDmv', () => {
  const PKG =
    'https://data.ca.gov/api/3/action/package_show?id=vehicle-fuel-type-count-by-zip-code';
  const pkg = JSON.stringify({
    result: {
      metadata_modified: '2026-02-01T00:00:00',
      resources: [
        {
          name: '1/1/2026 Vehicle Fuel Type Count by Zip Code',
          format: 'CSV',
          url: 'https://x/2026.csv'
        },
        {
          name: '1/1/2019 Vehicle Fuel Type Count by Zip Code',
          format: 'CSV',
          url: 'https://x/2019.csv'
        },
        { name: 'Data Dictionary', format: 'PDF', url: 'https://x/dict.pdf' }
      ]
    }
  });

  it('sums light-duty vehicles by SF ZIP and as-of year', async () => {
    const dir = tmp();
    const http = fakeHttp({
      [PKG]: pkg,
      'https://x/2026.csv':
        'Date,ZIP Code,Model Year,Fuel,Make,Duty,Vehicles\n' +
        '12/31/2025,94110,2018,Gasoline,JEEP,Light,25\n' +
        '12/31/2025,94110,2019,Gasoline,KIA,Light,5\n' +
        '12/31/2025,94110,2019,Diesel,MACK,Heavy,9\n' +
        '12/31/2025,95133,2019,Gasoline,KIA,Light,7\n',
      'https://x/2019.csv':
        'Date,Zip Code,Model Year,Fuel,Make,Duty,Vehicles\n' +
        '10/1/2018,94103,2006,Gasoline,DODGE,Light,12\n' +
        '10/1/2018,94103,2006,Gasoline,OTHER/UNK,Unk,4\n'
    });
    const e = await fetchDmv(dir, http, NOW);
    expect(e.id).toBe('ca-dmv-vehicles-zip');
    expect(e.license).toMatch(/No restrictions on public use/);
    expect(e.rowCount).toBe(2);
    expect(e.upstreamVersion).toContain('2019');
    expect(e.upstreamVersion).toContain('2026');
    const db = await openDuck();
    await normalised(db, [e], dir);
    const rows = await db.all<{ year: number; zip: string; light_duty: number }>(
      `SELECT * FROM src_dmv_zip ORDER BY year`
    );
    expect(rows).toEqual([
      { year: 2019, zip: '94103', light_duty: 12 },
      { year: 2026, zip: '94110', light_duty: 30 }
    ]);
    db.close();
  });

  it('a non-200 names the URL', async () => {
    await expect(fetchDmv(tmp(), fakeHttp({}), NOW)).rejects.toThrow(PKG);
  });
});

describe('normaliseAll without census entries', () => {
  it('normalises without census entries (the fixture lock)', async () => {
    const lockWithoutCensus = readLock(join(MINI, 'sources.lock.json'));
    expect(lockWithoutCensus.sources.some((s) => s.id.startsWith('census-'))).toBe(false);
    const db = await openDuck();
    const norm = tmp();
    await normaliseAll(db, lockWithoutCensus, join(MINI, 'raw'), norm, {
      byName: true,
      exemptionsCsv: SB79_EXEMPTIONS_CSV.fixture
    });
    await loadNormalised(db, norm);
    for (const t of [
      'src_acs_bg',
      'src_pums_hh',
      'src_sf3_bg',
      'src_bg_geom',
      'src_bg_xwalk',
      'src_dmv_zip',
      'src_tract_puma'
    ]) {
      expect(await tableExists(db, t)).toBe(false);
    }
    db.close();
  });

  it('creates a census table once its lock entries exist, through normaliseAll and loadNormalised', async () => {
    const dir = tmp();
    const e = await fetchCensus(
      'census-acs5-bg-2024',
      dir,
      fakeHttp(
        Object.fromEntries(
          ACS_TABLES.map((t) => [
            acsSummaryUrl(2024, t),
            `GEO_ID|${t}_E001|${t}_M001\n1500000US060750101011|5|1\n`
          ])
        )
      ),
      NOW
    );
    const lock = readLock(join(MINI, 'sources.lock.json'));
    lock.sources.push(e);
    // The mini raw files are read by name; the census raw file is by sha, so copy it in by name.
    const raw = tmp();
    cpSync(join(MINI, 'raw'), raw, { recursive: true });
    writeFileSync(join(raw, e.files[0].name), readFileSync(rawPath(dir, e.files[0])));
    const db = await openDuck();
    const norm = tmp();
    const counts = await normaliseAll(db, lock, raw, norm, {
      byName: true,
      exemptionsCsv: SB79_EXEMPTIONS_CSV.fixture
    });
    await loadNormalised(db, norm);
    expect(counts['src_acs_bg' as keyof typeof counts]).toBe(ACS_TABLES.length);
    expect(await tableExists(db, 'src_acs_bg')).toBe(true);
    expect(await tableExists(db, 'src_pums_hh')).toBe(false);
    db.close();
  });
});

describe('a fetch that finds no San Francisco rows writes no lock entry', () => {
  it('ACS: a table with no SF rows throws', async () => {
    const routes = Object.fromEntries(
      ACS_TABLES.map((t) => [
        acsSummaryUrl(2024, t),
        `GEO_ID|${t}_E001|${t}_M001\n1500000US060014001001|10|2\n`
      ])
    );
    await expect(fetchCensus('census-acs5-bg-2024', tmp(), fakeHttp(routes), NOW)).rejects.toThrow(
      /census-acs5-bg-2024.*no San Francisco rows/
    );
  });

  it('SF3: no SF block groups throws', async () => {
    const spec = CENSUS_SOURCES['census-sf3-2000-bg'];
    if (spec.kind !== 'sf3') throw new Error('sf3 spec');
    const http = fakeHttp({
      [spec.geoUrl]: zip('cageo.uf3', 'uSF3  CA04000000  0000001\n'),
      [spec.dataUrl]: zip('ca00058.uf3', 'uSF3,CA,000,58,0000001,1,2\n')
    });
    await expect(fetchCensus('census-sf3-2000-bg', tmp(), http, NOW)).rejects.toThrow(
      /census-sf3-2000-bg: no San Francisco block-group rows/
    );
  });

  it('PUMS: no SF households, and a missing column, throw', async () => {
    const spec = CENSUS_SOURCES['census-pums5-2024'];
    if (spec.kind !== 'pums') throw new Error('pums spec');
    const person = zip('psam_p06.csv', 'SERIALNO,ESR\n');
    const none = fakeHttp({
      [spec.hhUrl]: zip(
        'psam_h06.csv',
        'PUMA,SERIALNO,WGTP,VEH,NP,HINCP,ADJINC,TEN,YRBLT\n06501,X,1,1,1,1,1,1,2000\n'
      ),
      [spec.personUrl]: person
    });
    await expect(fetchCensus('census-pums5-2024', tmp(), none, NOW)).rejects.toThrow(
      /no occupied San Francisco households/
    );
    const noCol = fakeHttp({
      [spec.hhUrl]: zip('psam_h06.csv', 'PUMA,SERIALNO,WGTP,NP\n07508,X,1,1\n'),
      [spec.personUrl]: person
    });
    await expect(fetchCensus('census-pums5-2024', tmp(), noCol, NOW)).rejects.toThrow(
      /lacks column\(s\) VEH/
    );
  });

  it('DMV: a missing header column and a file with no SF ZIPs throw', async () => {
    const PKG =
      'https://data.ca.gov/api/3/action/package_show?id=vehicle-fuel-type-count-by-zip-code';
    const pkg = JSON.stringify({
      result: { resources: [{ name: '1/1/2026 x', format: 'CSV', url: 'https://x/a.csv' }] }
    });
    const badHeader = fakeHttp({
      [PKG]: pkg,
      'https://x/a.csv': 'Date,Zip,Duty,Vehicles\n1,94110,Light,5\n'
    });
    await expect(fetchDmv(tmp(), badHeader, NOW)).rejects.toThrow(/lacks column\(s\) zip code/);
    const noSf = fakeHttp({
      [PKG]: pkg,
      'https://x/a.csv': 'Date,Zip Code,Duty,Vehicles\n1,95133,Light,5\n'
    });
    await expect(fetchDmv(tmp(), noSf, NOW)).rejects.toThrow(/no light-duty rows/);
  });
});
