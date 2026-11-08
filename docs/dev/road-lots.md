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
- Treasure Island is kept by the block `1939` row (spec anti-goal). This covers the three `not road` lots there (`1939023`, `1939087`, `1939115`) and the unclear ones.
- Blocks `8953` and `8958` (Yerba Buena Island; lots `8953006` and `8958002`, 0 homes, imagery
  `road`) are kept by block rows, as the spec asks.
- `5431A028`, `5415013` and `2647048` are strips on imagery, so they get no row (24 homes if that
  is wrong).

The lists below are those of the plan's Task 7 step 2. A lot in several lists appears in each, and
every list shows every lot, road rows included, with the reviewer's one line of what the imagery
shows. "Rules" is the reason code the build assigned; "Row" is what the override file holds for the
lot (`keep`, a block row, or `none`).

## Lists

### (a) Net homes over 50

| Lot       | Rules  | Land name                                   | Net homes | Verdict  | Row  | What was seen                                                                                                                                                                                                                                |
| --------- | ------ | ------------------------------------------- | --------: | -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4382003   | r3     | ISLAIS CREEK FACILTY                        |       467 | not road | keep | Muni Islais Creek bus yard: east half rows of parked buses; west half is ground under the I-280 viaduct                                                                                                                                      |
| 4806015   | r7     | VACATED STREET                              |       375 | not road | keep | vacant grassy field by Yosemite Slough (open land, no street, curb or pavement); vacated-street name only                                                                                                                                    |
| 5269008   | r3     | Wholesale Produce Market                    |       214 | not road | keep | Wholesale Produce Market internal strip: small building, parking and truck aisle; NW tip under I-280                                                                                                                                         |
| 3770002   | r7     | VACATED PORTION OF MAIN ST                  |       199 | not road | keep | Surface parking lot (vacated Main St, Port) by The Embarcadero, striped stalls and parked cars; no roadway                                                                                                                                   |
| 4343031   | r7     | CESAR CHAVEZ ST RIGHT-OF-WAY                |       588 | unclear  | keep | ~30 m wide paved strip (no street centreline within 121 m): private access drive lined with parked cars, equipment and storage; NE end widens into a surface parking lot. Not a public street; reads as an old rail ROW used as parking/yard |
| 3767003   | r3     | -                                           |       401 | unclear  | keep | I-80 elevated deck crosses the middle; NW side is shaded ground-level lanes/parking beside the deck; SE corner is surface parking with small sheds outside the deck                                                                          |
| 3934001   | r3     | -                                           |       236 | unclear  | keep | west ~55% is the elevated I-80/101 freeway deck; east ~40% looks like an open surface parking lot alongside (rollClass PLG)                                                                                                                  |
| 5851024   | r3     | -                                           |       171 | unclear  | keep | 101/280 interchange infield: ramps cross the lot, but the middle holds a small building and paved yard between ramp spans                                                                                                                    |
| 4346001   | r7     | CESAR CHAVEZ ST RIGHT-OF-WAY                |       126 | unclear  | keep | Mixed: west half is Cesar Chavez/Evans roadway; east half is an open construction lay-down/storage yard (buildable-looking)                                                                                                                  |
| 3739013   | r7+r2s | East Clementina Right of Way                |        95 | unclear  | keep | deep tower shadow; strip between a track-like staging area and new towers in Transbay, looks like construction ground; cannot read                                                                                                           |
| 3069021   | r7     | PORTOLA DR (REMAINDER)                      |        77 | unclear  | keep | Wooded remainder lot behind houses off Portola Dr with a dirt path; no street on it; slope not judgeable under canopy, may be buildable                                                                                                      |
| 4110010   | r2s    | PORT LANDS                                  |        53 | unclear  | keep | Imagery: a strip of a large striped surface parking lot at Pier 70, no roadway; but it sits exactly on the 21st St centreline (streetShare 1), likely the mapped/planned 21st St extension                                                   |
| 6946061   | r7     | GENEVA AVE PEDESTRIAN BRIDGE AT OCEAN AVE   |        52 | unclear  | keep | wooded corner triangle by Geneva/San Jose with the pedestrian bridge landing over its north edge; adjoins a building, could be a small site                                                                                                  |
| 4168011   | r3     | -                                           |       407 | road     | none | I-280 elevated/at-grade lanes plus a thin vegetated margin                                                                                                                                                                                   |
| 3794026   | r7     | KING BLVD ROADWAY PROJECT                   |       398 | road     | none | King St roadway with light-rail median and sidewalk trees                                                                                                                                                                                    |
| 7380029   | r7     | JUNIPERO SERRA OVERPASS                     |       337 | road     | none | Wooded embankment and the Junipero Serra overpass ramp road between the golf course and the boulevard                                                                                                                                        |
| 6949011   | r3     | -                                           |       284 | road     | none | Strip between I-280 and Balboa Park station: paved access lane and trees; south tip clips the station canopy                                                                                                                                 |
| 3526017   | r3     | -                                           |       217 | road     | none | Hwy 101 on-ramp and its elevated curve, with landscaped ramp verge; small slice of parking under the ramp                                                                                                                                    |
| 3794029   | r7     | CHINA BASIN WALKWAY (ADJACENT TO BALL PARK) |       203 | road     | none | China Basin waterfront promenade/walkway strip along the ballpark                                                                                                                                                                            |
| 4227045   | r3     | -                                           |       181 | road     | none | I-280 viaducts, on-ramp and landscaped right-of-way between them                                                                                                                                                                             |
| 3784079   | r3     | -                                           |       139 | road     | none | I-280 at-grade lanes at the King St terminus plus a strip of parked cars along the median                                                                                                                                                    |
| 4347001   | r7     | CESAR CHAVEZ ST RIGHT-OF-WAY                |       125 | road     | none | sidewalk/frontage strip along Cesar Chavez St (under construction)                                                                                                                                                                           |
| 5573023   | r3     | -                                           |       125 | road     | none | Hwy 101 mainline lanes cover most of the lot; SE corner takes in parts of two commercial buildings and trees                                                                                                                                 |
| 4040031   | r3     | -                                           |       119 | road     | none | I-280 lanes and landscaped embankment                                                                                                                                                                                                        |
| 4063001   | r3     | -                                           |       118 | road     | none | I-280 on-ramp lanes plus wooded embankment                                                                                                                                                                                                   |
| 4353001   | r7     | CESAR CHAVEZ ST RIGHT-OF-WAY                |       117 | road     | none | Narrow strip along the south side of Cesar Chavez St: sidewalk, street trees and edge of an adjoining parking lot; small shed at east end                                                                                                    |
| 4227033   | r3     | -                                           |       115 | road     | none | I-280 lanes, on-ramp and slope; small parking pad corner at SE                                                                                                                                                                               |
| 5431A010  | r7     | BAY SHORE BLVD (REMAINDER)                  |       108 | road     | none | wedge of Bayshore Blvd roadway, sidewalk and edge strip                                                                                                                                                                                      |
| 5368033   | r3     | -                                           |       104 | road     | none | I-280 elevated deck and wooded embankment beneath                                                                                                                                                                                            |
| 4227009   | r3     | -                                           |       103 | road     | none | I-280 on-ramp and wooded right-of-way beside it                                                                                                                                                                                              |
| 6900004   | r7     | 20'' STRIP ALONG E LINE                     |       103 | road     | none | M-line rail median on Junipero Serra/19th Ave                                                                                                                                                                                                |
| 6900001   | r7     | 20'' STRIP ALONG E LINE                     |        98 | road     | none | 6 m wide strip running ~1.5 km along the east side of Junipero Serra Blvd (verge/landscape strip)                                                                                                                                            |
| 6692068   | r7     | SLOPE PROTECTION AT RANDALL                 |        96 | road     | none | Wooded slope between I-280 and houses; possible small shed near SW end                                                                                                                                                                       |
| 4347B007  | r3     | -                                           |        92 | road     | none | Sliver under/along the I-280 southbound elevated deck                                                                                                                                                                                        |
| 3998009   | r3     | -                                           |        84 | road     | none | I-280 off-ramp viaduct and planted strip beside a building                                                                                                                                                                                   |
| 5846011   | r7+r2s | SLOPE PROTECTION-ALEMANY BLVD               |        84 | road     | none | Alemany ramp roadway and embankment strip                                                                                                                                                                                                    |
| 3619033A  | r7     | CHURCH ST MUNI RIGHT-OF-WAY                 |        81 | road     | none | J-Church Muni track corridor through the block behind houses                                                                                                                                                                                 |
| 4104020   | r3     | -                                           |        77 | road     | none | I-280 lanes plus wooded embankment                                                                                                                                                                                                           |
| 4349013   | r3     | ISLAIS CREEK FACILTY                        |        76 | road     | none | Under I-280 southbound deck at Islais Creek                                                                                                                                                                                                  |
| 6693024   | r7     | SLOPE PROTECTION AT RANDALL                 |        73 | road     | none | San Jose Ave lane and vegetated slope below houses                                                                                                                                                                                           |
| 7096B001A | r7     | ALEMANY BLVD (REMAINDER AT FARAGUT)         |        73 | road     | none | landscaped/vegetated buffer strip between Alemany Blvd and house backs                                                                                                                                                                       |
| 6725003   | r7     | SLOPE PROTECTION AT RANDALL                 |        70 | road     | none | Wooded slope between San Jose Ave/Randall and the local street; tiny shed at the wide end                                                                                                                                                    |
| 2659059   | r7     | MARKET ST REMAINDER                         |        69 | road     | none | Wooded wedge on the slope between upper Market St and Corbett Ave; Market St parking shoulder along its edge                                                                                                                                 |
| 6686032   | r7     | SLOPE PROTECTION AT RANDALL                 |        69 | road     | none | wooded embankment beside San Jose Ave plus part of the roadway                                                                                                                                                                               |
| 3999011   | r3     | -                                           |        68 | road     | none | I-280 on-ramp and mainline lanes                                                                                                                                                                                                             |
| 4624454   | r2s    | SFHA -- Hunters View                        |        67 | road     | none | Hunters View new street loop (Memory Ln) with parking; the vacant blocks are outside the outline                                                                                                                                             |
| 6900005   | r7     | 20'' STRIP ALONG E LINE                     |        66 | road     | none | M-line rail median on 19th Ave near Randolph                                                                                                                                                                                                 |
| 7298004   | r7+r1n | UNDEDICATED STREET (WINSTON DR)             |        66 | road     | none | Curving strip along Winston Dr: road edge, sidewalk and landscaped verge                                                                                                                                                                     |
| 5203037   | r7     | Burke Ave ROW Parcel SE                     |        64 | road     | none | Burke Ave cul-de-sac bulb                                                                                                                                                                                                                    |
| 6661021   | r7     | SLOPE PROTECTION AT RANDALL                 |        62 | road     | none | tree-covered median/slope between San Jose Ave and its frontage street                                                                                                                                                                       |
| 3999012   | r3     | -                                           |        61 | road     | none | I-280 on-ramp lanes, mainline and verge at the street junction                                                                                                                                                                               |
| 0725026   | r7     | Ellis St ROW                                |        56 | road     | none | Paved Ellis St stub between two buildings: trees, parked cars, sidewalk                                                                                                                                                                      |
| 3606022   | r7     | CHURCH ST MUNI RIGHT-OF-WAY                 |        54 | road     | none | J-Church track right-of-way corridor (outline slightly overlaps a neighbouring building)                                                                                                                                                     |
| 4355001   | r7     | CESAR CHAVEZ ST RIGHT-OF-WAY                |        52 | road     | none | Cesar Chavez parking lane and sidewalk tree strip along a warehouse                                                                                                                                                                          |
| 3606053   | r7     | CHURCH ST MUNI RIGHT-OF-WAY                 |        51 | road     | none | J-Church Muni track curve through the block                                                                                                                                                                                                  |

### (b) Rule R3 alone

| Lot      | Rules | Land name                             | Net homes | Verdict  | Row        | What was seen                                                                                                                                                       |
| -------- | ----- | ------------------------------------- | --------: | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4382003  | r3    | ISLAIS CREEK FACILTY                  |       467 | not road | keep       | Muni Islais Creek bus yard: east half rows of parked buses; west half is ground under the I-280 viaduct                                                             |
| 5269008  | r3    | Wholesale Produce Market              |       214 | not road | keep       | Wholesale Produce Market internal strip: small building, parking and truck aisle; NW tip under I-280                                                                |
| 7177048  | r3    | -                                     |         5 | not road | keep       | Corner of a paved parking/business yard beside the I-280 tree buffer                                                                                                |
| 0916002  | r3    | PALACE PARK                           |         0 | not road | keep       | Palace of Fine Arts: landmark building, lagoon and park                                                                                                             |
| 1939023  | r3    | Treasure Island Development Authority |         0 | not road | block 1939 | Large YBI parcel: Coast Guard station buildings, lawn, wooded hillside and shoreline                                                                                |
| 1939087  | r3    | Treasure Island Development Authority |         0 | not road | block 1939 | 10 ha of Yerba Buena Island hillside: shoreline, scrub, open slope and a road under construction; most of it is far from I-80 (YBI-OS/R/MU zoning)                  |
| 5331055  | r3    | Selby Palou Mini Park                 |         0 | not road | keep       | Selby Palou Mini Park: playground and trees                                                                                                                         |
| 5331057  | r3    | Selby Palou Mini Park                 |         0 | not road | keep       | Selby Palou Mini Park: lawn, sport court and trees beside I-280                                                                                                     |
| 3767003  | r3    | -                                     |       401 | unclear  | keep       | I-80 elevated deck crosses the middle; NW side is shaded ground-level lanes/parking beside the deck; SE corner is surface parking with small sheds outside the deck |
| 3934001  | r3    | -                                     |       236 | unclear  | keep       | west ~55% is the elevated I-80/101 freeway deck; east ~40% looks like an open surface parking lot alongside (rollClass PLG)                                         |
| 5851024  | r3    | -                                     |       171 | unclear  | keep       | 101/280 interchange infield: ramps cross the lot, but the middle holds a small building and paved yard between ramp spans                                           |
| 1939024  | r3    | Treasure Island Development Authority |         0 | unclear  | block 1939 | Bay Bridge YBI interchange infield: wooded hill, access road loops, parking and a small building cluster                                                            |
| 1939092  | r3    | Treasure Island Development Authority |         0 | unclear  | block 1939 | Mostly open water (Clipper Cove/bay) plus a Bay Bridge segment and YBI shoreline; unbuildable either way                                                            |
| 4991055  | r3    | -                                     |         0 | unclear  | none       | Hwy 101/Alemany ramp at the west edge; mostly open scrub hillside abutting houses, likely slope but steepness not judgeable                                         |
| 4168011  | r3    | -                                     |       407 | road     | none       | I-280 elevated/at-grade lanes plus a thin vegetated margin                                                                                                          |
| 6949011  | r3    | -                                     |       284 | road     | none       | Strip between I-280 and Balboa Park station: paved access lane and trees; south tip clips the station canopy                                                        |
| 3526017  | r3    | -                                     |       217 | road     | none       | Hwy 101 on-ramp and its elevated curve, with landscaped ramp verge; small slice of parking under the ramp                                                           |
| 4227045  | r3    | -                                     |       181 | road     | none       | I-280 viaducts, on-ramp and landscaped right-of-way between them                                                                                                    |
| 3784079  | r3    | -                                     |       139 | road     | none       | I-280 at-grade lanes at the King St terminus plus a strip of parked cars along the median                                                                           |
| 5573023  | r3    | -                                     |       125 | road     | none       | Hwy 101 mainline lanes cover most of the lot; SE corner takes in parts of two commercial buildings and trees                                                        |
| 4040031  | r3    | -                                     |       119 | road     | none       | I-280 lanes and landscaped embankment                                                                                                                               |
| 4063001  | r3    | -                                     |       118 | road     | none       | I-280 on-ramp lanes plus wooded embankment                                                                                                                          |
| 4227033  | r3    | -                                     |       115 | road     | none       | I-280 lanes, on-ramp and slope; small parking pad corner at SE                                                                                                      |
| 5368033  | r3    | -                                     |       104 | road     | none       | I-280 elevated deck and wooded embankment beneath                                                                                                                   |
| 4227009  | r3    | -                                     |       103 | road     | none       | I-280 on-ramp and wooded right-of-way beside it                                                                                                                     |
| 4347B007 | r3    | -                                     |        92 | road     | none       | Sliver under/along the I-280 southbound elevated deck                                                                                                               |
| 3998009  | r3    | -                                     |        84 | road     | none       | I-280 off-ramp viaduct and planted strip beside a building                                                                                                          |
| 4104020  | r3    | -                                     |        77 | road     | none       | I-280 lanes plus wooded embankment                                                                                                                                  |
| 4349013  | r3    | ISLAIS CREEK FACILTY                  |        76 | road     | none       | Under I-280 southbound deck at Islais Creek                                                                                                                         |
| 3999011  | r3    | -                                     |        68 | road     | none       | I-280 on-ramp and mainline lanes                                                                                                                                    |
| 3999012  | r3    | -                                     |        61 | road     | none       | I-280 on-ramp lanes, mainline and verge at the street junction                                                                                                      |
| 5333037  | r3    | -                                     |        41 | road     | none       | Ground under the I-280 viaduct beside buildings                                                                                                                     |
| 4226007  | r3    | -                                     |        39 | road     | none       | I-280 southbound lanes and shoulder                                                                                                                                 |
| 4227013B | r3    | -                                     |        28 | road     | none       | dirt/debris triangle between the two elevated I-280 decks                                                                                                           |
| 4168005  | r3    | -                                     |        24 | road     | none       | I-280 lanes and wooded slope                                                                                                                                        |
| 7154053  | r3    | -                                     |        18 | road     | none       | tree strip on the freeway/rail embankment behind house backyards                                                                                                    |
| 3999007  | r3    | -                                     |        14 | road     | none       | Vegetated traffic island inside the I-280 off-ramp loop                                                                                                             |
| 4227019  | r3    | -                                     |        12 | road     | none       | I-280 lanes                                                                                                                                                         |
| 4227008  | r3    | -                                     |        10 | road     | none       | wooded margin beside the I-280 ramp (small, next to a parking area)                                                                                                 |
| 4227018  | r3    | -                                     |        10 | road     | none       | I-280 northbound lanes and verge trees                                                                                                                              |
| 4227020  | r3    | -                                     |        10 | road     | none       | I-280 lanes and ramp edge                                                                                                                                           |
| 4227021  | r3    | -                                     |        10 | road     | none       | I-280 lanes and ramp                                                                                                                                                |
| 4227015  | r3    | -                                     |         9 | road     | none       | I-280 northbound lanes and verge                                                                                                                                    |
| 4227016  | r3    | -                                     |         9 | road     | none       | I-280 lanes                                                                                                                                                         |
| 4227017  | r3    | -                                     |         9 | road     | none       | I-280 lanes                                                                                                                                                         |
| 5377054  | r3    | -                                     |         9 | road     | none       | I-280 southbound elevated lanes                                                                                                                                     |
| 3999006  | r3    | -                                     |         7 | road     | none       | Planted island inside the I-280 off-ramp loop                                                                                                                       |
| 5377049  | r3    | -                                     |         7 | road     | none       | I-280 ramp deck over brush                                                                                                                                          |
| 3999005  | r3    | -                                     |         5 | road     | none       | I-280 off-ramp roadway                                                                                                                                              |
| 5368011  | r3    | -                                     |         5 | road     | none       | I-280 lanes plus embankment sliver                                                                                                                                  |
| 5392033  | r3    | -                                     |         5 | road     | none       | I-280 northbound elevated ramp lanes                                                                                                                                |
| 3758130  | r3    | -                                     |         4 | road     | none       | I-80 decks and ramps; includes one small building squeezed between ramps                                                                                            |
| 3761063  | r3    | -                                     |         4 | road     | none       | I-80 west on-ramp, freeway edge and ventilation structure; SW tip includes a small parking area and shed                                                            |
| 5368014  | r3    | -                                     |         3 | road     | none       | Sliver of the I-280 elevated deck                                                                                                                                   |
| 1939015  | r3    | Treasure Island Development Authority |         0 | road     | block 1939 | I-80 Bay Bridge approach ramp and deck                                                                                                                              |
| 1939016  | r3    | -                                     |         0 | road     | block 1939 | YBI hillside with road turnaround and wooded slope                                                                                                                  |
| 1939018  | r3    | -                                     |         0 | road     | block 1939 | I-80 / Bay Bridge corridor across Yerba Buena Island: decks, tunnel approach, ramps and landscaped ROW                                                              |
| 3797008  | r3    | -                                     |         0 | road     | none       | I-280 ramp deck                                                                                                                                                     |
| 3797009  | r3    | -                                     |         0 | road     | none       | I-280 northbound off-ramp lanes alongside the Caltrain yard                                                                                                         |
| 3809002  | r3    | PORT LANDS                            |         0 | road     | none       | I-280 viaducts over the creek bank with vegetated strip                                                                                                             |
| 4012031  | r3    | -                                     |         0 | road     | none       | US-101 lanes plus wooded embankment and footbridge ramp                                                                                                             |
| 4027001  | r3    | -                                     |         0 | road     | none       | Hwy 101 lanes and wooded freeway embankment behind houses                                                                                                           |
| 8723005  | r3    | Future Park - Owens & Mariposa        |         0 | road     | none       | I-280 lanes; east third is part of the vacant future-park dirt lot                                                                                                  |
| 8727012  | r3    | -                                     |         0 | road     | none       | I-280 lanes plus a sliver of landscaping                                                                                                                            |
| 9900024  | r3    | PORT LANDS                            |         0 | road     | none       | Bay water under the Bay Bridge approach span by Pier 14/24 (not land)                                                                                               |

### (c) Names containing PLAZA or CIRCLE

| Lot      | Rules | Land name              | Net homes | Verdict  | Row  | What was seen                                                                  |
| -------- | ----- | ---------------------- | --------: | -------- | ---- | ------------------------------------------------------------------------------ |
| 3714012  | r1n   | JUSTIN HERMAN PLAZA    |         0 | not road | keep | Sliver inside the Justin Herman Plaza sunken lawn/court                        |
| 3714013  | r1n   | JUSTIN HERMAN PLAZA    |         0 | not road | keep | lawn/court inside Justin Herman Plaza                                          |
| 4339002A | r7    | CESAR CHAVEZ ST CIRCLE |        40 | road     | none | paved drive lane between a parking lot and a warehouse wall (old street strip) |

### (d) Block 1939 or a block starting 89

| Lot     | Rules   | Land name                             | Net homes | Verdict  | Row        | What was seen                                                                                                                                      |
| ------- | ------- | ------------------------------------- | --------: | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1939115 | r2s     | -                                     |         4 | not road | block 1939 | a large new building covers most of the outline (parcel lines predate the rebuild)                                                                 |
| 1939023 | r3      | Treasure Island Development Authority |         0 | not road | block 1939 | Large YBI parcel: Coast Guard station buildings, lawn, wooded hillside and shoreline                                                               |
| 1939087 | r3      | Treasure Island Development Authority |         0 | not road | block 1939 | 10 ha of Yerba Buena Island hillside: shoreline, scrub, open slope and a road under construction; most of it is far from I-80 (YBI-OS/R/MU zoning) |
| 1939141 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW across a graded construction site; no street built in imagery                                                                |
| 1939143 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939155 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW crossing the existing ballfield, bleachers and a structure; no street built                                                  |
| 1939156 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | construction staging yard and covered stockpile crossing a road; future street ROW per centreline                                                  |
| 1939159 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW across construction staging and graded fill; no street built                                                                 |
| 1939160 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939165 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW across a construction staging area; no street built                                                                          |
| 1939168 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939182 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939186 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW across a vacant scrub lot and graded fill; no street built                                                                   |
| 1939187 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939189 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW across graded site and paved apron beside a hangar; no street built                                                          |
| 1939190 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939193 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW across a paved boat-storage yard; no street built                                                                            |
| 1939194 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | paved waterfront apron and part of a yard beside a hangar; future Clipper Cove Ave per centreline                                                  |
| 1939196 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW along a graded field edge and shoreline path; no street built                                                                |
| 1939197 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939200 | r2s     | Treasure Island Development Authority |         4 | unclear  | block 1939 | Planned TI street ROW across a paved marina work yard; no street built                                                                             |
| 1939024 | r3      | Treasure Island Development Authority |         0 | unclear  | block 1939 | Bay Bridge YBI interchange infield: wooded hill, access road loops, parking and a small building cluster                                           |
| 1939092 | r3      | Treasure Island Development Authority |         0 | unclear  | block 1939 | Mostly open water (Clipper Cove/bay) plus a Bay Bridge segment and YBI shoreline; unbuildable either way                                           |
| 1939181 | r2s     | Treasure Island Development Authority |         0 | unclear  | block 1939 | Planned TI street ROW in graded fill; no street built                                                                                              |
| 1939184 | r2s     | Treasure Island Development Authority |         0 | unclear  | block 1939 | Treasure Island graded/construction ground, no street built yet (parcel follows a planned street centreline, so likely a future street ROW)        |
| 1939199 | r1n     | Treasure Island Development Authority |         0 | unclear  | block 1939 | 46 m2 triangle on the shoreline riprap edge of a paved lot; not a street, not buildable either                                                     |
| 1939019 | r7      | YERBA BUENA RIGHT-OF-WAY              |         4 | road     | block 1939 | YBI ramp roadway and wooded slope                                                                                                                  |
| 1939020 | r7      | YERBA BUENA RIGHT-OF-WAY              |         4 | road     | block 1939 | YBI ramp roadway and loop ramp                                                                                                                     |
| 1939098 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Treasure Island street (Seven Seas Ave) and its gravel shoulder                                                                                    |
| 1939103 | r2s     | -                                     |         4 | road     | block 1939 | Treasure Island street with sidewalks beside new buildings                                                                                         |
| 1939104 | r2s     | -                                     |         4 | road     | block 1939 | Johnson St, paved street with parking                                                                                                              |
| 1939106 | r2s     | -                                     |         4 | road     | block 1939 | Avenue of the Palms: new street with parking lanes and sidewalks                                                                                   |
| 1939108 | r2s     | -                                     |         4 | road     | block 1939 | Treasure Island street with sidewalks and tree row                                                                                                 |
| 1939109 | r2s     | -                                     |         4 | road     | block 1939 | Cravath St, paved street with parking                                                                                                              |
| 1939113 | r2s     | -                                     |         4 | road     | block 1939 | New street with median and sidewalks (Seven Seas Ave)                                                                                              |
| 1939114 | r2s     | -                                     |         4 | road     | block 1939 | Treasure Island street with parking                                                                                                                |
| 1939118 | r2s     | -                                     |         4 | road     | block 1939 | New street with median, crosswalks and sidewalks                                                                                                   |
| 1939122 | r2s     | -                                     |         4 | road     | block 1939 | Clipper Cove Ave waterfront street with palm median                                                                                                |
| 1939129 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Golden Bell Way roadway plus edge of a field                                                                                                       |
| 1939130 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Farallon St roadway with sidewalk                                                                                                                  |
| 1939144 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Graded construction pad on the alignment of a planned street (Indies Pl centreline at 0 m); no street built yet                                    |
| 1939157 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Planned street alignment (Blossom Ln) crossing a current trailer/container storage yard; no street built yet                                       |
| 1939162 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Planned street alignment (Zoe Dell Ln) across a construction site; no street built yet                                                             |
| 1939170 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Graded alignment of Trade Winds Ave under construction beside a large building                                                                     |
| 1939171 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Macky Ln existing street with cul-de-sac bulb                                                                                                      |
| 1939172 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Avenue H, paved roadway                                                                                                                            |
| 1939173 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Existing paved roadway (Macky Ln) with sidewalk                                                                                                    |
| 1939179 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | New TI street and shoreline promenade                                                                                                              |
| 1939185 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Graded construction ground and a drainage channel on the Braghetta Ln alignment                                                                    |
| 1939188 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Paved road stub (Macky Ln) running to a drainage channel and graded ground                                                                         |
| 1939191 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Planned Braghetta Ln alignment across a graded pad and a paved area clipping a sport court                                                         |
| 1939195 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Graded construction pad on the Peacemakers St alignment                                                                                            |
| 1939198 | r2s     | Treasure Island Development Authority |         4 | road     | block 1939 | Trade Winds Ave under construction (curb line/stakes visible)                                                                                      |
| 1939045 | r2s     | Treasure Island Development Authority |         3 | road     | block 1939 | Triangle of TI 9th St roadway                                                                                                                      |
| 1939015 | r3      | Treasure Island Development Authority |         0 | road     | block 1939 | I-80 Bay Bridge approach ramp and deck                                                                                                             |
| 1939016 | r3      | -                                     |         0 | road     | block 1939 | YBI hillside with road turnaround and wooded slope                                                                                                 |
| 1939017 | r7+r3   | YERBA BUENA RIGHT-OF-WAY              |         0 | road     | block 1939 | YBI ramp roads and road-edge strips (Treasure Island Rd ramps)                                                                                     |
| 1939018 | r3      | -                                     |         0 | road     | block 1939 | I-80 / Bay Bridge corridor across Yerba Buena Island: decks, tunnel approach, ramps and landscaped ROW                                             |
| 1939083 | r2s     | -                                     |         0 | road     | block 1939 | Treasure Island Rd segment and wooded roadside strip; small building at the south tip                                                              |
| 1939084 | r2s     | -                                     |         0 | road     | block 1939 | Macalla Rd roadway                                                                                                                                 |
| 1939085 | r2s     | -                                     |         0 | road     | block 1939 | Yerba Buena Rd loop roadway ring around a landscaped island                                                                                        |
| 1939102 | r1n     | Treasure Island Development Authority |         0 | road     | block 1939 | Thin strip along the Seven Seas Ave sidewalk                                                                                                       |
| 1939120 | r2s     | -                                     |         0 | road     | block 1939 | Treasure Island Rd roadway                                                                                                                         |
| 1939147 | r1n+r2s | Treasure Island Development Authority |         0 | road     | block 1939 | 5 m2 sliver inside a graded construction site on the Phillips Ln alignment                                                                         |
| 8953006 | r2s     | Treasure Island Development Authority |         0 | road     | block 8953 | YBI street (Signal Rd)                                                                                                                             |
| 8958002 | r1n+r2s | Treasure Island Development Authority |         0 | road     | block 8958 | strip across the roadway edge/track at Macalla Rd                                                                                                  |

### (e) Nearest street Octavia, or land name PARCEL <letter>

| Lot     | Rules | Land name                       | Net homes | Verdict  | Row  | What was seen                                                               |
| ------- | ----- | ------------------------------- | --------: | -------- | ---- | --------------------------------------------------------------------------- |
| 0817067 | r2s   | PATRICIAS GREEN IN HAYES VALLEY |         0 | not road | keep | Patricias Green park: lawn and paved promenade (Octavia Blvd central park)  |
| 0817077 | r2s   | PATRICIAS GREEN IN HAYES VALLEY |         0 | unclear  | none | Mixed: west half Patricia s Green lawn (park), east half Octavia St roadway |

### (f) The three named lots

| Lot      | Rules | Land name                   | Net homes | Verdict | Row  | What was seen                                                            |
| -------- | ----- | --------------------------- | --------: | ------- | ---- | ------------------------------------------------------------------------ |
| 5415013  | r1n   | -                           |        11 | road    | none | narrow tree strip between a street and a building                        |
| 5431A028 | r1n   | -                           |        11 | road    | none | 3 m wide dirt strip along the rail tracks next to an industrial building |
| 2647048  | r1n   | CITY-OWNED PARCEL (2647048) |         2 | road    | none | 63 m2 tree-covered corner sliver by the street                           |

### (g) Housing departments (Mayor, CII, SFHA) or MOHCD/SFHA in the name

| Lot      | Rules      | Land name                                 | Net homes | Verdict  | Row  | What was seen                                                                                                                                                        |
| -------- | ---------- | ----------------------------------------- | --------: | -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7000025  | r7         | JUNIPERO SERRA (REMAINDER)                |         7 | not road | keep | Fenced, tree-covered remnant behind houses at Shields St, east of the Junipero Serra planted median; roughly a 25x100 ft lot shape, reads as yard/garden, not street |
| 6723030  | r7         | SAN JOSE AVE (REMAINDER AT CUVIER ST)     |         5 | not road | keep | Small dirt triangle behind a fence between houses off San Jose Ave; yard-like vacant remnant, not part of the street (tiny, 160 m2)                                  |
| 4591C102 | r2s        | OCII Parcels - Block 4591C                |         0 | not road | keep | Pocket park with turf sports courts between buildings                                                                                                                |
| 6946061  | r7         | GENEVA AVE PEDESTRIAN BRIDGE AT OCEAN AVE |        52 | unclear  | keep | wooded corner triangle by Geneva/San Jose with the pedestrian bridge landing over its north edge; adjoins a building, could be a small site                          |
| 1866018F | r7+r1n     | UNDEDICATED ALLEY                         |         5 | unclear  | keep | 6 m alley strip between houses; north half is yard/garden, south half looks roofed by a neighbouring structure                                                       |
| 4591D141 | r2s        | OCII Parcels - Block 4591D                |         0 | unclear  | keep | dirt strip along Griffith St edge, part of a larger vacant site; could be street widening or development frontage                                                    |
| 4624454  | r2s        | SFHA -- Hunters View                      |        67 | road     | none | Hunters View new street loop (Memory Ln) with parking; the vacant blocks are outside the outline                                                                     |
| 0725026  | r7         | Ellis St ROW                              |        56 | road     | none | Paved Ellis St stub between two buildings: trees, parked cars, sidewalk                                                                                              |
| 4624058  | r2s        | SFHA -- Hunters View                      |        31 | road     | none | Hunters View street (Ironwood Way) plus paved pedestrian stub at the south                                                                                           |
| 4624057  | r2s        | SFHA -- Hunters View                      |        28 | road     | none | Fairfax Ave roadway with parked cars along both sides (Hunters View)                                                                                                 |
| 4624059  | r2s        | SFHA -- Hunters View                      |        11 | road     | none | Fairfax Ave street block in Hunters View                                                                                                                             |
| 6723031  | r7         | SAN JOSE AVE (REMAINDER AT CUVIER ST)     |         5 | road     | none | Landing of the pedestrian bridge over I-280/San Jose Ave; clips the edge of a house roof                                                                             |
| 6192074  | r7         | ALPHA ST WIDENING (REMAINDER)             |         4 | road     | none | Alpha St roadway/turnaround and parking strip                                                                                                                        |
| 4093114  | r7+r1n+r2s | VERMONT ST (REMAINDER)                    |         0 | road     | none | 4 m2 sidewalk sliver                                                                                                                                                 |
| 4591C040 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Paved pedestrian walkway/mews with trees between new townhouse rows                                                                                                  |
| 4591C175 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Innes Ave roadway and sidewalk                                                                                                                                       |
| 4591C176 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Donahue St: new roadway with sidewalks                                                                                                                               |
| 4591C178 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Coleman St loop with tree-lined parking                                                                                                                              |
| 4591C179 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | landscaped street end of Coleman St between buildings                                                                                                                |
| 4591C180 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Street segment with trees at a cul-de-sac                                                                                                                            |
| 4591C182 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Intersection and street                                                                                                                                              |
| 4591C183 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Innes Ct street with parking and street trees                                                                                                                        |
| 4591C184 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Kennedy Pl roadway segment                                                                                                                                           |
| 4591C185 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Innes Ct loop around a wooded island                                                                                                                                 |
| 4591C186 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Innes Ct roadway                                                                                                                                                     |
| 4591C187 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Innes Ct roadway with parked cars                                                                                                                                    |
| 4591C203 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Innes Ave street segment                                                                                                                                             |
| 4591C210 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | intersection roadway at Robinson St                                                                                                                                  |
| 4591C211 | r2s        | OCII Parcels - Block 4591C                |         0 | road     | none | Galvez Ave: wide paved roadway with angled parking                                                                                                                   |
| 4591D140 | r2s        | OCII Parcels - Block 4591D                |         0 | road     | none | End of a parking lot driveway at a hillside path gate                                                                                                                |
| 4700123  | r1n+r2s    | SFHA -- Westbrook Apartments              |         0 | road     | none | Tiny triangle in a paved street/turnaround                                                                                                                           |
| 5842048  | r1n        | JUSTINE ST PARCEL                         |         0 | road     | none | 1.5 m walkway gap between houses                                                                                                                                     |
| 6311022  | r2s        | SFHA -- Sunnydale                         |         0 | road     | none | Sunrise Way alignment in Sunnydale rebuild: graded with crosswalk/curb ramps built at its end                                                                        |

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

The released version is `2026-11-08-3b7fa918` (`<v2>`). It differs from `2026-11-08-7d2097ac` only
by the two block keep rows for `8953` and `8958`: `road_like.kept` is 91 (was 89), and
`road_like.lots` and `scenario.road_like.lots` are 491 (493), with `.r1n` 123 (124) and `.r2s` 59
(60). `scenario.road_like.unhostable` and `.net_removed` are equal (202, 6,861), `calibration.json`
is byte-identical, and `scenarios/lesscars/summary.json` differs only in `datasetVersion`. All 34
invariants passed. The figures below were measured on `7d2097ac`, built the same way:

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

## Live check

The pages were checked on 2026-11-08 in local R2, as the v1.1 live check did
([lesscars.md](lesscars.md) "v1.1 live check"): a `VITE_E2E=1` build served by `wrangler dev`
with `PUBLIC_DATASET_VERSION` passed as `--var` (and `--var ENVIRONMENT:development`, without which the override is ignored), in headless Chromium at 1280 px (and 375 px for
`/lesscars`), reading `window.__sfhFzp`, `window.__sfhBrush`, `window.__sfhLessCars` and the
rendered map features, and looking at the screenshots. Before is `2026-11-02-0d40e1e2`, after is
`2026-11-08-7d2097ac`, both served by the same build of this branch. The page figures were measured on
`7d2097ac`. The released `2026-11-08-3b7fa918` has identical scenario counts, calibration and
/lesscars summary (see "Live build"), so they carry over. The before dataset was
loaded from its local build output with `scripts/r2-load-local.ts`, because `npm run data:local`
fetches only the manifest, chunks, tiles, neighbourhoods and transit, not `scenarios/`, so `/sim`
fails on a missing `calibration.json`.

`/sim` and FZP (`/fzp` redirects to `/sim`, which opens on the FZP comparison). Each figure gave
the same number on a second load:

| `/sim` headline                          | `0d40e1e2` | `7d2097ac` | Change |
| ---------------------------------------- | ---------: | ---------: | -----: |
| At its default (Setup, October 2026)     |      9,101 |      8,709 |   −392 |
| Run, at the RHNA deadline (January 2031) |     18,148 |     16,915 | −1,233 |
| Run, at the horizon (December 2066)      |     91,176 |     91,254 |    +78 |
| FZP added vs no FZP, December 2066       |      8,337 |      7,784 |   −553 |

The before column equals the v1.1 table. The headline is one run, the representative seed (the
run whose 2066 total is the median of the 101). The rule moves the median from seed 43 to seed 72,
so the figures at other dates compare two different paths, as in v1.1. Seed 43 schedules 392
pipeline completions in the rest of October 2026, which the Setup bucket counts; seed 72 does not.
The rows other than the horizon are not effects of the rule.

**The horizon does not go down.** `scenario.road_like.net_removed` (6,861 homes of static
capacity) predicts a lower 2066 total; the median rises by 78. Across the 101 runs, the homes
completed after today at December 2066 move as follows (the band the Results chart draws; the
headline adds the 8,709 built by today to the median):

| December 2066, 101 runs | `0d40e1e2` | `7d2097ac` | Change |
| ----------------------- | ---------: | ---------: | -----: |
| p10                     |     74,260 |     75,223 |   +963 |
| p50                     |     82,467 |     82,545 |    +78 |
| p90                     |     88,718 |     88,692 |    −26 |
| Seed 43                 |     82,467 |     82,712 |   +245 |
| Seed 72                 |     83,246 |     82,545 |   −701 |

The likely reason is the calibration change above: the rule removes parcel-years from the
initiation panel but no events, so the fitted hazard per hostable lot rises by about 2.5%, and the
city-wide start rate (`impliedSteadyState` 82.19 to 82.06 a year) is almost unchanged. The model
starts projects at a rate, not until capacity runs out, so the removed capacity shows in where
projects start, not in how many. Same-seed changes go both ways (+245 and −701) and are within the
spread between runs. This was not changed here; it is for the owner.

**Road-like lots on the map.** Two flagged lots were checked on `/` at 1280 px, on both datasets:
`4168011` (r3, 407 net homes, under I-280 at Pennsylvania Ave) and `5573023` (r3, 125 net homes,
the strip beside US-101 at Bayshore Blvd). The chunk records keep their rings and label points
(`elig` goes from 1 to 0); `/` draws parcels only through painted rows, so a lot's outline is not
drawn on its own on either dataset. The basemap and the existing buildings around each lot draw
the same on both (27 and 106 existing-building features in the view). A short Paint stroke at each
label point, 30 m brush, 6 stories:

- `4168011`: before, 2 parcels painted; after, 1 parcel (the neighbour) and "1 not eligible".
- `5573023`: before, 1 parcel painted; after, "No eligible parcels under that stroke · 1 not
  eligible", the row "1 stroke · 0 lots", 0 homes added.

The editor keeps the stroke as an op with 0 lots, as it does for any stroke over ineligible land
(open space, the Bay), so `__sfhBrush.ops` is 1; no lot takes the paint.

**`/lesscars`** on `7d2097ac`, at 1280 and 375 px: the headline is "+29,096 homes by 2068", band
+28,381 to +29,526, as the build measured. The four parts (freed 22,959; parking 6,018;
transit-unlocked 119; other 0) add to it. The disclosure still reads "38.9 ha of former freeway
land and 4.3 ha of former roadway" and "take the place of 982 homes". No horizontal scroll at
375 px. On `0d40e1e2` the same build shows +29,081 (22,947; 6,020; 114; 0), as in v1.1.

No console errors, page errors, failed requests or HTTP errors on any page, on either dataset.
