// SB 79 (Gov. Code §§65912.155–65912.162, Stats. 2025 ch. 512) and SF Ordinance 082-26 (Board
// File 260132, Planning Code §207.11): every parameter the /sim policy layers use, each with a
// source and an evidence tier (0 per-record … 4 invented; plan "Evidence hierarchy"). Researched
// 2026-10-28 (task 1 of the /sim data-layers plan); the report holds the full findings.
//
// Statute facts, read from the chaptered text (10/10/2025):
// - There is no "Table 1" in the statute. §65912.157(a)(3)–(6) set height / density / FAR floors
//   for the ¼-mile and ¼–½-mile rings, and (e) adds an "adjacency intensifier" (+20 ft, +40 du/ac,
//   +1 FAR) for a project immediately adjacent to the stop; "adjacent" is within 200 ft of a
//   pedestrian access point (§65912.156(a)). STANDARDS band 1 is the ¼-mile row plus (e). These
//   match the ABAG summary's table, and the City's own Alternative Plan capacity table applies the
//   same 200 ft values (Tier 2 200ft: 85 ft, 140 du/ac, FAR 4).
// - The ¼–½-mile ring applies only in a city of at least 35,000 people; San Francisco is one.
// - Distance: a straight line from the nearest edge of the parcel to a pedestrian access point
//   (§65912.157(b)).
// - At least five units and the greater of 30 du/ac or the local minimum density (§65912.157(a)(1)).
// - Not on a site with more than two rent- or price-controlled units occupied by tenants in the
//   past seven years, or demolished within seven years (§65912.157(h)).
// - No rule for fractional units; see UNITS_ROUNDING.
// - Takes effect 2026-07-01 (§65912.157(n)). SF's Alternative Plan keeps §65912.157 from applying
//   in SF until the next Housing Element (§65912.161(d); Ord. 082-26 §2(g)).
import type { ModeId } from '../src/lib/data/transit';
import type { Cite } from './transit-config';

export type Sb79Tier = 1 | 2;
export type TodBand = 1 | 2 | 3; // adjacent, quarter, half

export interface TieredCite extends Cite {
  tier: 0 | 1 | 2 | 3 | 4;
}

const SB79_URL =
  'https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB79';
const ORD_URL = 'https://media.api.sf.gov/documents/o0082-26.pdf';
const BOARD_FILE_URL =
  'https://sfgov.legistar.com/LegislationDetail.aspx?ID=7880164&GUID=E0FE8932-C884-412C-A977-7C3E9B5778D2';
const ALT_PLAN_MEMO_URL =
  'https://sfgov.legistar.com/View.ashx?M=F&ID=15796913&GUID=4489B919-9281-4344-B757-BC92D33EAB0A';
const ZONING_DISTRICTS_URL = 'https://data.sfgov.org/d/3i4a-hu95';

function statute(section: string): TieredCite {
  return {
    source: `Gov. Code ${section} (SB 79, Stats. 2025 ch. 512, chaptered text)`,
    url: SB79_URL,
    asOf: '2025-10',
    tier: 1
  };
}

/** Upper edge of each band, metres: 200 ft (§65912.156(a)), ¼ mile, ½ mile (§65912.157(a)). */
export const BAND_MAX_M: Record<TodBand, number> = { 1: 60.96, 2: 402.336, 3: 804.672 };

/** §65912.157(a)(3)–(6), band 1 with the (e) adjacency intensifier on the ¼-mile row. */
export const STANDARDS: Record<
  Sb79Tier,
  Record<TodBand, { heightFt: number; duPerAcre: number; residentialFar: number }>
> = {
  1: {
    1: { heightFt: 95, duPerAcre: 160, residentialFar: 4.5 },
    2: { heightFt: 75, duPerAcre: 120, residentialFar: 3.5 },
    3: { heightFt: 65, duPerAcre: 100, residentialFar: 3.0 }
  },
  2: {
    1: { heightFt: 85, duPerAcre: 140, residentialFar: 4.0 },
    2: { heightFt: 65, duPerAcre: 100, residentialFar: 3.0 },
    3: { heightFt: 55, duPerAcre: 80, residentialFar: 2.5 }
  }
};
export const STANDARDS_CITE: TieredCite = statute('§65912.157(a)(3)–(6), (e); §65912.156(a)');

export type UnitsRounding = 'ceil' | 'floor' | 'round'; // 'round' = half up

/**
 * SB 79 as written: rounding of `duPerAcre × acres`. SB 79 is silent. §65912.157(d) makes the SB 79 density the base
 * density for the State Density Bonus Law, whose §65915(q) rounds each fractional component up:
 * tier 2, listed in UNSOURCED.
 */
export const UNITS_ROUNDING: UnitsRounding = 'ceil';
export const UNITS_ROUNDING_CITE: TieredCite = {
  source: 'Gov. Code §65915(q) via §65912.157(d) (SB 79 silent on fractional units)',
  url: SB79_URL,
  asOf: '2025-10',
  tier: 2
};

/** Trains per day, both directions: very high and high frequency commuter rail (§65912.156(r), (e)). */
export const VHF_TPD = 72;
export const HF_TPD = 48;
/** §65912.157(a)(1). */
export const MIN_UNITS = 5;
/** §65912.157(h): a site with more than this many rent- or price-controlled units is excluded. */
export const RENT_CONTROL_MAX_UNITS = 2;

/**
 * Tier 2 rail modes. §65912.156(h): light rail includes streetcar, trolley and tramway. Cable cars
 * are left out: MTC's SB 79 stop map (tier 1, presumed valid by §65912.160(f)) lists no Muni
 * route_type 5 stop, and no official source counts them.
 */
export const LIGHT_RAIL_MODES: readonly ModeId[] = ['light-rail', 'streetcar'];

/**
 * Muni stops MTC designates current Tier 2 TOD stops, as `muni:<GTFS stop_id>` (438: 293 rail or
 * rail-and-bus, 145 bus-only on PRC §21060.2(a)(1) corridors such as 49/90 Van Ness, 38/38R
 * Geary, 14/14R Mission). MTC's 9 planned "(Future)" BRT stops and its one tod_tier "0" row
 * (California St & Pierce St) are left out. MTC's stop_id for Muni is the GTFS stop_code; each
 * maps to exactly one stop_id in the live gtfs-muni stops.txt (2026-10-28). Our own list of ids,
 * cited to MTC; MTC's dataset is not shipped (licence: disclaimer only). Tier 1.
 */
export const MUNI_TIER2_STOP_IDS: ReadonlySet<string> = new Set(
  `
  3092 3095 3124 3136 3144 3153 3192 3194 3208 3266 3296 3311 3318 3358 3361 3376 3385 3387 3403
  3537 3538 3599 3600 3601 3602 3603 3715 3716 3717 3718 3719 3847 3848 3858 3859 3884 3909 3911
  3912 3913 3914 3915 3984 3985 3987 3994 3995 3996 3999 4000 4004 4006 4017 4026 4028 4255 4256
  4257 4258 4259 4260 4263 4264 4269 4270 4271 4272 4273 4274 4275 4288 4289 4290 4291 4292 4293
  4294 4295 4298 4300 4301 4302 4303 4304 4305 4447 4448 4501 4502 4503 4504 4506 4509 4510 4513
  4515 4516 4517 4518 4529 4530 4532 4534 4726 4727 4755 4756 4757 4758 4760 4761 4762 4763 4764
  4765 4767 4769 4787 4788 4821 5118 5124 5174 5175 5184 5193 5194 5195 5196 5197 5198 5199 5200
  5201 5202 5203 5204 5205 5206 5207 5208 5209 5210 5211 5212 5213 5214 5215 5216 5219 5220 5223
  5224 5225 5234 5237 5239 5240 5417 5418 5419 5532 5533 5535 5536 5537 5538 5539 5540 5541 5542
  5543 5544 5545 5548 5552 5554 5558 5562 5566 5568 5571 5572 5626 5639 5640 5643 5645 5647 5650
  5651 5652 5655 5656 5657 5659 5661 5662 5668 5669 5671 5672 5673 5675 5676 5678 5680 5681 5682
  5685 5686 5687 5690 5691 5692 5694 5695 5696 5726 5727 5728 5730 5731 5779 5780 5784 5785 5787
  5788 5793 5794 5795 5797 5798 5806 5807 5808 5813 5814 5817 5825 5836 6016 6017 6019 6021 6023
  6034 6037 6125 6126 6127 6172 6173 6174 6175 6213 6214 6215 6216 6217 6218 6219 6220 6221 6222
  6223 6224 6257 6259 6262 6265 6266 6269 6274 6275 6277 6280 6284 6285 6287 6288 6290 6294 6297
  6307 6311 6317 6503 6516 6594 6595 6598 6601 6603 6604 6612 6615 6616 6617 6619 6620 6622 6623
  6626 6627 6628 6629 6632 6633 6634 6635 6636 6637 6638 6640 6641 6738 6739 6740 6744 6898 6932
  6991 6992 6993 6994 6995 6996 6997 6998 7065 7073 7109 7113 7114 7123 7125 7129 7145 7164 7166
  7217 7219 7252 7264 7281 7283 7301 7318 7342 7343 7344 7345 7346 7347 7352 7353 7354 7355 7356
  7357 7358 7359 7360 7361 7362 7363 7364 7365 7390 7391 7392 7393 7394 7395 7396 7397 7398 7399
  7400 7401 7402 7403 7404 7449 7761 7762 7763 7767 7768 7769 7770 7778 7841 7854 7865 7866 7869
  7870 7872 7873 7874 7876 7877 7878 7879 7912 7953 7954 7996 7999 8031 8032 8059 8088 8089 8090
  8091 8092 8093 8094 8095 8096 8097 8098 8099 8100 8102 8103 8104 8105 8136 8137 8155 8156 8157
  8158
`
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => `muni:${id}`)
);
export const MUNI_TIER2_CITE: TieredCite = {
  source:
    'MTC "Senate Bill 79 - Transit-Oriented Development Transit Stops", agency SFMTA, tod_tier "Tier 2", excluding planned (mtc:*) stops; stop_code matched to SFMTA Muni GTFS stops.txt stop_id',
  url: 'https://services3.arcgis.com/i2dkYWmb4wHvYPda/arcgis/rest/services/mtc_sb79_tod_stops/FeatureServer/1',
  asOf: '2026-07',
  tier: 1
};

/**
 * Branch B. MTC publishes its SB 79 stops on its open data portal, but the item's licence is
 * "custom": a planning-purposes, as-is disclaimer that grants no redistribution right. So the
 * tiers come from GTFS, with MTC as the cross-check.
 */
export const TIER_SOURCE: 'mtc' | 'gtfs' = 'gtfs';
export const MTC_STOPS_CITE: TieredCite = {
  source:
    'MTC open data item 7906bd5706994abb833c878713d2038e, fields stop_id (= GTFS stop_code for Muni), station_id, location_type, stop_name, agency_id, agency_name, route_short_name, route_type, tod_tier; 797 rows; licence "custom" (disclaimer only)',
  url: 'https://opendata.mtc.ca.gov/datasets/senate-bill-79-transit-oriented-development-transit-stops',
  asOf: '2026-07',
  tier: 1
};

export type ZoneClass = 'residential' | 'mixed' | 'commercial' | 'excluded';

/**
 * One rule per use district `sc_zoning` holds (live acdm-wktn codes, 2026-10-28). `zoneClass` is
 * SB 79's "zoned for residential, mixed, or commercial development" (§65912.157(a)), taken from
 * the DataSF zoning districts' `gen` field (Industrial and Public are excluded). The section is
 * DataSF's `codesectio` (tier 1). `principallyResidential` is §207.11(b)(2); the Planning Code
 * text could not be fetched (amlegal 403), so those values are tier 2 unless the note says
 * otherwise, and UNSOURCED lists them. Codes without a rule ('' and the stray 'TI', 'TI-') are not SB 79
 * eligible; consumers split codes such as 'RH-1|RM-1'.
 */
function zone(
  pattern: RegExp,
  zoneClass: ZoneClass,
  principallyResidential: boolean,
  section: string,
  tier: 1 | 2 | 3 = 2
): { pattern: RegExp; zoneClass: ZoneClass; principallyResidential: boolean; cite: TieredCite } {
  return {
    pattern,
    zoneClass,
    principallyResidential,
    cite: {
      source: `SF Planning Code ${section}; class from DataSF zoning districts (gen, codesectio)`,
      url: ZONING_DISTRICTS_URL,
      asOf: '2026-10',
      tier
    }
  };
}

export const ZONE_CLASS_RULES: readonly {
  pattern: RegExp;
  zoneClass: ZoneClass;
  principallyResidential: boolean;
  cite: TieredCite;
}[] = [
  zone(/^RH-(1|1\(D\)|1\(S\)|2|3)$/, 'residential', true, '§209.1 (RH)'),
  zone(/^RM-[1-4]$/, 'residential', true, '§209.2 (RM)'),
  zone(/^RC-[34]$/, 'mixed', true, '§209.3 (RC)'),
  zone(/^RTO-(1|M)$/, 'residential', true, '§209.4 (RTO)'),
  zone(
    /^RTO-C$/,
    'commercial',
    true,
    'Art. 2 (RTO-C, Family Zoning Plan; DataSF codesectio blank)',
    3
  ),
  zone(/^NC-(1|2|3|S)$/, 'mixed', true, '§§710–713 (NC-1, NC-2, NC-3, NC-S)'),
  zone(/^NCT(-[123])?$/, 'mixed', true, 'Art. 7 §§750–764 (NCT-1..3 and named NCTs)'),
  zone(/^NCD$/, 'mixed', true, 'Art. 7 §§714–746 (named NCDs)'),
  zone(/^RCD$/, 'commercial', true, '§758 (Regional Commercial)'),
  zone(/^C-2$/, 'commercial', true, '§210.1 (C-2)'),
  zone(/^C-3-(G|O|O\(SD\)|R|S)$/, 'commercial', true, '§210.2 (C-3)'),
  zone(/^(CCB|CVR)$/, 'commercial', true, '§§810.1, 811.1 (Chinatown CB, VR)'),
  zone(/^CRNC$/, 'mixed', true, '§812.1 (Chinatown Residential NC)'),
  zone(/^(MUG|MUO|MUR|UMU)$/, 'mixed', true, '§§840–843 (Eastern Neighborhoods mixed use)'),
  zone(/^WMUG$/, 'mixed', true, '§844 (WMUG)'),
  zone(/^WMUO$/, 'mixed', false, '§845 (WMUO; residential not permitted)'),
  zone(/^CMUO$/, 'mixed', true, 'Art. 8 (CMUO, Central SoMa; DataSF codesectio "TBD")', 3),
  zone(/^SPD$/, 'mixed', true, '§814 (South Park)'),
  zone(/^RED$/, 'residential', true, '§813 (RED)'),
  zone(/^RED-MX$/, 'mixed', true, '§847 (RED-MX)'),
  zone(/^(RH DTR|SB-DTR|TB DTR)$/, 'residential', true, '§§827–829 (Downtown Residential)'),
  zone(/^(PDR-1-[BDG]|PDR-2)$/, 'excluded', false, '§210.3 (PDR)'),
  zone(/^M-[12]$/, 'excluded', false, '§210.4 (M)'),
  // Planning's Alternative Plan memo (June 2026, tier 1): SALI permits 100% affordable housing
  // only by Conditional Use; P principally permits only 100% affordable housing (§§211.1, 206.4).
  zone(/^SALI$/, 'excluded', false, '§846 (SALI); Planning Alternative Plan memo, June 2026', 1),
  zone(/^P$/, 'excluded', false, '§211 (P); Planning Alternative Plan memo, June 2026', 1),
  zone(/^PM-R$/, 'residential', true, '§249.64 (Parkmerced)'),
  zone(/^PM-MU[12]$/, 'mixed', true, '§249.64 (Parkmerced)'),
  zone(/^PM-(OS|CF|S)$/, 'excluded', false, '§249.64 (Parkmerced)'),
  zone(/^(TI|YBI)-R$/, 'residential', true, '§249.52 (Treasure Island / YBI)'),
  zone(/^(TI|YBI)-MU$/, 'mixed', true, '§249.52 (Treasure Island / YBI)'),
  zone(/^((TI|YBI)-(OS|PCI)|Job Corps)$/, 'excluded', false, '§249.52 (Treasure Island / YBI)'),
  zone(
    /^(MR|P70|PPS|BR|S)-MU$/,
    'mixed',
    true,
    '§§249.80, 249.79, 249.87, 263.35, 249.9 (Mission Rock, Pier 70, Potrero Power Station, BR-MU, S-MU SUDs)',
    3
  ),
  zone(
    /^MB-RA$/,
    'mixed',
    true,
    'Art. 9 §902 (Mission Bay; uses set by the redevelopment plan)',
    3
  ),
  zone(/^MB-O$/, 'commercial', false, 'Art. 9 §912 (Mission Bay Office)', 3),
  zone(/^HP-RA$/, 'mixed', false, 'none: Hunters Point Shipyard Redevelopment Plan governs uses', 3)
];

/** §207.11(c)(1): density up to 50% of the §65912.157 density for the parcel. */
const S207_DENSITY_SHARE = 0.5;

/** §207.11, Ord. 082-26 §5 (File 260132, passed 2026-05-05, signed 2026-05-08, effective 2026-06-08). */
export const S207: {
  heightFloorFt: 40;
  densityShare: 0.5;
  minDensityDuPerAcre: (tier: Sb79Tier, band: TodBand) => number;
  minDensityCite: TieredCite;
  rounding: UnitsRounding;
  roundingCite: TieredCite;
  historicCodes: readonly string[];
  cite: TieredCite;
} = {
  /** §207.11(c)(2): a height limit under 40 ft becomes 40 ft. */
  heightFloorFt: 40,
  /** §207.11(c)(1): density up to 50% of the §65912.157 density for the parcel. */
  densityShare: S207_DENSITY_SHARE,
  /**
   * §207.11(b)(8) threshold, Planning's reading: a lot qualifies when its permitted density is
   * below densityShare × the SB 79 density for its tier and band (Ord. 082-26 §2(f); Alternative
   * Plan memo footnote 4: §207.11 raises "all parcels whose zoning does not otherwise permit at
   * least 50% of the density permitted under SB79"). The literal reading, 30 du/ac from
   * §65912.157(a)(1)(A), is in UNSOURCED.
   */
  minDensityDuPerAcre: (tier, band) => S207_DENSITY_SHARE * STANDARDS[tier][band].duPerAcre,
  minDensityCite: {
    source:
      'SF Planning, "Memo - SB79 Alternative Plan_June2026", footnote 4 (Board File 260132); Ord. 082-26 §2(f)',
    url: ALT_PLAN_MEMO_URL,
    asOf: '2026-06',
    tier: 1
  },
  /** §207.11(c)(1) cap rounding: the City's "normal rounding", half up. */
  rounding: 'round',
  roundingCite: {
    source:
      'SF Planning, "Memo - SB79 Alternative Plan_June2026", Density Limit Ratio note: "Normal rounding applies for density calculations" (0.50 or more rounds up)',
    url: ALT_PLAN_MEMO_URL,
    asOf: '2026-06',
    tier: 1
  },
  /**
   * (b)(7) proxy: Article 10 landmarks and district contributors, and Article 11 Category I–IV
   * buildings, approximated by DataSF historic status (3tsw-4idn) code A*. Tier 2.
   */
  historicCodes: ['A*'],
  cite: {
    source:
      'SF Planning Code §207.11(b)–(c), added by Ordinance 082-26 §5 (Board File 260132), as amended in Board 2026-04-28',
    url: ORD_URL,
    asOf: '2026-05',
    tier: 1
  }
};

/**
 * §207.11(b) conditions and how the plan evaluates each:
 * (1) within ½ mile of a TOD stop → todBand > 0; (2) principallyResidential; (3) numeric density
 * (fzpYieldCap !== null) or a height limit < 40 ft (the applicable height: lpFt on a Local Program
 * lot, else baseFt); (4) not sc_district.r4; (5) not seeking a §206.6 density bonus: not modelled
 * (HCD's 2026-07-01 approval is conditioned on SF not enforcing it); (6) not in either exemption
 * table; (7) historic code not in S207.historicCodes; (8) "The permitted density prior to applying
 * the density and height exception in subsection (c) does not meet the minimum density":
 * fzpYieldCap / acres < S207.minDensityDuPerAcre(tier, band); an uncapped lot permits unlimited
 * density, so it meets the minimum and never qualifies. (c)(1) cap = S207.rounding(densityShare ×
 * STANDARDS[tier][band].duPerAcre × acres), combined as max(fzpCap, s207Cap); (c)(2) 40 ft →
 * storiesFromFt(40) = 4 where the FZP height is under 40 ft.
 */
export const CURRENT_LAW_RULE = 'fzp+s207.11';

/** §65912.157(n). */
export const SB79_EFFECTIVE = '2026-07-01';

/** Path 2: every Board File table is an Excel-printed PDF. Task 6 vendors a transcription. */
export const EXEMPTION_FETCH_PATH: 1 | 2 = 2;
/** No licence or terms of use appear on the Board File or its attachments. */
export const EXEMPTION_LICENSE = 'SF public record (Board File 260132)';
export const EXEMPTION_HOMEPAGE = BOARD_FILE_URL;

/**
 * The two exemption tables (Ord. 082-26 §§3–4). Parcel key: Assessor's Block + Lot (blklot), with
 * a few non-numeric pseudo-lots (VACST, ROWA, PARK). `rows` counts printed rows; `parcels` counts
 * distinct blklots. Retrieved 2026-10-28.
 */
export const EXEMPTION_TABLES: readonly {
  table: 'permanent' | 'temporary';
  label: string;
  url: string;
  format: 'pdf';
  sha256: string;
  bytes: number;
  rows: number;
  parcels: number;
}[] = [
  {
    table: 'permanent',
    label: 'Table of Permanent Exclusions (industrial employment hubs)',
    url: 'https://sfgov.legistar.com/View.ashx?M=F&ID=15190247&GUID=2AD44D65-34E2-4022-B6A3-DF406906A836',
    format: 'pdf',
    sha256: 'f0bdb49aebb5e0221d29db1e2f01de915334d923666f2912ccdd2c068bb242d8',
    bytes: 270186,
    rows: 1660,
    parcels: 1660
  },
  {
    table: 'temporary',
    label: 'Table of Temporary Exemptions-Low Resource Parcels, Ver2 (substituted 2026-04-13)',
    url: 'https://sfgov.legistar.com/View.ashx?M=F&ID=15389028&GUID=5F3894E8-8FC7-47E7-815D-33D66A8E8B22',
    format: 'pdf',
    sha256: '28befd3c9e50830de07e41db1ecac191925da9b62b15481210ca536c4b0a4c5e',
    bytes: 1214107,
    rows: 21838,
    parcels: 20825
  }
];

/** Parameters with no tier 0–1 source, or a reading other than the plain one. */
export const UNSOURCED: readonly string[] = [
  "UNITS_ROUNDING = ceil for SB 79 as written (tier 2): SB 79 has no fractional-unit rule; taken from §65915(q) through §65912.157(d). The §207.11 cap uses the City's half-up rounding instead (S207.rounding), and the City's own SB 79 capacity table rounds to nearest on most rows.",
  'Alternative reading of §207.11(b)(8), not used: the literal "minimum density required by §65912.157" is 30 du/ac (§65912.157(a)(1)(A)). Planning\'s memo says no parcel permits less than 33 du/ac, so under it §207.11 would almost never apply.',
  'S207 cap combination max(fzpCap, s207Cap) (tier 2): §207.11(c)(1) says density "shall be up to 50%" and does not say whether it replaces a higher existing cap.',
  'S207 band 1 density includes the §65912.157(e) adjacency intensifier, as the City capacity table does (Tier 2 200ft: 140 du/ac).',
  'S207.historicCodes = [A*] (tier 2): DataSF 3tsw-4idn status stands in for Article 10 / Article 11 Category I–IV designation.',
  '§207.11(b)(5) (no §206.6 density bonus) is not modelled.',
  '§207.11(c)(1) Coastal Zone rule (density applies to the whole parcel, building only outside the zone) is not modelled.',
  'ZONE_CLASS_RULES principallyResidential, accepted at tier 2–3: the Planning Code use tables could not be read online (amlegal 403). Values come from district names, DataSF gen and Planning memos. Tier 3 rules: RTO-C, CMUO, the MR/P70/PPS/BR/S-MU SUDs, MB-RA, MB-O, HP-RA. SALI and P are tier 1 (Planning memo).',
  "TIER_SOURCE = gtfs: the MTC SB 79 stops licence is a disclaimer with no redistribution grant, so MUNI_TIER2_STOP_IDS is our own id list cited to MTC (as of 2026-07) and the dataset is not shipped. MTC's 9 planned BRT stops (Hunters Point, Candlestick) are left out, though §65912.156(p) counts planned stops.",
  'TOD distance is measured to stop points; MTC publishes pedestrian access points (mtc_sb79_tod_access_points) under the same disclaimer.',
  "SB 79 as written, §65912.157(h) rent-control exclusion (tier 2 proxy): a lot is excluded when parcels.bin's rentControlLikely is set (homes on the latest roll, built before 1979) and it has more than RENT_CONTROL_MAX_UNITS (2) existing homes. The statute counts units occupied by tenants in the past seven years, or demolished within seven years; occupancy and demolition history are not modelled, so every pre-1979 home on the latest roll counts as rent-controlled.",
  `Exemption tables licence: none stated; using "${EXEMPTION_LICENSE}".`,
  'Temporary exemption table: row "4591A 011*" carries an unexplained asterisk; 1,013 rows repeat a blklot.',
  '§207.11(b)(3) and (c)(2), a lot with no height district (fzpHeightFt null) counts as not under 40 ft (tier 4, invented): with no height the code gives no evidence either way, so such a lot neither qualifies by height nor gets the 40 ft floor.',
  '§207.11(b)(3) and (c)(2) read the height limit of the project (tier 2): §207.11 applies per project, and every project on a Local Program lot uses the Local Program (no density cap, streamlined, Local Program height), so fzpHeightFt is lpFt (lp_ft, else base_ft) on a Local Program lot and baseFt elsewhere.'
];
