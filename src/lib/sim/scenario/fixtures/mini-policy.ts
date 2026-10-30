// The mini city's policy.bin columns: the T-sim test fixture for the stock layers, the user layer
// and the protections. Fixture values only (tier 4, made up): not data. Every lot is "SB 79
// outside, current law = FZP" except the five named lots, each of which exercises the case its
// name says. Browser-safe (no `node:` imports).
import { idsHash } from '$lib/data/column-file';
import type { ParcelId } from '$lib/data/parcel';
import {
  HISTORIC_CODES,
  NULL_CAP,
  S207_STATUSES,
  SB79_STATUSES,
  type PolicyParcels
} from '$lib/data/policy-codec';
import type { Provenance } from '$lib/timelapse/types';
import type { MiniCity } from './mini-parcels';

/** SB 79 applies and is more permissive than FZP (top 40 against 9); not exempt. */
export const MINI_SB79_ID: ParcelId = '0026T001A';
/** SB 79 applies and would win, but the lot is permanently exempt (Ord. 082-26 §3). */
export const MINI_EXEMPT_PERM_ID: ParcelId = '0026T002';
/** Current law is §207.11 (top 30), above SB 79 (top 20) and FZP (top 9); lapses after the switch. */
export const MINI_S207_ID: ParcelId = '2999A002';
/** Historic status 'A': protected. SB 79 does not apply. */
export const MINI_HISTORIC_ID: ParcelId = '3512003';
/** SB 79 applies with the same full-fill yield as FZP (9) but other stories: a tie keeps FZP. */
export const MINI_TIE_ID: ParcelId = '0026T004';

const prov = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [],
  method: 'Hand-written simulator fixture (tier 4, made up); not data.'
});

interface Special {
  sb79?: { stories: number; yield: number[]; cap?: number };
  exemptPermanent?: 1;
  s207?: { stories: number; yield: number[] };
  historic?: 'A';
}

const SPECIAL: Record<ParcelId, Special> = {
  [MINI_SB79_ID]: { sb79: { stories: 8, yield: [0, 10, 20, 30, 40] } },
  [MINI_EXEMPT_PERM_ID]: { sb79: { stories: 8, yield: [0, 10, 20, 30, 40] }, exemptPermanent: 1 },
  [MINI_S207_ID]: {
    sb79: { stories: 6, yield: [0, 5, 10, 15, 20] },
    s207: { stories: 12, yield: [0, 10, 20, 25, 30] }
  },
  [MINI_HISTORIC_ID]: { historic: 'A' },
  [MINI_TIE_ID]: { sb79: { stories: 5, yield: [0, 0, 3, 9, 9] } }
};

export function miniPolicy(city: MiniCity): PolicyParcels {
  const p = city.parcels;
  const n = p.count;
  const F = p.fillLevels.length;
  const u8 = () => new Uint8Array(n);
  const u16 = () => new Uint16Array(n);
  const out: PolicyParcels = {
    format: 'sfh-policy/1',
    datasetVersion: p.datasetVersion,
    count: n,
    idsHash: 0,
    fillLevels: [...p.fillLevels],
    currentLawRule: 'fzp+s207.11',
    tierSource: 'mtc',
    useDistricts: [''],
    provenance: {
      useDistrict: prov('Use districts'),
      historic: prov('Historic status'),
      exemptions: prov('Exemptions'),
      sb79: prov('SB 79'),
      currentLaw: prov('Current law')
    },
    useDistrict: u16(),
    historic: u8(),
    // parcels.bin's FZP yield is uncapped on Local Program lots and capped by baseCap elsewhere.
    fzpYieldCap: Uint16Array.from(p.baseCap, (c, i) => (p.localProgram[i] ? NULL_CAP : c)),
    todTier: u8(),
    todBand: u8(),
    sb79Status: u8(),
    sb79Stories: u8(),
    sb79Cap: new Uint16Array(n).fill(NULL_CAP),
    sb79Yield: new Uint16Array(n * F),
    s207Status: u8(),
    currentStories: Uint8Array.from(p.envelopeStories),
    currentCap: u16(),
    currentYield: Uint16Array.from(p.yield),
    hostableSb79: u8(),
    hostableCurrent: Uint8Array.from(p.hostable),
    currentFromS207: u8(),
    exemptPermanent: u8(),
    exemptTemporary: u8(),
    historicProtected: u8()
  };
  out.currentCap.set(out.fzpYieldCap);
  const noS207 = S207_STATUSES.indexOf('outside');
  out.s207Status.fill(noS207);

  for (const [id, s] of Object.entries(SPECIAL)) {
    const i = p.index.get(id);
    if (i === undefined) throw new Error(`mini-policy: ${id} is not in the mini city`);
    if (s.sb79) {
      out.sb79Status[i] = SB79_STATUSES.indexOf('applies');
      out.sb79Stories[i] = s.sb79.stories;
      out.sb79Cap[i] = s.sb79.cap ?? NULL_CAP;
      out.sb79Yield.set(s.sb79.yield, i * F);
      out.hostableSb79[i] = 1;
      out.todTier[i] = 1;
      out.todBand[i] = 2; // 'quarter'
    }
    if (s.exemptPermanent) out.exemptPermanent[i] = 1;
    if (s.s207) {
      out.s207Status[i] = S207_STATUSES.indexOf('applies');
      out.currentStories[i] = s.s207.stories;
      out.currentCap[i] = NULL_CAP;
      out.currentYield.set(s.s207.yield, i * F);
      out.hostableCurrent[i] = 1;
      out.currentFromS207[i] = 1;
    }
    if (s.historic) {
      out.historic[i] = HISTORIC_CODES.indexOf(s.historic);
      out.historicProtected[i] = 1;
    }
  }
  out.idsHash = idsHash(p.id);
  return out;
}
