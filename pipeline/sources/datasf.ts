import { type LockEntry, type LockFile } from '../lib/lock';
import { storeBytes } from '../lib/raw';
import type { Http } from '../lib/http';

export type { Http };

export type DatasfId =
  'datasf-parcels' | 'datasf-landuse-2023' | 'datasf-footprints' | 'datasf-neighborhoods';

export const DATASF: Record<
  DatasfId,
  {
    dataset: string;
    select: string;
    where?: string;
    license: string;
    homepage: string;
    label: string;
  }
> = {
  'datasf-parcels': {
    dataset: 'acdm-wktn',
    select: 'mapblklot,blklot,active,analysis_neighborhood,shape',
    where: 'active=true',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/acdm-wktn',
    label: 'DataSF Parcels (Active and Retired)'
  },
  'datasf-landuse-2023': {
    dataset: 'fdfd-xptc',
    select: 'mapblklot,landuse,resunits,res,totalcomm,the_geom',
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/fdfd-xptc',
    label: 'DataSF Land Use 2023'
  },
  'datasf-footprints': {
    dataset: 'ynuv-fyni',
    select: 'mblr,sf16_bldgid,hgt_median_m,shape',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/ynuv-fyni',
    label: 'DataSF Building Footprints'
  },
  'datasf-neighborhoods': {
    dataset: 'j2bu-swwd',
    select: 'nhood,the_geom',
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/j2bu-swwd',
    label: 'DataSF Analysis Neighborhoods'
  }
};

export const PAGE_SIZE = 50000;

/**
 * Spec §4.1: SODA 2 paging (`$order=:id`, `$limit=50000`, `$offset=k`) until a page comes back
 * short. Each page is one lock file saved as `<rawDir>/<sha256>`.
 */
export async function fetchDatasf(id: DatasfId, rawDir: string, http: Http): Promise<LockEntry> {
  const d = DATASF[id];
  const files: LockFile[] = [];
  let rowCount = 0;
  let upstreamVersion = '';
  for (let page = 0; ; page++) {
    const params = new URLSearchParams();
    params.set('$select', d.select);
    if (d.where) params.set('$where', d.where);
    params.set('$order', ':id');
    params.set('$limit', String(PAGE_SIZE));
    params.set('$offset', String(page * PAGE_SIZE));
    const url = `https://data.sf.gov/resource/${d.dataset}.geojson?${params}`;
    const res = await http.get(url);
    if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
    const n = (JSON.parse(new TextDecoder().decode(res.body)) as { features: unknown[] }).features
      .length;
    if (page === 0) {
      upstreamVersion =
        res.headers.get('X-SODA2-Truth-Last-Modified') ?? res.headers.get('ETag') ?? 'unknown';
    }
    // A trailing empty page (row count an exact multiple of the page size) is not locked.
    if (n > 0 || page === 0) {
      const name = `${id}.page-${String(page).padStart(3, '0')}.geojson`;
      files.push(storeBytes(rawDir, name, url, res.body));
      rowCount += n;
    }
    if (n < PAGE_SIZE) break;
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
