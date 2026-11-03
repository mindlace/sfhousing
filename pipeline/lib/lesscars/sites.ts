// /lesscars freed sites: lc_site rows (84_lesscars_sites.sql) as parcel records with the zoning of
// their most permissive neighbour (spec "Freed land": "the builder picks a consistent rule, for
// example the more permissive neighbour").
//
// Builder's calls:
// - A neighbour's FZP stories are its height district's Local Program envelope on the freed
//   piece's own area, with no rent-control or hotel exclusion (a freed piece is vacant new land).
//   So localProgram = the district's R-4 flag.
// - "No cap" in chooseZoning: the Local Program, or a zoning code with no density cap in the FZP
//   period (densityCap is null whatever the lot area). The plan window (2028 on) is all FZP period.
// - `outline` is the piece in [lng, lat] (GeoJSON rings, closed), for drawing; `rec.polygon` is
//   the local-frame record the generator reads.
import type { ParcelId, ParcelRecord } from '../../../src/lib/data/parcel';
import { ringsAreaM2 } from '../../../src/lib/data/parcel-chunk';
import { envelopeRow, type EnvelopeRow } from '../../../src/lib/data/envelope-row';
import type { Day } from '../../../src/lib/timelapse/time';
import { FZP_EFFECTIVE_DAY, densityCap, fzpYieldCapOf } from '../density-caps';
import type { Duck } from '../duck';
import type { HeightDistrict } from '../heights';
import { localProgramEnvelope } from '../local-program';
import { toLocalRings } from '../rings';

export interface NeighbourZoning {
  parcelId: string;
  distM: number;
  zoningCode: string | null;
  r4: boolean;
  baseFt: number | null;
  lpFt: number | null;
  localProgram: boolean;
  fzpStories: number;
  neighborhood: string;
}

export interface FreedSite {
  /** 'lc:<projectId>:<k>' */
  siteId: string;
  projectId: string;
  rec: ParcelRecord;
  outline: [number, number][][];
  zoning: NeighbourZoning;
  /** Freed (freewayLand) parcels the site overlaps by more than 1 m², sorted; [] for ROW only. */
  parcels: ParcelId[];
  /** The site's area inside those parcels, m² (0 for ROW only). */
  parcelM2: number;
  /** The edge garage standing on the site's parcel: no homes are built there. */
  heldBy: string | null;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function uncapped(n: NeighbourZoning): boolean {
  return n.localProgram || densityCap(n.zoningCode, 1, n.r4, FZP_EFFECTIVE_DAY) === null;
}

/** The most permissive neighbour: most FZP stories, then no cap over a cap, then smaller id. */
export function chooseZoning(ns: readonly NeighbourZoning[]): NeighbourZoning {
  if (ns.length === 0) throw new Error('chooseZoning: no neighbours');
  return [...ns].sort(
    (a, b) =>
      b.fzpStories - a.fzpStories ||
      Number(uncapped(b)) - Number(uncapped(a)) ||
      cmp(a.parcelId, b.parcelId)
  )[0];
}

interface SiteRow {
  site_id: string;
  project_id: string;
  area_m2: number;
  parcels: string[];
  parcel_m2: number;
  held_by: string | null;
  x0: number;
  y0: number;
  lng: number;
  lat: number;
  geojson7131: string;
  geojson4326: string;
}
interface NeighbourRow {
  site_id: string;
  parcel_id: string;
  dist_m: number;
  zoning_code: string | null;
  kind: string;
  district: string;
  base_ft: number | null;
  lp_ft: number | null;
  r4: boolean;
  neighborhood: string;
}

type Geom =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;

/** Outline rings in [lng, lat], rounded to 1e-7° so the published file is platform-stable. */
const lngLatRings = (g: Geom): [number, number][][] =>
  (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()).map((r) =>
    r.map((p) => [round7(p[0]), round7(p[1])] as [number, number])
  );

/**
 * Every lc_site row as a freed site, sorted by siteId. Needs carveFreedLand and the scenario SQL
 * (sc_district, sc_zoning) on `db`. `capDay` is unused by the record itself; it is the day the
 * caller caps on (freedFzpRow), kept here so a later reader can read caps with the sites.
 */
export async function readFreedSites(db: Duck, capDay: Day): Promise<FreedSite[]> {
  void capDay;
  const sites = await db.all<SiteRow>(
    `SELECT site_id, project_id, area_m2, parcels, parcel_m2, held_by, x0, y0, lng, lat,
            geojson7131, geojson4326
     FROM lc_site ORDER BY site_id`
  );
  const ns = await db.all<NeighbourRow>(
    `SELECT n.site_id, n.parcel_id, n.dist_m, z.zoning_code, d.kind, d.district, d.base_ft,
            d.lp_ft, d.r4, p.neighborhood
     FROM lc_site_neighbour n
     JOIN sc_district d ON d.id = n.parcel_id
     JOIN sc_zoning z ON z.id = n.parcel_id
     JOIN parcels p ON p.id = n.parcel_id
     ORDER BY n.site_id, n.parcel_id`
  );
  const bySite = new Map<string, NeighbourRow[]>();
  for (const n of ns) {
    const l = bySite.get(n.site_id);
    if (l) l.push(n);
    else bySite.set(n.site_id, [n]);
  }
  const out = sites.map((s): FreedSite => {
    const polygon = toLocalRings(JSON.parse(s.geojson7131), s.x0, s.y0);
    const areaM2 = ringsAreaM2(polygon);
    const zs = (bySite.get(s.site_id) ?? []).map((n): NeighbourZoning => {
      const district: HeightDistrict =
        n.kind === 'height' && n.base_ft !== null
          ? { kind: 'height', baseFt: n.base_ft, lpFt: n.lp_ft, r4: n.r4, normalised: n.district }
          : { kind: 'none' };
      const env = localProgramEnvelope({ district, lotAreaM2: areaM2, excluded: false });
      return {
        parcelId: n.parcel_id,
        distM: n.dist_m,
        zoningCode: n.zoning_code,
        r4: n.r4,
        baseFt: n.base_ft,
        lpFt: n.lp_ft,
        localProgram: env.localProgram,
        fzpStories: env.envelopeStories,
        neighborhood: n.neighborhood
      };
    });
    if (zs.length === 0) throw new Error(`lesscars: site ${s.site_id} has no neighbour`);
    const zoning = chooseZoning(zs);
    return {
      siteId: s.site_id,
      projectId: s.project_id,
      rec: {
        id: s.site_id,
        polygon,
        labelPoint: [s.lng, s.lat],
        areaM2,
        existingUnits: 0,
        existingFloorAreaM2: 0,
        existingHeightM: 0,
        landUse: 'VACANT',
        eligible: true,
        neighborhood: zoning.neighborhood
      },
      outline: lngLatRings(JSON.parse(s.geojson4326)),
      zoning,
      parcels: [...s.parcels].sort(cmp),
      parcelM2: s.parcel_m2,
      heldBy: s.held_by
    };
  });
  return out.sort((a, b) => cmp(a.siteId, b.siteId));
}

/**
 * The FZP envelope row of a freed site: its chosen neighbour's FZP stories, capped by
 * fzpYieldCapOf on the piece's own area on `capDay`, no existing homes, always eligible.
 */
export function freedFzpRow(
  site: FreedSite,
  capDay: Day,
  grossAt: (stories: number) => number
): EnvelopeRow {
  const z = site.zoning;
  return envelopeRow({
    stories: z.fzpStories,
    cap: fzpYieldCapOf(z.zoningCode, site.rec.areaM2, z.r4, z.localProgram, capDay),
    eligible: true,
    existingUnits: 0,
    grossAt
  });
}
