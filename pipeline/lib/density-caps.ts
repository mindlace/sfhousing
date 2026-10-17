// Base-zoning density caps in units per lot, from the San Francisco Planning Code (spec §4.4).
// Pure: no I/O. The base envelope is the base height and this cap; the Local Program envelope
// has no cap (Bulletin 11: "not limited by a ratio of permitted units to lot area",
// §206.10(d)(1)(A)).
//
// Every per-area divisor and per-lot count below is tier 1 (first-party: the Planning Code). The
// values were re-verified (AC 10) against the enacted text of Ordinance No. 245-25 (File 250701,
// the Family Zoning Plan Planning Code ordinance), which reprints the amended rows of Tables 209.1,
// 209.2 and 710-713 with strike/underline markup, read page by page. The consolidated Code on
// amlegal returned HTTP 403 (2026-10-16), so later amendments after Ord. 245-25 were not checked
// there; the gocodebook mirror (text as of 2026-09-23, Ord. 37-26) agrees with every value:
// https://gocodebook.com/library/us/ca/san-francisco-planning (spec §4.4 gives the full paths).
import type { Day } from '../../src/lib/timelapse/time';

/** Director Bulletin No. 11, Housing Choice-SF Program (first issued February 2026). */
export const BULLETIN_11_URL =
  'https://sfplanning.org/resource/planning-director-bulletin-no-11-housing-choice-sf-program';

/** Ordinance No. 245-25 (Planning Code - Family Zoning Plan), signed 2025-12-12. Official. */
const ORD_245_25_URL = 'https://www.sfbos.org/sites/default/files/o0245-25.pdf';

/** Planning code summary 2021-010762PCA (Ord. 210-22, four-unit RH exception). Official. */
const FOURPLEX_SUMMARY_URL =
  'https://sfplanning.org/sites/default/files/documents/legis/code-summaries/' +
  '2021-010762PCA-4_Unit_Density_Exception.pdf';

/**
 * Day of 2022-11-27, the effective date of Ord. 210-22 (four units per RH lot, Table 209.1 Note
 * 11). Tier 1: Planning code summary 2021-010762PCA, "Effective Date: November 27, 2022".
 */
export const DENSITY_CAP_CHANGE_DAY: Day = Date.UTC(2022, 10, 27) / 86400000;

/** Square metres per square foot: the international foot, exact by definition (0.3048 m)². */
const SQFT_M2 = 0.09290304;
/**
 * Slack (sf) added before flooring so that an area converted from whole square feet cannot land
 * one ulp below the integer and lose a square foot. Tier 4, numerical guard only.
 */
const SQFT_EPS = 1e-6;

/**
 * Units allowed on any RH lot from 2022-11-27 (corner lots get 6, not modelled). Tier 1: Table
 * 209.1 Note 11, "P for up to four dwelling units per lot, excluding Corner Lots", §207(c)(8).
 */
const RH_FOURPLEX = 4;

export type DensityCapEntry = {
  codes: string[];
  section: string;
  url: string;
  verified: 'official' | 'mirror';
  note?: string;
};

/** `A` is lot area in whole square feet (≥ 1); `post` is day ≥ DENSITY_CAP_CHANGE_DAY. */
type CapFormula = (A: number, post: boolean, inR4: boolean) => number | null;

type CapRow = DensityCapEntry & { cap: CapFormula };

/** "X per lot, or one unit per N sf of lot area" reads as whichever allows more (spec §4.4). */
const perArea = (A: number, perLot: number, sfPerUnit: number): number =>
  Math.max(perLot, Math.floor(A / sfPerUnit));

/** RH cap: the pre-2022-11-27 formula, lifted to at least four units from that day. */
const rh =
  (pre: (A: number) => number): CapFormula =>
  (A, post) =>
    post ? Math.max(RH_FOURPLEX, pre(A)) : pre(A);

/**
 * NC cap: one unit per N sf outside R-4. Inside R-4 the current Code reads "Form-Based Density
 * applies within the R-4 Height and Bulk District (§§ 263.19, 270(i))", so null. The R-4 rule is
 * applied from DENSITY_CAP_CHANGE_DAY (the spec's single change day); before it the outside
 * formula holds (spec §4.4 marks that cell "—").
 */
const nc =
  (sfPerUnit: number): CapFormula =>
  (A, post, inR4) =>
    post && inR4 ? null : perArea(A, 1, sfPerUnit);

const ord = (page: number): string => `${ORD_245_25_URL}#page=${page}`;

const RH_NOTE_PRE =
  'Pre-2022-11-27 branch is the spec formula. The official code summary ' +
  `${FOURPLEX_SUMMARY_URL} ("The Way It Was") lists the per-area alternative as conditional ` +
  '(CUA) and RH-1(D) as "1 unit max. per lot"; reported to main, value unchanged.';

const ROWS: CapRow[] = [
  {
    codes: ['RH-1(D)'],
    section: '§209.1, Table 209.1 (Residential Density, Dwelling Units; Note 11, §207(c)(8))',
    url: ord(63),
    verified: 'official',
    note:
      'Ord. 245-25 pp. 63-64: "P up to one unit per lot, or one unit per 3,000 square feet of ' +
      'lot area, with no more than three units per lot." ' +
      RH_NOTE_PRE,
    // Tier 1: 1 per lot, 1 per 3,000 sf, at most 3 (Table 209.1).
    cap: rh((A) => Math.min(3, perArea(A, 1, 3000)))
  },
  {
    codes: ['RH-1'],
    section: '§209.1, Table 209.1 (Residential Density, Dwelling Units; Note 11, §207(c)(8))',
    url: ord(63),
    verified: 'official',
    note:
      'Ord. 245-25 pp. 63-64: "P up to one unit per lot, or up to one unit per 3,000 square ' +
      'feet of lot area." ' +
      RH_NOTE_PRE,
    // Tier 1: 1 per lot or 1 per 3,000 sf (Table 209.1).
    cap: rh((A) => perArea(A, 1, 3000))
  },
  {
    codes: ['RH-1(S)'],
    section: '§209.1, Table 209.1 (Residential Density, Dwelling Units; Note 11, §207(c)(8))',
    url: ord(63),
    verified: 'official',
    note:
      'Ord. 245-25 pp. 63-64: "P up to two units per lot, if the second unit is 600 sq. ft. or ' +
      'less, or up to one unit per 3,000 square feet of lot area, with no more than three units ' +
      'per lot." The 600 sf second-unit condition is not modelled. ' +
      RH_NOTE_PRE,
    // Tier 1: 2 per lot or 1 per 3,000 sf, at most 3 (Table 209.1).
    cap: rh((A) => Math.min(3, perArea(A, 2, 3000)))
  },
  {
    codes: ['RH-2'],
    section: '§209.1, Table 209.1 (Residential Density, Dwelling Units; Note 11, §207(c)(8))',
    url: ord(63),
    verified: 'official',
    note:
      'Ord. 245-25 pp. 63-64: "P up to two units per lot, or up to one unit per 1,500 square ' +
      'feet of lot area." ' +
      RH_NOTE_PRE,
    // Tier 1: 2 per lot or 1 per 1,500 sf (Table 209.1).
    cap: rh((A) => perArea(A, 2, 1500))
  },
  {
    codes: ['RH-3'],
    section: '§209.1, Table 209.1 (Residential Density, Dwelling Units; Note 11, §207(c)(8))',
    url: ord(63),
    verified: 'official',
    note:
      'Ord. 245-25 pp. 63-64: "P up to three units per lot, or up to one unit per 1,000 square ' +
      'feet of lot area." ' +
      RH_NOTE_PRE,
    // Tier 1: 3 per lot or 1 per 1,000 sf (Table 209.1).
    cap: rh((A) => perArea(A, 3, 1000))
  },
  {
    codes: ['RM-1'],
    section: '§209.2, Table 209.2 (Dwelling Units Density, General)',
    url: ord(73),
    verified: 'official',
    note:
      'Ord. 245-25 p. 73: "Total maximum permitted density is one unit per 800 square feet of ' +
      'lot area." (the minimum-density clause is struck). The per-lot floor of 1 is the spec ' +
      'reading; the Table states no per-lot figure.',
    // Tier 1: 1 per 800 sf (Table 209.2); floor of 1 per lot is the spec's reading.
    cap: (A) => perArea(A, 1, 800)
  },
  {
    codes: ['RM-2'],
    section: '§209.2, Table 209.2 (Dwelling Units Density, General)',
    url: ord(73),
    verified: 'official',
    note: 'Ord. 245-25 p. 73: "Total maximum permitted density is one unit per 600 square feet".',
    // Tier 1: 1 per 600 sf (Table 209.2).
    cap: (A) => perArea(A, 1, 600)
  },
  {
    codes: ['RM-3'],
    section: '§209.2, Table 209.2 (Dwelling Units Density, General)',
    url: ord(73),
    verified: 'official',
    note: 'Ord. 245-25 p. 73: "Total maximum permitted density is one unit per 400 square feet".',
    // Tier 1: 1 per 400 sf (Table 209.2).
    cap: (A) => perArea(A, 1, 400)
  },
  {
    codes: ['RM-4'],
    section: '§209.2, Table 209.2 (Dwelling Units Density, General)',
    url: ord(73),
    verified: 'official',
    note:
      'Ord. 245-25 p. 73: "Total maximum permitted density is one unit per 200 square feet". ' +
      'Note 8 (a small unit counts as 3/4) is not modelled.',
    // Tier 1: 1 per 200 sf (Table 209.2).
    cap: (A) => perArea(A, 1, 200)
  },
  {
    codes: ['NC-1'],
    section: '§710, Table 710 (Dwelling Unit Density, General)',
    url: ord(209),
    verified: 'official',
    note:
      'Ord. 245-25 p. 209: "1 unit per 800 square foot lot area, or the density permitted in ' +
      'the nearest R District, whichever is greater. Form-Based Density applies within the R-4 ' +
      'Height and Bulk District". The nearest-R-District term is not modelled (understates).',
    // Tier 1: 1 per 800 sf outside R-4 (Table 710).
    cap: nc(800)
  },
  {
    codes: ['NC-2'],
    section: '§711, Table 711 (Dwelling Unit Density, General)',
    url: ord(223),
    verified: 'official',
    note:
      'Ord. 245-25 p. 223: "1 unit per 800 square foot lot area, or the density permitted in ' +
      'the nearest R District, whichever is greater. Form-Based Density applies within the R-4 ' +
      'Height and Bulk District". The nearest-R-District term is not modelled (understates).',
    // Tier 1: 1 per 800 sf outside R-4 (Table 711).
    cap: nc(800)
  },
  {
    codes: ['NC-3'],
    section: '§712, Table 712 (Dwelling Unit Density, General)',
    url: ord(234),
    verified: 'official',
    note:
      'Ord. 245-25 p. 234: "1 unit per 600 square foot lot area, or the density permitted in ' +
      'the nearest R District, whichever is greater. Form-Based Density applies within the R-4 ' +
      'Height and Bulk District". The nearest-R-District term is not modelled (understates).',
    // Tier 1: 1 per 600 sf outside R-4 (Table 712).
    cap: nc(600)
  },
  {
    codes: ['NC-S'],
    section: '§713, Table 713 (Dwelling Unit Density, General)',
    url: ord(239),
    verified: 'official',
    note:
      'Ord. 245-25 p. 239: "1 unit per 800 square foot lot area, or the density permitted in ' +
      'the nearest R District, whichever is greater. Form-Based Density applies within the R-4 ' +
      'Height and Bulk District". The nearest-R-District term is not modelled (understates).',
    // Tier 1: 1 per 800 sf outside R-4 (Table 713).
    cap: nc(800)
  },
  {
    codes: ['NCT-1', 'NCT-2', 'NCT-3'],
    section: '§207.6(a); §750, Table 750 (NCT-1); §751, §752',
    url: ord(96),
    verified: 'official',
    note:
      'Ord. 245-25 p. 96, §207.6(a): "dwelling unit density is not controlled by lot area in ' +
      'RTO-1 RTO-M, NCT, and Eastern Neighborhoods Mixed Use Districts"; p. 373, Table 750: ' +
      '"Form-Based Density." Tables 751 and 752 themselves were not read.',
    // Tier 1: no lot-area density limit (§207.6(a)).
    cap: () => null
  }
];

/** The density-cap table with one cited section and URL per entry (AC 10). */
export const DENSITY_CAP_TABLE: readonly DensityCapEntry[] = ROWS.map((r) => ({
  codes: r.codes,
  section: r.section,
  url: r.url,
  verified: r.verified,
  ...(r.note === undefined ? {} : { note: r.note })
}));

const BY_CODE = new Map<string, CapFormula>(ROWS.flatMap((r) => r.codes.map((c) => [c, r.cap])));

/**
 * Generic neighbourhood-commercial codes in `acdm-wktn` that do not name the district. Named NCDs
 * (§714-§746) and named NCTs (§751-§764) set their own density; with the district unknown the cap
 * is null. Tier 4 (main ruling 2026-10-16): §729 West Portal (Ord. 245-25 p. 307, "Form-Based
 * Density.") and §207.6(a) (all NCT) suggest null is the common case, but it is not verified for
 * the other named NCDs.
 */
const GENERIC_NC = new Set(['NCD', 'NCT']);

/**
 * Districts whose cap could not be verified against the official Code: every `mirror` table entry
 * (none after the 2026-10-16 re-verification) plus the generic `NCD` code, whose named district,
 * and so its section, is unknown. They default to no cap; the build reports parcel counts.
 */
export const UNVERIFIED_DISTRICTS: string[] = [
  ...ROWS.filter((r) => r.verified === 'mirror').flatMap((r) => r.codes),
  'NCD'
];

export type DensityCapRule = 'table' | 'split' | 'generic-nc' | 'unlisted' | 'none';

/** Which rule decides the cap for a raw `zoning_code` (Task 8 counts parcels per rule). */
export function densityCapRule(zoning: string | null): DensityCapRule {
  const z = zoning?.trim() ?? '';
  if (z === '') return 'none';
  if (z.includes('|')) return 'split';
  if (GENERIC_NC.has(z)) return 'generic-nc';
  return BY_CODE.has(z) ? 'table' : 'unlisted';
}

function capOne(code: string, A: number, post: boolean, inR4: boolean): number | null {
  const f = BY_CODE.get(code);
  return f === undefined ? null : f(A, post, inR4);
}

/**
 * Base-zoning cap in units for a lot of `lotAreaM2` on `day`, or null for no cap.
 *
 * - `A = max(1, floor(lotAreaM2 / 0.09290304))` sf; a non-finite or non-positive area reads as 1.
 * - Table codes use the §4.4 formulas; `day ≥ DENSITY_CAP_CHANGE_DAY` selects the current Code.
 * - A split code (`RH-2|RM-1`) takes the most permissive component: null if any component is
 *   null, else the max. Tier 4 (main ruling 2026-10-16): the Code applies each district to its
 *   own part of the lot, which the data does not split.
 * - Generic `NCD`/`NCT`, every unlisted code and a null or empty code give null.
 */
export function densityCap(
  zoning: string | null,
  lotAreaM2: number,
  inR4: boolean,
  day: Day
): number | null {
  const rule = densityCapRule(zoning);
  if (rule === 'none' || rule === 'generic-nc' || rule === 'unlisted') return null;
  const sf = Number.isFinite(lotAreaM2) ? Math.floor(lotAreaM2 / SQFT_M2 + SQFT_EPS) : 0;
  const A = Math.max(1, sf);
  const post = day >= DENSITY_CAP_CHANGE_DAY;
  const z = (zoning as string).trim();
  if (rule === 'table') return capOne(z, A, post, inR4);
  let best = 0;
  for (const part of z.split('|')) {
    const c = capOne(part.trim(), A, post, inR4);
    if (c === null) return null;
    best = Math.max(best, c);
  }
  return best;
}
