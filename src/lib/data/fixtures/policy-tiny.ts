import type { Provenance } from '../../timelapse/types';
import {
  HISTORIC_CODES,
  NULL_CAP,
  S207_STATUSES,
  SB79_STATUSES,
  TOD_BANDS,
  type PolicyParcels
} from '../policy-codec';
import { idsHash } from '../column-file';
import type { ScenarioParcels } from '../scenario-codec';

type Tiny = Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion'>;

interface Row {
  useDistrict: number; // index into USE_DISTRICTS
  historic: (typeof HISTORIC_CODES)[number];
  todTier: number;
  todBand: (typeof TOD_BANDS)[number];
  sb79: (typeof SB79_STATUSES)[number];
  sb79Stories: number;
  sb79Cap: number;
  s207: (typeof S207_STATUSES)[number];
  currentStories: number;
  currentCap: number;
  hostableSb79: number;
  hostableCurrent: number;
  currentFromS207: number;
  exemptPermanent: number;
  exemptTemporary: number;
}

const USE_DISTRICTS = ['', 'NC-2', 'RH-2', 'RM-1'];
// Fixture values only (tier 4, made up for the codec tests): not data. Six rows: one per
// SB79_STATUSES value, and six of the nine S207_STATUSES values. Row 0 has currentFromS207; row 1
// has historic A* (protected); row 2 historic B (not protected) and a permanent
// exemption; row 3 a temporary exemption; row 4 historic A.
const ROWS: Row[] = [
  {
    useDistrict: 1,
    historic: '',
    todTier: 1,
    todBand: 'quarter',
    sb79: 'applies',
    sb79Stories: 8,
    sb79Cap: 30,
    s207: 'applies',
    currentStories: 6,
    currentCap: 20,
    hostableSb79: 1,
    hostableCurrent: 1,
    currentFromS207: 1,
    exemptPermanent: 0,
    exemptTemporary: 0
  },
  {
    useDistrict: 2,
    historic: 'A*',
    todTier: 0,
    todBand: 'none',
    sb79: 'outside',
    sb79Stories: 0,
    sb79Cap: NULL_CAP,
    s207: 'outside',
    currentStories: 4,
    currentCap: NULL_CAP,
    hostableSb79: 0,
    hostableCurrent: 1,
    currentFromS207: 0,
    exemptPermanent: 0,
    exemptTemporary: 0
  },
  {
    useDistrict: 2,
    historic: 'B',
    todTier: 2,
    todBand: 'half',
    sb79: 'not-eligible',
    sb79Stories: 0,
    sb79Cap: NULL_CAP,
    s207: 'exempt',
    currentStories: 3,
    currentCap: 12,
    hostableSb79: 0,
    hostableCurrent: 1,
    currentFromS207: 0,
    exemptPermanent: 1,
    exemptTemporary: 0
  },
  {
    useDistrict: 3,
    historic: 'C',
    todTier: 1,
    todBand: 'adjacent',
    sb79: 'zone',
    sb79Stories: 0,
    sb79Cap: NULL_CAP,
    s207: 'not-residential',
    currentStories: 2,
    currentCap: 8,
    hostableSb79: 0,
    hostableCurrent: 0,
    currentFromS207: 0,
    exemptPermanent: 0,
    exemptTemporary: 1
  },
  {
    useDistrict: 3,
    historic: 'A',
    todTier: 2,
    todBand: 'quarter',
    sb79: 'rent-control',
    sb79Stories: 0,
    sb79Cap: NULL_CAP,
    s207: 'historic',
    currentStories: 2,
    currentCap: 6,
    hostableSb79: 0,
    hostableCurrent: 0,
    currentFromS207: 0,
    exemptPermanent: 0,
    exemptTemporary: 0
  },
  {
    useDistrict: 0,
    historic: '',
    todTier: 1,
    todBand: 'half',
    sb79: 'min-units',
    sb79Stories: 0,
    sb79Cap: NULL_CAP,
    s207: 'meets-minimum',
    currentStories: 1,
    currentCap: NULL_CAP,
    hostableSb79: 0,
    hostableCurrent: 1,
    currentFromS207: 0,
    exemptPermanent: 0,
    exemptTemporary: 0
  }
];

const prov = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [{ label: 'policy-tiny fixture', url: 'https://example.org/fixture' }],
  method: 'Hand-written codec fixture; not data.'
});

/** One policy row per parcel of `tiny` (which must have 6 parcels). */
export function policyTiny(tiny: Tiny): PolicyParcels {
  const n = ROWS.length;
  if (tiny.count !== n) throw new Error(`policyTiny has ${n} rows, parcels have ${tiny.count}`);
  const u8 = (pick: (r: Row) => number) => Uint8Array.from(ROWS, pick);
  const u16 = (pick: (r: Row) => number) => Uint16Array.from(ROWS, pick);
  return {
    format: 'sfh-policy/2',
    datasetVersion: tiny.datasetVersion,
    count: n,
    idsHash: idsHash(tiny.id),
    currentLawRule: 'fzp+s207.11',
    tierSource: 'gtfs',
    useDistricts: USE_DISTRICTS,
    provenance: {
      useDistrict: prov('Use district'),
      historic: prov('Historic'),
      exemptions: prov('Exemptions'),
      sb79: prov('SB 79'),
      currentLaw: prov('Current law')
    },
    useDistrict: u16((r) => r.useDistrict),
    historic: u8((r) => HISTORIC_CODES.indexOf(r.historic)),
    todTier: u8((r) => r.todTier),
    todBand: u8((r) => TOD_BANDS.indexOf(r.todBand)),
    sb79Status: u8((r) => SB79_STATUSES.indexOf(r.sb79)),
    sb79Stories: u8((r) => r.sb79Stories),
    sb79Cap: u16((r) => r.sb79Cap),
    s207Status: u8((r) => S207_STATUSES.indexOf(r.s207)),
    currentStories: u8((r) => r.currentStories),
    currentCap: u16((r) => r.currentCap),
    hostableSb79: u8((r) => r.hostableSb79),
    hostableCurrent: u8((r) => r.hostableCurrent),
    currentFromS207: u8((r) => r.currentFromS207),
    exemptPermanent: u8((r) => r.exemptPermanent),
    exemptTemporary: u8((r) => r.exemptTemporary),
    historicProtected: u8((r) => (r.historic === 'A' || r.historic === 'A*' ? 1 : 0))
  };
}
