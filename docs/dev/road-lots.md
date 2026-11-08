# Road-like lots: build note

The road-like rule keeps lots that are really street, median, slope or ramp strip out of the
candidates for building. The mechanism, thresholds and override file are in
[pipeline.md](pipeline.md) "Road-like lots". This file is the build note: the imagery review that
curated `pipeline/enrichment/road-lots.json`, and the lots the rule flags next to freeway land.

## Imagery review (2026-11-08)

**Method.** Esri World Imagery at each lot's box padded by 35%, with the DataSF parcel outline
drawn on, read by three reviewers (three batches). Verdicts are `road` (street, median, slope, ramp
strip, under a freeway), `not road` (a site, a building, a yard, a park) or `unclear`, with one line
of what is there.

**Counts.** 195 lots reviewed: 142 road, 17 not road, 36 unclear.

**Throwaway build (empty override file), `2026-11-08-beeafa9d`.** 582 road-like lots, 266
unhostable, 10,124 net homes. Per reason: r7 5,097, r1n 201, r2s 670, r3 4,156. Two flagged lots
carry roll units (`3714013`, `5431A010`).

**After the overrides, `2026-11-08-4350be8f`.** 493 road-like, 202 unhostable, 6,861 net homes. Per
reason: r7 3,560, r1n 201, r2s 438, r3 2,662. `road_like.kept` is 89 and `with_roll_units` is 1.

**Keep policy and rulings.**

- Every `not road` verdict gets a keep row.
- Unclear lots with homes that are partly buildable get keep rows.
- Unclear lots with 0 homes that cannot be built stay flagged (precision over recall, as the spec
  asks): `4991055` (scrub slope beside the Hwy 101 ramp) and `0817077` (half park, half Octavia roadway).
- Treasure Island and Yerba Buena Island are kept by the one block `1939` row (spec anti-goal). This
  covers the three `not road` lots there (`1939023`, `1939087`, `1939115`) and the unclear ones.
- Blocks `8953` and `8958` hold only Yerba Buena Island streets with 0 homes (`8953006`,
  `8958002`), not development parcels, so they get no row.
- `5431A028`, `5415013` and `2647048` are strips on imagery, so they get no row (24 homes if that
  is wrong).

The lists below are those of the plan's Task 7 step 2. A lot in several lists appears in each. For
a list of more than 20 lots, every `not road` and `unclear` lot is shown and the road lots are
counted. "Rules" is the reason code the build assigned; "Row" is what the override file holds for
the lot.

## Lists

### (a) Net homes over 50

| Lot     | Rules  | Land name                                 | Net homes | Verdict  | Row  |
| ------- | ------ | ----------------------------------------- | --------: | -------- | ---- |
| 4343031 | r7     | CESAR CHAVEZ ST RIGHT-OF-WAY              |       588 | unclear  | keep |
| 3767003 | r3     | -                                         |       401 | unclear  | keep |
| 3770002 | r7     | VACATED PORTION OF MAIN ST                |       199 | not road | keep |
| 4110010 | r2s    | PORT LANDS                                |        53 | unclear  | keep |
| 4382003 | r3     | ISLAIS CREEK FACILTY                      |       467 | not road | keep |
| 5269008 | r3     | Wholesale Produce Market                  |       214 | not road | keep |
| 4346001 | r7     | CESAR CHAVEZ ST RIGHT-OF-WAY              |       126 | unclear  | keep |
| 3069021 | r7     | PORTOLA DR (REMAINDER)                    |        77 | unclear  | keep |
| 4806015 | r7     | VACATED STREET                            |       375 | not road | keep |
| 3934001 | r3     | -                                         |       236 | unclear  | keep |
| 5851024 | r3     | -                                         |       171 | unclear  | keep |
| 3739013 | r7+r2s | East Clementina Right of Way              |        95 | unclear  | keep |
| 6946061 | r7     | GENEVA AVE PEDESTRIAN BRIDGE AT OCEAN AVE |        52 | unclear  | keep |

Not shown: 42 road rows (of 55 lots in this list; 5012 homes in the road rows), no row written.

### (b) Rule R3 alone

| Lot     | Rules | Land name                             | Net homes | Verdict  | Row        |
| ------- | ----- | ------------------------------------- | --------: | -------- | ---------- |
| 3767003 | r3    | -                                     |       401 | unclear  | keep       |
| 0916002 | r3    | PALACE PARK                           |         0 | not road | keep       |
| 1939087 | r3    | Treasure Island Development Authority |         0 | not road | block 1939 |
| 5331057 | r3    | Selby Palou Mini Park                 |         0 | not road | keep       |
| 4382003 | r3    | ISLAIS CREEK FACILTY                  |       467 | not road | keep       |
| 5269008 | r3    | Wholesale Produce Market              |       214 | not road | keep       |
| 7177048 | r3    | -                                     |         5 | not road | keep       |
| 1939023 | r3    | Treasure Island Development Authority |         0 | not road | block 1939 |
| 1939092 | r3    | Treasure Island Development Authority |         0 | unclear  | block 1939 |
| 4991055 | r3    | -                                     |         0 | unclear  | none       |
| 3934001 | r3    | -                                     |       236 | unclear  | keep       |
| 5851024 | r3    | -                                     |       171 | unclear  | keep       |
| 1939024 | r3    | Treasure Island Development Authority |         0 | unclear  | block 1939 |
| 5331055 | r3    | Selby Palou Mini Park                 |         0 | not road | keep       |

Not shown: 51 road rows (of 65 lots in this list; 2662 homes in the road rows), no row written.

### (c) Names containing PLAZA or CIRCLE

| Lot      | Rules | Land name              | Net homes | Verdict  | Row  |
| -------- | ----- | ---------------------- | --------: | -------- | ---- |
| 3714012  | r1n   | JUSTIN HERMAN PLAZA    |         0 | not road | keep |
| 4339002A | r7    | CESAR CHAVEZ ST CIRCLE |        40 | road     | none |
| 3714013  | r1n   | JUSTIN HERMAN PLAZA    |         0 | not road | keep |

### (d) Block 1939 or a block starting 89

| Lot     | Rules | Land name                             | Net homes | Verdict  | Row        |
| ------- | ----- | ------------------------------------- | --------: | -------- | ---------- |
| 1939087 | r3    | Treasure Island Development Authority |         0 | not road | block 1939 |
| 1939199 | r1n   | Treasure Island Development Authority |         0 | unclear  | block 1939 |
| 1939141 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939155 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939159 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939165 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939186 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939189 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939193 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939196 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939200 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939023 | r3    | Treasure Island Development Authority |         0 | not road | block 1939 |
| 1939092 | r3    | Treasure Island Development Authority |         0 | unclear  | block 1939 |
| 1939181 | r2s   | Treasure Island Development Authority |         0 | unclear  | block 1939 |
| 1939115 | r2s   | -                                     |         4 | not road | block 1939 |
| 1939143 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939156 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939160 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939168 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939182 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939187 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939190 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939194 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939197 | r2s   | Treasure Island Development Authority |         4 | unclear  | block 1939 |
| 1939024 | r3    | Treasure Island Development Authority |         0 | unclear  | block 1939 |
| 1939184 | r2s   | Treasure Island Development Authority |         0 | unclear  | block 1939 |

Not shown: 40 road rows (of 66 lots in this list; 111 homes in the road rows), no row written.

### (e) Nearest street Octavia, or land name PARCEL <letter>

| Lot     | Rules | Land name                       | Net homes | Verdict  | Row  |
| ------- | ----- | ------------------------------- | --------: | -------- | ---- |
| 0817067 | r2s   | PATRICIAS GREEN IN HAYES VALLEY |         0 | not road | keep |
| 0817077 | r2s   | PATRICIAS GREEN IN HAYES VALLEY |         0 | unclear  | none |

### (f) The three named lots

| Lot      | Rules | Land name                   | Net homes | Verdict | Row  |
| -------- | ----- | --------------------------- | --------: | ------- | ---- |
| 5431A028 | r1n   | -                           |        11 | road    | none |
| 5415013  | r1n   | -                           |        11 | road    | none |
| 2647048  | r1n   | CITY-OWNED PARCEL (2647048) |         2 | road    | none |

### (g) Housing departments (Mayor, CII, SFHA) or MOHCD/SFHA in the name

| Lot      | Rules  | Land name                                 | Net homes | Verdict  | Row  |
| -------- | ------ | ----------------------------------------- | --------: | -------- | ---- |
| 7000025  | r7     | JUNIPERO SERRA (REMAINDER)                |         7 | not road | keep |
| 6723030  | r7     | SAN JOSE AVE (REMAINDER AT CUVIER ST)     |         5 | not road | keep |
| 4591C102 | r2s    | OCII Parcels - Block 4591C                |         0 | not road | keep |
| 6946061  | r7     | GENEVA AVE PEDESTRIAN BRIDGE AT OCEAN AVE |        52 | unclear  | keep |
| 1866018F | r7+r1n | UNDEDICATED ALLEY                         |         5 | unclear  | keep |
| 4591D141 | r2s    | OCII Parcels - Block 4591D                |         0 | unclear  | keep |

Not shown: 27 road rows (of 33 lots in this list; 202 homes in the road rows), no row written.

## Name-word matches

Lots whose `landName` contains each word of `ROAD_NAME_WORDS` (`pipeline/lib/road-lots.ts`), over
the 582 flagged lots of the throwaway build. Counted with the repo's `roadNameWords`. A lot can match
more than one word, so the rows do not sum to the flagged total. Every word on the list matches at
least one live lot.

| Word              | Lots | Net homes |
| ----------------- | ---: | --------: |
| RIGHT-OF-WAY      |   27 |     1,361 |
| RIGHT OF WAY      |    2 |        95 |
| ROW               |   55 |       141 |
| R/W               |    9 |        55 |
| ROADWAY           |   13 |       470 |
| OVERPASS          |    2 |       341 |
| MERIDIAN          |    3 |        61 |
| SLOPE PROTECTION  |   72 |       723 |
| REMAINDER         |   30 |       381 |
| PEDESTRIAN BRIDGE |    1 |        52 |
| STRIP ALONG       |    5 |       327 |
| UNDEDICATED       |    9 |        76 |
| VACATED           |   12 |       612 |
| STREET AREA       |    3 |        66 |
| REALIGNMENT       |   12 |        24 |
| EXCESS PROPERTY   |    2 |         5 |
| WALKWAY           |    2 |       203 |
| TRAFFIC ISLAND    |    6 |        27 |
| FREEWAY           |    1 |        10 |
| BART TRACKS       |    3 |        21 |
| MEDIAN            |    4 |         6 |
| RELINQUISHMENT    |    1 |         0 |
| CHAVEZ ST CIRCLE  |    1 |        40 |

## Lots beside freed sites

Six lots touch the sites that freeway removal frees. Reason code and net homes are from the
rebuild `2026-11-08-4350be8f`. The phase is the /lesscars project whose freed site the lot touches,
where the freeway-land catalog or the plan names it.

| Lot        | Reason in rebuild | Net homes | Phase                                                                         |
| ---------- | ----------------- | --------: | ----------------------------------------------------------------------------- |
| `3758130`  | r3                |         4 | `i80-rincon` (within 15 m of its freed sites; see below)                      |
| `3761063`  | r3                |         4 | `i80-rincon` (catalog segment `i80-soma`; Yerba Buena Dog Park, listed `out`) |
| `4339002A` | r7                |        40 | `us101-james-lick` (listed `out`: across Bay Shore Blvd from the freeway)     |
| `5573023`  | r3                |       125 | `us101-bayshore` (within 15 m of its freed sites; see below)                  |
| `3526017`  | r3                |       217 | `us101-interchange` (within 15 m of its freed sites; see below)               |
| `3503004`  | not flagged       |         - | `central-freeway-stub` (McCoppin Hub plaza, listed `out`)                     |

For `3761063`, `4339002A` and `3503004` the phase is read from
`pipeline/enrichment/lesscars/plan.json` (the `freewayLand.excluded` rows of `i80-rincon`,
`us101-james-lick` and `central-freeway-stub`). The catalog and plan do not mention `3758130`,
`5573023` or `3526017`; their phases come from the 2026-11-07 investigation on
`2026-11-02-0d40e1e2`, which measured each lot as touching or within 15 m of that phase's
`lc:` sites in `sites.json`.

The five flagged lots stay unbuildable when their freeway comes down, because a road-like lot is not a candidate
and does not donate neighbour zoning to a freed site. They become buildable only if the owner adds
them to the freeway-land catalog, which is owner-approved and not changed here.

## Yerba Buena right-of-way

The investigation found `1939019` and `1939020`, the Yerba Buena Island right-of-way, with 4 homes
each. The imagery review calls both `road`. The block `1939` row keeps them anyway, as the spec
asks, because the island's lots are development parcels.

## Live build

Built 2026-11-08 on the owner's laptop (Apple M5 Pro, Mac17,9) as `2026-11-08-7d2097ac`, with the
road-like rule and the curated `pipeline/enrichment/road-lots.json` of the imagery review, from the
committed lock (unchanged). All 34 invariants passed, V17 and V18 included. The comparison version
is `2026-11-02-0d40e1e2`, the v1.1 live build before the rule; its values follow in brackets.

- **Time:** the phase timings in `report.json` sum to 177.2 s (2 min 57 s); `timings.scenario` was
  73.1 s and `timings.lesscars` 7.8 s. The build wrote `manifest.json` at 12:18 UTC.
- **Stop thresholds:** `scenario.road_like.net_removed` is 6,861 (limit 20,000). The /lesscars
  2068 extra mean is 29,095.78 against 29,080.99 (+0.05%, limit 5%). Both pass.
- **Warning line:** "scenario: road-like lots make 202 lots unbuildable, 6861 net homes of
  static capacity (r7 3560, r1n 201, r2s 438, r3 2662, override 0)", followed by "road-like lot(s)
  5431A010 have homes on the latest roll; they keep them and stay ineligible".

### Counts

| Count                             | Value |
| --------------------------------- | ----: |
| `road_like.candidates`            | 3,351 |
| `road_like.raw`                   |   582 |
| `road_like.raw.r7`                |   273 |
| `road_like.raw.r1n`               |   200 |
| `road_like.raw.r2s`               |   244 |
| `road_like.raw.r3`                |    76 |
| `road_like.kept`                  |    89 |
| `road_like.listed`                |     0 |
| `road_like.lots` (flagged)        |   493 |
| `road_like.catalog_excluded`      |   481 |
| `road_like.city_lands.rows`       | 1,035 |
| `road_like.city_lands.named_lots` | 2,364 |
| `road_like.city_lands.unmatched`  |   108 |

The raw rows are the lots the rule flags before the override file; they sum to more than 582
because a lot can fire several rules. The 582 raw lots less the 89 kept leave the 493 flagged. The
lots by first firing reason are `road_like.lots.r7` 260, `.r1n` 124, `.r2s` 60, `.r3` 49 and
`.override` 0. The quality rule `sd.parcels.road-like` fires on 493 of 155,020 parcels.

### Lots and homes removed

| Reason   | Lots flagged | Unhostable lots | Net homes removed | Hectares (unhostable) |
| -------- | -----------: | --------------: | ----------------: | --------------------: |
| r7       |          260 |             112 |             3,560 |                  9.10 |
| r1n      |          124 |              31 |               201 |                  0.56 |
| r2s      |           60 |              19 |               438 |                  4.44 |
| r3       |           49 |              40 |             2,662 |                  8.09 |
| override |            0 |               0 |                 0 |                  0.00 |
| Total    |          493 |             202 |             6,861 |                 22.18 |

The columns are `scenario.road_like.lots.*`, `scenario.road_like.unhostable.*` and
`scenario.road_like.net_removed.*`. An unhostable lot is one that would have been hostable without
the rule. The hectares are the summed `areaM2` of the 202 unhostable lots in `road-lots.csv`
(221,832 m²). The csv has no hostable column, so they are the flagged lots with net homes above 0;
their per-reason counts equal the `unhostable` counters (112, 31, 19, 40). The other 291 flagged
lots have no net homes. All 493 flagged lots cover 51.33 ha.
`scenario.road_like.with_roll_units` is 1 (`5431A010`, which keeps its roll homes and stays
ineligible).

### Calibration change

The rule changes the T13 panel's `hostable_base`, so the initiation fit moves. Everything else in
`calibration.json` is unchanged: `asOf` (day 20745), `schema`, `pathwayForNew`, `phaseGap`,
`ppaShare`, `revision`, `size`, `streamlinedForLocalProgram` and all `transitions`. The changed
fields are `initiation.intercept`, the 48 bin coefficients in `initiation.terms`, and
`initiation.provenance.method` (the basis coefficient in its text). The calibration report has one
initiation window (2007-01 to 2025-12), so these are its totals; the transition fitting windows
(report section 2) do not change.

| Measure (`calibration-report.md`)     |        Now |     Before |
| ------------------------------------- | ---------: | ---------: |
| hostable parcel-years                 |  2,771,882 |  2,775,539 |
| exposure, parcel-months               | 32,842,859 | 32,886,359 |
| parcel-years excluded                 |    151,515 |    147,858 |
| events (record 720, permit 551)       |      1,271 |      1,271 |
| intercept                             |   -9.47037 |   -9.49528 |
| measurement-basis coefficient         |   0.155844 |   0.158139 |
| `impliedSteadyState`, events per year |    82.0551 |    82.1869 |
| `fzpPerYear`                          |    77.5169 |    77.5281 |
| hostable unoccupied parcels           |    145,852 |    146,051 |
| `fzpRatio`                            |   0.944693 |   0.943313 |
| FZP over historical mean              |    1.15879 |    1.15896 |
| hold-out predicted (observed 128)     |    386.767 |    386.941 |

The parcel-years excluded rise in every roll year, by 188 in 2007 (8,060 against 7,872) and 201 in
2025 (7,989 against 7,788). The event counts are unchanged (1,271, with 236 off the panel and 199
on covered parcel-months), so the exposure falls by 0.13% and the hazard rises with it: the
intercept moves by +0.0249 (about 2.5% on the hazard) and `fzpRatio` by +0.0014.

### /lesscars

| 2068             |     Now |  Before |
| ---------------- | ------: | ------: |
| mean extra homes | +29,096 | +29,081 |
| p10              |  28,381 |  28,371 |
| p50              |  29,184 |  29,175 |
| p90              |  29,526 |  29,505 |
| plan             | 116,212 | 116,181 |
| baseline         |  87,116 |  87,100 |

By source, as the page rounds it (largest remainder, summing to 29,096): freed 22,959 (22,947),
parking 6,018 (6,020), transit-unlocked 119 (114), other 0.

`lesscars.sites` is 166, as before, and `lesscars.sites.parcels` (115), `.held` (1),
`.zero_gain_parking` (2) and the freed area (`lesscars.freed_m2.parcels` 388,806 m² and `.row`
42,951 m²) are unchanged; every site's outline and parcel list in `sites.json` are the same.
`lesscars.sites.zero_yield` rises from 15 to 17, and the freed homes at 2068 rise by 12 (22,947 to
22,959). This is the `notNeighboursOf` change (see [lesscars.md](lesscars.md)): road-like lots no
longer lend their zoning to a freed site, which moves what its neighbours allow. The mean moves by
+15 homes, inside the p10 to p90 band (1,145 wide).

### Bytes and what did not move

`scenarios/fzp/parcels.bin` is 2,106,151 B (2,106,971 B). Equal to `2026-11-02-0d40e1e2`:

- `scenarios/fzp/projects.json` `asOf` is day 20745.
- `transit.json` is byte-identical (Muni 2026-08-25; BART and Caltrain 2026-10-20).
- The parcel count is 155,020, in the same 144 chunks.
- The chunk geometry is equal: in every one of the 144 chunks `count`, `id`, `xy` and `rings`
  match. Only `datasetVersion` (all chunks), `elig` (72 chunks) and `rl` (78 chunks) differ.
- `buildings.pmtiles` is byte-identical (16,421,419 B). Its feature count was not counted; equal
  bytes imply equal features.
