# NYC physical-max-stories heuristic (PLUTO 64uk-42ks, pulled 2026-10-31)

Filter: LandUse 01-04 (1-2 family, walkup MF, elevator MF, mixed res/commercial), NumFloors>0, LotFront>0. n=764,482; irregular (IrrLotCode true) = 12.8%, excluded from cuts a-e, tabulated as cut f. Width = LotFront. Stories = NumFloors (PLUTO caps/undercounts supertalls: e.g. 111 W 57th shows 64, real 84). Bin labels: lt20 = under 20; 200plus = 200+. Bins are left-closed.
Cuts: a all regular citywide; b Manhattan; c built before 1961 (YearBuilt 1801-1960); d built 2000+; e Manhattan 2000+ (added: d is dominated by 2-3 story outer-borough infill, so it understates the envelope; e is the best "code-feasible, market-built where zoning allowed" cut); f irregular, all years.
Last two tables: p-values by min(front, depth) for c and d.

## Verdict
Best cut for "physically and code-feasible today" = e (Manhattan 2000+). Cut d is mostly houses and small walkups limited by NYC zoning (R3-R6), not physics. Cut c shows the tenement envelope: 5-6 stories on 25 ft lots (Manhattan 20-30 ft bin p95 = 6), only ~16 stories max at 20-30 ft frontage, which is the pre-elevator/old-law ceiling.

## Reference lots -> proposed physical max stories (frontage +-10%, area +-15%; Manhattan 2000+ cut e, p99 / max, with n)
| lot ft | n (e) | e p95 | e p99 | e max | other cuts p99 (a / c / d) | proposed max |
|---|---|---|---|---|---|---|
| 25x100 | 204 | 14 | 21 | 22 | 5 / 5 / 7 | 20 |
| 25x120 | 45 | 15 | 22 | 22 | 5 / 5 / 7 | 20 |
| 50x100 | 122 | 31 | 44 | 54 | 8 / 6 / 17 | 35 |
| 75x100 | 73 | 34 | 55 | 65 | 16 / 15 / 30 | 43 |
| 100x100 | 58 | 35 | 44 | 46 | 20 / 17 / 37 | 50 |
| 137.5x137.5 | 2 (use a: 210, d: 30) | 40 | 42 | 42 | 32 / 18 / 50 | 68 |
| 200x275 | 3 (use d: 16) | 57 | 59 | 60 | 49 / 31 / 56 | 100 |
(Large-lot rows have tiny n in Manhattan; d and a values are the supporting evidence. Proposed values sit between p95 and max, i.e. a physical ceiling, not typical.)

## Proposed heuristic
maxStories(minWidth, area) = floor( min( 0.8 * minWidth, 0.5 * sqrt(area), 100 ) ), floor of 3 for any buildable lot.
minWidth = min(LotFront, LotDepth) equivalent: the narrower dimension of the lot's inscribed rectangle (ft); area in ft2.
- 0.8 * minWidth (slenderness term, ~8:1 at 10 ft/floor): Manhattan 2000+ p99 by frontage bin is 12 (lt20), 21 (20-30), 20 (30-40), 38 (40-60), 61 (60-80), 60 (80-120), 77 (120-200), 74 (200+). 0.8*W gives 16, 20, 28, 40, 56, 80 at the bin tops/mid: matches 20-30 and 40-60 and tracks the p99 up to ~75 ft. Max in lt20 bin is 16 = 0.8*20 exactly.
- 0.5 * sqrt(area) (compact-footprint term): stops wide-but-shallow slivers and fits 100x100 (max 46, formula 50) and 50x100 (p99 44, max 54, formula 35 is conservative); by area bin Manhattan 2000+ p99: 2-3k 20, 3-5k 35, 5-10k 51, 10-20k 63, 20-40k 67, 40k+ 92; formula gives 25, 35, 50, 70, 100, 100.
- 100 cap: max in the whole dataset is 98 (and PLUTO undercounts supertalls); also the practical ceiling of concrete frame + code stair/egress/wind and structural limits outside supertall engineering.
- Not recommended: a lot-area-only threshold. Citywide medians are 2 stories at every area below 10k ft2 because zoning, not physics, binds; area only matters above ~5k ft2 (Manhattan p99 jumps 16 -> 31 at the 5k line).

## Slenderness (towers)
Height/width = stories*10 ft / min(front, depth). Post-2000 PLUTO regular lots with 30+ stories: median-ish top cases are 8-11:1 (60x100 lot 64 floors = 10.7; 49x100 54 floors = 10.9; 75x99 65 floors = 8.7; 85x125 71 floors = 8.4). Brooklyn 20x98 32 floors = 16:1 is a likely data artifact or a merged-lot tower. Real supertall pencils (external knowledge, not in PLUTO): 111 W 57th ~24:1 (1,428 ft on ~60 ft footprint, uses TMD and a damper), 432 Park ~15:1. So ~10:1 is the "ordinary reinforced concrete, no tuned damper" envelope; 0.8*W is ~8:1, deliberately conservative. A permissive variant: 1.0*W (10:1), which still fits data for 50-60 ft frontage (max 54-64).

## Caveats
- Old-law and pre-1961 tenements (25 ft lots, 5-6 stories, single stair, 1901 Tenement Act light/air rules) mostly would not be code-legal to build today; do not use cut c for feasibility, only as a historical low-tech envelope.
- Zoning-lot mergers and air-rights transfers: many Manhattan towers sit on a tax lot smaller than their zoning lot (e.g., 60x100 lot with 64 floors reflects a bought development-rights package and a stacked/tower-on-base design). The width term is therefore valid only for the footprint; a 50-60 ft frontage tower is not a base case.
- Condo lots: PLUTO often reports a condo building's tax lot as a small billing lot or the whole zoning lot; frontage and area may be inconsistent. Corner lots show their short street as LotFront (narrow-looking) while true width is larger; through-lots have 2 frontages but only one is reported.
- NumFloors for supertalls is undercounted and some values are data errors (e.g., 42 stories on a lt20 ft pre-1961 lot). I did not trim outliers; use p99 not max for calibration.
- Selection: NYC post-2000 buildings are market-selected (sites chosen for towers), so small-n Manhattan large-lot cells are fragile. Heights are also filtered by FAR and sky-exposure rules, so true physical limits are at or above what is shown.
- Medians below 6 stories in outer boroughs reflect zoning, not physics. Irregular lots (cut f) show the same pattern, slightly higher tails (p99 up to 50 at 20-40k ft2), reported separately because LotFront is unreliable there.
- Steel-and-concrete costs, wind and seismic (SF is seismically harder than NYC; 40-60 story residential on narrow lots is mostly NYC wind-governed) are not modeled; SF seismic design and the Transamerica/Salesforce-era tall-building review argue for dropping the 100 cap and the slenderness coefficient to ~0.6-0.7 for SF.

# Raw tables (script: /private/tmp/claude-501/-Users-mindlace-Projects-sfhousing/a8828154-8be9-486d-873d-77c128c28b2f/scratchpad/nyc-scripts/an.py)
764482 irr share 0.12785389322443172

### a all regular n=666740

By frontage (ft)

| lotfront   |      n |   p50 |   p90 |   p95 |   p99 |   max |
|:-----------|-------:|------:|------:|------:|------:|------:|
| lt20       |  90942 |   2   |   3   |     3 |   5   |    42 |
| 20-30      | 329486 |   2   |   3   |     4 |   5   |    44 |
| 30-40      |  74253 |   2   |   3   |     3 |   5   |    31 |
| 40-60      | 135822 |   2   |   2.8 |     4 |   6   |    54 |
| 60-80      |  20010 |   2   |   5   |     6 |  13   |    65 |
| 80-120     |  11658 |   2.5 |   7   |    12 |  20   |    71 |
| 120-200    |   3166 |   6   |  11   |    16 |  32.3 |    98 |
| 200plus    |   1403 |   6   |  17   |    24 |  46   |    76 |

By lot area (ft2)

| lotarea   |      n |   p50 |   p90 |   p95 |   p99 |   max |
|:----------|-------:|------:|------:|------:|------:|------:|
| lt2k      | 135094 |     2 |   3   |     4 |   5   |    42 |
| 2-3k      | 289210 |     2 |   3   |     4 |   5   |    24 |
| 3-5k      | 173587 |     2 |   2.8 |     3 |   6   |    54 |
| 5-10k     |  57330 |     2 |   4   |     6 |  12   |    65 |
| 10-20k    |   9354 |     4 |   8   |    13 |  22   |    71 |
| 20-40k    |   1615 |     6 |  14   |    20 |  39   |    77 |
| 40kplus   |    550 |     6 |  24   |    33 |  58.5 |    98 |

### b Manhattan n=25853

By frontage (ft)

| lotfront   |     n |   p50 |   p90 |   p95 |   p99 |   max |
|:-----------|------:|------:|------:|------:|------:|------:|
| lt20       |  5815 |     3 |     5 |   5   |   6   |    16 |
| 20-30      | 11996 |     5 |     6 |   6   |   9   |    44 |
| 30-40      |  1312 |     5 |     6 |   7   |  13   |    23 |
| 40-60      |  2993 |     6 |     9 |  12   |  21   |    54 |
| 60-80      |  1100 |     6 |    15 |  20   |  34   |    65 |
| 80-120     |  1744 |     7 |    18 |  20   |  36.6 |    71 |
| 120-200    |   630 |     7 |    23 |  31   |  47.7 |    98 |
| 200plus    |   263 |    14 |    35 |  43.9 |  66.3 |    76 |

By lot area (ft2)

| lotarea   |    n |   p50 |   p90 |   p95 |   p99 |   max |
|:----------|-----:|------:|------:|------:|------:|------:|
| lt2k      | 8391 |     4 |   5   |   5   |   6   |    19 |
| 2-3k      | 9684 |     5 |   6   |   6   |   9   |    24 |
| 3-5k      | 3039 |     5 |   7   |  10   |  16   |    54 |
| 5-10k     | 2862 |     6 |  15   |  18   |  31   |    65 |
| 10-20k    | 1499 |     7 |  20   |  23   |  42   |    71 |
| 20-40k    |  269 |    12 |  33   |  38.6 |  45.6 |    77 |
| 40kplus   |  109 |    20 |  46.2 |  58.8 |  75.7 |    98 |

### c pre-1961 n=540358

By frontage (ft)

| lotfront   |      n |   p50 |   p90 |   p95 |   p99 |   max |
|:-----------|-------:|------:|------:|------:|------:|------:|
| lt20       |  75060 |     2 |   3   |   3.5 |   5   |    42 |
| 20-30      | 273894 |     2 |   3   |   4   |   5   |    16 |
| 30-40      |  57008 |     2 |   2.8 |   3   |   5   |    23 |
| 40-60      | 107514 |     2 |   2.8 |   4   |   6   |    25 |
| 60-80      |  15556 |     2 |   4   |   6   |  12   |    25 |
| 80-120     |   8348 |     3 |   6   |  12   |  17   |    41 |
| 120-200    |   2163 |     6 |   6   |  10   |  18.4 |    38 |
| 200plus    |    815 |     6 |   7   |  13   |  23.3 |    57 |

By lot area (ft2)

| lotarea   |      n |   p50 |   p90 |   p95 |   p99 |   max |
|:----------|-------:|------:|------:|------:|------:|------:|
| lt2k      | 109950 |     2 |   3   |   4   |   5   |    42 |
| 2-3k      | 241113 |     2 |   3   |   4   |   5   |    16 |
| 3-5k      | 135551 |     2 |   2.8 |   3   |   6   |    23 |
| 5-10k     |  45776 |     2 |   4   |   5.5 |   9   |    25 |
| 10-20k    |   6695 |     4 |   6   |  12   |  18.1 |    38 |
| 20-40k    |   1003 |     6 |   6   |  11   |  20   |    41 |
| 40kplus   |    270 |     6 |  13.1 |  18.5 |  35.8 |    57 |

### d post-2000 n=44471

By frontage (ft)

| lotfront   |     n |   p50 |   p90 |   p95 |   p99 |   max |
|:-----------|------:|------:|------:|------:|------:|------:|
| lt20       |  5178 |   3   |     4 |   4   |   5   |    16 |
| 20-30      | 20746 |   3   |     4 |   4.5 |   6.5 |    32 |
| 30-40      |  6359 |   2   |     3 |   4   |   7   |    31 |
| 40-60      |  8585 |   2   |     5 |   7   |  11   |    54 |
| 60-80      |  1696 |   2.5 |     8 |  11   |  25   |    65 |
| 80-120     |  1175 |   5   |    12 |  19   |  40   |    71 |
| 120-200    |   490 |   7   |    19 |  30   |  52.1 |    98 |
| 200plus    |   242 |   8   |    31 |  43   |  67.5 |    76 |

By lot area (ft2)

| lotarea   |     n |   p50 |   p90 |   p95 |   p99 |   max |
|:----------|------:|------:|------:|------:|------:|------:|
| lt2k      |  8768 |     3 |   4   |   4   |   5   |    32 |
| 2-3k      | 18064 |     3 |   4   |   5   |   6   |    22 |
| 3-5k      | 11602 |     2 |   4   |   6   |   8   |    54 |
| 5-10k     |  4616 |     2 |   8   |   9   |  21   |    65 |
| 10-20k    |  1017 |     6 |  13   |  22   |  44.8 |    71 |
| 20-40k    |   297 |     8 |  19.4 |  33.8 |  53.2 |    77 |
| 40kplus   |   107 |    12 |  42.4 |  58.2 |  75.8 |    98 |

### e Manhattan post-2000 n=1173

By frontage (ft)

| lotfront   |   n |   p50 |   p90 |   p95 |   p99 |   max |
|:-----------|----:|------:|------:|------:|------:|------:|
| lt20       | 134 |   4   |   6   |   7   |  12   |    16 |
| 20-30      | 389 |   6   |  10   |  13.6 |  21.1 |    24 |
| 30-40      |  51 |   6   |  11   |  16.5 |  20.5 |    22 |
| 40-60      | 187 |   8   |  21   |  32.4 |  38.3 |    54 |
| 60-80      | 124 |  11   |  26.7 |  35   |  61   |    65 |
| 80-120     | 136 |  12   |  33   |  40.2 |  59.9 |    71 |
| 120-200    | 100 |  13   |  44.1 |  52   |  77.2 |    98 |
| 200plus    |  52 |  19.5 |  56.7 |  66.7 |  74   |    76 |

By lot area (ft2)

| lotarea   |   n |   p50 |   p90 |   p95 |   p99 |   max |
|:----------|----:|------:|------:|------:|------:|------:|
| lt2k      | 156 |   4   |   7   |   9.2 |  13.8 |    19 |
| 2-3k      | 374 |   6   |   9   |  12   |  20.3 |    22 |
| 3-5k      | 146 |   8   |  19.5 |  22.8 |  34.7 |    54 |
| 5-10k     | 269 |   9   |  25.2 |  35   |  51   |    65 |
| 10-20k    | 147 |  12   |  37   |  47.4 |  63   |    71 |
| 20-40k    |  51 |  14   |  39   |  43.5 |  67   |    77 |
| 40kplus   |  30 |  32.5 |  70.2 |  74.2 |  91.6 |    98 |

### f irregular all n=97742

By frontage (ft)

| lotfront   |     n |   p50 |   p90 |   p95 |   p99 |   max |
|:-----------|------:|------:|------:|------:|------:|------:|
| lt20       | 10274 |     2 |     3 |     4 |   5   |    29 |
| 20-30      | 32596 |     2 |     3 |     4 |   6   |    67 |
| 30-40      | 12169 |     2 |     3 |     4 |   6   |    42 |
| 40-60      | 20807 |     2 |     3 |     5 |   8   |    55 |
| 60-80      |  7416 |     2 |     5 |     7 |  17   |    90 |
| 80-120     |  7536 |     2 |     7 |    12 |  29   |    82 |
| 120-200    |  4081 |     6 |    13 |    20 |  41   |    70 |
| 200plus    |  2863 |     6 |    20 |    28 |  44.4 |    74 |

By lot area (ft2)

| lotarea   |     n |   p50 |   p90 |   p95 |   p99 |   max |
|:----------|------:|------:|------:|------:|------:|------:|
| lt2k      | 19768 |   2   |     3 |     4 |   5   |    14 |
| 2-3k      | 25622 |   2   |     3 |     4 |   6   |    33 |
| 3-5k      | 25685 |   2   |     3 |     4 |   7   |    57 |
| 5-10k     | 15826 |   2   |     5 |     7 |  15   |    71 |
| 10-20k    |  6320 |   3.9 |     9 |    15 |  32   |    78 |
| 20-40k    |  2570 |   6   |    19 |    31 |  50.3 |    90 |
| 40kplus   |  1951 |   6   |    22 |    30 |  47   |    74 |

### Reference lots (frontage +-10pct, area +-15pct)

| cut                   | lot         |      n |   p50 |   p95 |   p99 |   max |
|:----------------------|:------------|-------:|------:|------:|------:|------:|
| a all regular         | 25x100      | 138709 |  2    |  4    |  5    |    24 |
| a all regular         | 25x120      |  37950 |  2    |  4    |  5    |    27 |
| a all regular         | 50x100      |  34878 |  2    |  5    |  8    |    54 |
| a all regular         | 75x100      |   5939 |  2.5  |  8    | 16    |    65 |
| a all regular         | 100x100     |   4466 |  4    | 13    | 20    |    56 |
| a all regular         | 137.5x137.5 |    210 |  6    | 14.65 | 32.01 |    53 |
| a all regular         | 200x275     |     55 |  7    | 34.5  | 49.2  |    60 |
| b Manhattan           | 25x100      |   6041 |  5    |  6    | 10    |    24 |
| b Manhattan           | 25x120      |   1641 |  5    |  7    | 12    |    22 |
| b Manhattan           | 50x100      |   1582 |  6    | 13    | 21    |    54 |
| b Manhattan           | 75x100      |    717 |  6    | 19    | 31.84 |    65 |
| b Manhattan           | 100x100     |    839 |  6    | 20    | 33.86 |    56 |
| b Manhattan           | 137.5x137.5 |     22 |  7    | 32.45 | 40.11 |    42 |
| b Manhattan           | 200x275     |     17 | 21    | 44    | 56.8  |    60 |
| c pre-1961            | 25x100      | 117763 |  2    |  4    |  5    |    16 |
| c pre-1961            | 25x120      |  30758 |  2    |  4    |  5    |    16 |
| c pre-1961            | 50x100      |  28727 |  2    |  5    |  6    |    20 |
| c pre-1961            | 75x100      |   4407 |  2.5  |  7    | 15    |    25 |
| c pre-1961            | 100x100     |   3132 |  4    | 12    | 17    |    29 |
| c pre-1961            | 137.5x137.5 |    156 |  6    |  8    | 18.45 |    20 |
| c pre-1961            | 200x275     |     20 |  6    | 21.6  | 30.72 |    33 |
| d post-2000           | 25x100      |   8361 |  2.75 |  5    |  7    |    22 |
| d post-2000           | 25x120      |   2427 |  2    |  5    |  7    |    22 |
| d post-2000           | 50x100      |   2264 |  2    |  8    | 17.37 |    54 |
| d post-2000           | 75x100      |    562 |  4    | 12.95 | 30.34 |    65 |
| d post-2000           | 100x100     |    425 |  6    | 20    | 36.52 |    49 |
| d post-2000           | 137.5x137.5 |     30 |  7    | 28.95 | 49.81 |    53 |
| d post-2000           | 200x275     |     16 |  8.5  | 39.75 | 55.95 |    60 |
| e Manhattan post-2000 | 25x100      |    204 |  6    | 14    | 20.82 |    22 |
| e Manhattan post-2000 | 25x120      |     45 |  6    | 15    | 21.56 |    22 |
| e Manhattan post-2000 | 50x100      |    122 |  8    | 31    | 44.11 |    54 |
| e Manhattan post-2000 | 75x100      |     73 |  8    | 34    | 54.92 |    65 |
| e Manhattan post-2000 | 100x100     |     58 | 12.5  | 35.3  | 43.72 |    46 |
| e Manhattan post-2000 | 137.5x137.5 |      2 | 24.5  | 40.25 | 41.65 |    42 |
| e Manhattan post-2000 | 200x275     |      3 | 33    | 57.3  | 59.46 |    60 |

### Tallest post-2000 regular lots (frontage le 60)

| borough   | bldgclass   |   lotfront |   lotdepth |   lotarea |   numfloors |   yearbuilt |
|:----------|:------------|-----------:|-----------:|----------:|------------:|------------:|
| MN        | R4          |      60    |     100.42 |      6025 |          64 |        2017 |
| MN        | D6          |      49.42 |     100    |      4942 |          54 |        2023 |
| MN        | R4          |      60    |     100.42 |      6024 |          51 |        2015 |
| MN        | RM          |      60    |     100.42 |      6024 |          48 |        2008 |
| QN        | D6          |      60    |     140    |      8338 |          48 |        2025 |
| MN        | RM          |      50    |     100.42 |      5020 |          46 |        2001 |
| MN        | RM          |      44.75 |     200    |     10692 |          37 |        2018 |
| MN        | D3          |      50    |     100.42 |      5021 |          37 |        2018 |
| MN        | RM          |      60    |     100.42 |      6025 |          36 |        2005 |
| MN        | D8          |      50    |      98.75 |      4938 |          36 |        2007 |
| MN        | RM          |      49.38 |     112    |      5530 |          35 |        2019 |
| MN        | D6          |      56    |     150    |      8400 |          35 |        2008 |

### Tallest post-2000 regular lots, all

| borough   | bldgclass   |   lotfront |   lotdepth |   lotarea |   numfloors |   yearbuilt |
|:----------|:------------|-----------:|-----------:|----------:|------------:|------------:|
| MN        | RM          |     150    |     200.84 |     55862 |          98 |        2013 |
| MN        | RM          |     159    |     100    |     23808 |          77 |        2009 |
| MN        | RM          |     210.37 |     197.97 |     41370 |          76 |        2007 |
| MN        | RM          |     286.73 |     330.95 |     94619 |          72 |        2015 |
| MN        | RM          |      85    |     125    |     10625 |          71 |        2024 |
| MN        | RM          |     384    |     212    |     81408 |          70 |        2015 |
| MN        | R4          |      75    |      98.75 |      7406 |          65 |        2014 |
| MN        | R4          |      60    |     100.42 |      6025 |          64 |        2017 |

### Slenderness (stories*10ft / min(front,depth)) post-2000, stories ge 30

| borough   |   lotfront |   lotdepth |   numfloors |   yearbuilt |   sl |
|:----------|-----------:|-----------:|------------:|------------:|-----:|
| BK        |       20   |       98.2 |          32 |        2013 | 16   |
| MN        |       49.4 |      100   |          54 |        2023 | 10.9 |
| MN        |       60   |      100.4 |          64 |        2017 | 10.7 |
| BK        |       30   |      317.3 |          31 |        2019 | 10.3 |
| MN        |       50   |      100.4 |          46 |        2001 |  9.2 |
| MN        |       75   |       98.8 |          65 |        2014 |  8.7 |
| MN        |       60   |      100.4 |          51 |        2015 |  8.5 |
| MN        |       85   |      125   |          71 |        2024 |  8.4 |
| MN        |       44.8 |      200   |          37 |        2018 |  8.3 |
| MN        |       40   |      110   |          33 |        2023 |  8.2 |

### c pre-1961 by min(front,depth)

| md      |      n |   p50 |   p90 |   p95 |   p99 |   max |
|:--------|-------:|------:|------:|------:|------:|------:|
| lt20    |  75116 |     2 |   3   |   3.5 |   5   |    42 |
| 20-30   | 274352 |     2 |   3   |   4   |   5   |    16 |
| 30-40   |  57131 |     2 |   2.8 |   3   |   5   |    23 |
| 40-60   | 108226 |     2 |   2.8 |   4   |   6   |    25 |
| 60-80   |  15542 |     2 |   5   |   6   |  12   |    25 |
| 80-120  |   9188 |     4 |   6   |  12   |  18   |    41 |
| 120-200 |    628 |     6 |   6   |  11   |  20   |    38 |
| 200plus |    175 |     6 |  14   |  20   |  43.3 |    57 |

### d post-2000 by min(front,depth)

| md      |     n |   p50 |   p90 |   p95 |   p99 |   max |
|:--------|------:|------:|------:|------:|------:|------:|
| lt20    |  5193 |   3   |   4   |   4   |   5   |    16 |
| 20-30   | 20909 |   3   |   4   |   4.5 |   6.5 |    32 |
| 30-40   |  6406 |   2   |   3.5 |   4.4 |   7   |    31 |
| 40-60   |  8578 |   2   |   6   |   7   |  12   |    54 |
| 60-80   |  1693 |   2.5 |   8   |  12   |  30   |    65 |
| 80-120  |  1433 |   6   |  13   |  21   |  44.7 |    77 |
| 120-200 |   188 |   8   |  30   |  42   |  62.1 |    98 |
| 200plus |    71 |  10   |  42   |  55.5 |  70.6 |    72 |
