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

type Tiny = Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion' | 'fillLevels'>;

interface Row {
  useDistrict: number; // index into USE_DISTRICTS
  historic: (typeof HISTORIC_CODES)[number];
  fzpYieldCap: number;
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
  sb79Yield: number[];
  currentYield: number[];
}

const USE_DISTRICTS = ['', 'NC-2', 'RH-2', 'RM-1'];
const ZERO = [0, 0, 0, 0, 0];
// Fixture values only (tier 4, made up for the codec tests): not data. Six rows: one per
// SB79_STATUSES value, and six of the nine S207_STATUSES values. Row 0 has currentFromS207; row 1
// has no FZP cap and historic A* (protected); row 2 historic B (not protected) and a permanent
// exemption; row 3 a temporary exemption; row 4 historic A.
const ROWS: Row[] = [
  {
    useDistrict: 1,
    historic: '',
    fzpYieldCap: 40,
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
    exemptTemporary: 0,
    sb79Yield: [0, 8, 15, 24, 30],
    currentYield: [0, 6, 10, 18, 20]
  },
  {
    useDistrict: 2,
    historic: 'A*',
    fzpYieldCap: NULL_CAP,
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
    exemptTemporary: 0,
    sb79Yield: ZERO,
    currentYield: [0, 4, 6, 8, 10]
  },
  {
    useDistrict: 2,
    historic: 'B',
    fzpYieldCap: 12,
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
    exemptTemporary: 0,
    sb79Yield: ZERO,
    currentYield: [0, 3, 6, 9, 12]
  },
  {
    useDistrict: 3,
    historic: 'C',
    fzpYieldCap: 8,
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
    exemptTemporary: 1,
    sb79Yield: ZERO,
    currentYield: ZERO
  },
  {
    useDistrict: 3,
    historic: 'A',
    fzpYieldCap: 6,
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
    exemptTemporary: 0,
    sb79Yield: ZERO,
    currentYield: ZERO
  },
  {
    useDistrict: 0,
    historic: '',
    fzpYieldCap: NULL_CAP,
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
    exemptTemporary: 0,
    sb79Yield: ZERO,
    currentYield: [0, 0, 2, 3, 4]
  }
];

const prov = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [{ label: 'policy-tiny fixture', url: 'https://example.org/fixture' }],
  method: 'Hand-written codec fixture; not data.'
});

/** One policy row per parcel of `tiny` (which must have 6 parcels and 5 fill levels). */
export function policyTiny(tiny: Tiny): PolicyParcels {
  const n = ROWS.length;
  const f = tiny.fillLevels.length;
  if (tiny.count !== n || f !== ZERO.length)
    throw new Error(`policyTiny has ${n} rows × 5 fills, parcels have ${tiny.count} × ${f}`);
  const u8 = (pick: (r: Row) => number) => Uint8Array.from(ROWS, pick);
  const u16 = (pick: (r: Row) => number) => Uint16Array.from(ROWS, pick);
  const perFill = (pick: (r: Row) => number[]) => {
    const a = new Uint16Array(n * f);
    ROWS.forEach((r, i) => a.set(pick(r), i * f));
    return a;
  };
  return {
    format: 'sfh-policy/1',
    datasetVersion: tiny.datasetVersion,
    count: n,
    idsHash: idsHash(tiny.id),
    fillLevels: [...tiny.fillLevels],
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
    fzpYieldCap: u16((r) => r.fzpYieldCap),
    todTier: u8((r) => r.todTier),
    todBand: u8((r) => TOD_BANDS.indexOf(r.todBand)),
    sb79Status: u8((r) => SB79_STATUSES.indexOf(r.sb79)),
    sb79Stories: u8((r) => r.sb79Stories),
    sb79Cap: u16((r) => r.sb79Cap),
    sb79Yield: perFill((r) => r.sb79Yield),
    s207Status: u8((r) => S207_STATUSES.indexOf(r.s207)),
    currentStories: u8((r) => r.currentStories),
    currentCap: u16((r) => r.currentCap),
    currentYield: perFill((r) => r.currentYield),
    hostableSb79: u8((r) => r.hostableSb79),
    hostableCurrent: u8((r) => r.hostableCurrent),
    currentFromS207: u8((r) => r.currentFromS207),
    exemptPermanent: u8((r) => r.exemptPermanent),
    exemptTemporary: u8((r) => r.exemptTemporary),
    historicProtected: u8((r) => (r.historic === 'A' || r.historic === 'A*' ? 1 : 0))
  };
}
