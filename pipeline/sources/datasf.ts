import { type LockEntry, type LockFile } from '../lib/lock';
import { storeBytes } from '../lib/raw';
import type { Http } from '../lib/http';

export type { Http };

export type DatasfId =
  | 'datasf-parcels'
  | 'datasf-landuse-2023'
  | 'datasf-footprints'
  | 'datasf-neighborhoods'
  | 'datasf-permits-newcon'
  | 'datasf-planning-projects'
  | 'datasf-planning-records'
  | 'datasf-planning-review'
  | 'datasf-unit-completions'
  | 'datasf-housing-production'
  | 'datasf-dev-pipeline'
  | 'datasf-height-bulk'
  | 'datasf-parcel-attrs'
  | 'datasf-assessor-roll';

export const DATASF: Record<
  DatasfId,
  {
    dataset: string;
    /**
     * SODA export format. `geojson` pages are FeatureCollections; `json` pages are bare row
     * arrays; `csv` pages are header plus rows.
     */
    format: 'geojson' | 'json' | 'csv';
    select: string;
    where?: string;
    license: string;
    homepage: string;
    label: string;
  }
> = {
  'datasf-parcels': {
    dataset: 'acdm-wktn',
    format: 'geojson',
    select: 'mapblklot,blklot,active,analysis_neighborhood,shape',
    where: 'active=true',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/acdm-wktn',
    label: 'DataSF Parcels (Active and Retired)'
  },
  'datasf-landuse-2023': {
    dataset: 'fdfd-xptc',
    format: 'geojson',
    select: 'mapblklot,landuse,resunits,res,totalcomm,the_geom',
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/fdfd-xptc',
    label: 'DataSF Land Use 2023'
  },
  'datasf-footprints': {
    dataset: 'ynuv-fyni',
    format: 'geojson',
    select: 'mblr,sf16_bldgid,hgt_median_m,shape',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/ynuv-fyni',
    label: 'DataSF Building Footprints'
  },
  'datasf-neighborhoods': {
    dataset: 'j2bu-swwd',
    format: 'geojson',
    select: 'nhood,the_geom',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/j2bu-swwd',
    label: 'DataSF Analysis Neighborhoods'
  },
  'datasf-permits-newcon': {
    dataset: 'i98e-djp9',
    format: 'json',
    select:
      'permit_number,permit_type,block,lot,street_number,street_name,street_suffix,status,status_date,filed_date,permit_creation_date,issued_date,first_construction_document_date,completed_date,last_permit_activity_date,number_of_proposed_stories,existing_units,proposed_units,site_permit,primary_address_flag',
    where: "permit_type in('1','2')",
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/i98e-djp9',
    label: 'DataSF Building Permits (new construction)'
  },
  'datasf-planning-projects': {
    dataset: 'qvu5-m3a2',
    format: 'json',
    select:
      'record_id,record_status,project_address,block,lot,open_date,close_date,building_permits,project_decision,project_decision_date,number_of_units_prop,number_of_units_exist,new_construction,sb35,housing_sustainability_dist,ab2162,description',
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/qvu5-m3a2',
    label: 'DataSF Planning Projects'
  },
  'datasf-planning-records': {
    dataset: 'y673-d69b',
    format: 'json',
    select: 'record_id,record_type,record_status,block,lot,parent_id,open_date,close_date',
    where:
      "record_type in('PPA','ENV','CUA','VAR','DNX','ENX','OFA','AHB','PHA','DVA','COA','PTA','MAP','PCA','GPA','CTZ','DRP','DRM')",
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/y673-d69b',
    label: 'DataSF Planning Records'
  },
  'datasf-planning-review': {
    dataset: 'd4jk-jw33',
    format: 'json',
    select: 'b1_alt_id,start_event_type,start_event_date,end_event_type,end_event_date',
    where: "project_stage='accepted to approved'",
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/d4jk-jw33',
    label: 'DataSF Planning Review Time Metrics'
  },
  'datasf-unit-completions': {
    dataset: 'j67f-aayr',
    format: 'json',
    select: 'building_permit_application,date_issued,document_type,number_of_units_certified',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/j67f-aayr',
    label: 'DataSF Dwelling Unit Completions'
  },
  'datasf-housing-production': {
    dataset: 'xdht-4php',
    format: 'json',
    select: 'bpa,blocklot,form_no,net_units_completed,first_completion_date',
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/xdht-4php',
    label: 'DataSF Housing Production'
  },
  'datasf-dev-pipeline': {
    dataset: '6jgi-cpb4',
    format: 'json',
    select:
      'blklot,nameaddr,current_status,current_status_date,approved_date_planning,case_no,bpa_no,new_pipeline_units,existing_units,proposed_units,completed_new_units,net_pipeline_units,description_planning,da',
    license: 'CC0-1.0',
    homepage: 'https://data.sf.gov/d/6jgi-cpb4',
    label: 'DataSF SF Development Pipeline'
  },
  // Scenario-data spec §4.1.
  'datasf-height-bulk': {
    dataset: 'h9wh-cg3m',
    select: 'height,gen_hght,the_geom',
    format: 'geojson',
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/h9wh-cg3m',
    label: 'DataSF Zoning Map – Height and Bulk Districts'
  },
  'datasf-parcel-attrs': {
    dataset: 'acdm-wktn',
    select:
      'mapblklot,blklot,active,zoning_code,date_rec_add,date_rec_drop,' +
      'centroid_latitude,centroid_longitude',
    format: 'csv',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/acdm-wktn',
    label: 'DataSF Parcels (attributes, active and retired)'
  },
  'datasf-assessor-roll': {
    dataset: 'wv5m-vpq2',
    select:
      'closed_roll_year,parcel_number,use_code,property_class_code,year_property_built,' +
      'number_of_stories,number_of_units,property_area,assessed_land_value,' +
      'assessed_improvement_value,status_code',
    where: 'closed_roll_year >= 2007',
    format: 'csv',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/wv5m-vpq2',
    label: 'DataSF Assessor Historical Secured Property Tax Rolls'
  }
};

export const PAGE_SIZE = 50000;

const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;

/**
 * Data rows of a CSV body (RFC 4180 quoting): records outside quotes, minus the header. A newline
 * inside a quoted field does not end a record; blank lines and a missing final newline are fine.
 */
export function csvDataRows(body: Uint8Array): number {
  let records = 0;
  let inQuote = false;
  let pending = false;
  for (const b of body) {
    if (b === QUOTE) {
      // `""` inside a quoted field toggles twice, so the field stays quoted.
      inQuote = !inQuote;
      pending = true;
    } else if (b === LF && !inQuote) {
      if (pending) records++;
      pending = false;
    } else if (b !== CR || inQuote) {
      pending = true;
    }
  }
  if (pending) records++;
  return Math.max(0, records - 1);
}

/**
 * Spec §4.1: SODA 2 paging (`$order=:id`, `$limit=50000`, `$offset=k`) until a page comes back
 * short. Each page is one lock file saved as `<rawDir>/<sha256>` and named
 * `<id>.page-NNN.<geojson|json|csv>`. CSV row counts exclude the header.
 */
export async function fetchDatasf(
  id: DatasfId,
  rawDir: string,
  http: Http,
  pageSize: number = PAGE_SIZE
): Promise<LockEntry> {
  const d = DATASF[id];
  const format = d.format;
  const files: LockFile[] = [];
  let rowCount = 0;
  let upstreamVersion = '';
  for (let page = 0; ; page++) {
    const params = new URLSearchParams();
    params.set('$select', d.select);
    if (d.where) params.set('$where', d.where);
    params.set('$order', ':id');
    params.set('$limit', String(pageSize));
    params.set('$offset', String(page * pageSize));
    const url = `https://data.sf.gov/resource/${d.dataset}.${format}?${params}`;
    const res = await http.get(url);
    if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
    let n: number;
    if (format === 'csv') {
      n = csvDataRows(res.body);
    } else {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(res.body));
      if (format === 'json') {
        if (!Array.isArray(parsed)) throw new Error(`GET ${url}: expected a JSON array of rows`);
        n = parsed.length;
      } else {
        n = (parsed as { features: unknown[] }).features.length;
      }
    }
    if (page === 0) {
      upstreamVersion =
        res.headers.get('X-SODA2-Truth-Last-Modified') ?? res.headers.get('ETag') ?? 'unknown';
    }
    // A trailing empty page (row count an exact multiple of the page size) is not locked.
    if (n > 0 || page === 0) {
      const name = `${id}.page-${String(page).padStart(3, '0')}.${format}`;
      files.push(storeBytes(rawDir, name, url, res.body));
      rowCount += n;
    }
    if (n < pageSize) break;
  }
  return {
    id,
    files,
    retrievedAt: new Date().toISOString(),
    upstreamVersion,
    rowCount,
    license: d.license,
    label: d.label,
    homepage: d.homepage
  };
}
