# SF physical max stories heuristic (tier 0: DataSF building footprints + parcels + assessor roll)

Method (all scripts in scratchpad/sf-scripts, data in scratchpad/sf-data):
- Parcels: DataSF acdm-wktn active polygons (227,973 rows, 155,024 unique mapblklot; condo blklots share the map lot polygon, so one lot per mapblklot). Footprints: ynuv-fyni (177,023; LiDAR `hgt_median_m` = height used, `hgt_maxcm` = peak variant). Year built: assessor roll wv5m-vpq2 closed_roll_year 2023 `year_property_built` (min non-zero over condo blklots). Zoning: production parcels.bin (dataset 2026-10-29-0fd62c4d, roll 2025), base/envelope stories.
- Footprint -> lot: intersect, share = overlap/footprint area. Footprints < 30 m2 ignored; footprints with < 50% of area on any lot ignored. A building belongs to every lot with >= 20% of its footprint; those lots are merged (union-find) into one SITE (assemblage). 10,402 of 121,380 sites (8.6%) are merged; 27.7k buildings touch >1 lot at >= 20% before filtering. Site = unit of analysis; stories = tallest building on the site. Multi-polygon sites (131) dropped.
- Width/depth: principal axis from polygon area moments (port of poly.ts principalAxis), width = extent along the minor axis, depth = extent along the major axis. Median width / min-rotated-rectangle min side = 1.00 (rectangular lots; corner/odd lots differ slightly).
- Clean filter (used in ALL tables below): drop sites whose tallest footprint is wider/longer than the site by > 15% + 3 ft (tower footprints spanning many sliver/condo lots, would put a 50-story building on a 25 ft lot). Removes 1.5% of sites (121,249 -> 119,531). Unfiltered tables are in sf-data/analysis1.md (same p50-p99; only max in narrow bins is worse, e.g. 20-30 ft bin max 17 both ways, 40-60 ft max 46 vs 29).
- stories = round((heightM - 4.5)/3.1) + 1 for height > 4.5 m else 1 (primary); a 3.0 m/floor variant and a peak-height variant are included. Percentiles use "higher" interpolation.
- Cut (a) all; (b) roll year 1 to 1959 (N=103,124; includes 9,651 sites with the roll's 1900 default, dropping them changes nothing visible); (c) envelope = p99/max columns plus the p99.5/p99.9 table in the heuristic section.

## Table 1: stories by min-width bin (ft), median roof height, 4.5 m ground + 3.1 m/floor

### width

Cut (a): all buildings, N=119531

| bin | n | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| <20 | 430 | 3 | 4 | 4 | 5 | 12 |
| 20-30 | 74273 | 2 | 3 | 3 | 4 | 17 |
| 30-40 | 15798 | 2 | 3 | 4 | 5 | 12 |
| 40-60 | 14463 | 2 | 4 | 4 | 7 | 29 |
| 60-80 | 5561 | 2 | 4 | 5 | 10 | 39 |
| 80-120 | 5276 | 2 | 4 | 5 | 11 | 56 |
| 120-200 | 2578 | 3 | 7 | 10 | 31 | 56 |
| 200+ | 1152 | 3 | 8 | 12 | 42 | 70 |

Cut (b): built before 1960 (roll year_property_built, 1 to 1959), N=103124

| bin | n | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| <20 | 333 | 3 | 4 | 4 | 5 | 12 |
| 20-30 | 66692 | 2 | 3 | 3 | 4 | 17 |
| 30-40 | 13888 | 2 | 3 | 4 | 5 | 12 |
| 40-60 | 12035 | 2 | 4 | 4 | 7 | 29 |
| 60-80 | 4321 | 2 | 4 | 6 | 10 | 27 |
| 80-120 | 3836 | 2 | 4 | 5 | 9 | 28 |
| 120-200 | 1547 | 3 | 5 | 7 | 16 | 30 |
| 200+ | 472 | 3 | 6 | 9 | 18 | 70 |

## Table 2: stories by lot-area bin (ft2)

### area

Cut (a): all buildings, N=119531

| bin | n | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| <2k | 15646 | 2 | 3 | 3 | 4 | 17 |
| 2-3k | 52988 | 2 | 3 | 3 | 4 | 16 |
| 3-5k | 32360 | 2 | 3 | 4 | 5 | 19 |
| 5-10k | 11674 | 2 | 4 | 5 | 8 | 35 |
| 10-20k | 3897 | 3 | 5 | 7 | 22 | 56 |
| 20-40k | 1558 | 3 | 7 | 11 | 32 | 55 |
| 40k+ | 1408 | 3 | 8 | 11 | 42 | 70 |

Cut (b): built before 1960 (roll year_property_built, 1 to 1959), N=103124

| bin | n | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| <2k | 13418 | 2 | 3 | 3 | 4 | 17 |
| 2-3k | 47417 | 2 | 3 | 3 | 4 | 13 |
| 3-5k | 28715 | 2 | 3 | 4 | 5 | 19 |
| 5-10k | 9374 | 2 | 4 | 5 | 8 | 29 |
| 10-20k | 2708 | 2 | 4 | 6 | 10 | 28 |
| 20-40k | 895 | 2 | 5 | 7 | 18 | 30 |
| 40k+ | 597 | 2 | 5 | 8 | 17 | 70 |

## Variant: 3.0 m/floor (width bins; cut a and cut b)

| width bin | a: p50 | p99 | max | b: p50 | p99 | max |
|---|---|---|---|---|---|---|
| <20 | 3 | 5 | 12 | 3 | 5 | 12 |
| 20-30 | 2 | 4 | 18 | 2 | 4 | 18 |
| 30-40 | 2 | 5 | 13 | 2 | 5 | 13 |
| 40-60 | 2 | 7 | 30 | 2 | 7 | 30 |
| 60-80 | 2 | 10 | 40 | 2 | 10 | 28 |
| 80-120 | 2 | 12 | 58 | 2 | 9 | 29 |
| 120-200 | 3 | 32 | 58 | 3 | 16 | 31 |
| 200+ | 3 | 44 | 72 | 3 | 18 | 72 |

## Variant: peak (max LiDAR) roof height instead of median, cut a

| width bin | p50 | p99 | max |
|---|---|---|---|
| <20 | 3 | 8 | 14 |
| 20-30 | 2 | 5 | 46 |
| 30-40 | 2 | 7 | 28 |
| 40-60 | 3 | 9 | 46 |
| 60-80 | 3 | 14 | 41 |
| 80-120 | 3 | 16 | 56 |
| 120-200 | 4 | 38 | 62 |
| 200+ | 4 | 50 | 92 |

## Cut (c) envelope grid: max stories (n, p99) by width bin x area bin, cut a

| width by area | <2k | 2-3k | 3-5k | 5-10k | 10-20k | 20-40k | 40k+ |
|---|---|---|---|---|---|---|---|
| <20 | 12 (n=375, p99 5) | 5 (n=53, p99 5) | 1 (n=1, p99 1) | - | 1 (n=1, p99 1) | - | - |
| 20-30 | 17 (n=13594, p99 4) | 11 (n=46974, p99 4) | 11 (n=13578, p99 4) | 3 (n=127, p99 3) | - | - | - |
| 30-40 | 11 (n=1382, p99 5) | 8 (n=4278, p99 4) | 12 (n=9751, p99 4) | 12 (n=386, p99 7) | 2 (n=1, p99 2) | - | - |
| 40-60 | 5 (n=293, p99 4) | 16 (n=1527, p99 6) | 19 (n=7588, p99 7) | 29 (n=4998, p99 8) | 5 (n=52, p99 5) | 2 (n=4, p99 2) | 1 (n=1, p99 1) |
| 60-80 | 2 (n=2, p99 2) | 4 (n=155, p99 4) | 19 (n=1324, p99 8) | 27 (n=3689, p99 10) | 39 (n=368, p99 22) | 5 (n=20, p99 5) | 3 (n=3, p99 3) |
| 80-120 | - | - | 5 (n=117, p99 5) | 35 (n=2255, p99 8) | 56 (n=2309, p99 15) | 26 (n=510, p99 14) | 11 (n=85, p99 11) |
| 120-200 | - | 3 (n=1, p99 3) | 2 (n=1, p99 2) | 8 (n=219, p99 6) | 55 (n=1165, p99 29) | 55 (n=894, p99 40) | 56 (n=298, p99 48) |
| 200+ | - | - | - | - | 4 (n=1, p99 4) | 40 (n=130, p99 32) | 70 (n=1021, p99 43) |

## Share of sites at/near zoned height (cut a), by width bin

base = parcels.bin baseStories (current base zoning); env = FZP envelopeStories. at = built >= zoned; near = built >= zoned-1. Only sites whose lot id is in parcels.bin with base>0 (resp. env>0).

| width bin | n with base | at base | near base | n with env | at env | near env | median built/base |
|---|---|---|---|---|---|---|---|
| <20 | 430 | 5% | 42% | 430 | 5% | 40% | 0.50 |
| 20-30 | 74269 | 2% | 20% | 74269 | 2% | 18% | 0.50 |
| 30-40 | 15796 | 5% | 22% | 15796 | 4% | 21% | 0.50 |
| 40-60 | 14454 | 8% | 27% | 14454 | 7% | 25% | 0.50 |
| 60-80 | 5556 | 11% | 31% | 5556 | 9% | 27% | 0.50 |
| 80-120 | 5253 | 9% | 31% | 5253 | 8% | 27% | 0.50 |
| 120-200 | 2533 | 16% | 38% | 2533 | 14% | 32% | 0.50 |
| 200+ | 1027 | 19% | 39% | 1027 | 16% | 33% | 0.50 |

## Share at/near base-zoned height (cut a), by area bin

| area bin | n with base | at base | near base |
|---|---|---|---|
| <2k | 15642 | 2% | 19% |
| 2-3k | 52987 | 2% | 20% |
| 3-5k | 32355 | 4% | 24% |
| 5-10k | 11666 | 11% | 34% |
| 10-20k | 3885 | 13% | 37% |
| 20-40k | 1529 | 14% | 35% |
| 40k+ | 1254 | 18% | 38% |

Sites built >=2 stories above base zoning: cut a 0.3%, cut b 0.2%

## Table 3: reference lots (neighbours within +-15% on both principal extents; widened to 30% then 50% if n<30)

| lot (ft) | tol | n a | a p50 | a p90 | a p99 | a max | n b | b p50 | b p90 | b p99 | b max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 25x100 | 15% | 28525 | 2 | 3 | 4 | 11 | 25665 | 2 | 3 | 4 | 11 |
| 25x120 | 15% | 33010 | 2 | 3 | 4 | 8 | 29960 | 2 | 3 | 4 | 8 |
| 50x100 | 15% | 5577 | 2 | 4 | 6 | 22 | 4687 | 2 | 3 | 6 | 22 |
| 75x100 | 15% | 2295 | 2 | 4 | 8 | 26 | 1754 | 2 | 4 | 8 | 14 |
| 100x100 | 15% | 784 | 2 | 4 | 11 | 35 | 585 | 2 | 4 | 8 | 14 |
| 137.5x137.5 | 15% | 685 | 2 | 4 | 25 | 55 | 477 | 2 | 4 | 9 | 10 |
| 200x275 | 15% | 276 | 3 | 8 | 48 | 56 | 124 | 3 | 6 | 17 | 19 |

## Tall buildings: slenderness = roof height / footprint min width (tallest building per site)

- >=15 stories: n=196, H/w p50 2.4 p90 4.2 max 9.0
- >=20 stories: n=119, H/w p50 2.7 p90 4.4 max 6.9
- >=30 stories: n=56, H/w p50 3.4 p90 4.7 max 6.9
- >=40 stories: n=28, H/w p50 3.6 p90 5.0 max 6.9

Top 25 tallest sites (median height):

| lot | stories | h_med m | h_peak m | site wid ft | site len ft | site area ft2 | footprint wid ft | nlots | year |
|---|---|---|---|---|---|---|---|---|---|
| 0259026 | 70 | 218 | 241 | 277 | 415 | 114517 | 145 | 1 | 1921 |
| 2724003 | 67 | 210 | 286 | 432 | 918 | 220477 | 193 | 1 | 1974 |
| 3709019 | 58 | 181 | 186 | 301 | 388 | 59235 | 126 | 1 | 1985 |
| 3708175 | 56 | 174 | 176 | 115 | 156 | 17840 | 83 | 1 | 1975 |
| 3719020 | 56 | 176 | 195 | 185 | 275 | 50667 | 112 | 1 | 2009 |
| 0289004 | 55 | 171 | 177 | 123 | 139 | 16809 | 121 | 1 | 1983 |
| 3713007 | 55 | 172 | 178 | 275 | 456 | 112618 | 119 | 1 | 1979 |
| 0291012 | 55 | 171 | 178 | 183 | 239 | 22373 | 173 | 1 | 1966 |
| 0263011 | 52 | 162 | 189 | 325 | 326 | 75628 | 267 | 1 | 1983 |
| 0311015 | 52 | 161 | 171 | 164 | 260 | 22868 | 112 | 1 | 1969 |
| 3708056 | 51 | 160 | 163 | 155 | 285 | 44039 | 157 | 1 | 1973 |
| 0230028 | 50 | 157 | 179 | 369 | 383 | 74956 | 142 | 1 | 1970 |
| 0266009 | 48 | 150 | 166 | 181 | 268 | 27633 | 174 | 1 | 1981 |
| 3709014 | 48 | 151 | 158 | 209 | 306 | 44672 | 136 | 1 | 1973 |
| 0233044 | 48 | 151 | 179 | 332 | 426 | 73978 | 162 | 1 | 1979 |
| 0235022 | 48 | 149 | 158 | 167 | 286 | 40058 | 147 | 1 | 1971 |
| 0325031 | 47 | 148 | 155 | 276 | 412 | 113560 | 71 | 1 | 1964 |
| 0241025 | 46 | 143 | 151 | 163 | 288 | 26038 | 134 | 1 | 1963 |
| 0262020 | 46 | 143 | 146 | 165 | 182 | 15624 | 109 | 1 | 1971 |
| 0288032 | 46 | 145 | 156 | 183 | 289 | 32088 | 139 | 1 | 1987 |
| 3765023 | 44 | 137 | 157 | 288 | 389 | 56021 | 104 | 1 | 2008 |
| 3721120 | 44 | 137 | 149 | 163 | 218 | 34417 | 159 | 1 | 2008 |
| 3710020 | 43 | 136 | 146 | 208 | 306 | 44264 | 130 | 1 | 1981 |
| 0264004 | 42 | 133 | 138 | 219 | 370 | 44503 | 149 | 1 | 1969 |
| 3710019 | 42 | 132 | 146 | 138 | 230 | 31517 | 124 | 1 | 1978 |

## Data quality counts

- sites with a building: 121380; multi-polygon sites dropped: 131
- sites merged from >1 lot: 10402 (8.6%)
- year_property_built missing/0: 1604; ==1900: 9651; <1960: 104598; 1960+: 15178
- in parcels.bin (base>=0): 121379
- width p50 25 ft; median wid/mrr_min ratio 1.00

## Envelope tail (cut c): stories at p99.5 / p99.9 / max, clean, by min-width bin

| width ft | n | a p99.5 | a p99.9 | a max | b p99.5 | b p99.9 | b max |
|---|---|---|---|---|---|---|---|
| <20 | 430 | 5 | 12 | 12 | 6 | 12 | 12 |
| 20-30 | 74273 | 4 | 5 | 17 | 4 | 5 | 17 |
| 30-40 | 15798 | 6 | 8 | 12 | 6 | 8 | 12 |
| 40-60 | 14463 | 8 | 14 | 29 | 8 | 14 | 29 |
| 60-80 | 5561 | 13 | 23 | 39 | 12 | 18 | 27 |
| 80-120 | 5276 | 15 | 28 | 56 | 13 | 18 | 28 |
| 120-200 | 2578 | 41 | 55 | 56 | 19 | 29 | 30 |
| 200+ | 1152 | 50 | 67 | 70 | 28 | 70 | 70 |

By area (a p99.5 / p99.9): <2k 4/8; 2-3k 4/6; 3-5k 6/9; 5-10k 10/17; 10-20k 28/39; 20-40k 41/52; 40k+ 50/67. (b): 4/8, 4/6, 6/9, 11/17, 13/20, 19/30, 28/70.

Frontier (clean, cut a), smallest lots holding tall buildings. Sites with 8+ stories: p5 width 40 ft, p5 area 3,055 ft2 (n=735). 13+ stories: p5 50 ft, 4,735 ft2 (n=256). 20+: p5 71 ft, 8,050 ft2 (n=119), min 50 ft / 5,217 ft2. 30+: p5 103 ft, 10,470 ft2 (n=56), min 60 ft / 7,656 ft2. Share of sites reaching 13+ stories: 0.0% below 40 ft wide, 0.15% at 40-60, 0.6-0.9% at 60-120, 4% at 120+.

Real narrow tall examples (mostly pre-1960): 29 stories on 50x138 ft (lot 0268006, 1930); 17 on 41x157; 18 on 45x120; 19 on 55x88; 22 on 56x94; 10-12 on 20-25 ft wide lots (0310002, 0267009, 0554016). Probable artifacts: 0071012 (17 stories on 25 ft, probably Coit Tower), small footprints with tall peaks.

## Zoning-bias check (the downzoning concern)

- Built stories are at or above current base-zoning stories on only 2% (20-30 ft wide) to 19% (200+ ft wide) of sites, and within 1 story of it on 20% to 39% (tables above). Median built/base is 0.50 in every bin. Only 0.3% of sites (0.2% of pre-1960) exceed base zoning by 2+ stories. So zoning is not binding on roughly 80% of narrow-lot sites: the narrow-lot distribution (p99 of 4-5 stories below 40 ft wide) reflects market and typology, not a zoning cap. The 80-200 ft bins have the highest at/near-zoning share (31-39%), which is where zoning could be clipping the tail.
- Cut (b) vs (a) are identical to the story below 60 ft wide; a gap opens on big lots (120-200 ft: p99 16 vs 31; 200+: 18 vs 42). Post-1960 sites are 7x fewer than pre-1960 but hold more 13+ story buildings (154 vs 92), so the gap is mostly the tower era, which this data cannot separate from downzoning. Use (a) as the physical ceiling and (b) as the no-downzoning check for small lots.
- The zoned stories are parcels.bin baseStories (the current Planning Code), not 1960 zoning, so the shares describe today's zoning.

## 4. Proposed heuristic (inputs: min width w in ft, lot area A in ft2; returns physical max stories)

    capW(w) = 0.3 * w                        // lot-width term
    k = A / 1000
    capA(A) = 2.4 * k                        for k <= 15
            = 36 + 0.9 * (k - 15)            for 15 < k <= 30
            = 49.5 + 0.5 * (k - 30)          for k > 30
    maxStories(w, A) = clamp( floor(min(capW(w), capA(A))), 5, 70 )

Justification (all clean sites, cut a unless noted):
- capW: 0.3 stories per ft = 0.93 m of height per m of width at 3.1 m/floor, so height is at most about 3x lot width. Data: height / lot width at p99.9 is 2.1 (20-30 ft), 2.3 (30-40), 2.9 (40-60), 3.3 (60-80), 2.8 (80-120), 3.1 (120-200), 2.3 (200+). Stories at p99.9 by width bin (5, 8, 14, 23, 28, 55, 67) against 0.3w at bin midpoints (7.5, 10.5, 15, 21, 30, 48, 75+) agree within a few stories from 40 to 120 ft. Real outliers reach 5-6x (the 29-story 50 ft lot), so this is a p99.9-type bound, not an absolute one.
- capA breakpoints are the p99.9 by area bin: 2.5k ft2 gives 6, 4k gives 9, 7.5k gives 17, 15k gives 39 (the 2.4 stories per 1,000 ft2 slope is the fit through the first four), 30k gives 52, 60k gives 67. The slope drops to 0.9 then 0.5 per 1,000 ft2 where the data flatten. The 70 ceiling is the sample max by median height (70); the peak-height variant is higher.
- Floor of 5: below 20 ft wide (wedge or sliver lots, n=430) p99 is 5, and without the floor the function was exceeded by 35% of those sites. 4-story walkups are always feasible in the current selectTypology.
- Calibration check: the function is exceeded by 0.11% of all clean sites (0.10% pre-1960; 0.22% post-1960). By width bin: 0.47% (<20), 0.06% (20-30), 0.12% (30-40), 0.25% (40-60), 0.29% (60-80), 0.11% (80-120), 0.43% (120-200), 0.00% (200+). Scaling the function by 0.75 gives 3.0% exceedance, by 0.5 gives 11%. For a "plausible build" cap (p99 to p99.5) use roughly 0.6x the function.
- Versus the current 400/600/1500 m2 (4.3k / 6.5k / 16.1k ft2) area-only thresholds: p5 frontiers say 8+ stories needs about 3k ft2 and 40 ft width, 13+ needs 4.7k ft2 and 50 ft, 20+ needs 8k ft2 and 70 ft, 30+ needs 10k ft2 and 100 ft. The function gives 8 stories at A >= 3.3k and w >= 27; 13 at 5.4k and 43; 20 at 8.3k and 67; 30 at 12.5k and 100. It is more permissive than the p5 frontier at the narrow end by design (p99.9 vs p5 of the tall set).

## 3. Reference lots -> proposed physical max stories (neighbours within +-15% on both principal extents; observed from Table 3 and the tail table)

| lot ft | proposed max | obs p99 (a) | obs p99.5 / p99.9 (a) | obs max (a) | obs p99 (b) | obs max (b) |
|---|---|---|---|---|---|---|
| 25x100 | 6 | 4 | 4 / 5 | 11 | 4 | 11 |
| 25x120 | 7 | 4 | 4 / 5 | 8 | 4 | 8 |
| 50x100 | 12 | 6 | 7 / 14 | 22 | 6 | 22 |
| 75x100 | 18 | 8 | 10 / 14 | 26 | 8 | 14 |
| 100x100 | 24 | 11 | 14 / 35 | 35 | 8 | 14 |
| 137.5x137.5 | 39 | 25 | 31 / 55 | 55 | 9 | 10 |
| 200x275 | 60 | 48 | 55 / 56 | 56 | 17 | 19 |

n per row (cut a): 28,525; 33,010; 5,577; 2,295; 784; 685; 276. The function sits above observed p99 on small lots (6 vs 4 at 25x100); 0.6x the function (4, 4, 7, 11, 14, 23, 36) tracks the p99 to p99.5 columns.

## Slenderness note (towers)

For the tallest building on each site, roof height / building-footprint min width: 15+ stories p50 2.4, p90 4.2 (n=196); 20+: p50 2.7, p90 4.4; 30+: p50 3.4, p90 4.7; 40+: p50 3.6, p90 5.0, max 6.9 (n=28). So for towers (20+ stories) require footprint min width >= H/5 (covers about 90%); H/4.5 is stricter. For stories >= 13, building footprint width is about the lot width (lot width / footprint width p10 0.94, p50 1.06) and footprint covers 0.84 of the site (p10 0.27, p90 1.01), so SF towers fill the lot width; the lot-width test (capW) is the binding rule below about 100 ft width.

## 5. Caveats and data quality

- Height is LiDAR hgt_median_m (median over the footprint), not peak. It understates towers with crowns or setbacks: the tallest site is 218 m and I did not find Salesforce Tower (about 326 m) in the top 25, which suggests the median understates it (inference). Peak-height variant p99 is 10-50% higher in the tall bins (200+ ft: p99 50, max 92, where the 286 m site 2724003 is likely Sutro Tower, an artifact). Treat caps of 40+ as plus or minus 8 stories.
- Footprints are the sf16 (2016 LiDAR) set, loaded 2023, so post-2016 buildings are missing or have the old footprint. year_property_built is the assessor's year for the lot, not necessarily for the tallest building on a merged site (we take the lot holding the most of the tallest footprint). Some towers carry old years (0259026: 1921 at 70 stories; 3709019: 1985 at 58 stories, both suspicious), which inflates cut (b) max at 200+ ft (70); use p99 for (b) there.
- 1900 is the roll's default for unknown year (9,651 sites, 8%); kept in (b). The >= k-story frontier numbers are nearly the same with them dropped (cut b-no1900 run); I did not recompute the full tables without them.
- Multi-parcel buildings: lots sharing a building (>= 20% of footprint each) are merged into one site, so a hotel over 4 lots is one site (8.6% of sites are merged, mostly 2 lots). Chaining of mis-registered row houses is possible. Footprints that exceed their site (towers over sliver/condo or air-rights lots) are removed by the clean filter (1.5% of sites); the unfiltered table shows the artifact (46 stories at 40-60 ft vs 29 clean).
- Condo-mapped lots: acdm-wktn has one polygon per mapblklot; condo blklots share it, so a condo tower is one site, and the roll year is the earliest non-zero year among its blklots.
- Width is the principal-axis extent (as site.ts), which overstates usable width for triangular or irregular corner lots; the median ratio to the min-rotated-rectangle side is 1.00 but the tail differs. No frontage or street test. Depth effect on 40-80 ft wide sites is weak (p99 of 8/6/10/13 stories for depth <90/90-120/120-160/160+ ft).
- Survivorship: observed heights are what was built and still stands under SF zoning and market conditions. Absence of a tall building on a lot size is not proof of infeasibility, which is why the function targets p99.9, not p99. Percentiles are over sites and dominated by 2-3 story 25x100 houses (74k sites at 20-30 ft); big-lot rows have small n (200+ ft: 1,152 sites; pre-1960 472).
- Zoning shares join parcels.bin (dataset 2026-10-29-0fd62c4d, roll 2025) by lot id; all but one site matched. Stories there are the stories equivalent of the height district, and base zoning median is about 2x built stories.
- NYC comparison: the same units and bins (ft, ft2, stories at 4.5 m + 3.1 m/floor); the comparable columns are the p99 and max per bin, plus p99.9 in the tail table.
