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
| `3758130`  | r3                |         4 | Not in the catalog or the plan; see below                                     |
| `3761063`  | r3                |         4 | `i80-rincon` (catalog segment `i80-soma`; Yerba Buena Dog Park, listed `out`) |
| `4339002A` | r7                |        40 | `us101-james-lick` (listed `out`: across Bay Shore Blvd from the freeway)     |
| `5573023`  | r3                |       125 | Not in the catalog or the plan; see below                                     |
| `3526017`  | r3                |       217 | Not in the catalog or the plan; see below                                     |
| `3503004`  | not flagged       |         - | `central-freeway-stub` (McCoppin Hub plaza, listed `out`)                     |

For `3761063`, `4339002A` and `3503004` the phase is read from
`pipeline/enrichment/lesscars/plan.json` (the `freewayLand.excluded` rows of `i80-rincon`,
`us101-james-lick` and `central-freeway-stub`). The catalog and plan do not mention `3758130`,
`5573023` or `3526017`, so the phase could not be determined from the files. By position only
(unverified): `3758130` (I-80 eastbound near 7th and Bryant) is in the I-80 SoMa area, `3526017`
(beside the US-101 southbound on-ramp at 13th and Mission) in the Central Freeway area, and
`5573023` (US-101 northbound at Silver Ave) in the US-101 Bayshore area.

All six stay unbuildable when their freeway comes down, because a road-like lot is not a candidate
and does not donate neighbour zoning to a freed site. They become buildable only if the owner adds
them to the freeway-land catalog, which is owner-approved and not changed here.

## Yerba Buena right-of-way

The investigation found `1939019` and `1939020`, the Yerba Buena Island right-of-way, with 4 homes
each. The imagery review calls both `road`. The block `1939` row keeps them anyway, as the spec
asks, because the island's lots are development parcels.
