# Car ownership: data sources, verified

The facts the car-ownership build rests on (spec `docs/superpowers/specs/2026-11-24-car-ownership-design.html`),
each checked against the live source on 2026-11-24. Every answer gives the URL tried, what came
back, and a verdict: **VERIFIED** (fetched and read), **NOT FOUND**, or **BLOCKED** (needs an owner
action). Downloads were made with `curl` into a scratch directory; the counts below come from
reading those files.

Two committed files carry the facts code reads: `pipeline/enrichment/parking.json`
(`parseParkingFile`, `pipeline/enrichment/parking-schema.ts`) and `pipeline/enrichment/ami.json`
(`parseAmiFile`, `pipeline/enrichment/ami-schema.ts`). The mini fixture reads its own
`pipeline/test/fixtures/mini/enrichment/parking.json` and `ami.json` (2024 only). Its parking costs
are invented, marked `tier: 4` and `invented: true`, so fixture-0 has the parking link on and e2e
covers it; only `parseFixtureParkingFile` accepts such a cost, and the build uses it on fixture
builds only, so `parseParkingFile` keeps the live file to cited SF sources (ruling P3).

## For the owner

- **A real SF cost per space was found, but both figures are older than 2024.** `belowGrade`
  $80,000 per space in 2016 dollars (Strategic Economics for SF Planning, 2017); `podium` $28,700
  per space in 2012 dollars (Seifel for MOH, 2012; measured from a bar chart). `surface` is null:
  no SF source gives one. `parking.json` keeps each figure in its source's dollars; the build
  brings both to the finance prototypes' 2026 dollars (below grade $120,083, podium $48,756). See
  [Cost per space](#cost-per-space).
- **The dollars-year rule** is decided and applied (controller ruling; see
  [Dollars-year rule](#cost-per-space) below).
- **A current figure can be derived** from two SF sources (Controller 2026 $/GSF × Planning's
  per-project parking area per space): about $114,000 to $145,000 per below-grade space in 2026
  dollars. It is an inference (tier 2), so it is not in `parking.json`; it is there if you want it.
- **The Census data API now needs a key.** Every `api.census.gov` data request without one is
  redirected to `missing_key.html`. Metadata calls still work. All the checks below used the
  Census summary files on `www2.census.gov` instead, which need no key. The pipeline can do the
  same, or you can request a key (it is tied to an email address).
- **Archived GTFS needs you.** Transitland's API needs a key (401 without one); GTFS Data Exchange
  (2008-2016) is by request to its maintainer.

## ACS 5-year block-group tables

Question: which ACS 5-year releases have B25044, B25046, B25009, B19001, B25002 and a workers
table at SF block groups, and on which block-group vintage.

Tried:

- `https://api.census.gov/data/2022/acs/acs5?get=B25044_001E&for=block%20group:*&in=state:06%20county:075%20tract:*`
  → `HTTP 302`, `location: https://api.census.gov/data/missing_key.html`, header
  `x-datawebapi-keyerror: 1`. Same for every year 2009-2025. The data API needs a key.
- Releases 2021-2024 (table-based summary files), per table:
  `https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25044.dat`,
  counting rows whose `GEO_ID` starts `1500000US06075`. First rows:

  ```
  GEO_ID|B25044_E001|B25044_M001|B25044_E002|...
  1500000US060750101011|517|134|22|32|0|14|0|14|22|32|0|14|0|14|0|14|495|133|183|85|281|137|...
  1500000US060750101012|699|151|79|47|0|14|73|42|6|16|0|14|0|14|0|14|620|149|268|80|334|149|...
  ```

- Releases 2009-2020 (sequence-based summary files): the table's sequence and start column from
  `.../summary_file/<year>/documentation/(5_year/)user_tools/*Seq*Table*Lookup.txt`, the block-group
  logical records from `.../data/5_year_seq_by_state/California/Tracts_Block_Groups_Only/g<year>5ca.txt`
  (`15000US06075...`), the values from `.../Tracts_Block_Groups_Only/<year>5ca<seq>000.zip`. For
  example 2009: B25044 is sequence 98, start 111; first SF block group `15000US060750101001`,
  B25044 total 458.
- `https://www2.census.gov/programs-surveys/acs/summary_file/2025/table-based-SF/data/` lists only
  `1YRData/`: the 2021-2025 5-year release is not out (the 2025 5-year directory answers 401).

SF block groups with a value (B25046 is the aggregate vehicle count; block groups with no
vehicles or suppressed aggregates have no row):

| Release   | BG vintage | SF BGs | B25044 | B25046 | B25009 | B19001 | B25002 | B08301 | B08202 / B08203 |
| --------- | ---------- | ------ | ------ | ------ | ------ | ------ | ------ | ------ | --------------- |
| 2005-2009 | 2000       | 575    | 575    | 497    | 575    | 575    | 575    | 575    | 0 / 0           |
| 2006-2010 | 2010       | 581    | 581    | 522    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2007-2011 | 2010       | 581    | 581    | 527    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2008-2012 | 2010       | 581    | 581    | 539    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2009-2013 | 2010       | 581    | 581    | 538    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2010-2014 | 2010       | 581    | 581    | 548    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2011-2015 | 2010       | 581    | 581    | 528    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2012-2016 | 2010       | 581    | 581    | 525    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2013-2017 | 2010       | 581    | 581    | 530    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2014-2018 | 2010       | 581    | 581    | 537    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2015-2019 | 2010       | 581    | 581    | 530    | 581    | 581    | 581    | 581    | 0 / 0           |
| 2016-2020 | 2020       | 681    | 681    | 578    | 681    | 681    | 681    | 681    | 0 / 0           |
| 2017-2021 | 2020       | 681    | 681    | 583    | 681    | 681    | 681    | 681    | 0 / 0           |
| 2018-2022 | 2020       | 681    | 681    | 590    | 681    | 681    | 681    | 681    | 0 / 0           |
| 2019-2023 | 2020       | 681    | 681    | 594    | 681    | 681    | 681    | 681    | 0 / 0           |
| 2020-2024 | 2020       | 681    | 681    | 582    | 681    | 681    | 681    | 681    | 0 / 0           |

**VERIFIED.** Every release from 2005-2009 to the latest (2020-2024) has B25044, B25009, B19001
and B25002 at every SF block group, and B25046 where a block group has vehicles. The vintage
follows the decennial geography: 2000 block groups for 2005-2009 only, 2010 block groups for
2006-2010 to 2015-2019, 2020 block groups from 2016-2020. The block-group counts match TIGER
(575, 581, 681; below).

Workers: **B08202 (household size by workers) and B08203 (workers by vehicles) are not published
at block group** in any release; in 2020-2024, B08202 has 244 SF rows at tract
(`1400000US06075...`). The nearest block-group workers table is **B08301** (means of
transportation to work, workers 16 and over), a person count, not a household count. Workers per
household at block group can only come from B08202 at tract, or from PUMS.

## 2000 SF3 H044 at block group

Tried:

- `https://api.census.gov/data/2000/dec/sf3/variables/H044001.json` → `{"name": "H044001",
"label": "Total", "concept": "TENURE BY VEHICLES AVAILABLE [15]", "group": "H044"}`; the dataset's
  `geography.json` lists `block group`. Data calls need a key (as above).
- Census FTP summary files (not NHGIS): the table matrix
  `https://www2.census.gov/census_2000/datasets/Summary_File_3/0SF3_table_matrix.doc` puts H044001
  to H044015 in segment 58; read `.../Summary_File_3/California/ca00058_uf3.zip` with the geography
  file `.../California/cageo_uf3.zip` (SUMLEV 150, county 075). First rows (H044001..015):

  ```
  060750101001 [516, 18, 6, 6, 6, 0, 0, 0, 498, 214, 247, 37, 0, 0, 0]
  060750101002 [1244, 223, 50, 108, 56, 5, 4, 0, 1021, 435, 444, 107, 27, 0, 8]
  060750102001 [785, 247, 10, 108, 94, 24, 11, 0, 538, 102, 362, 66, 8, 0, 0]
  ```

  575 SF block groups, all present. City total 329,700 occupied homes (115,315 owner, 214,385
  renter; each tenure's vehicle cells sum to its total).

**VERIFIED.** H044 is the last 15 cells of segment 58's 216 (the matrix strings list 206 cells for
the segment; the files have 216, so the position is taken from the end, and the tenure sums
confirm it). Other 2000 SF3 tables a 2000 start needs (tenure by size, income, occupancy) were not
checked here.

## Crosswalks 2000 → 2010 → 2020 and the back-cast start

Tried (Census relationship files):

- `https://www2.census.gov/geo/docs/maps-data/data/rel/t00t10/TAB2000_TAB2010_ST_06_v2.zip`
  (2000 block to 2010 block, with intersecting land area). First row:
  `06,001,400100,1000,,3459935,0,p,06,001,400100,1000,,590336,0,,590336,0`.
- `https://www2.census.gov/geo/docs/maps-data/data/rel2020/t10t20/TAB2010_TAB2020_ST06.zip`
  (2010 block to 2020 block). First row: `06|001|400100|1000||590336|0|p|06|001|400100|1001||695414|0|p|503255|0`.
- `https://www2.census.gov/geo/docs/maps-data/data/rel2020/blkgrp/tab20_blkgrp20_blkgrp10_st06.txt`
  (2020 block group to 2010 block group, with `AREALAND_PART`): 830 SF rows.
- No Census-published 2000 block group to 2010 block group file was found; the block files serve
  (blocks nest in block groups: block group = first digit of the block).

Land-area nesting of SF block groups, from the block files (2000 → 2020 chains through 2010
blocks, splitting each 2010 block's area in proportion):

| Old → new   | Old BGs whose land is ≥99% in one new BG | ≥95%    | New BGs ≥99% inside one old BG |
| ----------- | ---------------------------------------- | ------- | ------------------------------ |
| 2000 → 2010 | 550/575                                  | 554/575 | 558/580                        |
| 2010 → 2020 | 433/580                                  | 455/580 | 605/679                        |
| 2000 → 2020 | 418/575                                  | 441/575 | 585/679                        |

**VERIFIED.** 2000 does not sit on today's block groups cleanly: SF went from 581 to 681 block
groups in 2020, mostly by splitting, so a quarter of 2000 block groups spread over more than one
2020 block group. Going the other way, 585 of 679 2020 block groups lie inside one 2000 block group.
Allocation of the split ones has to go through blocks; the relationship files give land area
only, so a housing-unit weight (decennial block counts) is the better allocator than area.

**Recommendation: start the back-cast in 2000 (SF3).** The 2005-2009 ACS release is on the same
2000 block groups (575, verified above), so it has exactly the same crosswalk problem and no
geographic advantage. SF3 is a single date (April 2000), a one-in-six sample with smaller errors
than a five-year ACS average, and H044 is there at every block group. The binding limit on the
back-cast is transit, not geography: no archived GTFS exists for 2000 (below), so transit access
holds at the earliest feed until one exists.

## PUMAs by vintage and nesting

Tried:

- 2000: `https://www2.census.gov/census_2000/datasets/PUMS/FivePercent/California/PUMEQ5-CA.TXT`
  (summary level 781 rows). SF = **02201-02207** (7 PUMAs; 176 tracts, each in one PUMA).
- 2010: `https://www2.census.gov/geo/docs/maps-data/data/rel/2010_Census_Tract_to_2010_PUMA.txt`.
  SF = **07501-07507** (7 PUMAs; 197 tracts, each listed once).
- 2020: `https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt`.
  SF = **07507-07514** (8 PUMAs; 244 tracts, each listed once).

**VERIFIED.** PUMAs are built from whole tracts, and block groups nest in tracts, so each block
group nests in one PUMA of the same vintage. Code `07507` exists in both 2010 and 2020 vintages
with different areas: always key a PUMA by its vintage. Which PUMA field a PUMS file carries is
below.

## PUMS household variables

Tried: data dictionaries
`https://www2.census.gov/programs-surveys/acs/tech_docs/pums/data_dict/PUMS_Data_Dictionary_2020-2024.csv`
and `..._2009-2013.txt`; the California household files
`https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_hca.zip` (99 MB,
`psam_h06.csv`) and `.../2013/5-Year/csv_hca.zip` (104 MB, `ss13hca.csv`). The PUMS API needs a
key like the rest.

| Variable | 2020-2024 5-year          | 2009-2013 5-year                                 |
| -------- | ------------------------- | ------------------------------------------------ |
| VEH      | yes (0-6, 6 = 6 or more)  | yes                                              |
| MV       | yes (1-7)                 | yes                                              |
| NP       | yes                       | yes                                              |
| WIF      | yes, families only        | yes, families only                               |
| HINCP    | yes                       | yes                                              |
| ADJINC   | yes                       | yes                                              |
| TEN      | yes                       | yes                                              |
| YBL      | **no: replaced by YRBLT** | yes                                              |
| WGTP     | yes                       | yes                                              |
| PUMA     | `PUMA` (2020 definition)  | `PUMA00` (2009-2011 records), `PUMA10` (2012-13) |

First SF rows, 2020-2024: `{'PUMA': '07508', 'SERIALNO': '2020HU0000139', 'VEH': '3', 'MV': '4',
'NP': '4', 'WIF': '2', 'HINCP': '1130000', 'ADJINC': '1222017', 'TEN': '1', 'YRBLT': '2000',
'WGTP': '6'}`. SF occupied households: 17,071 records, weighted 364,046 (VEH weighted: 0: 109,293;
1: 161,399; 2: 70,035; 3+: 23,319). 2009-2013: 6,753 records on `PUMA10` 07501-07507 (2012-2013)
and 10,008 on `PUMA00` 02201-02207 (2009-2011, `PUMA10` = -0009); NP is zero-padded (`'01'`).

**VERIFIED**, with three traps for Task 2: `YRBLT` (single years from 2020, decades before)
replaces `YBL` in the latest file; `WIF` is blank for non-family households, so workers per
household must be counted from the person file (`ESR`, in `csv_pca.zip`, 268 MB for 2024 and
298 MB for 2013, both present); and the 2009-2013 file needs both PUMA vintages.

## TIGER/Line block-group polygons

Tried, record counts read from each `.dbf`:

- 2000: `https://www2.census.gov/geo/tiger/TIGER2010/BG/2000/tl_2010_06075_bg00.zip` → 575.
- 2010: `https://www2.census.gov/geo/tiger/TIGER2010/BG/2010/tl_2010_06075_bg10.zip` → 581.
- 2020: `https://www2.census.gov/geo/tiger/TIGER2020/BG/tl_2020_06_bg.zip` (state file) → 681 with
  `COUNTYFP = 075`.
- Also present: `https://www2.census.gov/geo/tiger/TIGER2024/BG/tl_2024_06_bg.zip` (HTTP 200).

**VERIFIED.** The counts match the ACS block-group counts for each vintage.

## CA DMV light-duty registrations by ZIP

Tried: `https://data.ca.gov/api/3/action/package_show?id=vehicle-fuel-type-count-by-zip-code`
(publisher: California Department of Motor Vehicles; one CSV per year, as of 1/1/2019 to
1/1/2026). The 1/1/2026 file:
`https://publish.data.ca.gov/dataset/15179472-adeb-4df6-920a-20640d02b08c/resource/b459d957-5d94-4b10-999d-770419870364/download/vehicle-fuel-type-counts-2025-v3.csv`

```
Date,ZIP Code,Model Year,Fuel,Make,Duty,Vehicles
12/31/2025,95133,<2012,Flex-Fuel,OTHER/UNK,Light,28
12/31/2025,94110,2018,Gasoline,JEEP,Light,25
```

Light-duty vehicles in SF ZIPs 941xx on 12/31/2025: 410,813 (PUMS 2020-2024 household vehicles,
counting 6+ as 6: about 382,000; DMV also counts business registrations).

Licence: the CKAN `license_id` is empty; the dataset page's Rights row reads "No Restrictions on
Public Use" (`https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code`).

**VERIFIED.** Cross-check of totals only, as the spec says.

## Archived Muni, BART, Caltrain GTFS

Tried:

- `https://transit.land/api/v2/rest/feeds/f-9q8y-sfmta` → `401 {"error":"Unauthorized"}`;
  `https://www.transit.land/feeds/f-9q8y-sfmta` → 403. Transitland's feed archive needs an API key
  (free plans exist for academic and hobby use). Interline's comparison page
  (`https://interline.io/transitland/compare/gtfs-data-exchange`) gives Transitland's coverage as
  "2015 - ongoing".
- GTFS Data Exchange: `https://github.com/jehiah/gtfs-data-exchange` says the historical feeds
  "will remain available for research via S3 accessor pays policy. Please contact me if you'd like
  access." `archive.gtfs.org` lists the 2008-2016 archive (93 GB) as available on request.

**BLOCKED** (owner action): request a Transitland API key, and write to the GTFS Data Exchange
maintainer. Until then the per-agency earliest year is unverified; the best published figure is
Transitland from 2015. If neither arrives in time, the back-cast holds transit access at the
earliest year obtained (2015 or later) for every earlier year, and the report says so. Today's
feeds come from the agencies (`npm run data:transit`).

## SF per-project off-street parking counts

Tried: the Socrata metadata of the datasets the pipeline already reads, then
`https://data.sf.gov/api/views/qvu5-m3a2.json` (Planning Department Records - Projects; licence
"Public Domain U.S. Government"). It carries `parking_spaces_exist`, `parking_spaces_prop`,
`parking_gsf_exist`, `parking_gsf_prop` by PRJ record. Request:

```
https://data.sf.gov/resource/qvu5-m3a2.json?$select=record_id,record_type,open_date,project_address,
  new_construction,number_of_units_prop,parking_spaces_prop,parking_gsf_prop,record_status
  &$where=number_of_units_prop >= 10 AND parking_spaces_prop > 0&$limit=50000
```

First row: `{'record_id': '2021-013057PRJ', 'open_date': '2021-12-31', 'project_address': '842
CALIFORNIA ST 94108', 'new_construction': 'CHECKED', 'number_of_units_prop': '24',
'parking_spaces_prop': '8', 'parking_gsf_prop': '6000', 'record_status': 'Closed - Withdrawn'}`.
791 records; 312 new construction; 99 opened 2019 or later.

| New construction, 10+ homes, with parking | Records | Spaces per home (pooled) | Parking GSF per space (median; pooled) |
| ----------------------------------------- | ------- | ------------------------ | -------------------------------------- |
| All years (2003-2026)                     | 312     | 0.632                    | 340; 380 (n = 225)                     |
| Opened 2019 on (after minimums ended)     | 99      | 0.495                    | 353; 403 (n = 92)                      |

(GSF per space keeps records between 50 and 2,000 sq ft per space.)

**Supply: FOUND** (proposed spaces, by project; includes withdrawn and unbuilt projects, so a
builder using it filters to completed ones). **Use: NOT FOUND**: no SF per-project count of
spaces used. The supply-over-use ratio therefore stays the literature figure, **1.4, tier 3**
(King County Right Size Parking Final Report, August 2015, p. 7: "parking is supplied at 1.4
spaces per dwelling unit but is only used at about 1 space/unit"; read in Appendix A14, PDF p. 173,
of `https://www.sandiego.gov/sites/default/files/appendix_a_-_tpa_multifamily_residential_parking_standards_study.pdf`).
A tier-2 SF ratio is possible later: completed projects' spaces per home from this dataset over
cars per household in recently built homes from PUMS (`YRBLT`); it needs Task 2's PUMS work.

## Cost per space

Searched in the order the brief gives (every search is in `parking.json` `searched`):

1. **Controller, Triennial Review of Economic Feasibility 2026**
   (`https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf`, the
   source of `PROTOTYPES`): p. 11 gives parking hard cost **per GSF** (TBD Consultants): rentals
   at grade $259 and $267, below grade $341-$360; condos at grade $245 and $267, below grade
   $322-$357. No cost per space, no parking area. The TAC deck of 2026-02-11 (slides 7-8), the 2023
   Triennial and the 2023 TAC deck are the same: $/GSF only ($198-$328 in 2023).
2. **Planning cost work**: the Family Zoning Plan packet (2025-06-26, Century Urban) gives parking
   $225-$617/GSF and a condo space sale price of $75,000 (a price, not a cost); Central SoMa
   (Seifel, 2016) gives $140-$160/GSF of parking area, $15,000 per stacker space and "about 400
   square feet" of building area per space; the TSF study (2015) gives stackers only.
   **Found:** Strategic Economics' memo to Planning on the Hub (2017-01-18,
   `https://default.sfplanning.org/plans-and-programs/in-your-neighborhood/hub/Inclusionary_Housing_Community_Facilities_Analysis.pdf`),
   p. 20: "an across-the-board cost assumption of $80,000 per space. This cost reflects the fact
   that most or all parking would be located underground"; p. 21, Figure 16: "Parking, Per space,
   $80,000" (Source: Strategic Economics, 2016).
3. **SFMTA / SFCTA**: the SFCTA parking supply report (2016) covers pricing and fees, not
   construction cost. No SFMTA cost study found.
4. **Published SF pro formas**: Seifel for MOH, Inclusionary Housing Financial Analysis (2012),
   p. 15, Figure 3 "Comparison of 2012 Parking Costs Per Unit, City of San Francisco"
   (`https://sfmohcd.org/sites/default/files/FileCenter/Documents/6976-IH%20Financial%20Analysis%202012_042913.pdf`).
   The figure is an image; bar tops measured against its gridlines (272.4 px per $10,000):

   | Type                      | Per unit at 0.75 | Per unit at 1.0 | Per space |
   | ------------------------- | ---------------- | --------------- | --------- |
   | Podium                    | $21,531          | $28,689         | $28,700   |
   | Podium with stackers      | $15,988          | $21,311         | $21,300   |
   | Underground               | $31,369          | $41,832         | $41,800   |
   | Underground with stackers | $20,943          | $27,882         | $27,900   |

   The two ratios give the same per-space cost, which confirms the reading.

5. Not used: Planning staff's FAQ on removing minimums (via SPUR) cites $38,000 / $29,000 per
   space to Curbed SF 2016 (a news article) and staff's anecdotal $70,000-$80,000 with no source.
   National rules of thumb (Shoup, RSMeans, King County's $20,000-$40,000) are not SF sources.

**In `parking.json`:** `belowGrade` = $80,000 (2016 dollars; Hub memo, the newest per-space SF
figure); `podium` = $28,700 (2012 dollars; Seifel Figure 3); `surface` = null. Both are hard
cost only, kept in their sources' dollars (the build converts them; rule below). The Seifel underground
figure ($41,800 in 2012) is far below the Hub figure ($80,000 in 2016), while the Controller's
real cost index (`market.json`) moved only from 98.2 to 100 over those years: the two sources
disagree about what a below-grade space costs, beyond inflation.

**Alternative, not in the file (tier 2 inference):** Controller 2026 $/GSF × SF parking area per
space from Planning's project records (post-2019 median 353 GSF, pooled 403; Seifel's "about 400"
agrees):

| Type        | Controller 2026 $/GSF | × 353 GSF         | × 403 GSF         |
| ----------- | --------------------- | ----------------- | ----------------- |
| Below grade | $322-$360             | $114,000-$127,000 | $130,000-$145,000 |
| At grade    | $245-$267             | $86,000-$94,000   | $99,000-$108,000  |

These are in the Controller's 2026 cost base, the same base as `PROTOTYPES`, which the found
figures are not.

**Dollars-year rule (controller ruling, applied by `parkingOf` in `pipeline/lib/cars/rates.ts`):**
every `costPerSpace` entry in `parking.json` keeps the dollars-year y its source states. The build
brings each to the finance prototypes' nominal dollars, P = 2026 (the Controller's 2026
Triennial, the base of `PROTOTYPES.costPerHome`, which the odds shift divides by):

cost_P = cost_y × I(min(P, 2023)) / I(y) × CPI(P) / CPI(y)

I is the Controller's Blended Construction Cost Index in `market.json` (`costIndex`, 2016 = 100,
2005-2023, inflation-adjusted, held flat after 2023): the real change in construction cost. CPI
is BLS CPI-U San Francisco-Oakland-Hayward, all items, annual average, series `CUURS49BSA0`
(`https://data.bls.gov/timeseries/CUURS49BSA0`; values 2005-2025 in
`pipeline/enrichment/cpi.json`, `parseCpiFile`, read from the BLS flat file
`https://download.bls.gov/pub/time.series/cu/cu.data.2.Summaries` on 2026-11-25): the price
level. The 2026 annual average is not yet published, so 2025's (356.005) stands in for CPI(2026).

| Type        | Cited, dollars year | I ratio    | CPI ratio       | 2026 dollars |
| ----------- | ------------------- | ---------- | --------------- | ------------ |
| Below grade | $80,000, 2016       | 112.3/100  | 356.005/266.344 | $120,083     |
| Podium      | $28,700, 2012       | 112.3/98.2 | 356.005/239.65  | $48,756      |
| Surface     | none                |            |                 | none         |

The below-grade figure, $120,083, falls inside the derived cross-check above ($98,000-$144,000 at
$245-$360/GSF × 400 GSF; $114,000-$145,000 at the below-grade $/GSF). The derived figure stays a
cross-check and is never used.

## SF AMI by year and household size

Tried: MOHCD's archive page
`https://www.sf.gov/information--previous-years-income-limits-and-sales-price-levels-mohcd-homeownership-programs`,
which links one chart per year; each chart fetched and its "100% of Median" row read. 2026:
`https://media.api.sf.gov/documents/2026_AMI-IncomeLimits-HMFA.pdf`, "Maximum Income by Household
Size derived from the Unadjusted Area Median Income (AMI) for HUD Metro Fair Market Rent Area
(HMFA) that Contains San Francisco", effective 06/01/2026:

```
100% of Median  $113,450  $129,700  $145,900  $162,100  $175,050  $188,050  $201,000  $213,950 ...
```

**VERIFIED** for 2007-2026 (20 years, sizes 1-8, all in `ami.json` with each chart's URL). Notes:

- From 2019 the charts apply MOHCD's AMI Hold Harmless Policy (effective 2019-05-03), so a year
  never falls below the one before; earlier years can (2014 is below 2013), as HUD published them.
- 2016 and 2017's archive links (`sfmohcd.org/file/861`, `/file/5921`) answer with an HTML page;
  the PDFs are at the links in `ami.json`.
- 2006's chart (`https://www.sf.gov/documents/62795/MOH2006IncomeLimits-Master.pdf`) is a
  different series ("San Francisco PMSA", not the unadjusted HMFA) and is left out. Earlier years
  would come from HUD's archive (`huduser.gov`), which answered 202 with a bot check: **NOT
  FETCHED**.

The affordable tiers' bands (`AMI_TIER_BOUNDS`: 50%, 80%, 120%) are shares of these dollars.
