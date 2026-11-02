# /lesscars plan v1: a fewer-cars San Francisco, 2028–2068 (draft for owner review)

Status: draft. Calls marked **(drafter's call)** were made by the drafter, not the owner. Owner
decisions already taken are marked **(owner)**. This document argues from the binding spec,
`docs/superpowers/specs/2026-11-01-lesscars-design.md`, and maps one-to-one onto the plan format
of Plan 1 Task 2 (`src/lib/data/lesscars/plan.ts`) in Appendix A.

## Intent

The plan asks whether giving street space back to transit, walking and building unlocks materially
more homes than zoning alone. It does that the Fillmore way round: transit first, then car
closures, then homes. v1 builds two subway phases under Geary and 19th Avenue, a one-station and
then a Fisherman's Wharf extension of the Central Subway, three bus-lane corridors (Fulton,
19th Avenue, Lombard) and three tram-priority lines (N, J, K). Behind that transit it closes the
Geary expressway trench and the Central Freeway stub north of Mission Street, pedestrianises two
streets, sites two edge garages, and has the initiative build homes itself on the freed land and on
48 surface lots and garages, each one only after a plan transit project with a stop within ½ mile
has opened. Nothing in the plan takes an existing home.

## Method and evidence hierarchy

Every number carries an evidence tier, ranked by the project's hierarchy **(owner)**:

| Tier | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | Per-record data (DataSF rows, GTFS stops, the dataset's own parcel and project files) |
| 1    | Official aggregates and official project records (agency pages, Board resolutions)    |
| 2    | Inferences: a tier 0 or 1 figure applied to a different project, place or stage       |
| 3    | Literature and journalism                                                             |
| 4    | Invented. Labelled "invented" wherever it appears                                     |

Rules followed:

- A duration taken from a real project and applied to a plan project is tier 2 (the source is tier
  0 or 1; applying it elsewhere is an inference), as `/sim`'s timers do (`docs/dev/sim-timers.md`).
- Durations come from real San Francisco or peer projects wherever one was found and opened:
  Central Subway, Van Ness BRT, Geary Rapid, L Taraval, car-free Market Street, the Central
  Freeway/Octavia Boulevard replacement, the Rochester Inner Loop East fill, and the SFCTA
  Geary/19th Avenue Subway Strategic Case. Every source in Appendix B was opened; nothing is cited
  from memory or from a search snippet alone.
- A project's `startYear` is 1 January of that year (Task 2 builder's call). A transit project
  "opens" at `startYear` + `durationMonths`; a dependant starts on or after that day.
- `startYear` for a transit line is the **construction** start. The lead time before it (design,
  environmental review) is argued in each project's text, not hidden in the duration.
- Capacity is counted by calendar year: a project uses one slot in every year it is active for any
  month. This is stricter than the monthly check Task 3 runs, so a schedule that fits here fits
  there.

Fixed rules from the owner and Plan 1:

- **Switch day 2032-01-31 (owner, resolved).** FZP until then; from then the larger of FZP and SB 79
  per lot.
- **Parking converts in step with transit (owner).** Every `parking-conversion` depends directly on
  a transit project with a stop within ½ mile (804.672 m) of its parcel outline and starts on or
  after that project opens. Each names exactly one parcel; a multi-lot site is several conversions
  on one schedule.
- **The initiative builds (owner).** Freed land and converted parking get scheduled builds at full
  fill of the envelope in force at the build's start. Freed-land zoning is the larger of the
  adjacent block's zoning and SB 79.
- **No plan project demolishes existing homes (owner).** Every parking parcel below has 0 homes on
  the 2025 assessor roll and in the dataset's parcel file; freed land excludes parcels by
  construction.
- **Fillmore rule.** Every car-closing project depends on at least one transit project and starts
  on or after the latest opening of those it depends on.

## Data findings

There is no pipeline cache in this worktree (`pipeline/.cache` and `out/` are absent here and in
the main checkout). The findings below come from the published dataset `2026-10-29-14e0eccb` (the
version `wrangler.jsonc` names) fetched from `https://sfhousing.mindlace.net/data/2026-10-29-14e0eccb/`
(`manifest.json`, `transit.json`, the 144 `parcels/*.json` chunks, `scenarios/fzp/projects.json`,
`scenarios/fzp/calibration.json`) and from the DataSF APIs directly. Every query is recorded here.

### Parking sites

**Which assessor codes mean parking.** `use_code` is too coarse (parking is inside `COMM`, `GOVT`,
`MISC`). `property_class_code` carries it. Query (2024 roll, all classes with their definitions):

```
https://data.sf.gov/resource/wv5m-vpq2.json?$select=property_class_code,property_class_code_definition,count(*)&$where=closed_roll_year='2024'&$group=property_class_code,property_class_code_definition&$limit=300
```

| `property_class_code` | Definition (assessor)      | 2024 rows | Used                                    |
| --------------------- | -------------------------- | --------- | --------------------------------------- |
| `PL`                  | Parking Lot                | 329       | yes                                     |
| `G`                   | Garages (Commercial)       | 230       | yes                                     |
| `GG`                  | Garages (Commercial) [gov] | 26        | yes                                     |
| `PLG`                 | GARAGE [gov]               | 109       | yes                                     |
| `PZ`                  | Parking Stall Condominium  | 366       | no: stalls inside residential buildings |
| `GZ`                  | Garage Condominium         | 22        | no: same                                |

**Candidates.** The latest roll is 2025 (`$select=max(closed_roll_year)` returns `2025`). Query:

```
https://data.sf.gov/resource/wv5m-vpq2.json?$select=parcel_number,property_location,property_class_code,use_code,number_of_units,number_of_stories,property_area,lot_area,zoning_code,year_property_built,analysis_neighborhood,the_geom,assessed_land_value,exemption_code&$where=closed_roll_year='2025' and property_class_code in('PL','G','GG','PLG')&$limit=5000
```

| Step                                                                                 | Parcels           |
| ------------------------------------------------------------------------------------ | ----------------- |
| 2025 roll rows in the four classes                                                   | 683               |
| Excluded: homes on the roll (`number_of_units` > 0)                                  | 118               |
| Excluded: not in the dataset's parcel chunks (retired or merged lots)                | 31                |
| Excluded: homes in the dataset's parcel chunks (`units` > 0)                         | 25                |
| **0-home parking parcels**                                                           | **509** (59.9 ha) |
| Of those, with a plan transit stop within 804.672 m of the outline                   | 226 (21.2 ha)     |
| Of those, at least 1,000 m² **(drafter's call)**                                     | 55                |
| Excluded: in-flight project on the parcel (`projects.json`)                          | 5                 |
| Excluded: Union Square (`0308001`: the plaza, land use OPENSPACE, garage underneath) | 1                 |
| Excluded: used as the north edge-garage site (`0509009`)                             | 1                 |
| **Parking conversions in v1**                                                        | **48** (11.1 ha)  |

Areas are shoelace areas of the dataset's parcel outlines (`parcels/*.json`, `xy` in cm about the
label point). Distances are from each outline vertex to each plan stop, equirectangular. The
remaining 171 served parcels under 1,000 m² (8.0 ha) are left out of v1 (see "What is left out").

In-flight projects on candidates (excluded, because the market is already there and the conversion
would mostly be voided):

| Parcel    | In-flight project (projects.json)                          |
| --------- | ---------------------------------------------------------- |
| `3704045` | PRJ:2017-014833PRJ 469 Stevenson St (entitled, 495 homes)  |
| `0744119` | BP:202212087884 850 Turk St (construction, 92 homes)       |
| `3726110` | PRJ:2025-008351PRJ 1023 Mission St (filed, 220 homes)      |
| `3721013` | PRJ:2023-010883PRJ 524 Howard St (permitFiled, 672 homes)  |
| `0836013` | PRJ:2016-014802PRJ 98 Franklin St (permitFiled, 345 homes) |

The 48 sites, with the transit project each depends on (the earliest-opening serving project,
**drafter's call**, see Open question 3) and any other serving project. `zoning` is the assessor
roll's `zoning_code` (`NA` = the roll has none), not the Planning zoning map, which the pipeline
reads itself:

| Parcel    | Street          | Neighbourhood                  | Class | Area m² | Zoning | Land use 2023 | Depends on (stop distance)         | Also served by             |
| --------- | --------------- | ------------------------------ | ----- | ------- | ------ | ------------- | ---------------------------------- | -------------------------- |
| `0700035` | Geary Blvd      | Japantown                      | GG    | 11,964  | NA     | VACANT        | fulton-brt (656 m)                 | geary-subway-1 185 m       |
| `3724067` | Mission St      | South of Market                | PLG   | 11,903  | P      | MIXED         | fulton-brt (552 m)                 | geary-subway-1 416 m       |
| `7296007` | Winston Dr      | Lakeshore                      | G     | 6,463   | C2     | RETAIL/ENT    | 19th-ave-brt (256 m)               | geary-19th-subway-2 273 m  |
| `0286024` | Sutter St       | Financial District/South Beach | GG    | 4,723   | P      | RETAIL/ENT    | geary-subway-1 (274 m)             | —                          |
| `0056007` | Montgomery St   | North Beach                    | G     | 4,515   | C2     | MIXED         | central-subway-north-beach (620 m) | central-subway-wharf 440 m |
| `3735060` | 3rd St          | Financial District/South Beach | PLG   | 3,718   | C3S    | MIXED         | geary-subway-1 (498 m)             | —                          |
| `0446003` | Marina Blvd     | Marina                         | PL    | 3,258   | NCS    | VACANT        | lombard-bus-lane (429 m)           | —                          |
| `0327021` | O'Farrell St    | Financial District/South Beach | GG    | 3,131   | P      | PDR           | fulton-brt (661 m)                 | geary-subway-1 337 m       |
| `0035001` | Bay St          | North Beach                    | PLG   | 2,915   | C2     | PDR           | central-subway-north-beach (739 m) | central-subway-wharf 325 m |
| `0719002` | Van Ness Ave    | Western Addition               | G     | 2,757   | RC4    | RETAIL/ENT    | fulton-brt (426 m)                 | geary-subway-1 172 m       |
| `0781034` | Fulton St       | Western Addition               | PLG   | 2,459   | RM2    | VACANT        | fulton-brt (143 m)                 | geary-subway-1 741 m       |
| `0347016` | Golden Gate Ave | Tenderloin                     | GG    | 2,377   | CM     | RETAIL/ENT    | fulton-brt (64 m)                  | geary-subway-1 632 m       |
| `0785030` | McAllister St   | Hayes Valley                   | PLG   | 2,073   | NC3    | VACANT        | fulton-brt (40 m)                  | geary-subway-1 671 m       |
| `1450049` | 18th Ave        | Outer Richmond                 | G     | 2,020   | NA     | VACANT        | 19th-ave-brt (443 m)               | geary-19th-subway-2 451 m  |
| `0719001` | Van Ness Ave    | Western Addition               | G     | 1,990   | RC4    | RETAIL/ENT    | fulton-brt (473 m)                 | geary-subway-1 125 m       |
| `0715015` | Van Ness Ave    | Tenderloin                     | G     | 1,937   | NC3    | RETAIL/ENT    | fulton-brt (543 m)                 | geary-subway-1 120 m       |
| `0685050` | Webster St      | Japantown                      | PL    | 1,795   | NC2    | VACANT        | fulton-brt (778 m)                 | geary-subway-1 222 m       |
| `0195019` | Kearny St       | Chinatown                      | G     | 1,779   | CRNC   | MIXED         | central-subway-north-beach (675 m) | —                          |
| `0285020` | Sutter St       | Financial District/South Beach | G     | 1,753   | NA     | VISITOR       | geary-subway-1 (415 m)             | —                          |
| `0081003` | Sansome St      | Financial District/South Beach | G     | 1,750   | C2     | VACANT        | central-subway-north-beach (730 m) | central-subway-wharf 797 m |
| `0147029` | Vallejo St      | Chinatown                      | GG    | 1,750   | NA     | PDR           | central-subway-north-beach (238 m) | —                          |
| `0713033` | Gough St        | Western Addition               | PL    | 1,741   | RM4    | VACANT        | fulton-brt (515 m)                 | geary-subway-1 187 m       |
| `3722079` | Natoma St       | Financial District/South Beach | G     | 1,740   | C3O    | PDR           | geary-subway-1 (318 m)             | —                          |
| `3753122` | 6th St          | South of Market                | PL    | 1,523   | RSD    | VACANT        | fulton-brt (666 m)                 | —                          |
| `0743001` | Van Ness Ave    | Western Addition               | G     | 1,394   | RC4    | VACANT        | fulton-brt (263 m)                 | geary-subway-1 335 m       |
| `3721084` | Minna St        | Financial District/South Beach | G     | 1,383   | C3O    | VACANT        | geary-subway-1 (497 m)             | —                          |
| `7080009` | 19th Ave        | Oceanview/Merced/Ingleside     | G     | 1,370   | NC1    | PDR           | 19th-ave-brt (84 m)                | geary-19th-subway-2 114 m  |
| `0761065` | Golden Gate Ave | Western Addition               | PLG   | 1,332   | NA     | NONE          | fulton-brt (130 m)                 | geary-subway-1 520 m       |
| `0647014` | California St   | Western Addition               | G     | 1,292   | NC3    | VACANT        | geary-subway-1 (465 m)             | —                          |
| `1228006` | Stanyan St      | Haight Ashbury                 | PL    | 1,284   | HAIGHT | RETAIL/ENT    | fulton-brt (575 m)                 | —                          |
| `2413038` | Taraval St      | West of Twin Peaks             | PL    | 1,281   | NC2    | VACANT        | 19th-ave-brt (592 m)               | geary-19th-subway-2 601 m  |
| `0768073` | Redwood St      | Western Addition               | PL    | 1,270   | NC3    | VACANT        | fulton-brt (42 m)                  | geary-subway-1 609 m       |
| `0776010` | McAllister St   | Western Addition               | PL    | 1,268   | RM1    | VACANT        | fulton-brt (64 m)                  | geary-subway-1 697 m       |
| `0668003` | Bush St         | Nob Hill                       | GG    | 1,264   | P      | VACANT        | geary-subway-1 (384 m)             | —                          |
| `1017027` | California St   | Presidio Heights               | PL    | 1,261   | RM2    | VACANT        | geary-subway-1 (704 m)             | —                          |
| `0718021` | Van Ness Ave    | Tenderloin                     | G     | 1,215   | RC4    | VACANT        | fulton-brt (477 m)                 | geary-subway-1 130 m       |
| `0658003` | Pierce St       | Pacific Heights                | PL    | 1,204   | RH3    | CIE           | geary-subway-1 (394 m)             | —                          |
| `0817011` | Fell St         | Hayes Valley                   | G     | 1,199   | HAYES  | PDR           | fulton-brt (374 m)                 | —                          |
| `1216019` | Oak St          | Hayes Valley                   | PL    | 1,197   | RH3    | VACANT        | fulton-brt (464 m)                 | —                          |
| `0266007` | Battery St      | Financial District/South Beach | G     | 1,176   | C3O    | VACANT        | geary-subway-1 (548 m)             | —                          |
| `0680001` | Bush St         | Pacific Heights                | G     | 1,175   | RH3    | MIXED         | geary-subway-1 (387 m)             | —                          |
| `3710014` | Beale St        | Financial District/South Beach | G     | 1,174   | C3O    | VACANT        | geary-subway-1 (692 m)             | —                          |
| `0647012` | California St   | Western Addition               | G     | 1,166   | NC3    | VACANT        | geary-subway-1 (472 m)             | —                          |
| `1182023` | Fulton St       | Hayes Valley                   | G     | 1,118   | NC2    | VACANT        | fulton-brt (125 m)                 | —                          |
| `1101027` | O'Farrell St    | Western Addition               | PL    | 1,106   | RM3    | VACANT        | fulton-brt (473 m)                 | geary-subway-1 590 m       |
| `0347017` | Golden Gate Ave | Tenderloin                     | GG    | 1,100   | NA     | VACANT        | fulton-brt (51 m)                  | geary-subway-1 636 m       |
| `0643016` | Sacramento St   | Nob Hill                       | PL    | 1,057   | POLK   | VACANT        | geary-subway-1 (579 m)             | —                          |
| `0101031` | Filbert St      | Chinatown                      | G     | 1,022   | NBEACH | MIXED         | central-subway-north-beach (97 m)  | central-subway-wharf 764 m |

Multi-lot sites on one schedule: `0719001` + `0719002` (Van Ness Ave, block 0719), `0647012` +
`0647014` (California St, block 0647), `0347016` + `0347017` (Golden Gate Ave, block 0347).

Notes for the owner on the list:

- Four of the largest sites are government-class garages (`GG`/`PLG`) downtown and in Japantown:
  `3724067` (Mission St, the largest in the list), `0286024` (Sutter St), `0327021` (O'Farrell St),
  `0700035` (Geary Blvd, Japantown). By location they look like the city's Fifth and Mission,
  Sutter-Stockton, Ellis-O'Farrell and Japan Center garages; the roll does not name them, so the
  owner should confirm. Removing them is in the spirit of the plan but is a visible choice (Open
  question 4).
- Sites zoned `P` (public) on the roll (`3724067`, `0286024`, `0327021`, `0668003`) may have no
  residential envelope under FZP; whether SB 79 lifts them after the switch is the pipeline's call.
  A site with no envelope is kept and builds 0 homes (Plan 1 Review Focus 4). Open question 5.
- The garages in the list are standing structures; "clearance" means demolition.

### Freeway segments in DataSF Streets (`3psu-pn9h`)

Freeways are present as `classcode` `1` (mainline) and `6` (ramps). Queries:

```
https://data.sf.gov/resource/3psu-pn9h.json?$select=cnn,streetname,f_st,t_st,classcode,layer,active,oneway&$where=classcode='1' and active=true&$limit=200
https://data.sf.gov/resource/3psu-pn9h.json?$select=cnn,streetname,f_st,t_st,classcode,line&$where=active=true and (streetname like '%280%' or streetname like '%101%' or streetname like '%I-80%')&$limit=1000
https://data.sf.gov/resource/3psu-pn9h.json?$select=cnn,streetname,f_st,t_st,classcode,oneway,line&$where=active=true and streetname like 'GEARY%'&$limit=1000
```

| Segment                                  | In Streets?                                                              | CNNs                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-280 north of Mariposa                  | yes                                                                      | NB mainline `19301000` (533 m), `19300000` (827 m, to 6th St); NB off-ramp to 5th/King `19288000` (746 m); SB mainline `19338000` (695 m, from 6th St), `19339000` (494 m); SB on-ramp from 5th `19330000` (650 m). Mariposa off-ramp `19320000` stays.                                                                                 |
| Central Freeway stub (US-101, to Market) | yes, but too coarse                                                      | NB `19204001` (710 m) and SB `19264001` (740 m) each run from about 12th St/13th St to Market St, and their first ~300 m sits above 13th St, a live street. v1 uses a `{ line, provenance }` from the Mission St ramps (`19212000`, `19213000` stay) to Market St instead.                                                              |
| US-101 on Van Ness Ave and Lombard St    | yes, as ordinary streets (`VAN NESS AVE`, `LOMBARD ST`); no freeway CNNs | Not removed in v1 (see the project text). Plan 3 resolves the street selectors in Appendix A to CNN lists with the same query pattern.                                                                                                                                                                                                  |
| Geary expressway, Gough to Steiner       | yes                                                                      | Main lanes `6039201` (Gough–Laguna, 304 m), `6040201` (Laguna–Webster, 293 m), `6041201` (Webster–Steiner, 302 m); opposite-direction twins `6039101`, `6039102`, `6040102`, `6040103`, `6040104`, `6041101`; frontage roads at Fillmore `6041102`, `6041103`, `6041202`, `6041203`, `6041204` (classcode 4). All share one centreline. |

**Geary right-of-way width**, measured from the dataset's parcels as the gap between parcel
outlines along a meridian (tier 0 data, my measurement):

| Point            | Gap (m) | Parcels either side  |
| ---------------- | ------- | -------------------- |
| Gough–Laguna     | 54.3    | `0712001`, `0697039` |
| Laguna–Buchanan  | 45.7    | `0710027`, `0700035` |
| Buchanan–Webster | 47.8    | `0709027`, `0700012` |
| Webster–Fillmore | 52.3    | `0708021`, `0701007` |
| Fillmore–Steiner | 52.1    | `0707018`, `0702033` |
| Steiner–Scott    | 48.6    | `0706001`, `0703002` |
| Downtown (Jones) | 21.5    | `0318020`, `0304020` |

Geary is 46–54 m wide through the Western Addition, against 21.5 m downtown. That surplus is the
expressway that urban renewal built through the Fillmore (spec, Intent).

### Existing Muni stops on the candidate bus corridors (`transit.json`)

Stop ids from `transit.json` (dataset `2026-10-29-14e0eccb`), all stops on the named routes'
patterns whose name matches the corridor street. None is in `MUNI_TIER2_STOP_IDS`
(`pipeline/sb79-config.ts`), so each bus-lane project can move them to tier 2.

| Project            | Routes  | Corridor match                                                  | Stops | Already tier 2 | Peak tph today (transit.json) |
| ------------------ | ------- | --------------------------------------------------------------- | ----- | -------------- | ----------------------------- |
| `fulton-brt`       | 5, 5R   | Fulton St, McAllister St                                        | 60    | 0              | 5R 7.5–8.5                    |
| `19th-ave-brt`     | 28, 28R | 19th Ave, Park Presidio Blvd, Crossover Dr, Junipero Serra Blvd | 42    | 0              | 28 5.0, 28R 5.0               |
| `lombard-bus-lane` | 28      | Lombard St, Richardson Ave                                      | 12    | 0              | 28 5.0                        |

The ids are listed in Appendix A. For comparison, the 38R on Geary's red lanes runs 10–11 peak tph
and the 49 on Van Ness BRT 9–11.5 (`transit.json` stores tph × 10). Existing rail: N 6.0–6.5,
J 4.0–4.5, K 6.0–6.5, L 6.0, M 4.5–5.5, T 5.5–6.0; all their stops are already tier 2.

### Capacity evidence from the dataset

`scenarios/fzp/projects.json` (asOf 2026-10-19): 60 projects in `construction`, of which 15 have 50
or more homes (2,541 homes) and 8 have 100 or more. `scenarios/fzp/calibration.json`: the
construction stage's median duration is 23–25 months by pathway and its 80th percentile 34–46
months (SF permit records 2007–2026; the calibration's own tier is 2).

## Projects

Each subsection gives kind, geometry, stops and mode, peak trips per hour, start, duration,
dependencies, and for removals `rowHalfWidthM` and the scheduled build. Provenance ids (`PV-…`) are
defined in Appendix A and resolve to the sources in Appendix B.

### Geary/19th Avenue subway: phase 1 (`geary-subway-1`) — in

- **Kind** `transit-line`, mode `subway` (SB 79 tier 1). Six new stations under Geary: Kearny
  (connects to Market Street BART/Muni), Jones (Tenderloin), Van Ness (Van Ness BRT), Fillmore,
  Masonic, Arguello. Alignment: straight lines between stations (tier 4 for the exact path).
- **Why.** The SFCTA Strategic Case (June 2026, adopted by Resolution 26-64) defines the corridor:
  downtown, west under Geary "as far west as the Inner Richmond", south under Golden Gate Park and
  19th Avenue to near Daly City BART, about 10 miles, $20–30 billion. It recommends defining an
  initial operating segment with independent utility. Phase 1 is that segment.
- **Stations.** The study expects spacing of 0.5–1 mile but modelled 5–6 stations on the whole 10
  miles. v1 places 12 at about 0.6–1.2 miles **(drafter's call)**, because SB 79 counts stops; see
  Open question 2.
- **Peak tph** 24 (PV-tph-subway, tier 2: the study's modelling assumption, 24 trains per hour per
  direction).
- **Start** 2032 (PV-start-subway, tier 2): the study puts planning, alternatives analysis and
  environmental work for California peers at 5–8 years; the Strategic Case finished in 2026, so
  construction starts about 6 years later with financing assumed.
- **Duration** 108 months (PV-subway, tier 2): the study's 7–10 years for construction and
  commissioning; Central Subway (1.7 miles, tunnel contract June 2011, revenue service 7 January
  2023, about 11.5 years) says the upper half is realistic in San Francisco. Opens 2041.
- **Dependencies** none.

### Geary/19th Avenue subway: phase 2 (`geary-19th-subway-2`) — in

- **Kind** `transit-line`, mode `subway`. New stations: Geary & Park Presidio, 19th Ave & Irving
  (N Judah), 19th Ave & Noriega, 19th Ave & Taraval (L), 19th Ave & Winston (Stonestown/SF State),
  19th Ave & Junipero Serra (Parkmerced). Ends at Daly City BART (no new stop there; the study's
  terminus).
- **Peak tph** 24 (PV-tph-subway). **Start** 2035, staggered so the transit capacity of 4 holds
  (see Capacity). **Duration** 108 months (PV-subway). Opens 2044.
- **Dependencies** none in the data. It physically extends phase 1, and its 2044 opening follows
  phase 1's 2041 opening; making it depend on phase 1 would delay its start to 2041 and its opening
  to 2050 (Open question 6).
- This is the spec's **19th Avenue / M-line** candidate in its strongest form. The M already runs
  in its own median right-of-way on 19th Avenue, so it gets no tram-priority project.

### Central Subway to North Beach (`central-subway-north-beach`) — in

- **Kind** `transit-line`, mode `tram` (light rail: SB 79 tier 2, the same as the existing T
  stations). One new station: Columbus Ave & Union St (North Beach).
- **Why.** SFMTA's Central Subway Extension page: the unfinished tunnels already run north of
  Chinatown–Rose Pak station to Columbus Avenue and Union Street; the relaunched study (mid-2026 to
  mid-2028) focuses on this one-station extension. This is the spec's **Central Subway north**
  candidate.
- **Peak tph** 6 (PV-tph-T, tier 2: today's T Third peak, 5.5–6.0 in `transit.json`, carried onto
  the extension).
- **Start** 2030 (study done mid-2028, then design): tier 4, invented. **Duration** 60 months
  (PV-cs-north, tier 4, invented: no published estimate; the tunnels exist, so one station box and
  fit-out). Opens 2035.

### Central Subway to Fisherman's Wharf (`central-subway-wharf`) — in

- **Kind** `transit-line`, mode `tram`. One new station: Beach & Stockton (Fisherman's Wharf).
  SFMTA's page names "a multi-station extension to Fisherman's Wharf and beyond" as the comparison
  case.
- **Peak tph** 6 (PV-tph-T). **Start** 2036. **Duration** 96 months (PV-cs-wharf, tier 2: the low
  end of the Strategic Case's 7–10 years, plus one year, for a new bored segment). Opens 2044.
- **Dependencies** `central-subway-north-beach` (it extends that tunnel).

### Fulton bus lanes (`fulton-brt`) — in

- **Kind** `bus-lane`, routes 5 and 5R, 60 existing stops on McAllister St and Fulton St (Appendix
  A). Side-running red lanes like Geary Rapid.
- **Why.** The 5/5R is the busiest east–west line with no tier 2 stop (0 of 60). Dedicated lanes
  make its corridor BRT and its stops tier 2 from 2032, two years before anything else in the
  plan opens, and it serves 23 of the 48 parking sites.
- **Peak tph** 11 (PV-tph-brt, tier 2: the 38R's 10–11 peak tph on Geary's red lanes, transit.json,
  applied to Fulton; today's 5R is 7.5–8.5).
- **Start** 2029. **Duration** 36 months (PV-brt, tier 2: Geary Rapid, about 3 miles of red lanes,
  a three-year capital project completed fall 2021; Van Ness BRT, centre-running, took from 2016 to
  April 2022 and is the slower bound). Opens 2032.

### 19th Avenue bus lanes (`19th-ave-brt`) — in

- **Kind** `bus-lane`, routes 28 and 28R, 42 existing stops on Park Presidio Blvd, 19th Ave and
  Junipero Serra Blvd. 19th Avenue is State Route 1; the initiative's street authority covers it.
- **Why.** Interim BRT twelve years before the phase 2 subway: tier 2 stops on 19th Avenue from 2032.
- **Peak tph** 11 (PV-tph-brt). **Start** 2029. **Duration** 36 months (PV-brt). Opens 2032.

### Lombard bus lanes (`lombard-bus-lane`) — in

- **Kind** `bus-lane`, route 28, 12 existing stops on Lombard St and Richardson Ave.
- **Why.** The spec's **US-101 on Van Ness and Lombard** candidate. Van Ness already has BRT
  (opened 1 April 2022). Lombard, the US-101 surface route to the Golden Gate Bridge, has no tier 2
  stop. Bus lanes there take a car lane each way and make its stops tier 2. US-101 itself is not
  removed: it is the only road route to Marin, both streets are lined with homes that need access,
  and removing either would free no land.
- **Peak tph** 11 (PV-tph-brt). **Start** 2032. **Duration** 24 months (PV-tram, tier 2: L Taraval
  segment A, September 2019 to July 2021, about 22 months, for a shorter street job). Opens 2034.

### Tram priority: N Judah, J Church, K Ingleside (`n-judah-priority`, `j-church-priority`, `k-ocean-priority`) — in

- **Kind** `tram-priority`. Cars are forbidden on the tram's own lanes (cross traffic and access
  stay). Stops are already tier 2, so these change frequency on the map and no homes.
- **Geometry**: N on Carl St, Irving St, 9th Ave and Judah St to La Playa; J on Church St (Market to
  18th St, 22nd to 30th St); K on Ocean Ave (Junipero Serra to San Jose Ave).
- **Peak tph**: N 10, J 7, K 8. Tier 4, invented: today's 6.0–6.5, 4.0–4.5 and 6.0–6.5
  (`transit.json`) raised by a guessed run-time saving. No opened source gives a frequency gain from
  tram priority.
- **Start / duration**: N 2030, J 2032, K 2034, each 24 months (PV-tram). Open 2032, 2034, 2036.

### Edge garages (`garage-south`, `garage-north`) — in

- **Kind** `edge-garage` on existing 0-home parcels **(drafter's call: not on freed land)**.
  - `garage-south`: parcel `3901004` (Division St, surface lot `PL`, 4,687 m², roll zoning M1,
    about 190 m from the US-101/I-80 interchange, where drivers from the Peninsula and the Bay
    Bridge meet before entering city streets). M1 zoning makes it unlikely the baseline builds
    homes there, so the garage costs few homes.
  - `garage-north`: parcel `0509009` (Lombard St, government garage `GG`, 1,864 m², roll zoning P),
    at the Golden Gate entrance.
- **Why not on freed land.** The spec allows freed highway land; the only freed highway land in v1
  is the Central Freeway stub, which Octavia Boulevard shows is better used for homes. Putting the
  garage there would turn the plan's best freed site into parking.
- **Spaces**: 750 and 300 (PV-spaces, tier 4, invented: footprint × 5 levels ÷ 30 m² per space).
- **Start** 2031. **Duration** 24 months (PV-garage, tier 2: the SF construction median from the
  dataset's calibration applied to a parking structure). Open 2033, before the freeway closure
  `garage-south` serves.

### Van Ness street change (`van-ness-street`) — in

- **Kind** `street-change`, `VAN NESS AVE` Lombard to Market, lanes `car`, `bus`, `bike`,
  `sidewalk`: one car lane each way instead of two; the freed lane widens sidewalks and adds a bike
  lane. Display only. Keeps cars, so no Fillmore dependency.
- **Start** 2033. **Duration** 24 months (PV-tram, curb work at the scale of L Taraval segment A).

### Irving Street pedestrian street (`irving-pedestrian`) — in

- **Kind** `street-change`, `IRVING ST` Arguello Blvd to 9th Ave, lanes `tram`, `pedestrian`,
  `service`, `sidewalk`. Car-closing.
- **Dependencies** `n-judah-priority` (opens 2032). **Start** 2032. **Duration** 12 months
  (PV-ped, tier 4, invented; SFMTA made Market Street car-free 29 days after announcing it, but
  loading and curb work take longer).

### Columbus Avenue pedestrian street (`columbus-pedestrian`) — in

- **Kind** `street-change`, `COLUMBUS AVE` Broadway to Bay St, lanes `bus`, `pedestrian`, `service`,
  `sidewalk` (the 30 Stockton keeps running). Car-closing.
- **Dependencies** `central-subway-north-beach` (opens 2035). **Start** 2035. **Duration** 12
  months (PV-ped). Opens 2036.

### Central Freeway stub and Fell/Oak (`central-freeway-stub`, `fell-oak-street`) — in

- **`central-freeway-stub`**: kind `highway-truncation`. US-101 ends at the Mission St ramps; the
  elevated stub from there to its Market/Octavia touchdown (about 450 m) comes down. Geometry is a
  `{ line, provenance }` (Appendix A) because the Streets CNNs also cover the section above 13th
  St, a live street that must not become "land". `rowHalfWidthM` 11 (PV-row-cfwy, tier 4, invented:
  half a four-lane deck with shoulders).
- **Dependencies** `fulton-brt` and `n-judah-priority` (the westbound trips the stub feeds through
  Octavia and Fell/Oak) and `garage-south` (the place to leave a car). **Start** 2033, after all
  three open. **Duration** 30 months (PV-hwy, tier 2: Caltrans began demolishing the Central
  Freeway in March 2003 and Octavia Boulevard opened on 9 September 2005, Board of Supervisors
  Resolution 94-13). Clearance ends mid-2035.
- **Build** start 2036, 30 months (PV-build). The Octavia parcels show what happens without a
  schedule: some were still vacant in 2023–24 (Parcel K, leased as a temporary use since 2009,
  Mission Local, September 2024). The initiative builds instead.
- **`fell-oak-street`**: kind `street-change`, `FELL ST` and `OAK ST` from Market/Octavia to Baker
  St, lanes `car`, `bus`, `bike`, `sidewalk` (one fewer car lane each). Display only.
  **Dependencies** `central-freeway-stub` (traffic falls once the stub is gone). **Start** 2036.
  **Duration** 18 months (PV-fell-oak, tier 4, invented).
- Freed land here is small: the carve keeps only the band outside existing parcels and streets.
  Whether the land under the viaduct (today's SoMa West skate and dog parks) is a parcel in the
  dataset decides how much is left; Task 6's carving output must be checked (Concern 2 in the
  report).

### Geary expressway trench (`geary-trench`) — in

- **Kind** `street-removal`. The sunken expressway lanes of Geary between Gough and Steiner, with
  the Fillmore underpass, are filled; the middle of the right-of-way becomes a new linear block;
  Geary keeps a one-way surface street on each side (the frontage roads that exist at Fillmore
  today).
- **Geometry** CNNs `6039201`, `6040201`, `6041201` (the main lanes; their twins share the
  centreline). `rowHalfWidthM` 10 (PV-row-geary, tier 4: the right-of-way is 45.7–54.3 m, tier 0
  measured above; keeping about 15 m each side for a surface street is invented). Freed strip about
  20 m × 900 m, about 1.8 ha before cross streets.
- **Why.** This is the Fillmore repaired in the order the Fillmore was not: the subway under Geary
  opens first, then the trench closes. Filling the underpass is not new: in 2014 the city weighed
  about $50 million to fill it (CBS, February 2014).
- **Dependencies** `geary-subway-1` (opens 2041). **Start** 2041. **Duration** 36 months
  (PV-trench, tier 2: Rochester's Inner Loop East, a sunken expressway filled to street grade,
  November 2014 to December 2017, FHWA; the 2014 Geary estimate was "a two-year construction phase",
  tier 3). Clearance ends 2044.
- **Build** start 2045, 30 months (PV-build).

### Masonic underpass becomes the Masonic station (part of `geary-subway-1`) — no separate project

- **Owner, 2026-11-01:** no roundabout. The `lc:geary-masonic` station replaces the Masonic
  underpass, and the Masonic and Park Presidio crossings stay more or less as they are: ordinary
  surface intersections.
- **Why it is not a separate project.** `geary-trench` covers Gough to Steiner only and never reaches
  Masonic; the carve keeps a `keepHalfM` (10 m) corridor around every crossing street, so no freed
  land or housing reaches Masonic. The station box is built in the underpass as part of the subway's
  own construction (2032–2041) and Geary runs at grade through the Masonic intersection when the
  station opens. No land is freed, no homes are added, and the change is not a car closure (Geary
  keeps car lanes at grade), so it needs no project of its own and adds nothing to `street`
  capacity, which is full in 2041.
- **For the page (Plan 2):** show the Masonic underpass as filled from `geary-subway-1`'s opening.
  Park Presidio (a phase 2 station) is unchanged at the surface.

### Parking conversions (48 projects, `park-<parcel>`) — in

- **Kind** `parking-conversion`, one parcel each (the table under Data findings). Each depends on
  the earliest-opening plan transit project with a stop within 804.672 m of its outline, and starts
  on or after its opening.
- **Clearance duration** 6 months for a surface lot, 12 for a garage (PV-clear-lot,
  PV-clear-garage, tier 4, invented).
- **Build** start the year after clearance starts (one year of design overlapping clearance: tier
  4, invented), 30 months (PV-build).
- Starts are spread by the street and housing capacity (Schedule).

## Capacity

One `maxConcurrent` per capacity kind (Task 2 `CapacityRule`). Parking clearance counts as
`street`, and its build as `housing` (Task 2 `capacityKindOf`).

| Kind      | `maxConcurrent` | Tier | Evidence                                                                                                                                                                                                                                                                                                                                   |
| --------- | --------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `transit` | 4               | 2    | 2019–2021: SFMTA had four major transit capital projects in construction at once: Central Subway (station work from 2013, revenue service January 2023), Van Ness BRT (2016 to April 2022), Geary Rapid (three years to fall 2021) and L Taraval segment A (September 2019 to July 2021). Applying that to the initiative is an inference. |
| `street`  | 6               | 4    | Invented. No opened source counts concurrent street projects. Six lets the parking clearances run at about five a year.                                                                                                                                                                                                                    |
| `garage`  | 2               | 4    | Invented. Only two garages exist in v1.                                                                                                                                                                                                                                                                                                    |
| `housing` | 15              | 2    | 15 projects of 50 or more homes were in construction citywide on 2026-10-19 (`projects.json`, tier 0). v1 lets the initiative run as many large builds at once as the whole city does today.                                                                                                                                               |

## Schedule

Opening = `startYear` + `durationMonths`, rounded up to the next 1 January. Capacity is per
calendar year (a project counts in every year it is active for any month). Parking clearances
listed by parcel.

| Year | Starts                                                                                                                      | Opens / completes                                                                                                         | Car closures (and the transit they wait for)                       | transit | street | garage | housing |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- | ------ | ------ | ------- |
| 2029 | fulton-brt, 19th-ave-brt                                                                                                    |                                                                                                                           |                                                                    | 2/4     | 0/6    | 0/2    | 0/15    |
| 2030 | n-judah-priority, central-subway-north-beach                                                                                |                                                                                                                           |                                                                    | 4/4     | 0/6    | 0/2    | 0/15    |
| 2031 | garage-south, garage-north                                                                                                  |                                                                                                                           |                                                                    | 4/4     | 0/6    | 2/2    | 0/15    |
| 2032 | geary-subway-1, j-church-priority, lombard-bus-lane; irving-pedestrian; parking 0700035, 3724067, 7296007, 0327021, 0781034 | fulton-brt, 19th-ave-brt, n-judah-priority (1 Jan); switch day 31 Jan                                                     | irving-pedestrian (after n-judah-priority, open 2032)              | 4/4     | 6/6    | 2/2    | 0/15    |
| 2033 | central-freeway-stub, van-ness-street; parking 0719001, 0719002, 0347016, 0347017                                           | garage-south, garage-north, irving-pedestrian                                                                             | central-freeway-stub (after fulton-brt and n-judah-priority, 2032) | 4/4     | 6/6    | 0/2    | 5/15    |
| 2034 | k-ocean-priority; parking 0446003, 0785030, 1450049, 0715015                                                                | lombard-bus-lane, j-church-priority                                                                                       |                                                                    | 3/4     | 6/6    | 0/2    | 9/15    |
| 2035 | geary-19th-subway-2; columbus-pedestrian; parking 0056007, 0035001, 0685050, 0195019                                        | central-subway-north-beach, van-ness-street; central-freeway-stub clearance (mid-year); first initiative homes (mid-year) | columbus-pedestrian (after central-subway-north-beach, 2035)       | 3/4     | 6/6    | 0/2    | 13/15   |
| 2036 | central-subway-wharf; fell-oak-street; Central Freeway build; parking 0081003, 0147029, 0713033, 3753122, 0743001           | k-ocean-priority, columbus-pedestrian                                                                                     |                                                                    | 3/4     | 6/6    | 0/2    | 13/15   |
| 2037 | parking 7080009, 0761065, 1228006, 2413038, 0768073                                                                         |                                                                                                                           |                                                                    | 3/4     | 6/6    | 0/2    | 14/15   |
| 2038 | parking 0776010, 0718021, 0817011, 1216019, 1182023                                                                         | fell-oak-street                                                                                                           |                                                                    | 3/4     | 5/6    | 0/2    | 15/15   |
| 2039 | parking 1101027, 0101031                                                                                                    |                                                                                                                           |                                                                    | 3/4     | 2/6    | 0/2    | 15/15   |
| 2040 |                                                                                                                             |                                                                                                                           |                                                                    | 3/4     | 0/6    | 0/2    | 12/15   |
| 2041 | geary-trench; parking 0286024, 3735060, 0285020, 3722079, 3721084                                                           | geary-subway-1                                                                                                            | geary-trench (after geary-subway-1, 2041)                          | 2/4     | 6/6    | 0/2    | 7/15    |
| 2042 | parking 0647012, 0647014, 0668003, 1017027, 0658003                                                                         |                                                                                                                           |                                                                    | 2/4     | 6/6    | 0/2    | 7/15    |
| 2043 | parking 0266007, 0680001, 3710014, 0643016                                                                                  |                                                                                                                           |                                                                    | 2/4     | 5/6    | 0/2    | 10/15   |
| 2044 |                                                                                                                             | geary-19th-subway-2, central-subway-wharf, geary-trench clearance                                                         |                                                                    | 0/4     | 0/6    | 0/2    | 14/15   |
| 2045 | Geary trench build                                                                                                          |                                                                                                                           |                                                                    | 0/4     | 0/6    | 0/2    | 10/15   |
| 2046 |                                                                                                                             |                                                                                                                           |                                                                    | 0/4     | 0/6    | 0/2    | 5/15    |
| 2047 |                                                                                                                             | last scheduled build completes (mid-2047)                                                                                 |                                                                    | 0/4     | 0/6    | 0/2    | 1/15    |

Checks:

- **Fillmore rule.** Four car-closing projects, each starting on or after the opening of every
  transit project it depends on: `irving-pedestrian` 2032 ≥ `n-judah-priority` 2032;
  `central-freeway-stub` 2033 ≥ `fulton-brt` 2032 and `n-judah-priority` 2032; `columbus-pedestrian`
  2035 ≥ `central-subway-north-beach` 2035; `geary-trench` 2041 ≥ `geary-subway-1` 2041.
- **Parking in step with transit.** Every conversion starts on or after its dependency's opening
  (2032 Fulton/19th Ave, 2034 Lombard, 2035 North Beach, 2041 Geary).
- **Capacity.** No year exceeds a cap. `transit` is binding 2030–2033, `street` 2032–2037 and
  2041–2042, `housing` 2038–2039.
- **No instant city.** The first initiative homes complete in mid-2035, three years after the first
  transit opens; the last scheduled build completes in 2047.

## What is left out and why

- **I-280 spur north of Mariposa (spec candidate): out.** The segment sits directly above the
  Caltrain tracks from Mariposa to Mission Bay Drive and flies over the 4th/King railyard (RAB
  Executive Summary, September 2018, pp. 40–41). With rail on the surface there is no room for a
  boulevard, and the land under the viaduct is rail right-of-way, so removal frees no buildable
  land; the RAB study also found the freeway has "considerable useful life remaining". The CNNs are
  recorded above so a later plan can add it with the Pennsylvania Avenue rail tunnel, which RAB says
  would make room.
- **Car shuttle (owner's idea): out of v1, owner to decide.** No rail right-of-way links the two
  garage sites, and the spec counts the shuttle as display only. Drawing one would need an invented
  alignment and invented frequencies, with no effect on any number. It can join v2 if the owner
  wants it on the map (Open question 7).
- **Highway removal on Van Ness and Lombard: out** (kept as bus lanes and a street change; see
  `lombard-bus-lane`).
- **Parking sites under 1,000 m²: out of v1.** 171 more served parcels (8.0 ha). They would add
  171 projects for the owner to review; v2 can add them in bulk if v1 shows parking matters.
- **Parking sites with an in-flight project: out** (5 parcels, listed above).
- **M Ocean View tram priority: out.** The M already runs in its own median on 19th Avenue.
- **Sidewalk restoration as a separate project kind: folded in.** The format has no sidewalk width
  parameter; `sidewalk` appears as a lane use in `van-ness-street`, `fell-oak-street` and the two
  pedestrian streets. No opened source gives historic sidewalk widths.
- **Hunters Point and Candlestick BRT (MTC's planned stops): out.** Not a fewer-cars move, and
  MTC's planned stops are already left out of `MUNI_TIER2_STOP_IDS`.

## Open questions for the owner

1. **Switch day — resolved.** 2032-01-31, accepted by the owner in plan review (spec open question
   1). Listed here for the record only.
   Owner answers, 2026-11-01:

2. **Subway station count: keep 12.**
3. **Which transit a parking site waits for: the earliest-opening serving project** (as drafted).
4. **Government garages: the rule is function, not ownership.** A garage that works as the
   transition into or out of the city stays a garage; one that serves parking for trips within the
   city is converted. The four downtown and Japantown garages (`3724067`, `0286024`, `0327021`,
   `0700035`) are destination parking inside the city, not at an entrance, so they stay in v1 as
   parking conversions (drafter's reading of the rule, confirmed by the owner). The edge-garage role
   is carried by `garage-south` and `garage-north`.
5. **Public-zoned (`P`) sites: keep** (an honest zero where no envelope applies).
6. **Phase 2 dependency: independent** (owner). Plan 3 adds a check that phase 2 does not open before phase 1; reasoning below.
7. **Car shuttle: leave for v2.**
8. **Garages off freed land: agreed.**
9. **Geary trench design: the linear block for v1.** The owner adds: convert intersections like
   Masonic & Geary into roundabouts. Then, on reflection: no roundabout; the Masonic subway station
   replaces the underpass and the Masonic and Park Presidio crossings stay ordinary intersections
   (see "Masonic underpass becomes the Masonic station").

**Plan 3 carving check for the trench.** The main-lane CNNs share one centreline with their
opposite-direction twins and the Fillmore frontage roads (Data findings). The carve removes a
`keepHalfM` corridor around every _kept_ centreline, so if only the three main-lane CNNs are listed
as removed, the twins' corridor would erase most of the 20 m freed strip. Plan 3 must list the twins
in `segments` (or keep the frontage roads deliberately and accept a narrower block), and check the
carved area against the expected ~1.8 ha.

6 (resolved). **Are the two subway phases structurally dependent?** For construction, no: phase 2 is a
separate tunnel drive from Park Presidio south under Golden Gate Park and 19th Avenue to Daly City
BART, and California and peer agencies routinely build segments of one line under separate
contracts at the same time. For service, partly: phase 2 has its own utility (19th Avenue to Daly
City BART, the N and L transfers, SF State), but its trains reach downtown only through phase 1. The
schedule already opens phase 2 (2044) after phase 1 (2041), so nothing is stranded. The plan format
has no "opens after" link, only "starts after a dependency opens", which would push phase 2's
opening to 2050. Drafter's recommendation: keep it independent and add a plan check in Plan 3 that
phase 2 does not open before phase 1.

## Appendix A: plan.json fields

`schema: 1`, `id: "lesscars-v1"`, `label: "Fewer cars, v1"`. Field names below are exactly Task 2's.
A Param is written `value (PV-id)`; the provenance table gives its `tier`, `label`, `sources` and
`method`. Segments written as a street selector (`STREET, FROM → TO`) are resolved by Plan 3 to
`{ cnn: [...] }` with the Streets query pattern recorded above; the others are given as CNNs or a
line.

### Provenances

| Id              | `tier` | `label`                                                                        | `sources`      | `method`                                                                                                                                                                                     |
| --------------- | ------ | ------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PV-subway       | 2      | 9 years to build a subway phase (peer range 7–10 years)                        | S1, S3, S4     | Midpoint of the Strategic Case's 7–10 years for construction and commissioning; Central Subway's June 2011 tunnel contract to January 2023 service (~11.5 years) as the San Francisco check. |
| PV-start-subway | 2      | Construction starts 6 years after the 2026 Strategic Case                      | S1             | Strategic Case: 5–8 years of planning, alternatives analysis and environmental work for California peers.                                                                                    |
| PV-tph-subway   | 2      | 24 trains an hour at the peak                                                  | S1             | The Strategic Case's modelling assumption per direction.                                                                                                                                     |
| PV-cs-north     | 4      | 5 years for one station on existing tunnels (invented)                         | S5             | No published estimate. The tunnels to Columbus & Union exist (S5).                                                                                                                           |
| PV-cs-wharf     | 2      | 8 years for a bored extension                                                  | S1             | Low end of the Strategic Case's 7–10 years, plus one year.                                                                                                                                   |
| PV-tph-T        | 2      | 6 trains an hour, today's T Third peak                                         | D3             | Max of `tph` on the T patterns in `transit.json` (5.5–6.0), carried onto the extension.                                                                                                      |
| PV-brt          | 2      | 3 years for side-running bus lanes                                             | S7, S6         | Geary Rapid: three-year capital project, about 3 miles, completed fall 2021 (S7). Van Ness BRT 2016–2022 as the slow bound (S6).                                                             |
| PV-tph-brt      | 2      | 11 buses an hour, the 38R on Geary's red lanes                                 | D3             | Max of `tph` on the 38R patterns in `transit.json` (10–11), applied to the plan corridors.                                                                                                   |
| PV-tram         | 2      | 2 years for street and track works on a tram corridor                          | S8             | L Taraval segment A, September 2019 to July 2021 (about 22 months), rounded up.                                                                                                              |
| PV-tph-N        | 4      | 10 trams an hour on the N after priority (invented)                            | D3             | Today 6.0–6.5 (`transit.json`); the gain is a guess.                                                                                                                                         |
| PV-tph-J        | 4      | 7 trams an hour on the J after priority (invented)                             | D3             | Today 4.0–4.5; the gain is a guess.                                                                                                                                                          |
| PV-tph-K        | 4      | 8 trams an hour on the K after priority (invented)                             | D3             | Today 6.0–6.5; the gain is a guess.                                                                                                                                                          |
| PV-ped          | 4      | 1 year to pedestrianise a street (invented)                                    | S9             | Car-free Market Street started 29 days after SFMTA announced it (S9); a year allows for loading and curb work.                                                                               |
| PV-fell-oak     | 4      | 18 months to reconfigure Fell and Oak (invented)                               | —              | Unsourced.                                                                                                                                                                                   |
| PV-hwy          | 2      | 30 months to take down an elevated freeway stub                                | S10            | Central Freeway: demolition began March 2003, Octavia Boulevard opened 9 September 2005.                                                                                                     |
| PV-trench       | 2      | 3 years to fill a sunken expressway                                            | S12, S13       | Rochester Inner Loop East, November 2014 to December 2017 (S12); the 2014 Geary underpass estimate of two years (S13, tier 3) as a check.                                                    |
| PV-row-geary    | 4      | 10 m either side of Geary's centreline becomes land (frontage widths invented) | D3             | Right-of-way 45.7–54.3 m measured from parcel outlines (tier 0); about 15 m kept each side for a one-way street is invented.                                                                 |
| PV-row-cfwy     | 4      | 11 m either side of the freeway line (invented)                                | —              | Half a four-lane deck with shoulders; unsourced.                                                                                                                                             |
| PV-garage       | 2      | 2 years to build a garage                                                      | D3             | Construction-stage median 23–25 months in `calibration.json` (SF permit records), applied to a parking structure.                                                                            |
| PV-spaces-south | 4      | 750 spaces (invented)                                                          | D2             | 4,687 m² footprint × 5 levels ÷ 30 m² per space.                                                                                                                                             |
| PV-spaces-north | 4      | 300 spaces (invented)                                                          | D2             | 1,864 m² footprint × 5 levels ÷ 30 m² per space.                                                                                                                                             |
| PV-clear-lot    | 4      | 6 months to clear a surface lot (invented)                                     | —              | Unsourced.                                                                                                                                                                                   |
| PV-clear-garage | 4      | 12 months to demolish a garage (invented)                                      | —              | Unsourced.                                                                                                                                                                                   |
| PV-build        | 2      | 30 months to build a large building                                            | D3             | Construction-stage median 23–25 months and 80th percentile 34–46 months in `calibration.json`; 30 for full-fill buildings.                                                                   |
| PV-line-cfwy    | 0      | Central Freeway stub from the Mission St ramps to Market St                    | D2             | Vertices of Streets CNN `19204001` from the Mission St ramp junction (−122.4194) to the Market St touchdown.                                                                                 |
| PV-cap-transit  | 2      | Four major transit projects at once, as SFMTA ran in 2019–2021                 | S3, S6, S7, S8 | Overlap of the four projects' construction dates.                                                                                                                                            |
| PV-cap-street   | 4      | Six street projects at once (invented)                                         | —              | Unsourced.                                                                                                                                                                                   |
| PV-cap-garage   | 4      | Two garage projects at once (invented)                                         | —              | Unsourced.                                                                                                                                                                                   |
| PV-cap-housing  | 2      | Fifteen large builds at once, the city's count today                           | D3             | Projects of 50+ homes in `construction` in `projects.json` (asOf 2026-10-19).                                                                                                                |

### Capacity

| `kind`    | `maxConcurrent` | `provenance`   |
| --------- | --------------- | -------------- |
| `transit` | 4               | PV-cap-transit |
| `street`  | 6               | PV-cap-street  |
| `garage`  | 2               | PV-cap-garage  |
| `housing` | 15              | PV-cap-housing |

### geary-subway-1

| Field            | Value                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `geary-subway-1`                                                                                                                                                                                                                                                                                                                                                 |
| `label`          | Geary subway, phase 1 (Kearny to Arguello)                                                                                                                                                                                                                                                                                                                       |
| `kind`           | `transit-line`                                                                                                                                                                                                                                                                                                                                                   |
| `startYear`      | 2032 (PV-start-subway)                                                                                                                                                                                                                                                                                                                                           |
| `durationMonths` | 108 (PV-subway)                                                                                                                                                                                                                                                                                                                                                  |
| `dependsOn`      | `[]`                                                                                                                                                                                                                                                                                                                                                             |
| `mode`           | `subway`                                                                                                                                                                                                                                                                                                                                                         |
| `stops`          | `lc:geary-kearny` Geary & Kearny [-122.40366, 37.78800]; `lc:geary-jones` Geary & Jones [-122.41333, 37.78677]; `lc:geary-van-ness` Geary & Van Ness [-122.42158, 37.78575]; `lc:geary-fillmore` Geary & Fillmore [-122.43305, 37.78439]; `lc:geary-masonic` Geary & Masonic [-122.44680, 37.78250]; `lc:geary-arguello` Geary & Arguello [-122.45869, 37.78115] |
| `peakTph`        | 24 (PV-tph-subway)                                                                                                                                                                                                                                                                                                                                               |
| `alignment`      | the six stop coordinates in order                                                                                                                                                                                                                                                                                                                                |

Stop coordinates are taken from the nearest existing Muni stop of the same name in `transit.json`
(Masonic estimated: there is no "Geary & Masonic" stop). Exact station sites are tier 4.

### geary-19th-subway-2

| Field            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `geary-19th-subway-2`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `label`          | Geary/19th Avenue subway, phase 2 (Park Presidio to Daly City)                                                                                                                                                                                                                                                                                                                                                                        |
| `kind`           | `transit-line`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `startYear`      | 2035                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `durationMonths` | 108 (PV-subway)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `dependsOn`      | `[]`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mode`           | `subway`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `stops`          | `lc:geary-park-presidio` Geary & Park Presidio [-122.47231, 37.78066]; `lc:19th-irving` 19th Ave & Irving [-122.47717, 37.76356]; `lc:19th-noriega` 19th Ave & Noriega [-122.47645, 37.75412]; `lc:19th-taraval` 19th Ave & Taraval [-122.47564, 37.74296]; `lc:19th-winston` 19th Ave & Winston (Stonestown/SF State) [-122.47490, 37.72723]; `lc:19th-junipero-serra` 19th Ave & Junipero Serra (Parkmerced) [-122.47308, 37.71769] |
| `peakTph`        | 24 (PV-tph-subway)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `alignment`      | [-122.45869, 37.78115] (phase 1 end), the six stops in order, [-122.46892, 37.70626] (Daly City BART)                                                                                                                                                                                                                                                                                                                                 |

### central-subway-north-beach

| Field            | Value                                                                  |
| ---------------- | ---------------------------------------------------------------------- |
| `id`             | `central-subway-north-beach`                                           |
| `label`          | Central Subway to North Beach                                          |
| `kind`           | `transit-line`                                                         |
| `startYear`      | 2030 (tier 4, invented: study ends mid-2028, then design)              |
| `durationMonths` | 60 (PV-cs-north)                                                       |
| `dependsOn`      | `[]`                                                                   |
| `mode`           | `tram`                                                                 |
| `stops`          | `lc:north-beach` Columbus & Union (North Beach) [-122.41043, 37.80044] |
| `peakTph`        | 6 (PV-tph-T)                                                           |
| `alignment`      | [-122.40808, 37.79481] (Chinatown–Rose Pak), [-122.41043, 37.80044]    |

### central-subway-wharf

| Field            | Value                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| `id`             | `central-subway-wharf`                                                            |
| `label`          | Central Subway to Fisherman's Wharf                                               |
| `kind`           | `transit-line`                                                                    |
| `startYear`      | 2036                                                                              |
| `durationMonths` | 96 (PV-cs-wharf)                                                                  |
| `dependsOn`      | `["central-subway-north-beach"]`                                                  |
| `mode`           | `tram`                                                                            |
| `stops`          | `lc:fishermans-wharf` Fisherman's Wharf (Beach & Stockton) [-122.41081, 37.80784] |
| `peakTph`        | 6 (PV-tph-T)                                                                      |
| `alignment`      | [-122.41043, 37.80044], [-122.41081, 37.80784]                                    |

### fulton-brt

| Field            | Value                                                                                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `fulton-brt`                                                                                                                                                                                                                                                                                                          |
| `label`          | Fulton and McAllister bus lanes (5, 5R)                                                                                                                                                                                                                                                                               |
| `kind`           | `bus-lane`                                                                                                                                                                                                                                                                                                            |
| `startYear`      | 2029                                                                                                                                                                                                                                                                                                                  |
| `durationMonths` | 36 (PV-brt)                                                                                                                                                                                                                                                                                                           |
| `dependsOn`      | `[]`                                                                                                                                                                                                                                                                                                                  |
| `routeIds`       | `["5", "5R"]`                                                                                                                                                                                                                                                                                                         |
| `stopIds`        | `muni:` + 4211 4212 4213 4215 4218 4221 4222 4223 4224 4225 4226 4228 4229 4230 4231 4232 4233 4234 4235 4236 4730 4731 4732 4733 4734 4735 4736 4737 4742 4746 4747 4748 4749 4751 4753 5384 5385 5389 5390 5391 5392 5393 5394 5395 5396 5397 5398 5399 5400 5401 5404 5405 7563 7635 7720 7721 7727 7728 7729 7730 |
| `segments`       | `MCALLISTER ST, JONES ST → CENTRAL AVE`; `FULTON ST, CENTRAL AVE → LA PLAYA ST`                                                                                                                                                                                                                                       |
| `peakTph`        | 11 (PV-tph-brt)                                                                                                                                                                                                                                                                                                       |

### 19th-ave-brt

| Field            | Value                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `19th-ave-brt`                                                                                                                                                                                                             |
| `label`          | 19th Avenue and Park Presidio bus lanes (28, 28R)                                                                                                                                                                          |
| `kind`           | `bus-lane`                                                                                                                                                                                                                 |
| `startYear`      | 2029                                                                                                                                                                                                                       |
| `durationMonths` | 36 (PV-brt)                                                                                                                                                                                                                |
| `dependsOn`      | `[]`                                                                                                                                                                                                                       |
| `routeIds`       | `["28", "28R"]`                                                                                                                                                                                                            |
| `stopIds`        | `muni:` + 390 3354 3355 3356 3359 3360 3362 3363 3364 3365 3368 3369 3371 3374 3375 3379 3380 3383 3384 3388 3389 3390 3391 3394 3395 3398 3399 3402 5134 5135 5136 5140 5946 5947 5948 5949 5950 5951 5952 5953 7448 7758 |
| `segments`       | `PARK PRESIDIO BLVD, LAKE ST → FULTON ST`; `19TH AVE, LINCOLN WAY → JUNIPERO SERRA BLVD`; `JUNIPERO SERRA BLVD, 19TH AVE → COUNTY LINE`                                                                                    |
| `peakTph`        | 11 (PV-tph-brt)                                                                                                                                                                                                            |

### lombard-bus-lane

| Field            | Value                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| `id`             | `lombard-bus-lane`                                                             |
| `label`          | Lombard Street bus lanes (28)                                                  |
| `kind`           | `bus-lane`                                                                     |
| `startYear`      | 2032                                                                           |
| `durationMonths` | 24 (PV-tram)                                                                   |
| `dependsOn`      | `[]`                                                                           |
| `routeIds`       | `["28"]`                                                                       |
| `stopIds`        | `muni:` + 5272 5273 5274 5275 5280 5281 5284 5285 6181 6182 7787 7800          |
| `segments`       | `LOMBARD ST, VAN NESS AVE → LYON ST`; `RICHARDSON AVE, LYON ST → FRANCISCO ST` |
| `peakTph`        | 11 (PV-tph-brt)                                                                |

### n-judah-priority, j-church-priority, k-ocean-priority

| Field            | `n-judah-priority`                                                                                                                           | `j-church-priority`                                              | `k-ocean-priority`                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| `id`             | `n-judah-priority`                                                                                                                           | `j-church-priority`                                              | `k-ocean-priority`                              |
| `label`          | N Judah: no cars on the tram lanes                                                                                                           | J Church: no cars on the tram lanes                              | K Ingleside: no cars on the tram lanes          |
| `kind`           | `tram-priority`                                                                                                                              | `tram-priority`                                                  | `tram-priority`                                 |
| `startYear`      | 2030                                                                                                                                         | 2032                                                             | 2034                                            |
| `durationMonths` | 24 (PV-tram)                                                                                                                                 | 24 (PV-tram)                                                     | 24 (PV-tram)                                    |
| `dependsOn`      | `[]`                                                                                                                                         | `[]`                                                             | `[]`                                            |
| `routeIds`       | `["N"]`                                                                                                                                      | `["J"]`                                                          | `["K"]`                                         |
| `segments`       | `CARL ST, COLE ST → ARGUELLO BLVD`; `IRVING ST, ARGUELLO BLVD → 9TH AVE`; `9TH AVE, IRVING ST → JUDAH ST`; `JUDAH ST, 9TH AVE → LA PLAYA ST` | `CHURCH ST, MARKET ST → 18TH ST`; `CHURCH ST, 22ND ST → 30TH ST` | `OCEAN AVE, JUNIPERO SERRA BLVD → SAN JOSE AVE` |
| `peakTph`        | 10 (PV-tph-N)                                                                                                                                | 7 (PV-tph-J)                                                     | 8 (PV-tph-K)                                    |

### garage-south, garage-north

| Field            | `garage-south`                                   | `garage-north`                                       |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `id`             | `garage-south`                                   | `garage-north`                                       |
| `label`          | South edge garage (US-101 terminus, Division St) | North edge garage (Golden Gate approach, Lombard St) |
| `kind`           | `edge-garage`                                    | `edge-garage`                                        |
| `startYear`      | 2031                                             | 2031                                                 |
| `durationMonths` | 24 (PV-garage)                                   | 24 (PV-garage)                                       |
| `dependsOn`      | `[]`                                             | `[]`                                                 |
| `site`           | `{ parcel: "3901004" }`                          | `{ parcel: "0509009" }`                              |
| `spaces`         | 750 (PV-spaces-south)                            | 300 (PV-spaces-north)                                |

### van-ness-street, fell-oak-street, irving-pedestrian, columbus-pedestrian

| Field            | `van-ness-street`                                           | `fell-oak-street`                                               | `irving-pedestrian`                             | `columbus-pedestrian`                          |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `id`             | `van-ness-street`                                           | `fell-oak-street`                                               | `irving-pedestrian`                             | `columbus-pedestrian`                          |
| `label`          | Van Ness: one car lane each way, wider sidewalks, bike lane | Fell and Oak: one fewer car lane each                           | Irving Street pedestrian street                 | Columbus Avenue pedestrian street              |
| `kind`           | `street-change`                                             | `street-change`                                                 | `street-change`                                 | `street-change`                                |
| `startYear`      | 2033                                                        | 2036                                                            | 2032                                            | 2035                                           |
| `durationMonths` | 24 (PV-tram)                                                | 18 (PV-fell-oak)                                                | 12 (PV-ped)                                     | 12 (PV-ped)                                    |
| `dependsOn`      | `[]`                                                        | `["central-freeway-stub"]`                                      | `["n-judah-priority"]`                          | `["central-subway-north-beach"]`               |
| `segments`       | `VAN NESS AVE, LOMBARD ST → MARKET ST`                      | `FELL ST, MARKET ST → BAKER ST`; `OAK ST, MARKET ST → BAKER ST` | `IRVING ST, ARGUELLO BLVD → 9TH AVE`            | `COLUMBUS AVE, BROADWAY → BAY ST`              |
| `lanes`          | `["car", "bus", "bike", "sidewalk"]`                        | `["car", "bus", "bike", "sidewalk"]`                            | `["tram", "pedestrian", "service", "sidewalk"]` | `["bus", "pedestrian", "service", "sidewalk"]` |

### central-freeway-stub

| Field            | Value                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `central-freeway-stub`                                                                                                                                                                                                                            |
| `label`          | Central Freeway ends at Mission Street                                                                                                                                                                                                            |
| `kind`           | `highway-truncation`                                                                                                                                                                                                                              |
| `startYear`      | 2033                                                                                                                                                                                                                                              |
| `durationMonths` | 30 (PV-hwy)                                                                                                                                                                                                                                       |
| `dependsOn`      | `["fulton-brt", "n-judah-priority", "garage-south"]`                                                                                                                                                                                              |
| `segments`       | `{ line: [[-122.419542, 37.770086], [-122.4201, 37.770105], [-122.420816, 37.770145], [-122.4215, 37.770298], [-122.422168, 37.770602], [-122.422814, 37.771135], [-122.423252, 37.77177], [-122.423397, 37.771886]], provenance: PV-line-cfwy }` |
| `rowHalfWidthM`  | 11 (PV-row-cfwy)                                                                                                                                                                                                                                  |
| `build`          | `{ startYear: 2036, durationMonths: 30 (PV-build) }`                                                                                                                                                                                              |

### geary-trench

| Field            | Value                                                |
| ---------------- | ---------------------------------------------------- |
| `id`             | `geary-trench`                                       |
| `label`          | Geary expressway trench filled, Gough to Steiner     |
| `kind`           | `street-removal`                                     |
| `startYear`      | 2041                                                 |
| `durationMonths` | 36 (PV-trench)                                       |
| `dependsOn`      | `["geary-subway-1"]`                                 |
| `segments`       | `{ cnn: ["6039201", "6040201", "6041201"] }`         |
| `rowHalfWidthM`  | 10 (PV-row-geary)                                    |
| `build`          | `{ startYear: 2045, durationMonths: 30 (PV-build) }` |

### Parking conversions

All rows: `kind` `parking-conversion`; `label` "Parking at <street> becomes homes"; `build.durationMonths`
30 (PV-build). `durationMonths` is the clearance.

| `id`           | `parcel`  | `startYear` | `durationMonths`     | `dependsOn`                  | `build.startYear` |
| -------------- | --------- | ----------- | -------------------- | ---------------------------- | ----------------- |
| `park-0700035` | `0700035` | 2032        | 12 (PV-clear-garage) | `fulton-brt`                 | 2033              |
| `park-3724067` | `3724067` | 2032        | 12 (PV-clear-garage) | `fulton-brt`                 | 2033              |
| `park-7296007` | `7296007` | 2032        | 12 (PV-clear-garage) | `19th-ave-brt`               | 2033              |
| `park-0327021` | `0327021` | 2032        | 12 (PV-clear-garage) | `fulton-brt`                 | 2033              |
| `park-0781034` | `0781034` | 2032        | 12 (PV-clear-garage) | `fulton-brt`                 | 2033              |
| `park-0719001` | `0719001` | 2033        | 12 (PV-clear-garage) | `fulton-brt`                 | 2034              |
| `park-0719002` | `0719002` | 2033        | 12 (PV-clear-garage) | `fulton-brt`                 | 2034              |
| `park-0347016` | `0347016` | 2033        | 12 (PV-clear-garage) | `fulton-brt`                 | 2034              |
| `park-0347017` | `0347017` | 2033        | 12 (PV-clear-garage) | `fulton-brt`                 | 2034              |
| `park-0446003` | `0446003` | 2034        | 6 (PV-clear-lot)     | `lombard-bus-lane`           | 2035              |
| `park-0785030` | `0785030` | 2034        | 12 (PV-clear-garage) | `fulton-brt`                 | 2035              |
| `park-1450049` | `1450049` | 2034        | 12 (PV-clear-garage) | `19th-ave-brt`               | 2035              |
| `park-0715015` | `0715015` | 2034        | 12 (PV-clear-garage) | `fulton-brt`                 | 2035              |
| `park-0056007` | `0056007` | 2035        | 12 (PV-clear-garage) | `central-subway-north-beach` | 2036              |
| `park-0035001` | `0035001` | 2035        | 12 (PV-clear-garage) | `central-subway-north-beach` | 2036              |
| `park-0685050` | `0685050` | 2035        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2036              |
| `park-0195019` | `0195019` | 2035        | 12 (PV-clear-garage) | `central-subway-north-beach` | 2036              |
| `park-0081003` | `0081003` | 2036        | 12 (PV-clear-garage) | `central-subway-north-beach` | 2037              |
| `park-0147029` | `0147029` | 2036        | 12 (PV-clear-garage) | `central-subway-north-beach` | 2037              |
| `park-0713033` | `0713033` | 2036        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2037              |
| `park-3753122` | `3753122` | 2036        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2037              |
| `park-0743001` | `0743001` | 2036        | 12 (PV-clear-garage) | `fulton-brt`                 | 2037              |
| `park-7080009` | `7080009` | 2037        | 12 (PV-clear-garage) | `19th-ave-brt`               | 2038              |
| `park-0761065` | `0761065` | 2037        | 12 (PV-clear-garage) | `fulton-brt`                 | 2038              |
| `park-1228006` | `1228006` | 2037        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2038              |
| `park-2413038` | `2413038` | 2037        | 6 (PV-clear-lot)     | `19th-ave-brt`               | 2038              |
| `park-0768073` | `0768073` | 2037        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2038              |
| `park-0776010` | `0776010` | 2038        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2039              |
| `park-0718021` | `0718021` | 2038        | 12 (PV-clear-garage) | `fulton-brt`                 | 2039              |
| `park-0817011` | `0817011` | 2038        | 12 (PV-clear-garage) | `fulton-brt`                 | 2039              |
| `park-1216019` | `1216019` | 2038        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2039              |
| `park-1182023` | `1182023` | 2038        | 12 (PV-clear-garage) | `fulton-brt`                 | 2039              |
| `park-1101027` | `1101027` | 2039        | 6 (PV-clear-lot)     | `fulton-brt`                 | 2040              |
| `park-0101031` | `0101031` | 2039        | 12 (PV-clear-garage) | `central-subway-north-beach` | 2040              |
| `park-0286024` | `0286024` | 2041        | 12 (PV-clear-garage) | `geary-subway-1`             | 2042              |
| `park-3735060` | `3735060` | 2041        | 12 (PV-clear-garage) | `geary-subway-1`             | 2042              |
| `park-0285020` | `0285020` | 2041        | 12 (PV-clear-garage) | `geary-subway-1`             | 2042              |
| `park-3722079` | `3722079` | 2041        | 12 (PV-clear-garage) | `geary-subway-1`             | 2042              |
| `park-3721084` | `3721084` | 2041        | 12 (PV-clear-garage) | `geary-subway-1`             | 2042              |
| `park-0647012` | `0647012` | 2042        | 12 (PV-clear-garage) | `geary-subway-1`             | 2043              |
| `park-0647014` | `0647014` | 2042        | 12 (PV-clear-garage) | `geary-subway-1`             | 2043              |
| `park-0668003` | `0668003` | 2042        | 12 (PV-clear-garage) | `geary-subway-1`             | 2043              |
| `park-1017027` | `1017027` | 2042        | 6 (PV-clear-lot)     | `geary-subway-1`             | 2043              |
| `park-0658003` | `0658003` | 2042        | 6 (PV-clear-lot)     | `geary-subway-1`             | 2043              |
| `park-0266007` | `0266007` | 2043        | 12 (PV-clear-garage) | `geary-subway-1`             | 2044              |
| `park-0680001` | `0680001` | 2043        | 12 (PV-clear-garage) | `geary-subway-1`             | 2044              |
| `park-3710014` | `3710014` | 2043        | 12 (PV-clear-garage) | `geary-subway-1`             | 2044              |
| `park-0643016` | `0643016` | 2043        | 6 (PV-clear-lot)     | `geary-subway-1`             | 2044              |

## Appendix B: sources

Every source below was opened for this draft (2026-11-01).

| Id  | Source                                                                                                                                                                                                                                      | Used for                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | SFCTA, _Geary/19th Ave Subway and Regional Connections Study Strategic Case_, Final Report, June 2026. https://www.sfcta.org/sites/default/files/2026-06/SFCTA_Geary-19th_Subway_and_Regional_Connections_Study_Final_Report_2026-06-23.pdf | Corridor, ~10 miles, 5–6 modelled stations, 0.5–1 mile spacing, 24 tph, $20–30 billion, 5–8 years planning and 7–10 years construction for California peers, initial operating segment |
| S2  | SFCTA, Geary/19th Ave Subway and Regional Connections Study, project page. https://www.sfcta.org/projects/geary19th-ave-subway-and-regional-connections-study                                                                               | Study status                                                                                                                                                                           |
| S3  | SFMTA, Central Subway Project. https://www.sfmta.com/projects/central-subway-project                                                                                                                                                        | 1.7 miles, four stations, revenue service 7 January 2023, ~$1.95 billion baseline                                                                                                      |
| S4  | Tunneling Online, "Worth the Wait" (Central Subway, November 2013). https://tunnelingonline.com/san-francisco-tunnel/                                                                                                                       | Tunnel contract June 2011; station work began 2013                                                                                                                                     |
| S5  | SFMTA, Central Subway Extension. https://www.sfmta.com/projects/central-subway-extension                                                                                                                                                    | Tunnels end at Columbus Ave & Union St; one-station study mid-2026 to mid-2028; Fisherman's Wharf as the comparison                                                                    |
| S6  | Wikipedia, "Van Ness Bus Rapid Transit". https://en.wikipedia.org/wiki/Van_Ness_Bus_Rapid_Transit                                                                                                                                           | Construction from June 2016 (groundbreaking March 2017), opened 1 April 2022, 1.96 miles                                                                                               |
| S7  | SFMTA, Geary Rapid Project. https://www.sfmta.com/projects/geary-rapid-project                                                                                                                                                              | Three-year capital project, about 3 miles, completed fall 2021; four general lanes to two each way plus a bus lane                                                                     |
| S8  | SFMTA, L Taraval Improvement Project. https://www.sfmta.com/projects/l-taraval-improvement-project                                                                                                                                          | Segment A 2019–2021, segment B 2022–2024                                                                                                                                               |
| S9  | SFMTA, "Car-Free Market Street starts January 29" (31 December 2019). https://www.sfmta.com/blog/car-free-market-street-starts-january-29                                                                                                   | 29 days from announcement to car-free Market Street                                                                                                                                    |
| S10 | SF Board of Supervisors, Resolution 94-13 (Central Freeway freeway agreement). https://www.sfbos.org/ftp/uploadedfiles/bdsupvrs/resolutions13/r0094-13.pdf                                                                                  | Demolition began March 2003; Octavia Boulevard opened 9 September 2005                                                                                                                 |
| S11 | Mission Local, "Advocates for housing on Parcel K…" (24 September 2024). https://missionlocal.org/2024/09/advocates-housing-parcel-k-hayes-valley-march-signatures-city-hall/                                                               | Parcel K, a quarter acre, leased as a temporary use since 2009, not prioritised in the next 3–5 years                                                                                  |
| S12 | FHWA, "Rochester, NY: Freeway to Boulevard" project profile. https://www.fhwa.dot.gov/ipd/project_profiles/ny_freeway_to_boulvard_rochester.aspx                                                                                            | Inner Loop East removal November 2014 to December 2017; $22 million                                                                                                                    |
| S13 | CBS San Francisco (Phil Matier), "San Francisco's $50 Million Plan To Fill Geary Blvd. Underpass", 7 February 2014. https://www.cbsnews.com/amp/sanfrancisco/news/phil-matier-san-franciscos-50-million-plan-to-fill-geary-blvd-underpass/  | Underpass fill about $50 million, two-year construction expected (tier 3)                                                                                                              |
| S14 | SF Planning, _Rail Alignment and Benefits Study_, Executive Summary, September 2018 (SFCTA copy). https://www.sfcta.org/sites/default/files/2019-02/RAB_ExecutiveSummary.pdf                                                                | I-280 north of Mariposa above Caltrain; no room for a boulevard with surface rail; considerable useful life                                                                            |
| D1  | DataSF Assessor Historical Secured Property Tax Rolls (`wv5m-vpq2`). https://data.sf.gov/d/wv5m-vpq2                                                                                                                                        | Parking classes and candidates (queries above)                                                                                                                                         |
| D2  | DataSF Streets – Active and Retired (`3psu-pn9h`). https://data.sf.gov/d/3psu-pn9h                                                                                                                                                          | Freeway and Geary CNNs and lines (queries above)                                                                                                                                       |
| D3  | SF Housing Simulator dataset `2026-10-29-14e0eccb`: `transit.json`, `parcels/*.json`, `scenarios/fzp/projects.json`, `scenarios/fzp/calibration.json`. https://sfhousing.mindlace.net/data/2026-10-29-14e0eccb/manifest.json                | Stops, tph, parcel outlines and homes, in-flight projects, construction durations, Geary width                                                                                         |
| D4  | `MUNI_TIER2_STOP_IDS`, `pipeline/sb79-config.ts` (MTC SB 79 TOD stops, cited there)                                                                                                                                                         | Which corridor stops are already tier 2                                                                                                                                                |

Owner review: approved 2026-11-01 (answers to the nine questions recorded under "Open questions for the owner"; no Masonic roundabout, the Masonic station replaces the underpass).
