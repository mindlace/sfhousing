import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { RunFn } from '../lib/r2';
import type { R2Target } from '../lib/r2';
import type { Lock } from '../lib/lock';
import { DATASF, fetchDatasf, type DatasfId } from '../sources/datasf';
import { fetchGtfs } from '../sources/gtfs';
import { latestOvertureRelease } from '../sources/overture';
import { fetchBasemap } from '../sources/protomaps';
import { restoreRaw } from '../steps/fetch';

function fakeHttp(pageSizes: number[]) {
  const urls: string[] = [];
  return {
    urls,
    get: async (url: string) => {
      urls.push(url);
      const k = urls.length - 1;
      const n = pageSizes[k] ?? 0;
      const fc = {
        type: 'FeatureCollection',
        features: Array.from({ length: n }, (_, i) => ({
          type: 'Feature',
          properties: { mapblklot: `${k}-${i}` },
          geometry: null
        }))
      };
      return {
        status: 200,
        headers: new Headers({ 'X-SODA2-Truth-Last-Modified': 'Tue, 07 Oct 2026 10:00:00 GMT' }),
        body: new TextEncoder().encode(JSON.stringify(fc))
      };
    }
  };
}

function fakeJsonHttp(pageSizes: number[]) {
  const urls: string[] = [];
  return {
    urls,
    get: async (url: string) => {
      urls.push(url);
      const n = pageSizes[urls.length - 1] ?? 0;
      const rows = Array.from({ length: n }, (_, i) => ({ record_id: `${urls.length}-${i}` }));
      return {
        status: 200,
        headers: new Headers({ 'X-SODA2-Truth-Last-Modified': 'Tue, 07 Oct 2026 10:00:00 GMT' }),
        body: new TextEncoder().encode(JSON.stringify(rows))
      };
    }
  };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'sfh-raw-'));

/** SODA CSV pages (quoted header + rows, trailing newline), one body per request. */
function fakeCsvHttp(bodies: string[]) {
  const urls: string[] = [];
  return {
    urls,
    get: async (url: string) => {
      urls.push(url);
      return {
        status: 200,
        headers: new Headers({ 'X-SODA2-Truth-Last-Modified': 'Wed, 15 Oct 2026 10:00:00 GMT' }),
        body: new TextEncoder().encode(bodies[urls.length - 1] ?? bodies[bodies.length - 1])
      };
    }
  };
}
const ROLL_HEADER =
  '"closed_roll_year","parcel_number","use_code","property_class_code","year_property_built",' +
  '"number_of_stories","number_of_units","property_area","assessed_land_value",' +
  '"assessed_improvement_value","status_code"\n';
const rollRow = (p: string) =>
  `"2025","${p}","SRES","D","1950","1.0","1.0","1000.0","300000.0","100000.0","NA"\n`;

describe('fetchDatasf', () => {
  it('pages with $order=:id/$limit/$offset until a short page, filters active parcels and locks each page', async () => {
    const http = fakeHttp([50000, 50000, 12]);
    const raw = tmp();
    const entry = await fetchDatasf('datasf-parcels', raw, http);
    expect(http.urls).toHaveLength(3);
    const u = new URL(http.urls[1]);
    expect(u.host).toBe('data.sf.gov');
    expect(u.pathname).toBe('/resource/acdm-wktn.geojson');
    expect(u.searchParams.get('$offset')).toBe('50000');
    expect(u.searchParams.get('$order')).toBe(':id');
    expect(u.searchParams.get('$where')).toBe('active=true');
    expect(entry.files).toHaveLength(3);
    expect(entry.rowCount).toBe(100012);
    expect(entry.upstreamVersion).toBe('Tue, 07 Oct 2026 10:00:00 GMT');
    expect(entry.license).toBe('PDDL-1.0');
    expect(readFileSync(join(raw, entry.files[2].sha256), 'utf8')).toContain('"2-11"');
  });

  it('names pages, records sha256/bytes/archiveKey and selects the live column names', async () => {
    const raw = tmp();
    const entry = await fetchDatasf('datasf-footprints', raw, fakeHttp([3]));
    const f = entry.files[0];
    expect(f.name).toBe('datasf-footprints.page-000.geojson');
    expect(f.archiveKey).toBe(`sources/${f.sha256}.geojson`);
    const bytes = readFileSync(join(raw, f.sha256));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
    expect(f.bytes).toBe(bytes.length);
    const u = new URL(f.url);
    expect(u.searchParams.get('$select')).toBe('mblr,sf16_bldgid,hgt_median_m,shape');
    expect(u.searchParams.get('$where')).toBeNull();
  });

  it('does not lock a trailing empty page, and fails on a non-200 status', async () => {
    const entry = await fetchDatasf('datasf-neighborhoods', tmp(), fakeHttp([50000, 0]));
    expect(entry.files).toHaveLength(1);
    await expect(
      fetchDatasf('datasf-neighborhoods', tmp(), {
        get: async () => ({ status: 403, headers: new Headers(), body: new Uint8Array() })
      })
    ).rejects.toThrow(/403/);
  });

  it('falls back to ETag when the truth-last-modified header is absent', async () => {
    const entry = await fetchDatasf('datasf-neighborhoods', tmp(), {
      get: async () => ({
        status: 200,
        headers: new Headers({ ETag: 'W/"abc"' }),
        body: new TextEncoder().encode('{"type":"FeatureCollection","features":[]}')
      })
    });
    expect(entry.upstreamVersion).toBe('W/"abc"');
  });

  it('CSV paging locks pages until a short page', async () => {
    const http = fakeCsvHttp([
      ROLL_HEADER + rollRow('3512001') + rollRow('3512002') + rollRow('3512003'),
      ROLL_HEADER + rollRow('3512004')
    ]);
    const raw = tmp();
    const entry = await fetchDatasf('datasf-assessor-roll', raw, http, 3);
    expect(http.urls).toHaveLength(2);
    const u = new URL(http.urls[1]);
    expect(u.pathname).toBe('/resource/wv5m-vpq2.csv');
    expect(u.searchParams.get('$order')).toBe(':id');
    expect(u.searchParams.get('$limit')).toBe('3');
    expect(u.searchParams.get('$offset')).toBe('3');
    expect(u.searchParams.get('$where')).toBe('closed_roll_year >= 2007');
    expect(u.searchParams.get('$select')).toBe(
      'closed_roll_year,parcel_number,use_code,property_class_code,year_property_built,' +
        'number_of_stories,number_of_units,property_area,assessed_land_value,' +
        'assessed_improvement_value,status_code'
    );
    expect(entry.rowCount).toBe(4);
    expect(entry.files.map((f) => f.name)).toEqual([
      'datasf-assessor-roll.page-000.csv',
      'datasf-assessor-roll.page-001.csv'
    ]);
    expect(entry.files[1].archiveKey).toBe(`sources/${entry.files[1].sha256}.csv`);
    expect(entry.license).toBe('PDDL-1.0');
    expect(entry.label).toBe('DataSF Assessor Historical Secured Property Tax Rolls');
    expect(entry.upstreamVersion).toBe('Wed, 15 Oct 2026 10:00:00 GMT');
    expect(readFileSync(join(raw, entry.files[1].sha256), 'utf8')).toContain('"3512004"');
  });

  it('a trailing empty CSV page (header only) is not locked', async () => {
    const http = fakeCsvHttp([ROLL_HEADER + rollRow('a') + rollRow('b'), ROLL_HEADER]);
    const entry = await fetchDatasf('datasf-parcel-attrs', tmp(), http, 2);
    expect(http.urls).toHaveLength(2);
    expect(new URL(http.urls[0]).pathname).toBe('/resource/acdm-wktn.csv');
    expect(new URL(http.urls[0]).searchParams.get('$where')).toBeNull();
    expect(entry.files).toHaveLength(1);
    expect(entry.rowCount).toBe(2);
    expect(entry.label).toBe('DataSF Parcels (attributes, active and retired)');
  });

  it('a quoted newline inside a field counts as one row', async () => {
    const body =
      '"mapblklot","zoning_code"\n"3512001","RH-2\nRM-1"\r\n"3512002",""\n"3512003",\n"3512004","x ""q"""';
    const entry = await fetchDatasf('datasf-parcel-attrs', tmp(), fakeCsvHttp([body]), 10);
    expect(entry.rowCount).toBe(4);
    const header = await fetchDatasf('datasf-parcel-attrs', tmp(), fakeCsvHttp(['']), 10);
    expect(header.rowCount).toBe(0);
    expect(header.files).toHaveLength(1);
  });

  it('fetches the height districts as GeoJSON with the spec labels', async () => {
    const http = fakeHttp([5]);
    const entry = await fetchDatasf('datasf-height-bulk', tmp(), http);
    const u = new URL(http.urls[0]);
    expect(u.pathname).toBe('/resource/h9wh-cg3m.geojson');
    expect(u.searchParams.get('$select')).toBe('height,gen_hght,the_geom');
    expect(entry.files[0].name).toBe('datasf-height-bulk.page-000.geojson');
    expect(entry).toMatchObject({
      rowCount: 5,
      license: 'public-domain',
      homepage: 'https://data.sf.gov/d/h9wh-cg3m',
      label: 'DataSF Zoning Map – Height and Bulk Districts'
    });
  });
});

describe('fetchDatasf json sources (spec §4.1)', () => {
  const SEVEN: Record<
    string,
    { dataset: string; select: string; where?: string; license: string; label: string }
  > = {
    'datasf-permits-newcon': {
      dataset: 'i98e-djp9',
      select:
        'permit_number,permit_type,block,lot,street_number,street_name,street_suffix,status,status_date,filed_date,permit_creation_date,issued_date,first_construction_document_date,completed_date,last_permit_activity_date,number_of_proposed_stories,existing_units,proposed_units,estimated_cost,revised_cost,site_permit,primary_address_flag',
      where: "permit_type in('1','2')",
      license: 'PDDL-1.0',
      label: 'DataSF Building Permits (new construction)'
    },
    // Ruling L1: unit-adding alterations, kept only where a PRJ names them.
    'datasf-permits-named': {
      dataset: 'i98e-djp9',
      select:
        'permit_number,permit_type,block,lot,street_number,street_name,street_suffix,status,status_date,filed_date,permit_creation_date,issued_date,first_construction_document_date,completed_date,last_permit_activity_date,number_of_proposed_stories,existing_units,proposed_units,estimated_cost,revised_cost,site_permit,primary_address_flag',
      where: "permit_type in('3','8') and proposed_units > existing_units",
      license: 'PDDL-1.0',
      label: 'DataSF Building Permits (unit-adding alterations)'
    },
    'datasf-planning-projects': {
      dataset: 'qvu5-m3a2',
      select:
        'record_id,record_status,project_address,block,lot,open_date,close_date,building_permits,project_decision,project_decision_date,number_of_units_prop,number_of_units_exist,new_construction,sb35,housing_sustainability_dist,ab2162,description',
      license: 'public-domain',
      label: 'DataSF Planning Projects'
    },
    'datasf-planning-records': {
      dataset: 'y673-d69b',
      select: 'record_id,record_type,record_status,block,lot,parent_id,open_date,close_date',
      where:
        "record_type in('PPA','ENV','CUA','VAR','DNX','ENX','OFA','AHB','PHA','DVA','COA','PTA','MAP','PCA','GPA','CTZ','DRP','DRM')",
      license: 'public-domain',
      label: 'DataSF Planning Records'
    },
    'datasf-planning-review': {
      dataset: 'd4jk-jw33',
      select: 'b1_alt_id,start_event_type,start_event_date,end_event_type,end_event_date',
      where: "project_stage='accepted to approved'",
      license: 'PDDL-1.0',
      label: 'DataSF Planning Review Time Metrics'
    },
    'datasf-unit-completions': {
      dataset: 'j67f-aayr',
      select: 'building_permit_application,date_issued,document_type,number_of_units_certified',
      license: 'PDDL-1.0',
      label: 'DataSF Dwelling Unit Completions'
    },
    'datasf-housing-production': {
      dataset: 'xdht-4php',
      select: 'bpa,blocklot,form_no,net_units_completed,first_completion_date',
      license: 'public-domain',
      label: 'DataSF Housing Production'
    },
    'datasf-dev-pipeline': {
      dataset: '6jgi-cpb4',
      select:
        'blklot,nameaddr,current_status,current_status_date,approved_date_planning,case_no,bpa_no,new_pipeline_units,existing_units,proposed_units,completed_new_units,net_pipeline_units,description_planning,da',
      license: 'CC0-1.0',
      label: 'DataSF SF Development Pipeline'
    }
  };
  const ids = Object.keys(SEVEN) as DatasfId[];

  it('json entry pages and counts array rows', async () => {
    const http = fakeJsonHttp([50000, 3]);
    const raw = tmp();
    const entry = await fetchDatasf('datasf-planning-projects', raw, http);
    expect(entry.rowCount).toBe(50003);
    expect(entry.files.map((f) => f.name)).toEqual([
      'datasf-planning-projects.page-000.json',
      'datasf-planning-projects.page-001.json'
    ]);
    expect(entry.files[0].archiveKey).toBe(`sources/${entry.files[0].sha256}.json`);
    for (const u of http.urls) {
      expect(u.startsWith('https://data.sf.gov/resource/qvu5-m3a2.json?')).toBe(true);
    }
  });

  it('urls carry the §4.1 select and where', async () => {
    for (const id of ids) {
      const http = fakeJsonHttp([1]);
      await fetchDatasf(id, tmp(), http);
      const u = new URL(http.urls[0]);
      expect(u.pathname).toBe(`/resource/${SEVEN[id].dataset}.json`);
      expect(u.searchParams.get('$select')).toBe(SEVEN[id].select);
      expect(u.searchParams.get('$where')).toBe(SEVEN[id].where ?? null);
    }
    expect(DATASF['datasf-permits-newcon'].where).toBe("permit_type in('1','2')");
    expect(DATASF['datasf-planning-review'].where).toBe("project_stage='accepted to approved'");
    expect(DATASF['datasf-planning-records'].where).toBe(
      "record_type in('PPA','ENV','CUA','VAR','DNX','ENX','OFA','AHB','PHA','DVA','COA','PTA','MAP','PCA','GPA','CTZ','DRP','DRM')"
    );
  });

  it('exactly-full json page then empty page locks only the full page', async () => {
    const entry = await fetchDatasf('datasf-dev-pipeline', tmp(), fakeJsonHttp([50000, 0]));
    expect(entry.files).toHaveLength(1);
    expect(entry.rowCount).toBe(50000);
  });

  it('rejects a 200 json response whose body is not an array', async () => {
    const url = 'https://data.sf.gov/resource/qvu5-m3a2.json';
    await expect(
      fetchDatasf('datasf-planning-projects', tmp(), {
        get: async () => ({
          status: 200,
          headers: new Headers(),
          body: new TextEncoder().encode('{"error":true}')
        })
      })
    ).rejects.toThrow(new RegExp(url.replace(/[.]/g, '\\.')));
  });

  it('licences, labels, homepages and format', () => {
    expect(
      ids.map((id) => [
        DATASF[id].license,
        DATASF[id].label,
        DATASF[id].homepage,
        DATASF[id].format
      ])
    ).toEqual(
      ids.map((id) => [
        SEVEN[id].license,
        SEVEN[id].label,
        `https://data.sf.gov/d/${SEVEN[id].dataset}`,
        'json'
      ])
    );
    expect(ids.map((id) => DATASF[id].license)).toEqual([
      'PDDL-1.0',
      'PDDL-1.0',
      'public-domain',
      'public-domain',
      'PDDL-1.0',
      'PDDL-1.0',
      'public-domain',
      'CC0-1.0'
    ]);
  });

  it('the four existing entries keep geojson format and URLs', async () => {
    for (const id of [
      'datasf-parcels',
      'datasf-landuse-2023',
      'datasf-footprints',
      'datasf-neighborhoods'
    ] as const) {
      expect(DATASF[id].format).toBe('geojson');
      const http = fakeHttp([1]);
      await fetchDatasf(id, tmp(), http);
      expect(
        http.urls[0].startsWith(`https://data.sf.gov/resource/${DATASF[id].dataset}.geojson?`)
      ).toBe(true);
    }
  });
});

describe('fetchBasemap', () => {
  it('steps back a day on a 404 and records the date that worked', async () => {
    const calls: string[] = [];
    const run: RunFn = async (cmd, args) => {
      calls.push(args[1]);
      if (args[1].includes('20261009')) {
        return { code: 1, stdout: '', stderr: 'Failed to create range reader, HTTP error: 404' };
      }
      writeFileSync(args[2], 'PMTILES');
      return { code: 0, stdout: '', stderr: '' };
    };
    const raw = tmp();
    const entry = await fetchBasemap(undefined, raw, new Date('2026-10-10T05:00:00Z'), run);
    expect(calls).toEqual([
      'https://build.protomaps.com/20261009.pmtiles',
      'https://build.protomaps.com/20261008.pmtiles'
    ]);
    expect(entry.upstreamVersion).toBe('20261008');
    expect(entry.files[0].name).toBe('protomaps-basemap.pmtiles');
    expect(entry.files[0].url).toBe('https://build.protomaps.com/20261008.pmtiles');
    expect(readFileSync(join(raw, entry.files[0].sha256), 'utf8')).toBe('PMTILES');
  });

  it('passes the bbox/maxzoom, and does not step back for non-404 failures or an explicit date', async () => {
    const seen: string[][] = [];
    const run: RunFn = async (_c, args) => {
      seen.push(args);
      return { code: 1, stdout: '', stderr: 'boom' };
    };
    await expect(
      fetchBasemap('20261001', tmp(), new Date('2026-10-10T00:00:00Z'), run)
    ).rejects.toThrow(/boom/);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('--bbox=-122.53,37.69,-122.34,37.84');
    expect(seen[0]).toContain('--maxzoom=15');
  });

  it('gives up after 7 days of 404s', async () => {
    let n = 0;
    const run: RunFn = async () => {
      n++;
      return { code: 1, stdout: '', stderr: 'HTTP error: 404' };
    };
    await expect(
      fetchBasemap(undefined, tmp(), new Date('2026-10-10T00:00:00Z'), run)
    ).rejects.toThrow(/no protomaps build/);
    expect(n).toBe(8);
  });
});

describe('latestOvertureRelease', () => {
  it('reads the `latest` field of the STAC catalog', async () => {
    const urls: string[] = [];
    const rel = await latestOvertureRelease({
      get: async (u) => {
        urls.push(u);
        return {
          status: 200,
          headers: new Headers(),
          body: new TextEncoder().encode(JSON.stringify({ latest: '2026-09-23.1', links: [] }))
        };
      }
    });
    expect(rel).toBe('2026-09-23.1');
    expect(urls).toEqual(['https://stac.overturemaps.org/catalog.json']);
  });
});

describe('restoreRaw', () => {
  const content = new TextEncoder().encode('archived bytes');
  const sha = createHash('sha256').update(content).digest('hex');
  const lock: Lock = {
    sources: [
      {
        id: 'x',
        files: [
          {
            url: 'u',
            sha256: sha,
            bytes: content.length,
            archiveKey: `sources/${sha}.geojson`,
            name: 'x.geojson'
          }
        ],
        retrievedAt: 't',
        upstreamVersion: 'v',
        rowCount: 1,
        license: 'l',
        homepage: 'h'
      }
    ]
  };
  const r2 = (bytes: Uint8Array | null): R2Target & { gets: string[] } => {
    const gets: string[] = [];
    return {
      gets,
      exists: async () => true,
      put: async () => {},
      get: async (key, file) => {
        gets.push(key);
        if (!bytes) return false;
        writeFileSync(file, bytes);
        return true;
      }
    };
  };

  it('downloads only missing files and verifies their sha256', async () => {
    const raw = tmp();
    const t = r2(content);
    const res = await restoreRaw(lock, raw, t);
    expect(res).toEqual({ restored: 1, present: 0 });
    expect(t.gets).toEqual([`sources/${sha}.geojson`]);
    expect(readFileSync(join(raw, sha), 'utf8')).toBe('archived bytes');
    const t2 = r2(content);
    expect(await restoreRaw(lock, raw, t2)).toEqual({ restored: 0, present: 1 });
    expect(t2.gets).toEqual([]);
  });

  it('rejects a corrupt archive and leaves nothing under the sha name', async () => {
    const raw = tmp();
    await expect(restoreRaw(lock, raw, r2(new TextEncoder().encode('tampered')))).rejects.toThrow(
      /sha256 mismatch/
    );
    expect(existsSync(join(raw, sha))).toBe(false);
  });

  it('reports an archive that is not in the bucket', async () => {
    await expect(restoreRaw(lock, tmp(), r2(null))).rejects.toThrow(/not found in R2/);
  });
});

describe('fetchGtfs', () => {
  it('stores the zip by sha256 and versions it from the feed', async () => {
    const zip = zipSync({
      'stops.txt': strToU8(
        'stop_id,stop_name,stop_lat,stop_lon\n1,A,37.7,-122.4\n2,B,37.7,-122.4\n'
      ),
      'stop_times.txt': strToU8('trip_id,stop_id\n'),
      'calendar.txt': strToU8(
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260901,20261231\n'
      )
    });
    const http = { get: async () => ({ status: 200, headers: new Headers(), body: zip }) };
    const raw = mkdtempSync(join(tmpdir(), 'sfh-gtfs-raw-'));
    const e = await fetchGtfs('gtfs-bart', raw, http, new Date('2026-10-14T00:00:00Z'));
    expect(e).toMatchObject({
      id: 'gtfs-bart',
      rowCount: 2,
      upstreamVersion: '20260901..20261231',
      retrievedAt: '2026-10-14T00:00:00.000Z',
      label: 'BART GTFS'
    });
    expect(e.files[0].name).toBe('gtfs-bart.zip');
  });

  it('rejects a response that is not a GTFS zip', async () => {
    const http = {
      get: async () => ({
        status: 200,
        headers: new Headers(),
        body: zipSync({ 'x.txt': strToU8('x') })
      })
    };
    await expect(fetchGtfs('gtfs-muni', tmpdir(), http)).rejects.toThrow(/not a GTFS zip/);
  });
});
