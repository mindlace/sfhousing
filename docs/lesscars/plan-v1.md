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
46 surface lots and garages, each one only after a plan transit project with a stop within ½ mile
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
- **No plan project demolishes existing homes (owner).** Every parking parcel in the plan has 0
  homes on the 2025 assessor roll and in the dataset's parcel file; freed land excludes parcels by
  construction. Two sites first listed had homes in the built parcel file and were dropped (see
  the correction under Parking sites).
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
| Excluded: homes in the built parcel file (correction 2026-11-02)                     | 2                 |
| **Parking conversions in v1**                                                        | **46** (10.8 ha)  |

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

The 48 sites first listed (two since dropped, marked **dropped**; see the correction below), with
the transit project each depends on (the earliest-opening serving project,
**drafter's call**, see Open question 3) and any other serving project. `zoning` is the assessor
roll's `zoning_code` (`NA` = the roll has none), not the Planning zoning map, which the pipeline
reads itself:

| Parcel                | Street          | Neighbourhood                  | Class | Area m² | Zoning | Land use 2023 | Depends on (stop distance)         | Also served by             |
| --------------------- | --------------- | ------------------------------ | ----- | ------- | ------ | ------------- | ---------------------------------- | -------------------------- |
| `0700035`             | Geary Blvd      | Japantown                      | GG    | 11,964  | NA     | VACANT        | fulton-brt (656 m)                 | geary-subway-1 185 m       |
| `3724067`             | Mission St      | South of Market                | PLG   | 11,903  | P      | MIXED         | fulton-brt (552 m)                 | geary-subway-1 416 m       |
| `7296007`             | Winston Dr      | Lakeshore                      | G     | 6,463   | C2     | RETAIL/ENT    | 19th-ave-brt (256 m)               | geary-19th-subway-2 273 m  |
| `0286024`             | Sutter St       | Financial District/South Beach | GG    | 4,723   | P      | RETAIL/ENT    | geary-subway-1 (274 m)             | —                          |
| `0056007`             | Montgomery St   | North Beach                    | G     | 4,515   | C2     | MIXED         | central-subway-north-beach (620 m) | central-subway-wharf 440 m |
| `3735060`             | 3rd St          | Financial District/South Beach | PLG   | 3,718   | C3S    | MIXED         | geary-subway-1 (498 m)             | —                          |
| `0446003`             | Marina Blvd     | Marina                         | PL    | 3,258   | NCS    | VACANT        | lombard-bus-lane (429 m)           | —                          |
| `0327021`             | O'Farrell St    | Financial District/South Beach | GG    | 3,131   | P      | PDR           | fulton-brt (661 m)                 | geary-subway-1 337 m       |
| `0035001`             | Bay St          | North Beach                    | PLG   | 2,915   | C2     | PDR           | central-subway-north-beach (739 m) | central-subway-wharf 325 m |
| `0719002`             | Van Ness Ave    | Western Addition               | G     | 2,757   | RC4    | RETAIL/ENT    | fulton-brt (426 m)                 | geary-subway-1 172 m       |
| `0781034`             | Fulton St       | Western Addition               | PLG   | 2,459   | RM2    | VACANT        | fulton-brt (143 m)                 | geary-subway-1 741 m       |
| `0347016`             | Golden Gate Ave | Tenderloin                     | GG    | 2,377   | CM     | RETAIL/ENT    | fulton-brt (64 m)                  | geary-subway-1 632 m       |
| `0785030`             | McAllister St   | Hayes Valley                   | PLG   | 2,073   | NC3    | VACANT        | fulton-brt (40 m)                  | geary-subway-1 671 m       |
| `1450049`             | 18th Ave        | Outer Richmond                 | G     | 2,020   | NA     | VACANT        | 19th-ave-brt (443 m)               | geary-19th-subway-2 451 m  |
| `0719001`             | Van Ness Ave    | Western Addition               | G     | 1,990   | RC4    | RETAIL/ENT    | fulton-brt (473 m)                 | geary-subway-1 125 m       |
| `0715015`             | Van Ness Ave    | Tenderloin                     | G     | 1,937   | NC3    | RETAIL/ENT    | fulton-brt (543 m)                 | geary-subway-1 120 m       |
| `0685050`             | Webster St      | Japantown                      | PL    | 1,795   | NC2    | VACANT        | fulton-brt (778 m)                 | geary-subway-1 222 m       |
| `0195019` **dropped** | Kearny St       | Chinatown                      | G     | 1,779   | CRNC   | MIXED         | central-subway-north-beach (675 m) | —                          |
| `0285020` **dropped** | Sutter St       | Financial District/South Beach | G     | 1,753   | NA     | VISITOR       | geary-subway-1 (415 m)             | —                          |
| `0081003`             | Sansome St      | Financial District/South Beach | G     | 1,750   | C2     | VACANT        | central-subway-north-beach (730 m) | central-subway-wharf 797 m |
| `0147029`             | Vallejo St      | Chinatown                      | GG    | 1,750   | NA     | PDR           | central-subway-north-beach (238 m) | —                          |
| `0713033`             | Gough St        | Western Addition               | PL    | 1,741   | RM4    | VACANT        | fulton-brt (515 m)                 | geary-subway-1 187 m       |
| `3722079`             | Natoma St       | Financial District/South Beach | G     | 1,740   | C3O    | PDR           | geary-subway-1 (318 m)             | —                          |
| `3753122`             | 6th St          | South of Market                | PL    | 1,523   | RSD    | VACANT        | fulton-brt (666 m)                 | —                          |
| `0743001`             | Van Ness Ave    | Western Addition               | G     | 1,394   | RC4    | VACANT        | fulton-brt (263 m)                 | geary-subway-1 335 m       |
| `3721084`             | Minna St        | Financial District/South Beach | G     | 1,383   | C3O    | VACANT        | geary-subway-1 (497 m)             | —                          |
| `7080009`             | 19th Ave        | Oceanview/Merced/Ingleside     | G     | 1,370   | NC1    | PDR           | 19th-ave-brt (84 m)                | geary-19th-subway-2 114 m  |
| `0761065`             | Golden Gate Ave | Western Addition               | PLG   | 1,332   | NA     | NONE          | fulton-brt (130 m)                 | geary-subway-1 520 m       |
| `0647014`             | California St   | Western Addition               | G     | 1,292   | NC3    | VACANT        | geary-subway-1 (465 m)             | —                          |
| `1228006`             | Stanyan St      | Haight Ashbury                 | PL    | 1,284   | HAIGHT | RETAIL/ENT    | fulton-brt (575 m)                 | —                          |
| `2413038`             | Taraval St      | West of Twin Peaks             | PL    | 1,281   | NC2    | VACANT        | 19th-ave-brt (592 m)               | geary-19th-subway-2 601 m  |
| `0768073`             | Redwood St      | Western Addition               | PL    | 1,270   | NC3    | VACANT        | fulton-brt (42 m)                  | geary-subway-1 609 m       |
| `0776010`             | McAllister St   | Western Addition               | PL    | 1,268   | RM1    | VACANT        | fulton-brt (64 m)                  | geary-subway-1 697 m       |
| `0668003`             | Bush St         | Nob Hill                       | GG    | 1,264   | P      | VACANT        | geary-subway-1 (384 m)             | —                          |
| `1017027`             | California St   | Presidio Heights               | PL    | 1,261   | RM2    | VACANT        | geary-subway-1 (704 m)             | —                          |
| `0718021`             | Van Ness Ave    | Tenderloin                     | G     | 1,215   | RC4    | VACANT        | fulton-brt (477 m)                 | geary-subway-1 130 m       |
| `0658003`             | Pierce St       | Pacific Heights                | PL    | 1,204   | RH3    | CIE           | geary-subway-1 (394 m)             | —                          |
| `0817011`             | Fell St         | Hayes Valley                   | G     | 1,199   | HAYES  | PDR           | fulton-brt (374 m)                 | —                          |
| `1216019`             | Oak St          | Hayes Valley                   | PL    | 1,197   | RH3    | VACANT        | fulton-brt (464 m)                 | —                          |
| `0266007`             | Battery St      | Financial District/South Beach | G     | 1,176   | C3O    | VACANT        | geary-subway-1 (548 m)             | —                          |
| `0680001`             | Bush St         | Pacific Heights                | G     | 1,175   | RH3    | MIXED         | geary-subway-1 (387 m)             | —                          |
| `3710014`             | Beale St        | Financial District/South Beach | G     | 1,174   | C3O    | VACANT        | geary-subway-1 (692 m)             | —                          |
| `0647012`             | California St   | Western Addition               | G     | 1,166   | NC3    | VACANT        | geary-subway-1 (472 m)             | —                          |
| `1182023`             | Fulton St       | Hayes Valley                   | G     | 1,118   | NC2    | VACANT        | fulton-brt (125 m)                 | —                          |
| `1101027`             | O'Farrell St    | Western Addition               | PL    | 1,106   | RM3    | VACANT        | fulton-brt (473 m)                 | geary-subway-1 590 m       |
| `0347017`             | Golden Gate Ave | Tenderloin                     | GG    | 1,100   | NA     | VACANT        | fulton-brt (51 m)                  | geary-subway-1 636 m       |
| `0643016`             | Sacramento St   | Nob Hill                       | PL    | 1,057   | POLK   | VACANT        | geary-subway-1 (579 m)             | —                          |
| `0101031`             | Filbert St      | Chinatown                      | G     | 1,022   | NBEACH | MIXED         | central-subway-north-beach (97 m)  | central-subway-wharf 764 m |

**Correction (2026-11-02).** 0195019 (Kearny St, 105 homes) and 0285020 (Sutter St, 400 homes)
dropped: the parcels hold existing homes, and the plan demolishes none (spec Anti-goals). Found by
the first live build. Both rows stay in the table above as data findings; neither is a parking
conversion, and the plan has 46.

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
  plan opens, and it serves 23 of the 46 parking sites.
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

### Parking conversions (46 projects, `park-<parcel>`) — in

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
| 2035 | geary-19th-subway-2; columbus-pedestrian; parking 0056007, 0035001, 0685050                                                 | central-subway-north-beach, van-ness-street; central-freeway-stub clearance (mid-year); first initiative homes (mid-year) | columbus-pedestrian (after central-subway-north-beach, 2035)       | 3/4     | 5/6    | 0/2    | 13/15   |
| 2036 | central-subway-wharf; fell-oak-street; Central Freeway build; parking 0081003, 0147029, 0713033, 3753122, 0743001           | k-ocean-priority, columbus-pedestrian                                                                                     |                                                                    | 3/4     | 6/6    | 0/2    | 12/15   |
| 2037 | parking 7080009, 0761065, 1228006, 2413038, 0768073                                                                         |                                                                                                                           |                                                                    | 3/4     | 6/6    | 0/2    | 13/15   |
| 2038 | parking 0776010, 0718021, 0817011, 1216019, 1182023                                                                         | fell-oak-street                                                                                                           |                                                                    | 3/4     | 5/6    | 0/2    | 14/15   |
| 2039 | parking 1101027, 0101031                                                                                                    |                                                                                                                           |                                                                    | 3/4     | 2/6    | 0/2    | 15/15   |
| 2040 |                                                                                                                             |                                                                                                                           |                                                                    | 3/4     | 0/6    | 0/2    | 12/15   |
| 2041 | geary-trench; parking 0286024, 3735060, 3722079, 3721084                                                                    | geary-subway-1                                                                                                            | geary-trench (after geary-subway-1, 2041)                          | 2/4     | 5/6    | 0/2    | 7/15    |
| 2042 | parking 0647012, 0647014, 0668003, 1017027, 0658003                                                                         |                                                                                                                           |                                                                    | 2/4     | 6/6    | 0/2    | 6/15    |
| 2043 | parking 0266007, 0680001, 3710014, 0643016                                                                                  |                                                                                                                           |                                                                    | 2/4     | 5/6    | 0/2    | 9/15    |
| 2044 |                                                                                                                             | geary-19th-subway-2, central-subway-wharf, geary-trench clearance                                                         |                                                                    | 0/4     | 0/6    | 0/2    | 13/15   |
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
- **Capacity.** No year exceeds a cap. `transit` is binding 2030–2033, `street` 2032–2034,
  2036–2037 and 2042, `housing` 2039.
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

## v1.1 (2026-11-03): freeway removal and freeway land

Status: approved by the owner on 2026-11-03 (the line at the end of this section), with the
owner's answers to the draft's open questions written in (Owner decisions, below). Amends the v1
plan above, which is otherwise unchanged; binding spec
`docs/superpowers/specs/2026-11-03-lesscars-v1-1-design.md` (including its "Rulings while
planning"). Calls marked **(drafter's call)** are the drafter's; **(owner)** marks the owner's
decisions. Nothing here is wired into `plan.json` yet: the segment catalog
`pipeline/enrichment/lesscars/freeway-land.json` is committed with its segments and empty parcel
lists, so no number changes until Plan B transcribes this section.

### What changes

The owner looked at the first live build and saw three problems. Land under a freeway counts as
buildable while the freeway stands (the four lots under the Central Freeway stub already get up to
about 480 homes in the no-plan baseline), so removing the stub adds nothing. The removed freeway
stays on the basemap after it comes down. And v1 frees far too little: the green strips that are
only frontage for a freeway should be "fair game at the usual large parcel rules" (owner). The
owner's decisions **(owner)**: US-101 is cut at the Alemany interchange with I-280 and everything
north of it comes down (the Bayshore Freeway, the James Lick Freeway with the Hairball, the
US-101/I-80 interchange and the Central Freeway, with the v1 stub as the first phase on its v1
dates); I-80 is cut at Rincon Hill and the elevated I-80 west of it to the US-101 interchange comes
down; I-280 stays; the recovered green land of the two messy interchanges hosts two large garages
(on review, one: Owner decisions); and freeway land is unbuildable in every run while its freeway
stands.

This section therefore lists every freeway segment in San Francisco with the street-segment ids
(CNNs) the phases name, curates the freeway land along each one, adds four removal phases and one
garage, retires `garage-south`, and picks the basemap features each phase hides. It does not model
traffic: where US-101 and I-80 traffic goes (onto I-280, the remaining ramps or city streets) is
not modelled, and no number depends on it. The large-lot lift to 65 ft applies only where it
already does: a freed site is lifted only when its chosen neighbour is in an R-4 (Local Program)
district (`pipeline/lib/local-program.ts:40-49`, ruled). Freeway land beside any other district
takes the v1 freed-land zoning (the larger of the adjacent zoning and SB 79 after the switch day)
without the lift.

### Owner decisions (2026-11-03)

The owner reviewed the draft and decided **(owner)**:

1. **`garage-rincon` moves to Rincon Hill.** Pointing at the green triangle between I-80 and
   Bryant St east of Rincon St: "Stick the rincon parking lot here - just drop the off/onramp
   there". The ramp that crosses that green is the westbound I-80 off-ramp to Harrison St
   (`19374000`). It comes down with `i80-rincon`, on that phase's dates, together with the 100 m of
   westbound mainline (`19383000`) that only feeds it (Freeway segments). The green it frees moves
   from the kept `i80-bay-bridge` list to `i80-soma`, and `garage-rincon` stands on its largest
   parcel, `3764064` (Garages). The draft's site `3761062` (the loop of the removed 4th and 5th St
   ramps) is ordinary freed land of `i80-rincon`.
2. **`garage-alemany` is removed.** Its parcel `5820035` stays ordinary freed land of
   `us101-bayshore`. The US-101 phases depend on no garage.
3. **The stub's skate park and dog park are freed land.** `3513071` and `3513074` are `in`; the
   stub frees 0.88 ha of parcels, not 0.33. The Yerba Buena Dog Park (`3761063`, under I-80) was
   not part of this decision and stays `out`.
4. **`street` capacity goes from 6 to 7** (PV-cap-street-7). Every phase starts as early as the
   caps allow: the US-101 phases in 2033, 2037, 2040 and 2043 and `i80-rincon` in 2038; the last
   build completes in mid-2048 (the draft said mid-2049 for 7, with the interchange left in 2038).
5. **Spot-check the kept lists on satellite imagery** before approval: the largest lots by FZP
   yield and the new Rincon Hill parcels (Evidence, "Satellite spot check"). It found three lots on
   `i280-north` that are not freeway land; they are removed from the list. Nothing else changed.
6. **Approved on 2026-11-03**, on condition of that spot check. The draft's open questions 2
   (interim uses stay `in`) and 3 (no regional transit project) stand as drafted.

### Freeway segments

Every CNN of the `FREEWAYS` layer of DataSF Streets (`datasf-streets` in the lock; classcode 1
mainline and 6 ramps) is in exactly one segment: 218 CNNs, none left over. Query (DuckDB over the
locked raw file, `active` rows only):

```
SELECT cnn, streetname, classcode, geom FROM ST_Read('<raw datasf-streets.page-000.geojson>')
WHERE active AND layer = 'FREEWAYS'
```

Cut points **(drafter's call, from the CNN end points)**:

- **US-101 at Alemany.** Northbound, US-101 ends where `19222002` leaves the node at
  (−122.40375, 37.73009): the kept `19222001` still offers the off-ramp `15249000` and the
  connector `19279000` to I-280. Southbound, US-101 begins at the node (−122.40672, 37.73497)
  where the kept on-ramp `19247000` joins; `19270000` north of it comes down. The connectors from
  the removed stretch to I-280 (`19278000`, `19280000`, `19353000`) and the off-ramp `19234000`
  hanging from them come down with it. The connectors between I-280 and US-101 south
  (`19279000`, `19354000`, `19314000`, `19252000`) stay.
- **James Lick and Bayshore at Cesar Chavez St.** The Hairball goes with James Lick, except the
  three links that tie the Bayshore stretch to Cesar Chavez St (northbound exit `19191000`,
  southbound entrances `19245000`, `19246000`, `19250000`): they come down with the Bayshore
  phase, so between the two removals (mid-2042 to 2043) the remaining stretch still ends at a
  street.
- **The interchange and the rest of the Central Freeway** start at the nodes (−122.40481,
  37.76506) northbound and (−122.40522, 37.76618) southbound and include the four US-101/I-80
  connectors (`19281000`, `19371000`, `19372000`, `19373000`) and the Mission St ramps
  (`19212000`, `19213000`), which v1 kept.
- **I-80 at Rincon Hill.** The Bay Bridge keeps its eastbound entrances `19359000`, `19360000`,
  `19361000` (from Harrison St near First and Essex Streets, and from Sterling St) and its
  westbound exit to Fremont St, `19375001`–`19375002` (one ramp in two CNNs), with the mainline
  between them (`19364000`, `19365000`, `19382000`). I-80 west of the nodes (−122.39344, 37.78446)
  eastbound and (−122.39194, 37.78530) westbound comes down: it serves only trips through SoMa to
  US-101, which v1.1 removes, while every Bay Bridge trip can still start or end east of 2nd St
  **(drafter's call)**. The westbound off-ramp to Harrison St, `19374000`, comes down too
  **(owner)**: it leaves the westbound deck at (−122.39289, 37.78475), loops south to Bryant St at
  Sterling St, runs north-east across the green between I-80 and Bryant St and passes under I-80 to
  Harrison St near First St. Without it, the westbound mainline `19383000` from the Fremont St exit
  to that node feeds nothing, so it comes down with it (drafter's call, from the CNN end points).
- I-280 is split at the Alemany interchange only to keep its two lists a reviewable size; both
  halves stay. The Presidio Parkway and the Park Presidio approach (`HWY 1`) are listed so that
  every freeway CNN has a segment; both stay.

| Segment id           | Freeway | Stretch                                                                                       | removedBy              | CNNs                                                                                                                                                                                                                                                                                                                                                               | Curated |
| -------------------- | ------- | --------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `us101-central-stub` | US-101  | Central Freeway stub, Mission St ramps to Market St                                           | `central-freeway-stub` | 2: 19204001 19264001                                                                                                                                                                                                                                                                                                                                               | hand    |
| `us101-interchange`  | US-101  | Central Freeway to the Mission St ramps and the US-101/I-80 interchange                       | `us101-interchange`    | 17: 19189000 19206000 19207000 19208000 19212000 19213000 19217000 19243000 19244000 19258000 19267001 19267002 19269000 19281000 19371000 19372000 19373000                                                                                                                                                                                                       | hand    |
| `us101-james-lick`   | US-101  | James Lick Freeway, the interchange to Cesar Chavez St, with the Hairball                     | `us101-james-lick`     | 17: 19190000 19195000 19197000 19199000 19203000 19214000 19215000 19218000 19226000 19229000 19232000 19233000 19236000 19237000 19238000 19262000 19265000                                                                                                                                                                                                       | hand    |
| `us101-bayshore`     | US-101  | Bayshore Freeway, Cesar Chavez St to the Alemany interchange                                  | `us101-bayshore`       | 14: 19191000 19200000 19220000 19221000 19222002 19234000 19245000 19246000 19250000 19268000 19270000 19278000 19280000 19353000                                                                                                                                                                                                                                  | hand    |
| `i80-soma`           | I-80    | I-80 over SoMa, the US-101 interchange to the Rincon Hill ramps, and the Harrison St off-ramp | `i80-rincon`           | 24: 19355000 19356000 19357000 19358000 19362000 19363000 19366000 19367000 19368000 19369000 19370000 19374000 19376000 19377000 19378000 19379000 19380000 19381000 19383000 19384000 19385000 19386000 19387000 19388000                                                                                                                                        | hand    |
| `us101-south`        | US-101  | Bayshore Freeway south of the Alemany interchange to the county line                          | null                   | 28: 15194000 15195000 15249000 19192000 19193000 19194000 19201000 19222001 19223000 19224000 19225000 19230000 19231000 19235000 19247000 19248000 19249000 19251000 19252000 19253000 19271001 19271002 19271003 19272000 19273000 19274000 19275000 19279000                                                                                                    | rule    |
| `i280-south`         | I-280   | I-280, the county line to the Alemany interchange                                             | null                   | 39: 19284000 19285000 19286000 19291000 19292000 19293000 19294000 19295000 19299000 19306000 19307000 19308000 19309000 19310000 19311000 19312000 19313000 19315000 19316000 19317000 19318000 19319000 19322000 19323000 19328000 19329000 19331000 19332000 19333000 19344000 19345000 19346000 19347000 19348000 19349000 19350000 19351000 19352000 19354000 | rule    |
| `i280-north`         | I-280   | I-280, the Alemany interchange to King St (Southern Embarcadero Freeway)                      | null                   | 29: 19287000 19288000 19296000 19297000 19298000 19300000 19301000 19302000 19303000 19304000 19305000 19314000 19320000 19321000 19324000 19325000 19326000 19327000 19330000 19334000 19335000 19336000 19337000 19338000 19339000 19340000 19341000 19342000 19343000                                                                                           | rule    |
| `i80-bay-bridge`     | I-80    | Bay Bridge approach from the Rincon Hill ramps, the bridge and Yerba Buena Island             | null                   | 22: 14210000 14214000 14237000 14239000 14240000 14241000 14242000 14243000 14244000 14245000 14246000 14247000 14248000 14249000 19359000 19360000 19361000 19364000 19365000 19375001 19375002 19382000                                                                                                                                                          | rule    |
| `us101-presidio`     | US-101  | Presidio Parkway and the Golden Gate Bridge approach                                          | null                   | 24: 15178000 15179000 15217000 15218000 15219000 15220000 15221000 15222000 15223000 15224000 15225000 15226000 19184000 19187000 19196000 19205000 19209000 19210000 19227000 19241000 19256000 19259000 19260000 19277000                                                                                                                                        | rule    |
| `ca1-presidio`       | CA-1    | Park Presidio approach in the Presidio                                                        | null                   | 2: 19185000 19186000                                                                                                                                                                                                                                                                                                                                               | rule    |

### Freeway land

**Candidates.** `npm run pipeline -- lesscars-freeway-land --dataset 2026-11-02-39fbf039` over
the catalog above proposes, per segment, every parcel with 0 homes whose land use is VACANT (or is
zoned P with no building) and whose area is at least half within 60 m of the segment's CNN lines;
a parcel near two segments goes to the nearer. It wrote
`pipeline/enrichment/lesscars/freeway-land.candidates.json` (lock sha256 `54b5dcbb…`, dataset
`2026-11-02-39fbf039`): 1,015 candidates, 266 of them on removed segments. The full-city run took
38 s. "FZP yield today" is the candidate's top-fill FZP yield in the dataset's `parcels.bin` when
it is hostable, else 0. "In band" is the share of its area within 60 m. The run predates the owner's
Rincon Hill decision, which moved two CNNs from `i80-bay-bridge` to `i80-soma`: the four parcels
that move with them keep the values the run gave them on `i80-bay-bridge`.

**How the candidates were decided (drafter's rules, applied by script).** The candidate rule is
loose: DataSF's 2023 land use calls many standing businesses beside the freeway VACANT. Every
candidate was decided by the rules below, applied by a script to per-record data: the 2025
assessor roll class, zoning, the 2023 land use, the distance to the freeway lines and whether a
street lies between, and the OpenStreetMap land use and named places in the dataset's
`basemap.pmtiles` (z15). Named places were looked up and given the named reasons in the tables.
After the draft, the 25 kept-list lots with the largest FZP yield and the Rincon Hill parcels were
checked on satellite imagery (Evidence, "Satellite spot check"); the rest were not. The inputs
are tier 0 records; the thresholds and their order are the drafter's (tier 4), so a decision is
only as good as the records behind it. Rules, in order:

1. **Never a park, school, rail yard or Port facility.** A candidate is `out` when its land use is
   OPENSPACE; its zoning includes an open-space district (`OS`, e.g. `YBI-OS`); an OSM park,
   garden, playground, pitch, dog park, school, college, hospital, railway, pier, cemetery,
   recreation ground, sports centre, stadium or military polygon covers at least 25% of it, or an
   OSM pedestrian area covers at least half (treated as public open space); or an OSM place of
   those kinds, or a station, pool, community centre, library or viewpoint, lies on it. Named
   places found while checking the largest candidates (the Port piers, the Muni Woods yard, the Caltrain yard and 22nd Street
   station) are `out` by name. The sweep covers every candidate of every segment, kept or removed.
   One parcel is kept `in` against it by name: `4091003`, a vacant public slope at the edge of the
   hospital's OSM outline with no hospital building on it. The owner put two more `in`: the SoMa
   West Skate Park and Dog Park under the stub (Owner decisions).
2. Land within 30 m of a **kept** freeway with at least half of it within 60 m of that freeway is
   `out` of the phase: it stays freeway land of the kept segment and is never freed (the table
   names the segment it moves to).
3. A standing building or business on the roll (classes C, CM, I, IG, IW, IX, O, S, G, FIRG and
   similar) or a residential roll class is `out`. One exception, flagged in its row: the CHP office
   lot `3758126` (open question 2: approved).
4. A street between the parcel and the freeway makes it city fabric, not frontage: `out`.
5. Public land (zoned P, or roll VPUB, VG, PLG) within 25 m of the freeway lines is `in`; the
   PLG and P-zoned PL lots under the deck are Caltrans land leased as parking.
6. A private vacant lot (roll V, VCI, VR, PL) within 15 m with no street between is `in`
   (against the deck); farther out, or any other roll class, it is `out`.

**Interim uses under the deck** (the Division Circle and Bryant Navigation Centers, the street
tree nursery, the Women's Resource Center, and the CHP office as the rule 3 exception) sit on
Caltrans land and are not homes, parks or schools, so their lots are `in`; the owner approved this
(open question 2). **Parks under the deck** are `out` under rule 1, except the SoMa West Skate
Park and Dog Park on two of the spec's four stub lots, which the owner counts as freed land (open
question 1).

**The committed lists.** `pipeline/enrichment/lesscars/freeway-land.draft.json` is the catalog in
its own format (it passes `parseFreewayLand`) with these decisions filled in: every segment's
`parcels` (removed: the `in` rows; kept: the candidates that pass the rules, plus the parcels moved
from removed segments) and its `excluded` rows with reasons (a moved parcel is excluded only in
the table, not in the file, because the format allows a parcel once). The build does not read it;
Plan B copies its lists into `freeway-land.json`. Kept segments are `rule` curated: the rules
replace a hand pass. The tables below show, per kept segment, the ten largest candidates and every
rule 1 exclusion; the other exclusions, with their reasons, are in the draft file. Applying rules 3
to 6 to kept segments, not only rule 1, follows from the removed segments, where 140 of the 266 raw
candidates turned out not to be freeway land, besides 11 that belong to a kept freeway.

**Required rows.** The four stub lots, the owner's example and the four parcels the spec asked
about are in the tables, decided as follows:

- **The stub** (`us101-central-stub`): all four are `in`: `3502112`, `3503002`, and `3513071`
  (SoMa West Skate Park) and `3513074` (SoMa West Dog Park), the parks by the owner's decision.
  With `3513024`, the stub frees 0.88 ha of parcels (five lots) besides its right-of-way.
- **The owner's example** (US-101, 18th to 22nd St, Potrero Ave to Vermont St): the 14 P/VACANT
  parcels whose centre lies in that box total 7.34 ha. Nine are `in` (`4026018`, `4076022`,
  `4077001`, `4090003`, `4091002`, `4091003`, `4093076`, `4139001`, `4140002`; 3.99 ha, all with no
  envelope today). Five are `out`: `4027001` (Benches Garden, a community garden), `4029022` and
  `4029009` (Downtown High School, across Vermont St), and `4090002` and `4140001` (Zuckerberg San
  Francisco General Hospital buildings). Four of the 14 (`4029009`, `4029022`, `4090002`,
  `4140001`) are not rule candidates (under half in the band) and were added to the table to be decided;
  10 of the 14 get no envelope today (the spec's recon counted 12; its list was not recorded).
- **`3179011` and `3179010`** (near Balboa Park, I-280): `out`. They are Balboa Park (land use
  OPENSPACE, 14% in the band) and City College's Ocean campus (CIE, 9% in the band); neither is a
  candidate.
- **`4012031`**: `out`, Fallen Bridge Park (land use OPENSPACE, a named open space).
- **`4154001`** (60,882 m², baseline yield 2,721): `out`. It is the main campus of Zuckerberg San
  Francisco General Hospital (OSM hospital on 99%, roll class N1G), only 7% within 60 m of US-101.
  The 2,721 is real model output, not a data error in this section: `parcels.bin` holds it as a
  hostable, eligible 6.09 ha lot with 0 homes, 21,799 m² of existing floor area (5 stories, 1915)
  and a 10-story envelope (P zoning in a height district that allows it), and the FZP model fills
  that envelope (112 / 1,622 / 2,276 / 2,501 / 2,721 homes at 25 / 50 / 75 / 90 / 100% fill). The
  baseline treats a working hospital as a redevelopable lot because it has no homes. That is
  outside v1.1 (it is not freeway land) and is reported, not fixed here.

#### us101-central-stub

| Parcel    | Area m² | In band | Land use | Zoning      | FZP yield today | Decision | Reason                                                                                                       |
| --------- | ------- | ------- | -------- | ----------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `3502112` | 2,660   | 1.00    | VACANT   | P           | 130             | in       | Vacant public land under the viaduct (roll VPUB, zoned P): the spec's stub parcels                           |
| `3503002` | 382     | 1.00    | VACANT   | P           | 14              | in       | Vacant public land under the viaduct (roll VPUB, zoned P): the spec's stub parcels                           |
| `3513024` | 223     | 1.00    | VACANT   | NCT-3       | 8               | in       | Vacant lot against the deck (roll VCI), no street between                                                    |
| `3513071` | 3,014   | 1.00    | VACANT   | P           | 213             | in       | SoMa West Skate Park (OSM pitch on 39% of the lot) under the viaduct: freed land by the owner's decision     |
| `3513074` | 2,495   | 1.00    | VACANT   | P           | 122             | in       | SoMa West Dog Park (OSM dog park on 22% of the lot) under the viaduct: freed land by the owner's decision    |
| `3502141` | 1,014   | 1.00    | VACANT   | NCT-3/RTO-1 | 49              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land   |
| `3503004` | 414     | 1.00    | VACANT   | NCT-3       | 13              | out      | McCoppin Hub, a public plaza (OSM park on 93% of the lot)                                                    |
| `3532040` | 353     | 1.00    | VACANT   | PDR-1-G     | 13              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land   |
| `3532002` | 352     | 1.00    | VACANT   | PDR-1-G     | 13              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land   |
| `3502134` | 296     | 1.00    | VACANT   | RTO-1       | 0               | out      | Residential parcel on the 2025 roll (class A5)                                                               |
| `3532069` | 279     | 1.00    | VACANT   | PDR-1-G     | 11              | out      | An industrial property on the 2025 roll (class IX): a standing building or business, not vacant freeway land |
| `3532041` | 237     | 1.00    | VACANT   | PDR-1-G     | 0               | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land   |
| `3532039` | 221     | 1.00    | VACANT   | PDR-1-G     | 8               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land  |
| `3502145` | 190     | 1.00    | VACANT   | RTO-1       | 7               | out      | Residential parcel on the 2025 roll (class Z)                                                                |
| `3513023` | 186     | 1.00    | VACANT   | NCT-3       | 7               | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land   |

**Totals, `us101-central-stub`:** 15 candidates; **5 in, 0.88 ha, FZP yield removed 487** (the sum of today's top-fill yield over the hostable `in` parcels); 10 out.

#### us101-interchange

| Parcel     | Area m² | In band | Land use | Zoning  | FZP yield today | Decision | Reason                                                                                                                                          |
| ---------- | ------- | ------- | -------- | ------- | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `3959001`  | 7,421   | 1.00    | VACANT   | P       | 237             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3917001`  | 7,324   | 1.00    | VACANT   | P       | 234             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3531005`  | 5,592   | 1.00    | VACANT   | P       | 178             | in       | Caltrans land under the deck (roll VPUB); the Division Circle Navigation Center on it is an interim lease that ends with the freeway            |
| `3528003`  | 4,966   | 1.00    | VACANT   | P       | 158             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                          |
| `3909003`  | 4,227   | 1.00    | VACANT   | P       | 135             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3908002`  | 4,027   | 1.00    | VACANT   | P       | 128             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3907004`  | 3,134   | 1.00    | VACANT   | P       | 100             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3531043`  | 3,087   | 1.00    | VACANT   | P       | 98              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                          |
| `3526001`  | 2,543   | 1.00    | VACANT   | P       | 81              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                          |
| `3906002`  | 2,058   | 1.00    | VACANT   | PDR-1-G | 121             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3909001`  | 1,513   | 1.00    | VACANT   | P       | 48              | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3918003`  | 1,343   | 1.00    | VACANT   | P       | 42              | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                  |
| `3905001`  | 1,237   | 1.00    | VACANT   | PDR-1-G | 73              | in       | Vacant lot against the deck (roll VCI), no street between                                                                                       |
| `3907001`  | 889     | 1.00    | VACANT   | P       | 28              | in       | Caltrans land under the deck, used as a parking lot (roll PL)                                                                                   |
| `3909002`  | 875     | 1.00    | VACANT   | P       | 27              | in       | Caltrans land under the deck, used as a parking lot (roll PL)                                                                                   |
| `3908001`  | 744     | 1.00    | VACANT   | P       | 23              | in       | Caltrans land under the deck, used as a parking lot (roll PL)                                                                                   |
| `3906001`  | 620     | 1.00    | VACANT   | PDR-1-G | 36              | in       | Vacant lot against the deck (roll VCI), no street between                                                                                       |
| `3527002`  | 507     | 1.00    | VACANT   | P       | 16              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                          |
| `3531045`  | 426     | 1.00    | VACANT   | P       | 13              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                          |
| `3515020`  | 246     | 1.00    | VACANT   | WMUG    | 9               | in       | Vacant lot against the deck (roll VCI), no street between                                                                                       |
| `3522074`  | 180     | 1.00    | VACANT   | WMUG    | 7               | in       | Vacant lot against the deck (roll VR), no street between                                                                                        |
| `3514028`  | 142     | 1.00    | VACANT   | NCT-3   | 5               | in       | Vacant public land under the deck (roll VPUB)                                                                                                   |
| `3908003`  | 93      | 1.00    | VACANT   | P       | 2               | in       | Caltrans land against the deck, used as a parking lot (roll PLG)                                                                                |
| `3529048`  | 70      | 1.00    | VACANT   | PDR-1-G | 2               | in       | Vacant lot against the deck (roll VCI), no street between                                                                                       |
| `3530045`  | 46      | 1.00    | VACANT   | PDR-1-G | 0               | in       | Vacant lot against the deck (roll VCI), no street between                                                                                       |
| `3528006`  | 8       | 1.00    | VACANT   | SALI    | 0               | in       | Vacant lot against the deck (roll VR), no street between                                                                                        |
| `3523005`  | 6       | 1.00    | VACANT   | SALI    | 0               | in       | Vacant public land against the deck (roll VPUB)                                                                                                 |
| `3901004`  | 4,688   | 0.63    | VACANT   | UMU     | 276             | out      | The retired garage-south site: a private parking lot (roll PL) south of Division St, 12.7 m from the deck; it returns to an ordinary lot (spec) |
| `3901003`  | 4,108   | 0.68    | VACANT   | UMU     | 242             | out      | A private parking lot (roll PL) beside the retired garage-south site, facing the deck across Division St                                        |
| `3782001A` | 3,813   | 0.64    | VACANT   | PDR-1-G | 122             | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                      |
| `3515019`  | 3,247   | 0.59    | VACANT   | WMUG    | 229             | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3903004`  | 3,222   | 0.94    | VACANT   | PDR-1-G | 190             | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3905012`  | 2,677   | 0.81    | VACANT   | PDR-1-G | 157             | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3530042`  | 1,415   | 0.54    | VACANT   | PDR-1-G | 69              | out      | A warehouse property on the 2025 roll (class IW): a standing building or business, not vacant freeway land                                      |
| `3523013`  | 1,294   | 1.00    | VACANT   | SALI    | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3530039`  | 1,241   | 1.00    | VACANT   | PDR-1-G | 61              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3904001`  | 1,126   | 1.00    | VACANT   | PDR-1-G | 65              | out      | 15.8 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                           |
| `3515021`  | 1,119   | 1.00    | VACANT   | WMUG    | 75              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3523008`  | 1,100   | 1.00    | VACANT   | SALI    | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3905002A` | 883     | 1.00    | VACANT   | PDR-1-G | 52              | out      | An industrial property on the 2025 roll (class IG): a standing building or business, not vacant freeway land                                    |
| `3530032`  | 868     | 0.68    | VACANT   | PDR-1-G | 42              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3906005`  | 770     | 1.00    | VACANT   | PDR-1-G | 45              | out      | An office property on the 2025 roll (class O): a standing building or business, not vacant freeway land                                         |
| `3530001`  | 730     | 1.00    | VACANT   | PDR-1-G | 35              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3526018`  | 604     | 1.00    | VACANT   | PDR-1-G | 19              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3528011`  | 570     | 1.00    | VACANT   | SALI    | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3935002`  | 553     | 0.80    | VACANT   | PDR-1-D | 32              | out      | San Francisco Fire Station 29 (roll class FIRG), across Vermont St                                                                              |
| `3531019`  | 535     | 0.74    | VACANT   | PDR-1-G | 26              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3530050`  | 509     | 0.75    | VACANT   | PDR-1-G | 25              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3512006`  | 464     | 0.95    | VACANT   | C-3-G   | 32              | out      | Across Mission St from the freeway: city fabric, not frontage                                                                                   |
| `3910005`  | 455     | 0.88    | VACANT   | PDR-1-D | 14              | out      | Across Vermont St from the freeway: city fabric, not frontage                                                                                   |
| `3526021`  | 382     | 1.00    | VACANT   | PDR-1-G | 12              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3522042`  | 329     | 1.00    | VACANT   | RED     | 10              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3531016`  | 257     | 1.00    | VACANT   | PDR-1-G | 10              | out      | A commercial property on the 2025 roll (class CM): a standing building or business, not vacant freeway land                                     |
| `3525056`  | 237     | 1.00    | VACANT   | SALI    | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3530047`  | 222     | 1.00    | VACANT   | PDR-1-G | 8               | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                      |
| `3526020`  | 191     | 1.00    | VACANT   | PDR-1-G | 6               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3531013`  | 183     | 1.00    | VACANT   | PDR-1-G | 7               | out      | 33.4 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                           |
| `3522053`  | 182     | 1.00    | VACANT   | RED     | 5               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3522016`  | 175     | 1.00    | VACANT   | WMUG    | 7               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3531014`  | 172     | 1.00    | VACANT   | PDR-1-G | 6               | out      | 41 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                             |
| `3522060`  | 171     | 1.00    | VACANT   | WMUG    | 6               | out      | 30.3 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                           |
| `3522061`  | 161     | 1.00    | VACANT   | WMUG    | 6               | out      | 37.3 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                           |
| `3522027`  | 143     | 1.00    | VACANT   | RED     | 4               | out      | 22.9 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                           |
| `3512010`  | 143     | 1.00    | VACANT   | C-3-G   | 5               | out      | Across Mission St from the freeway: city fabric, not frontage                                                                                   |
| `3522026`  | 142     | 1.00    | VACANT   | RED     | 4               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                     |
| `3910006`  | 5       | 1.00    | VACANT   | PDR-1-D | 0               | out      | Across Vermont St from the freeway: city fabric, not frontage                                                                                   |

**Totals, `us101-interchange`:** 66 candidates; **27 in, 5.33 ha, FZP yield removed 1,801** (the sum of today's top-fill yield over the hostable `in` parcels); 39 out.

#### us101-james-lick

| Parcel     | Area m² | In band                | Land use  | Zoning | FZP yield today | Decision | Reason                                                                                                                           |
| ---------- | ------- | ---------------------- | --------- | ------ | --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `4091002`  | 11,639  | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4077001`  | 10,150  | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4279030`  | 9,873   | 1.00                   | VACANT    | P      | 315             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4202001`  | 7,470   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4215001`  | 7,451   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4261001`  | 7,415   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4157001`  | 7,408   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `3976029`  | 6,941   | 1.00                   | VACANT    | P      | 222             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4139001`  | 5,739   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `5509005`  | 5,457   | 1.00                   | VACANT    | P      | 174             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4280027`  | 5,175   | 1.00                   | VACANT    | P      | 165             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4026018`  | 4,772   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4339004`  | 3,059   | 1.00                   | VACANT    | PDR-2  | 179             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                   |
| `4011019`  | 2,877   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `5510010`  | 2,846   | 1.00                   | VACANT    | P      | 90              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4076022`  | 2,336   | 0.99                   | VACANT    | P      | 0               | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                         |
| `4091003`  | 2,024   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public slope against the deck (roll VPUB, zoned P), at the edge of the hospital's OSM outline; no hospital building on it |
| `4329010`  | 1,949   | 1.00                   | VACANT    | P      | 62              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4093076`  | 1,499   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4090003`  | 1,273   | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4277006`  | 1,061   | 1.00                   | VACANT    | MUR    | 0               | in       | Vacant public land under the deck (roll VPUB)                                                                                    |
| `5508001`  | 887     | 1.00                   | VACANT    | P      | 28              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4279029`  | 686     | 1.00                   | VACANT    | MUR    | 21              | in       | Vacant lot against the deck (roll PL), no street between                                                                         |
| `4329012`  | 627     | 0.80                   | VACANT    | P      | 37              | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                         |
| `4279033`  | 501     | 1.00                   | VACANT    | P      | 16              | in       | Vacant public land against the deck (roll V, zoned P)                                                                            |
| `4140002`  | 435     | 1.00                   | VACANT    | P      | 0               | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                         |
| `4339009`  | 351     | 1.00                   | VACANT    | PDR-2  | 14              | in       | Vacant public land against the deck (roll VPUB)                                                                                  |
| `4277006A` | 164     | 1.00                   | VACANT    | MUR    | 5               | in       | Vacant lot against the deck (roll VCI), no street between                                                                        |
| `3975001N` | 152     | 1.00                   | VACANT    | P      | 4               | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                         |
| `4329011`  | 77      | 1.00                   | VACANT    | P      | 2               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                           |
| `4339002C` | 11      | 1.00                   | VACANT    | PDR-2  | 0               | in       | Vacant public land against the deck (roll VPUB)                                                                                  |
| `4154001`  | 60,882  | 0.07 (not a candidate) | MIXED     | P      | 2,721           | out      | Zuckerberg San Francisco General Hospital main campus (OSM hospital on 99%; roll class N1G; 7% in the band)                      |
| `4090002`  | 16,929  | 0.22 (not a candidate) | VACANT    | P      | 1,493           | out      | Zuckerberg San Francisco General Hospital campus (OSM hospital on 100%; roll class N1G)                                          |
| `4140001`  | 6,998   | 0.41 (not a candidate) | VACANT    | P      | 618             | out      | Zuckerberg San Francisco General Hospital campus (OSM hospital on 100%; roll class OMD, medical office)                          |
| `4029022`  | 5,486   | 0.00 (not a candidate) | VACANT    | P      | 175             | out      | Downtown High School (SFUSD; OSM school on 97%; roll class EG)                                                                   |
| `4012031`  | 5,229   | 1.00                   | OPENSPACE | P      | 0               | out      | Fallen Bridge Park, a named open space (land use OPENSPACE; OSM park)                                                            |
| `4027001`  | 3,868   | 1.00                   | VACANT    | P      | 0               | out      | Benches Garden, a community garden (OSM park and garden library on the lot)                                                      |
| `4339008`  | 1,464   | 1.00                   | VACANT    | PDR-2  | 86              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                      |
| `4277016`  | 1,000   | 1.00                   | VACANT    | MUR    | 31              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                      |
| `4279001`  | 687     | 1.00                   | VACANT    | P      | 21              | out      | A fire department property on the 2025 roll (class FIRG): a standing building or business, not vacant freeway land               |
| `4339002A` | 683     | 0.55                   | VACANT    | PDR-2  | 40              | out      | Across Bay Shore Blvd from the freeway: city fabric, not frontage                                                                |
| `4339006`  | 578     | 0.58                   | VACANT    | PDR-2  | 33              | out      | Across Bay Shore Blvd from the freeway: city fabric, not frontage                                                                |
| `4154002`  | 413     | 1.00                   | VACANT    | P      | 0               | out      | OSM hospital on 39% of the lot                                                                                                   |
| `4029009`  | 232     | 0.00 (not a candidate) | VACANT    | P      | 7               | out      | Downtown High School grounds (OSM school on 94%)                                                                                 |
| `4093114`  | 4       | 1.00                   | VACANT    | RH-2   | 0               | out      | Across Vermont St from the freeway: city fabric, not frontage                                                                    |
| `4280006D` | 1       | 1.00                   | VACANT    | RH-2   | 0               | out      | 24.7 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                            |

**Totals, `us101-james-lick`:** 41 candidates and 5 hand-added rows; **31 in, 11.23 ha, FZP yield removed 1,334** (the sum of today's top-fill yield over the hostable `in` parcels); 15 out.

#### us101-bayshore

| Parcel     | Area m² | In band | Land use | Zoning  | FZP yield today | Decision | Reason                                                                                                                                                                           |
| ---------- | ------- | ------- | -------- | ------- | --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `5533049`  | 28,796  | 1.00    | VACANT   | P/PDR-2 | 318             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5692045`  | 6,894   | 1.00    | VACANT   | P       | 220             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5596044`  | 4,258   | 1.00    | VACANT   | P/PDR-2 | 136             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5596017C` | 3,464   | 1.00    | VACANT   | P       | 110             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5596017A` | 3,400   | 1.00    | VACANT   | P       | 108             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5576017`  | 3,325   | 1.00    | VACANT   | P       | 106             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5691045`  | 3,259   | 1.00    | VACANT   | P       | 104             | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                                                                         |
| `5657050`  | 3,239   | 1.00    | VACANT   | P       | 103             | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                                                                         |
| `5636025`  | 3,213   | 1.00    | VACANT   | P       | 102             | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                                                                         |
| `5596011B` | 2,926   | 1.00    | VACANT   | P       | 93              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5820035`  | 2,868   | 1.00    | VACANT   | P       | 91              | in       | Vacant public land between the removed US-101 to I-280 connectors (roll VPUB, zoned P); the draft's garage-alemany site, ordinary freed land since the owner dropped that garage |
| `5511011`  | 2,633   | 1.00    | VACANT   | P       | 84              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5596013A` | 2,574   | 1.00    | VACANT   | P       | 82              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5512025`  | 2,535   | 1.00    | VACANT   | P       | 81              | in       | Vacant public land under the deck (roll VG, zoned P)                                                                                                                             |
| `5596051`  | 2,120   | 1.00    | VACANT   | P/PDR-2 | 67              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5596046`  | 1,875   | 1.00    | VACANT   | P       | 60              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5596010A` | 1,654   | 1.00    | VACANT   | P       | 52              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5596006`  | 1,247   | 1.00    | VACANT   | P/PDR-2 | 39              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5512024`  | 1,177   | 1.00    | VACANT   | P       | 37              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5819010`  | 1,059   | 1.00    | VACANT   | P       | 33              | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                                                                         |
| `5596012A` | 965     | 1.00    | VACANT   | P       | 30              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5693037`  | 720     | 1.00    | VACANT   | PDR-2   | 23              | in       | Vacant public land against the deck (roll VPUB)                                                                                                                                  |
| `5607047`  | 715     | 1.00    | VACANT   | P       | 41              | in       | Caltrans land under the deck, used as a parking lot (roll PL)                                                                                                                    |
| `5693041`  | 647     | 1.00    | VACANT   | PDR-2   | 20              | in       | Vacant public land against the deck (roll VPUB)                                                                                                                                  |
| `5512027`  | 469     | 1.00    | VACANT   | P       | 15              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5819009`  | 463     | 1.00    | VACANT   | P       | 14              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5512026`  | 424     | 1.00    | VACANT   | P       | 13              | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5693038`  | 121     | 1.00    | VACANT   | P/PDR-2 | 3               | in       | Caltrans land against the deck, used as a parking lot (roll PLG)                                                                                                                 |
| `5596017E` | 91      | 1.00    | VACANT   | P       | 2               | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                                                                         |
| `5693040`  | 53      | 1.00    | VACANT   | P       | 1               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5820034`  | 48      | 1.00    | VACANT   | P       | 0               | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                                                                         |
| `5607043`  | 34      | 1.00    | VACANT   | P       | 0               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                           |
| `5437002`  | 13,064  | 1.00    | VACANT   | P       | 418             | out      | Beside the kept US-101 (us101-south, CNN 19271002, 0 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south                                          |
| `5822031`  | 5,363   | 1.00    | VACANT   | P       | 171             | out      | Beside the kept I-280 (i280-north, CNN 19343000, 0.1 m; 93% within 60 m of it): kept freeway land is never freed; moves to i280-north                                            |
| `5438001`  | 5,104   | 0.67    | VACANT   | P       | 163             | out      | Beside the kept US-101 (us101-south, CNN 19271002, 0 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south                                          |
| `5372A001` | 4,085   | 1.00    | VACANT   | P       | 130             | out      | Beside the kept US-101 (us101-south, CNN 19247000, 24.4 m; 54% within 60 m of it): kept freeway land is never freed; moves to us101-south                                        |
| `5607046`  | 4,045   | 1.00    | VACANT   | P       | 129             | out      | Beside the kept US-101 (us101-south, CNN 19247000, 0 m; 98% within 60 m of it): kept freeway land is never freed; moves to us101-south                                           |
| `5734002`  | 2,649   | 0.65    | VACANT   | P       | 84              | out      | Across Alemany Blvd and Putnam St from the freeway: city fabric, not frontage                                                                                                    |
| `5559002`  | 2,503   | 0.56    | VACANT   | PDR-2   | 147             | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                      |
| `5733A002` | 2,005   | 0.90    | VACANT   | NC-S/P  | 64              | out      | 28.1 m from the freeway, beyond the 25 m the rules accept for this land: not frontage                                                                                            |
| `5373001`  | 1,336   | 1.00    | VACANT   | P       | 42              | out      | Beside the kept US-101 (us101-south, CNN 19247000, 0 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south                                          |
| `5373003`  | 1,320   | 1.00    | VACANT   | P       | 42              | out      | Beside the kept US-101 (us101-south, CNN 19247000, 0 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south                                          |
| `5375028`  | 1,276   | 1.00    | VACANT   | P       | 40              | out      | Beside the kept US-101 (us101-south, CNN 19271001, 0 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south                                          |
| `5512028`  | 1,171   | 1.00    | VACANT   | NC-1    | 15              | out      | A service station property on the 2025 roll (class S): a standing building or business, not vacant freeway land                                                                  |
| `5695021`  | 924     | 1.00    | VACANT   | P       | 29              | out      | Beside the kept US-101 (us101-south, CNN 19247000, 27.3 m; 86% within 60 m of it): kept freeway land is never freed; moves to us101-south                                        |
| `5596039`  | 662     | 0.73    | VACANT   | PDR-2   | 21              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                       |
| `5596001`  | 645     | 1.00    | VACANT   | PDR-2   | 20              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                       |
| `5596012`  | 622     | 0.90    | VACANT   | PDR-2   | 19              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                       |
| `5693003A` | 608     | 1.00    | VACANT   | PDR-2   | 19              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                       |
| `5596015`  | 460     | 1.00    | VACANT   | PDR-2   | 14              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                      |
| `5596042`  | 456     | 1.00    | VACANT   | PDR-2   | 14              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                      |
| `5596050`  | 366     | 1.00    | VACANT   | PDR-2   | 11              | out      | 26.4 m from the freeway, beyond the 25 m the rules accept for this land: not frontage                                                                                            |
| `5573005`  | 335     | 1.00    | VACANT   | PDR-2   | 10              | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                       |
| `5694001`  | 281     | 1.00    | VACANT   | P       | 8               | out      | Beside the kept US-101 (us101-south, CNN 19247000, 20.7 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south                                       |
| `5657048`  | 257     | 0.78    | VACANT   | RH-1    | 4               | out      | 32.9 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                            |
| `5557002`  | 163     | 0.94    | VACANT   | RH-1    | 4               | out      | A miscellaneous property on the 2025 roll (class X): a standing building or business, not vacant freeway land                                                                    |
| `5691024`  | 163     | 0.87    | VACANT   | RH-1    | 4               | out      | 41.3 m from the freeway, beyond the 25 m the rules accept for this land: not frontage                                                                                            |
| `5691037`  | 163     | 0.98    | VACANT   | RH-1    | 4               | out      | 39 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                              |
| `5691047`  | 163     | 0.89    | VACANT   | RH-1    | 4               | out      | 40.7 m from the freeway, beyond the 25 m the rules accept for this land: not frontage                                                                                            |
| `5691023`  | 161     | 0.83    | VACANT   | RH-1    | 4               | out      | 41.9 m from the freeway, beyond the 25 m the rules accept for this land: not frontage                                                                                            |
| `5596052`  | 153     | 1.00    | VACANT   | PDR-2   | 4               | out      | 37.9 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                            |
| `5577002`  | 152     | 1.00    | VACANT   | RH-1    | 4               | out      | Across Holladay Ave from the freeway: city fabric, not frontage                                                                                                                  |
| `5577004`  | 131     | 1.00    | VACANT   | RH-1    | 4               | out      | Residential parcel on the 2025 roll (class DA)                                                                                                                                   |
| `5693042`  | 121     | 1.00    | VACANT   | PDR-2   | 3               | out      | 18.8 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                            |
| `5577001`  | 107     | 1.00    | VACANT   | RH-1    | 3               | out      | Across Holladay Ave from the freeway: city fabric, not frontage                                                                                                                  |
| `5735005`  | 103     | 1.00    | VACANT   | NC-S    | 1               | out      | Across Alemany Blvd and Putnam St from the freeway: city fabric, not frontage                                                                                                    |
| `5695020`  | 86      | 0.53    | VACANT   | RH-1    | 2               | out      | 52 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                              |
| `5512007A` | 70      | 1.00    | VACANT   | RH-2    | 2               | out      | 33.1 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                            |
| `5533047`  | 52      | 1.00    | VACANT   | PDR-2   | 1               | out      | 29.3 m from the freeway, beyond the 25 m the rules accept for this land: not frontage                                                                                            |
| `5372011`  | 45      | 1.00    | VACANT   | P       | 1               | out      | Across Alemany Blvd from the freeway: city fabric, not frontage                                                                                                                  |

**Totals, `us101-bayshore`:** 70 candidates; **32 in, 8.73 ha, FZP yield removed 2,188** (the sum of today's top-fill yield over the hostable `in` parcels); 38 out, of which 10 move to a kept segment.

#### i80-soma

| Parcel     | Area m² | In band | Land use | Zoning        | FZP yield today | Decision | Reason                                                                                                                                                                                                                                                                |
| ---------- | ------- | ------- | -------- | ------------- | --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3761062`  | 23,987  | 1.00    | VACANT   | P             | 40              | in       | Caltrans land in the loop of the removed 4th and 5th St ramps (roll VPUB); its interim uses (Bryant Navigation Center, SF street tree nursery, storage) end with the freeway. The draft's garage-rincon site; ordinary freed land since the garage moved to `3764064` |
| `3758126`  | 16,996  | 1.00    | VACANT   | P             | 4               | in       | Exception to rule 3: Caltrans land under the deck (roll VPUB) whose California Highway Patrol office is a standing state building; drafted in on the assumption that the office moves with the freeway (open question 2: approved)                                    |
| `3762004`  | 12,132  | 1.00    | VACANT   | P             | 388             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3759040`  | 12,126  | 1.00    | VACANT   | P             | 4               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3763126`  | 11,548  | 1.00    | VACANT   | P             | 369             | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3765715`  | 10,625  | 1.00    | VACANT   | RH DTR/SB-DTR | 627             | in       | Moved from `i80-bay-bridge` (owner): public land (roll VPUB) that the removed Harrison St off-ramp crosses on its way under I-80, mostly green; 27% of it lies within 12 m of the kept Bay Bridge mainline, which still stands                                        |
| `3764064`  | 10,252  | 1.00    | VACANT   | SB-DTR        | 605             | in       | Moved from `i80-bay-bridge` (owner): public land (roll VPUB), the green between the I-80 decks and the removed off-ramp east of Rincon St. The garage-rincon site: held by the garage, so it gets no homes                                                            |
| `3758129`  | 8,315   | 1.00    | VACANT   | P             | 4               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3781007`  | 5,974   | 1.00    | VACANT   | P             | 191             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                                                                                                                                        |
| `3782002`  | 4,733   | 0.93    | VACANT   | P             | 151             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                                                                                                                                        |
| `3760116`  | 4,219   | 1.00    | VACANT   | P             | 4               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3760124`  | 4,033   | 1.00    | VACANT   | P             | 4               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3782004`  | 3,691   | 1.00    | VACANT   | P             | 118             | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                                                                                                                                        |
| `3760117`  | 3,646   | 1.00    | VACANT   | P             | 4               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3760120`  | 2,785   | 1.00    | VACANT   | P             | 4               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3759038`  | 2,444   | 1.00    | VACANT   | P             | 4               | in       | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                                                                                                                                |
| `3764056`  | 2,322   | 1.00    | VACANT   | SB-DTR        | 136             | in       | Moved from `i80-bay-bridge` (owner): vacant green between the I-80 deck and the removed off-ramp; 40% of it lies within 12 m of the kept mainline or 8 m of a kept ramp                                                                                               |
| `3780014`  | 1,867   | 1.00    | VACANT   | P             | 59              | in       | Caltrans land under the deck, used as a parking lot (roll PLG)                                                                                                                                                                                                        |
| `3758127`  | 1,351   | 1.00    | VACANT   | P             | 4               | in       | Vacant public land against the deck (roll VPUB, zoned P)                                                                                                                                                                                                              |
| `3758128`  | 961     | 1.00    | VACANT   | P             | 4               | in       | Caltrans land under the deck (roll VPUB); the Women's Resource Center on it is an interim use                                                                                                                                                                         |
| `3761064`  | 818     | 1.00    | VACANT   | SALI          | 0               | in       | Vacant lot against the deck (roll VR), no street between                                                                                                                                                                                                              |
| `3760002`  | 296     | 1.00    | VACANT   | SALI          | 0               | in       | Vacant lot against the deck (roll PL), no street between                                                                                                                                                                                                              |
| `3760114`  | 256     | 1.00    | VACANT   | SALI          | 0               | in       | Vacant lot against the deck (roll VR), no street between                                                                                                                                                                                                              |
| `3758121`  | 219     | 1.00    | VACANT   | SALI          | 0               | in       | Vacant lot against the deck (roll VR), no street between                                                                                                                                                                                                              |
| `3765714`  | 167     | 1.00    | VACANT   | SB-DTR        | 6               | in       | Moved from `i80-bay-bridge` (owner): a vacant strip beside the removed off-ramp where it reaches Harrison St                                                                                                                                                          |
| `3760123`  | 89      | 1.00    | VACANT   | SALI          | 0               | in       | Vacant lot against the deck (roll VR), no street between                                                                                                                                                                                                              |
| `3761063`  | 8,459   | 1.00    | VACANT   | P             | 4               | out      | Yerba Buena Dog Park (OSM dog park), a named open space under the deck                                                                                                                                                                                                |
| `3764067`  | 4,382   | 0.91    | VACANT   | P             | 215             | out      | Beside the kept I-80 (i80-bay-bridge, CNN 19361000, 7.8 m; 67% within 60 m of it): kept freeway land is never freed; moves to i80-bay-bridge                                                                                                                          |
| `3781011`  | 3,970   | 0.91    | VACANT   | UMU           | 127             | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                                                                                                            |
| `3757002`  | 3,898   | 0.56    | VACANT   | SALI          | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3761002`  | 3,001   | 1.00    | VACANT   | SALI          | 0               | out      | An office property on the 2025 roll (class O): a standing building or business, not vacant freeway land                                                                                                                                                               |
| `3762149`  | 1,399   | 0.65    | VACANT   | CMUO          | 128             | out      | Across Perry St from the freeway: city fabric, not frontage                                                                                                                                                                                                           |
| `3763015C` | 1,092   | 0.72    | VACANT   | CMUO          | 76              | out      | An office property on the 2025 roll (class OCH): a standing building or business, not vacant freeway land                                                                                                                                                             |
| `3752590`  | 1,056   | 0.83    | VACANT   | MUR           | 72              | out      | Across Harrison St and 5Th St from the freeway: city fabric, not frontage                                                                                                                                                                                             |
| `3776117`  | 930     | 0.82    | VACANT   | CMUO          | 88              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3760055`  | 760     | 1.00    | VACANT   | SALI          | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3763125`  | 691     | 1.00    | VACANT   | CMUO          | 61              | out      | A commercial property on the 2025 roll (class CM): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3777055`  | 577     | 0.64    | VACANT   | CMUO          | 33              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3762037`  | 575     | 1.00    | VACANT   | CMUO          | 39              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3759002`  | 567     | 1.00    | VACANT   | SALI          | 0               | out      | 16.1 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |
| `3762122`  | 543     | 1.00    | VACANT   | CMUO          | 36              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3759045`  | 536     | 1.00    | VACANT   | SALI          | 0               | out      | A government industrial property on the 2025 roll (class IXG): a standing building or business, not vacant freeway land                                                                                                                                               |
| `3760014`  | 510     | 1.00    | VACANT   | SALI          | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3763113`  | 497     | 1.00    | VACANT   | CMUO          | 33              | out      | 35.5 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |
| `3760059`  | 494     | 1.00    | VACANT   | SALI          | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3762026`  | 446     | 0.97    | VACANT   | CMUO          | 30              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3755021`  | 409     | 0.81    | VACANT   | WMUG          | 20              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3757007`  | 384     | 0.94    | VACANT   | SALI          | 0               | out      | Across 8Th St and Bryant St from the freeway: city fabric, not frontage                                                                                                                                                                                               |
| `3755014`  | 371     | 0.97    | VACANT   | WMUG          | 14              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3760121`  | 367     | 1.00    | VACANT   | SALI          | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3762014`  | 357     | 0.84    | VACANT   | CMUO          | 14              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3762012`  | 335     | 0.83    | VACANT   | CMUO          | 12              | out      | An office property on the 2025 roll (class O): a standing building or business, not vacant freeway land                                                                                                                                                               |
| `3763078`  | 325     | 1.00    | VACANT   | CMUO          | 12              | out      | Across Perry St from the freeway: city fabric, not frontage                                                                                                                                                                                                           |
| `3760112`  | 315     | 1.00    | VACANT   | SALI          | 0               | out      | 15.6 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |
| `3755034`  | 297     | 0.92    | VACANT   | WMUG          | 11              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3755033`  | 297     | 0.57    | VACANT   | WMUG          | 11              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3780034`  | 293     | 1.00    | VACANT   | UMU           | 9               | out      | A garage property on the 2025 roll (class G): a standing building or business, not vacant freeway land                                                                                                                                                                |
| `3760129`  | 279     | 1.00    | VACANT   | SALI          | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3760111`  | 277     | 1.00    | VACANT   | SALI          | 0               | out      | 16.5 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |
| `3762049`  | 271     | 1.00    | VACANT   | CMUO          | 10              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3760122`  | 270     | 1.00    | VACANT   | SALI          | 0               | out      | 15.8 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |
| `3762055`  | 270     | 1.00    | VACANT   | CMUO          | 10              | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3755137`  | 242     | 1.00    | VACANT   | WMUG          | 9               | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                                                                                                            |
| `3762016`  | 238     | 0.85    | VACANT   | CMUO          | 9               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3760125`  | 226     | 1.00    | VACANT   | SALI          | 0               | out      | 16.3 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |
| `3776118`  | 224     | 1.00    | VACANT   | CMUO          | 8               | out      | A commercial property on the 2025 roll (class C): a standing building or business, not vacant freeway land                                                                                                                                                            |
| `3763018`  | 220     | 0.76    | VACANT   | CMUO          | 8               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3759001`  | 209     | 1.00    | VACANT   | SALI          | 0               | out      | 24.1 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |
| `3762058`  | 196     | 1.00    | VACANT   | CMUO          | 7               | out      | Across Stillman St from the freeway: city fabric, not frontage                                                                                                                                                                                                        |
| `3755016`  | 196     | 1.00    | VACANT   | WMUG          | 7               | out      | A commercial property on the 2025 roll (class CM): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3760020`  | 188     | 0.60    | VACANT   | SALI          | 0               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3763079`  | 174     | 1.00    | VACANT   | CMUO          | 6               | out      | Across Perry St from the freeway: city fabric, not frontage                                                                                                                                                                                                           |
| `3763081`  | 152     | 1.00    | VACANT   | CMUO          | 6               | out      | Across Perry St from the freeway: city fabric, not frontage                                                                                                                                                                                                           |
| `3759041`  | 143     | 1.00    | VACANT   | P             | 5               | out      | Across 7Th St from the freeway: city fabric, not frontage                                                                                                                                                                                                             |
| `3763080`  | 142     | 1.00    | VACANT   | CMUO          | 5               | out      | Across Perry St from the freeway: city fabric, not frontage                                                                                                                                                                                                           |
| `3763080A` | 142     | 1.00    | VACANT   | CMUO          | 5               | out      | Across Perry St from the freeway: city fabric, not frontage                                                                                                                                                                                                           |
| `3780023`  | 139     | 1.00    | VACANT   | UMU           | 4               | out      | An industrial property on the 2025 roll (class I): a standing building or business, not vacant freeway land                                                                                                                                                           |
| `3760126`  | 38      | 1.00    | VACANT   | SALI          | 0               | out      | 16.2 m from the freeway, beyond the 15 m the rules accept for this land: not frontage                                                                                                                                                                                 |

**Totals, `i80-soma`:** 74 candidates and 4 parcels moved from `i80-bay-bridge` with the Harrison St off-ramp; **26 in, 14.59 ha, FZP yield removed 2,730** (the sum of today's top-fill yield over the hostable `in` parcels); 52 out, of which 1 moves to a kept segment.

#### us101-south

| Parcel     | Area m² | In band | Land use | Zoning | FZP yield today | Decision | Reason                                                 |
| ---------- | ------- | ------- | -------- | ------ | --------------- | -------- | ------------------------------------------------------ |
| `4991066`  | 68,006  | 0.94    | VACANT   | C-2/P  | 0               | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5477006`  | 6,853   | 1.00    | VACANT   | P      | 219             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5065A006` | 6,256   | 1.00    | VACANT   | P      | 0               | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5479001`  | 6,042   | 1.00    | VACANT   | P      | 193             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5458027`  | 5,913   | 1.00    | VACANT   | P      | 189             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5037025`  | 5,832   | 1.00    | VACANT   | P      | 186             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5466029`  | 5,135   | 1.00    | VACANT   | P      | 164             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5481010`  | 4,616   | 1.00    | VACANT   | P      | 147             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5450001`  | 4,254   | 1.00    | VACANT   | P      | 136             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5449001`  | 4,186   | 1.00    | VACANT   | P      | 133             | rule     | Vacant public land under the deck (roll VPUB, zoned P) |
| `5472001`  | 72      | 1.00    | VACANT   | P      | 2               | out      | OSM garden on 100% of the lot                          |

**Totals, `us101-south` (rule, committed in `freeway-land.draft.json`):** 102 candidates; 62 listed, 19.18 ha, FZP yield removed 3,560 (including 9 moved from removed segments: `5607046`, `5437002`, `5438001`, `5373001`, `5695021`, `5372A001`, `5694001`, `5375028`, `5373003`); 49 out (1 by rule 1, all listed above; the rest by rules 3 to 6, with reasons in the draft file).

#### i280-south

| Parcel     | Area m² | In band                | Land use  | Zoning | FZP yield today | Decision | Reason                                                                                                                              |
| ---------- | ------- | ---------------------- | --------- | ------ | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `3179014`  | 53,445  | 1.00                   | VACANT    | P      | 0               | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `5846013`  | 25,771  | 1.00                   | VACANT    | P      | 351             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `6777048`  | 25,369  | 1.00                   | VACANT    | P      | 325             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `7147024A` | 16,441  | 1.00                   | VACANT    | P      | 525             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `7140038`  | 15,654  | 1.00                   | VACANT    | P      | 500             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `5846014`  | 15,207  | 1.00                   | VACANT    | P      | 486             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `7111028`  | 13,934  | 1.00                   | VACANT    | P      | 445             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `7095035`  | 12,542  | 1.00                   | VACANT    | P      | 401             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `7102023`  | 12,422  | 1.00                   | VACANT    | P      | 397             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `5391002`  | 11,222  | 1.00                   | VACANT    | P      | 358             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                              |
| `7095B002` | 5,928   | 0.50                   | OPENSPACE | P      | 0               | out      | Open space (land use OPENSPACE)                                                                                                     |
| `3179012`  | 4,099   | 1.00                   | VACANT    | P      | 0               | out      | OSM park on 72% of the lot                                                                                                          |
| `6949013`  | 3,509   | 1.00                   | VACANT    | P      | 232             | out      | OSM station Balboa Park on the lot                                                                                                  |
| `6755026`  | 2,993   | 0.92                   | VACANT    | P      | 228             | out      | OSM station Glen Park on the lot                                                                                                    |
| `7147033`  | 250     | 1.00                   | VACANT    | RH-1   | 4               | out      | OSM pitch on 67% of the lot                                                                                                         |
| `3179010`  | 232,875 | 0.09 (not a candidate) | CIE       | P      | 10,513          | out      | City College of San Francisco, Ocean campus (land use CIE; OSM college on 84%); 9% in the band, a school: not freeway land          |
| `3179011`  | 100,346 | 0.14 (not a candidate) | OPENSPACE | P      | 0               | out      | Balboa Park (land use OPENSPACE; OSM park on 96%; Balboa Pool, Ingleside Police Station); 14% in the band, a park: not freeway land |

**Totals, `i280-south` (rule, committed in `freeway-land.draft.json`):** 351 candidates; 229 listed, 47.36 ha, FZP yield removed 12,757; 122 out (7 by rule 1, all listed above; the rest by rules 3 to 6, with reasons in the draft file).

#### i280-north

| Parcel     | Area m² | In band | Land use  | Zoning  | FZP yield today | Decision | Reason                                                                                                                                                  |
| ---------- | ------- | ------- | --------- | ------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8701003`  | 22,381  | 0.66    | VACANT    | MB-O    | 415             | out      | Caltrain 4th and King rail yard approach (OSM railway on 85%; CP 4th Street)                                                                            |
| `4169002`  | 15,692  | 0.69    | VACANT    | P       | 925             | out      | Muni Woods bus division, a working transit yard (roll class IG)                                                                                         |
| `8709015`  | 15,372  | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM pedestrian area on 86% of the lot (treated as public open space)                                                                                    |
| `8727007`  | 14,034  | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM pedestrian area on 79% of the lot (treated as public open space)                                                                                    |
| `4168011`  | 12,735  | 1.00    | VACANT    | P       | 407             | out      | Caltrain 22nd Street station and tracks (OSM railway on 94%)                                                                                            |
| `4291017`  | 12,604  | 1.00    | VACANT    | PDR-2   | 744             | rule     | Vacant public land under the deck (roll VPUB)                                                                                                           |
| `8709002`  | 10,186  | 0.98    | VACANT    | MB-RA   | 0               | rule     | Vacant public land under the deck (roll VPUB)                                                                                                           |
| `4382003`  | 7,907   | 1.00    | VACANT    | PDR-2   | 467             | out      | Satellite spot check: a working Muni vehicle storage yard, about half of it under the I-280 deck; a rail yard (rule 1), as the Muni Woods yard          |
| `5823056`  | 6,630   | 1.00    | VACANT    | P       | 212             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                  |
| `5848056`  | 6,488   | 1.00    | VACANT    | P       | 207             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                                                  |
| `3809002`  | 6,087   | 0.92    | VACANT    | MB-RA   | 0               | out      | OSM park on 100% of the lot                                                                                                                             |
| `4349004`  | 5,694   | 0.79    | VACANT    | PDR-2   | 336             | out      | Satellite spot check: the Caltrain tracks and their verges beside I-280, none of it within 12 m of a freeway line; a railway (rule 1), not freeway land |
| `8709016`  | 4,999   | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM pedestrian area on 69% of the lot (treated as public open space)                                                                                    |
| `5232011`  | 3,830   | 0.64    | VACANT    | PDR-2   | 260             | out      | Satellite spot check: a lane beside the Caltrain tracks, only its north end under an I-280 ramp (28% within 30 m of a freeway line): not freeway land   |
| `4040031`  | 3,731   | 1.00    | VACANT    | P       | 119             | out      | OSM garden Commander Isaiah Nelson Memorial Hanging Gardens on the lot                                                                                  |
| `4063001`  | 3,717   | 1.00    | VACANT    | P       | 118             | out      | OSM garden on 33% of the lot                                                                                                                            |
| `4227045`  | 3,698   | 1.00    | VACANT    | PDR-1-G | 181             | out      | OSM dog park on 27% of the lot                                                                                                                          |
| `3797009`  | 3,478   | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM pedestrian area on 61% of the lot (treated as public open space)                                                                                    |
| `4226011`  | 3,214   | 1.00    | VACANT    | PDR-1-G | 102             | out      | OSM railway on 31% of the lot                                                                                                                           |
| `4104020`  | 2,426   | 1.00    | VACANT    | P       | 77              | out      | OSM pedestrian area on 68% of the lot (treated as public open space)                                                                                    |
| `4227033`  | 2,352   | 1.00    | VACANT    | PDR-1-G | 115             | out      | OSM pedestrian area on 55% of the lot (treated as public open space)                                                                                    |
| `3999011`  | 2,137   | 1.00    | VACANT    | P       | 68              | out      | OSM pedestrian area on 75% of the lot (treated as public open space)                                                                                    |
| `4227009`  | 2,100   | 1.00    | VACANT    | PDR-1-G | 103             | out      | OSM park on 62% of the lot                                                                                                                              |
| `3784079`  | 2,039   | 1.00    | VACANT    | P       | 139             | out      | OSM pedestrian area on 66% of the lot (treated as public open space)                                                                                    |
| `3999012`  | 1,920   | 1.00    | VACANT    | P       | 61              | out      | OSM pedestrian area on 54% of the lot (treated as public open space)                                                                                    |
| `5368033`  | 1,762   | 1.00    | VACANT    | P       | 104             | out      | OSM pedestrian area on 61% of the lot (treated as public open space)                                                                                    |
| `8723005`  | 1,751   | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM pedestrian area on 77% of the lot (treated as public open space)                                                                                    |
| `3998009`  | 1,723   | 1.00    | VACANT    | UMU     | 84              | out      | OSM pedestrian area on 53% of the lot (treated as public open space)                                                                                    |
| `5214001`  | 1,713   | 1.00    | VACANT    | PDR-2   | 54              | out      | OSM pedestrian area on 52% of the lot (treated as public open space)                                                                                    |
| `4349004A` | 1,583   | 1.00    | VACANT    | PDR-2   | 50              | out      | OSM pedestrian area on 50% of the lot (treated as public open space)                                                                                    |
| `4347B007` | 1,375   | 1.00    | VACANT    | PDR-2   | 92              | out      | OSM pedestrian area on 79% of the lot (treated as public open space)                                                                                    |
| `4349013`  | 1,305   | 1.00    | VACANT    | PDR-2   | 76              | out      | OSM pedestrian area on 56% of the lot (treated as public open space)                                                                                    |
| `4226007`  | 1,250   | 1.00    | VACANT    | PDR-1-G | 39              | out      | OSM pedestrian area on 80% of the lot (treated as public open space)                                                                                    |
| `5351002`  | 929     | 0.77    | VACANT    | P       | 29              | out      | OSM school on 94% of the lot                                                                                                                            |
| `3797008`  | 858     | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM pedestrian area on 90% of the lot (treated as public open space)                                                                                    |
| `8726001`  | 799     | 0.86    | VACANT    | MB-RA   | 0               | out      | OSM railway on 56% of the lot                                                                                                                           |
| `4168005`  | 780     | 1.00    | VACANT    | P       | 24              | out      | OSM railway on 64% of the lot                                                                                                                           |
| `5333037`  | 697     | 1.00    | VACANT    | P       | 41              | out      | OSM pedestrian area on 91% of the lot (treated as public open space)                                                                                    |
| `4227013B` | 589     | 1.00    | VACANT    | PDR-1-G | 28              | out      | OSM pedestrian area on 64% of the lot (treated as public open space)                                                                                    |
| `5269007`  | 519     | 1.00    | VACANT    | PDR-2   | 35              | out      | OSM pedestrian area on 100% of the lot (treated as public open space)                                                                                   |
| `5282031`  | 472     | 1.00    | VACANT    | PDR-2   | 32              | out      | OSM pedestrian area on 100% of the lot (treated as public open space)                                                                                   |
| `3999007`  | 465     | 1.00    | VACANT    | UMU     | 14              | out      | OSM park on 98% of the lot                                                                                                                              |
| `8726002`  | 439     | 0.64    | VACANT    | MB-RA   | 0               | out      | OSM railway on 100% of the lot                                                                                                                          |
| `8709023`  | 339     | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM railway on 40% of the lot                                                                                                                           |
| `5331056`  | 335     | 1.00    | OPENSPACE | P       | 0               | out      | Open space (land use OPENSPACE)                                                                                                                         |
| `4227019`  | 310     | 1.00    | VACANT    | PDR-1-G | 12              | out      | OSM pedestrian area on 68% of the lot (treated as public open space)                                                                                    |
| `4227008`  | 270     | 1.00    | VACANT    | PDR-1-G | 10              | out      | OSM park on 96% of the lot                                                                                                                              |
| `4227021`  | 269     | 1.00    | VACANT    | PDR-1-G | 10              | out      | OSM pedestrian area on 83% of the lot (treated as public open space)                                                                                    |
| `4227020`  | 269     | 1.00    | VACANT    | PDR-1-G | 10              | out      | OSM park on 40% of the lot                                                                                                                              |
| `4227018`  | 260     | 1.00    | VACANT    | PDR-1-G | 10              | out      | OSM park on 27% of the lot                                                                                                                              |
| `4227015`  | 232     | 1.00    | VACANT    | PDR-1-G | 9               | out      | OSM pedestrian area on 79% of the lot (treated as public open space)                                                                                    |
| `4227017`  | 232     | 1.00    | VACANT    | PDR-1-G | 9               | out      | OSM pedestrian area on 76% of the lot (treated as public open space)                                                                                    |
| `5377054`  | 232     | 1.00    | VACANT    | P       | 9               | out      | OSM pedestrian area on 76% of the lot (treated as public open space)                                                                                    |
| `4227016`  | 232     | 1.00    | VACANT    | PDR-1-G | 9               | out      | OSM pedestrian area on 77% of the lot (treated as public open space)                                                                                    |
| `5377049`  | 232     | 1.00    | VACANT    | P       | 7               | out      | OSM pedestrian area on 83% of the lot (treated as public open space)                                                                                    |
| `3999006`  | 232     | 1.00    | VACANT    | UMU     | 7               | out      | OSM park on 92% of the lot                                                                                                                              |
| `5392033`  | 179     | 1.00    | VACANT    | P       | 5               | out      | OSM pedestrian area on 98% of the lot (treated as public open space)                                                                                    |
| `3999005`  | 177     | 1.00    | VACANT    | P       | 5               | out      | OSM park on 48% of the lot                                                                                                                              |
| `3809006`  | 164     | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM park on 67% of the lot                                                                                                                              |
| `5368011`  | 145     | 1.00    | VACANT    | P       | 5               | out      | OSM pedestrian area on 57% of the lot (treated as public open space)                                                                                    |
| `4168006`  | 118     | 1.00    | VACANT    | P       | 3               | out      | OSM pedestrian area on 100% of the lot (treated as public open space)                                                                                   |
| `5368014`  | 99      | 1.00    | VACANT    | P       | 3               | out      | OSM pedestrian area on 100% of the lot (treated as public open space)                                                                                   |
| `3806011`  | 98      | 1.00    | VACANT    | MB-RA   | 0               | out      | OSM park on 100% of the lot                                                                                                                             |
| `5392027`  | 86      | 1.00    | VACANT    | P       | 0               | out      | OSM pedestrian area on 63% of the lot (treated as public open space)                                                                                    |

**Totals, `i280-north` (rule, committed in `freeway-land.draft.json`):** 260 candidates; 137 listed, 14.46 ha, FZP yield removed 5,576 (including 1 moved from removed segments: `5822031`); 124 out (57 by rule 1 and 3 by the satellite spot check, all listed above; the rest by rules 3 to 6, with reasons in the draft file).

#### i80-bay-bridge

| Parcel     | Area m² | In band | Land use | Zoning                              | FZP yield today | Decision | Reason                                                                                                                  |
| ---------- | ------- | ------- | -------- | ----------------------------------- | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `1939018`  | 77,930  | 0.92    | VACANT   | P/YBI-OS/YBI-OS/YBI-PCI/YBI-R       | 0               | out      | Zoned in part YBI-OS (an open-space district)                                                                           |
| `9900024`  | 12,304  | 0.90    | VACANT   | C-2/C-2                             | 0               | out      | Port of San Francisco pier land south of Pier 24 (roll IXG)                                                             |
| `1939017`  | 10,862  | 0.67    | VACANT   | P                                   | 0               | out      | OSM viewpoint Bay Bridge Trail Lookout on the lot                                                                       |
| `3765715`  | 10,625  | 1.00    | VACANT   | RH DTR/SB-DTR                       | 627             | out      | Moves to `i80-soma` (owner): freed with the Harrison St off-ramp                                                        |
| `3764064`  | 10,252  | 1.00    | VACANT   | SB-DTR                              | 605             | out      | Moves to `i80-soma` (owner): freed with the Harrison St off-ramp; the garage-rincon site                                |
| `3764066`  | 9,881   | 1.00    | VACANT   | SB-DTR                              | 862             | rule     | Vacant public land under the deck (roll VPUB)                                                                           |
| `1939175`  | 6,169   | 0.96    | VACANT   | YBI-R/YBI-OS/YBI-PCI                | 0               | out      | Zoned in part YBI-OS (an open-space district)                                                                           |
| `3749052`  | 5,781   | 1.00    | VACANT   | P                                   | 320             | rule     | Vacant public land under the deck (roll VPUB, zoned P)                                                                  |
| `3767003`  | 5,715   | 1.00    | VACANT   | RH DTR                              | 401             | out      | A government industrial property on the 2025 roll (class IXG): a standing building or business, not vacant freeway land |
| `1939020`  | 5,037   | 0.76    | VACANT   | YBI-MU/YBI-MU/YBI-OS/YBI-OS/YBI-PCI | 4               | out      | Zoned in part YBI-OS (an open-space district)                                                                           |
| `1939016`  | 4,208   | 1.00    | VACANT   | P/YBI-OS/YBI-R                      | 0               | out      | Zoned in part YBI-OS (an open-space district)                                                                           |
| `9900024H` | 2,960   | 0.91    | VACANT   | C-2                                 | 39              | out      | Pier 24 (Port of San Francisco; OSM pier on 76%)                                                                        |
| `9900026H` | 2,850   | 0.55    | VACANT   | M-1                                 | 0               | out      | Port pier (OSM pier on 83%)                                                                                             |
| `3766011`  | 2,807   | 1.00    | VACANT   | P                                   | 231             | out      | Rincon Hill Dog Park (OSM dog park on 66%)                                                                              |
| `1939015`  | 1,283   | 1.00    | VACANT   | P/YBI-PCI                           | 0               | out      | OSM pedestrian area on 72% of the lot (treated as public open space)                                                    |
| `3768003`  | 81      | 1.00    | VACANT   | RH DTR                              | 0               | out      | OSM pedestrian area on 70% of the lot (treated as public open space)                                                    |

**Totals, `i80-bay-bridge` (rule, committed in `freeway-land.draft.json`):** 36 candidates; 10 listed, 4.06 ha, FZP yield removed 2,374 (including 1 moved from removed segments: `3764067`); 4 move to `i80-soma` with the Harrison St off-ramp (`3764056`, `3764064`, `3765714`, `3765715`; owner); 23 out (11 by rule 1, all listed above; the rest by rules 3 to 6, with reasons in the draft file). `3764066` (9,881 m², 862 homes), west of Rincon St, holds the loop of the removed ramp but lies mostly under the kept decks and the Sterling St entrance, so it stays listed.

#### us101-presidio

No candidates: no parcel in the pool (0 homes; VACANT, or P with no building) lies at least half within 60 m of these CNNs. Nothing to spot-check; the list stays empty.

#### ca1-presidio

No candidates: no parcel in the pool (0 homes; VACANT, or P with no building) lies at least half within 60 m of these CNNs. Nothing to spot-check; the list stays empty.

### Phases

Five `highway-truncation` projects, four on US-101 north to south and one on I-80. Each phase's
`segments` is one `{ cnn }` list: every CNN of its catalog segment (ruled: CNNs, not a drawn line).
`rowHalfWidthM` is 11 (PV-row-cfwy) around each CNN line, which on the per-direction centrelines
covers a four-lane deck with shoulders each way. `durationMonths` is 30 (PV-hwy) for every phase: no
better evidence for a longer elevated structure was found (Evidence). Each phase depends on the
plan transit carrying the corridor's trips inside the city (the Fillmore rule), and `i80-rincon`
also on `garage-rincon`; the US-101 phases depend on no garage, since the owner dropped
`garage-alemany`. No plan project carries the US-101 trips from the Peninsula or the I-80 trips
from the East Bay, which ride Caltrain, BART and AC Transit today (open question 3, accepted).
`build` starts on 1 January after the clearance ends, for 30 months (PV-build).
`freewayLand.parcels` are the `in` rows of the segment's table in Freeway land;
`freewayLand.excluded` are its `out` rows with their reasons.

**One crew per freeway (spec).** The US-101 phases run one after another: 2033, 2037, 2040, 2043.
Each starts on the first 1 January after the previous clearance ends on which every cap has room,
with `street` at 7 **(owner)**: the interchange waits until 2037 because a 2036 start would put its
build in 2039, when the `housing` capacity of 15 is already full. `i80-rincon` is another freeway
and may overlap; it starts in 2038 (2037 is full once the interchange starts), while the
interchange phase is still under way (2037 to mid-2039). From mid-2039 to mid-2040 the I-80 deck
over SoMa still stands with its US-101 connectors gone, so it carries only the trips of its own 4th
to 9th St ramps; traffic is not modelled.

#### central-freeway-stub (changed)

| Field            | Value                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`             | `central-freeway-stub`                                                                                                 |
| `label`          | Central Freeway ends at Mission Street                                                                                 |
| `kind`           | `highway-truncation`                                                                                                   |
| `startYear`      | 2033                                                                                                                   |
| `durationMonths` | 30 (PV-hwy)                                                                                                            |
| `dependsOn`      | `["fulton-brt", "n-judah-priority"]`                                                                                   |
| `segments`       | `{ cnn: ["19204001", "19264001"] }`                                                                                    |
| `rowHalfWidthM`  | 11 (PV-row-cfwy)                                                                                                       |
| `build`          | `{ startYear: 2036, durationMonths: 30 (PV-build) }`                                                                   |
| `freewayLand`    | parcels `["3502112", "3503002", "3513024", "3513071", "3513074"]`; excluded: the 10 `out` rows of `us101-central-stub` |

v1 dates unchanged (clearance 2033 to mid-2035, build 2036 to mid-2038). v1's dependency on
`garage-south` goes with that garage. The ruling put `garage-alemany` in its place; the owner then
dropped `garage-alemany`, so the stub depends on transit only.

#### us101-interchange (added)

| Field            | Value                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `us101-interchange`                                                                                                                                                                                                                                                                                                                                                     |
| `label`          | US-101/I-80 interchange and the rest of the Central Freeway come down                                                                                                                                                                                                                                                                                                   |
| `kind`           | `highway-truncation`                                                                                                                                                                                                                                                                                                                                                    |
| `startYear`      | 2037                                                                                                                                                                                                                                                                                                                                                                    |
| `durationMonths` | 30 (PV-hwy)                                                                                                                                                                                                                                                                                                                                                             |
| `dependsOn`      | `["fulton-brt", "n-judah-priority", "central-subway-north-beach"]`                                                                                                                                                                                                                                                                                                      |
| `segments`       | `{ cnn: ["19189000", "19206000", "19207000", "19208000", "19212000", "19213000", "19217000", "19243000", "19244000", "19258000", "19267001", "19267002", "19269000", "19281000", "19371000", "19372000", "19373000"] }`                                                                                                                                                 |
| `rowHalfWidthM`  | 11 (PV-row-cfwy)                                                                                                                                                                                                                                                                                                                                                        |
| `build`          | `{ startYear: 2040, durationMonths: 30 (PV-build) }`                                                                                                                                                                                                                                                                                                                    |
| `freewayLand`    | parcels `["3514028", "3515020", "3522074", "3523005", "3526001", "3527002", "3528003", "3528006", "3529048", "3530045", "3531005", "3531043", "3531045", "3905001", "3906001", "3906002", "3907001", "3907004", "3908001", "3908002", "3908003", "3909001", "3909002", "3909003", "3917001", "3918003", "3959001"]`; excluded: the 39 `out` rows of `us101-interchange` |

Transit: the Central Freeway's westbound trips, as for the stub (`fulton-brt`, `n-judah-priority`),
and the downtown trips the interchange feeds, carried by the Central Subway under 4th St
(`central-subway-north-beach`, open 2035). Clearance 2037 to mid-2039.

#### us101-james-lick (added)

| Field            | Value                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `us101-james-lick`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `label`          | James Lick Freeway and the Hairball come down                                                                                                                                                                                                                                                                                                                                                                         |
| `kind`           | `highway-truncation`                                                                                                                                                                                                                                                                                                                                                                                                  |
| `startYear`      | 2040                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `durationMonths` | 30 (PV-hwy)                                                                                                                                                                                                                                                                                                                                                                                                           |
| `dependsOn`      | `["j-church-priority", "central-subway-north-beach"]`                                                                                                                                                                                                                                                                                                                                                                 |
| `segments`       | `{ cnn: ["19190000", "19195000", "19197000", "19199000", "19203000", "19214000", "19215000", "19218000", "19226000", "19229000", "19232000", "19233000", "19236000", "19237000", "19238000", "19262000", "19265000"] }`                                                                                                                                                                                               |
| `rowHalfWidthM`  | 11 (PV-row-cfwy)                                                                                                                                                                                                                                                                                                                                                                                                      |
| `build`          | `{ startYear: 2043, durationMonths: 30 (PV-build) }`                                                                                                                                                                                                                                                                                                                                                                  |
| `freewayLand`    | parcels `["3975001N", "3976029", "4011019", "4026018", "4076022", "4077001", "4090003", "4091002", "4091003", "4093076", "4139001", "4140002", "4157001", "4202001", "4215001", "4261001", "4277006", "4277006A", "4279029", "4279030", "4279033", "4280027", "4329010", "4329011", "4329012", "4339002C", "4339004", "4339009", "5508001", "5509005", "5510010"]`; excluded: the 15 `out` rows of `us101-james-lick` |

Transit: the Mission and Noe Valley trips (`j-church-priority`, open 2034) and the T Third, which
runs parallel on 3rd St and reaches downtown and North Beach through the Central Subway
(`central-subway-north-beach`). Clearance 2040 to mid-2042.

#### us101-bayshore (added)

| Field            | Value                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `us101-bayshore`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `label`          | Bayshore Freeway comes down to the Alemany interchange                                                                                                                                                                                                                                                                                                                                                                             |
| `kind`           | `highway-truncation`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `startYear`      | 2043                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `durationMonths` | 30 (PV-hwy)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `dependsOn`      | `["central-subway-north-beach", "k-ocean-priority"]`                                                                                                                                                                                                                                                                                                                                                                               |
| `segments`       | `{ cnn: ["19191000", "19200000", "19220000", "19221000", "19222002", "19234000", "19245000", "19246000", "19250000", "19268000", "19270000", "19278000", "19280000", "19353000"] }`                                                                                                                                                                                                                                                |
| `rowHalfWidthM`  | 11 (PV-row-cfwy)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `build`          | `{ startYear: 2046, durationMonths: 30 (PV-build) }`                                                                                                                                                                                                                                                                                                                                                                               |
| `freewayLand`    | parcels `["5511011", "5512024", "5512025", "5512026", "5512027", "5533049", "5576017", "5596006", "5596010A", "5596011B", "5596012A", "5596013A", "5596017A", "5596017C", "5596017E", "5596044", "5596046", "5596051", "5607043", "5607047", "5636025", "5657050", "5691045", "5692045", "5693037", "5693038", "5693040", "5693041", "5819009", "5819010", "5820034", "5820035"]`; excluded: the 38 `out` rows of `us101-bayshore` |

Transit: the T Third (through `central-subway-north-beach`) for Bayview and Visitacion Valley, and
the K on Ocean Ave (`k-ocean-priority`, open 2036) for the Excelsior and Ingleside side. Clearance
2043 to mid-2045; the last scheduled build completes mid-2048. `5820035`, the draft's
`garage-alemany` site, is ordinary freed land.

#### i80-rincon (added)

| Field            | Value                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `i80-rincon`                                                                                                                                                                                                                                                                                                                                        |
| `label`          | I-80 over SoMa comes down; the Bay Bridge ends at Rincon Hill                                                                                                                                                                                                                                                                                       |
| `kind`           | `highway-truncation`                                                                                                                                                                                                                                                                                                                                |
| `startYear`      | 2038                                                                                                                                                                                                                                                                                                                                                |
| `durationMonths` | 30 (PV-hwy)                                                                                                                                                                                                                                                                                                                                         |
| `dependsOn`      | `["garage-rincon", "central-subway-north-beach"]`                                                                                                                                                                                                                                                                                                   |
| `segments`       | `{ cnn: ["19355000", "19356000", "19357000", "19358000", "19362000", "19363000", "19366000", "19367000", "19368000", "19369000", "19370000", "19374000", "19376000", "19377000", "19378000", "19379000", "19380000", "19381000", "19383000", "19384000", "19385000", "19386000", "19387000", "19388000"] }`                                         |
| `rowHalfWidthM`  | 11 (PV-row-cfwy)                                                                                                                                                                                                                                                                                                                                    |
| `build`          | `{ startYear: 2041, durationMonths: 30 (PV-build) }`                                                                                                                                                                                                                                                                                                |
| `freewayLand`    | parcels `["3758121", "3758126", "3758127", "3758128", "3758129", "3759038", "3759040", "3760002", "3760114", "3760116", "3760117", "3760120", "3760123", "3760124", "3761062", "3761064", "3762004", "3763126", "3764056", "3764064", "3765714", "3765715", "3780014", "3781007", "3782002", "3782004"]`; excluded: the 52 `out` rows of `i80-soma` |

Transit: the Central Subway under 4th St, which crosses beneath this stretch and carries SoMa's
trips downtown (`central-subway-north-beach`). The ramps that stay at Rincon Hill are listed under
Freeway segments: three eastbound entrances and the westbound exit to Fremont St
(`19375001`–`19375002`, one ramp in two CNNs), so the Bay Bridge still reaches city streets. The
westbound Harrison St off-ramp `19374000` and the mainline piece `19383000` come down with this
phase **(owner)**: folding them in keeps one crew and one date for the I-80 work, and `checkPlan`
needs nothing else, because `garage-rincon` may stand on freeway land before it is freed (Garages).
Clearance 2038 to mid-2040.

**No overlap on one freeway.** US-101: [2033-01-01, 2035-07-01), [2037-01-01, 2039-07-01),
[2040-01-01, 2042-07-01), [2043-01-01, 2045-07-01). I-80: [2038-01-01, 2040-07-01).

### Garages

One new garage, `garage-rincon`, on the Rincon Hill green the owner pointed at **(owner)**.
`garage-alemany` is dropped **(owner)**; `garage-north` is unchanged and `garage-south` is retired.
The garage stands on freeway land of the `i80-rincon` removal: the green between the I-80 decks and
the westbound Harrison St off-ramp that the phase takes down. The spec's garage exception lets a
garage name a `{ parcel }` of freeway land that is not yet freed: the site is also in the phase's
`freewayLand.parcels`, the build marks that freed site `heldBy` the garage, it gets no homes, and
the breakdown reports the homes it would have had at the phase's build start as the garage's cost.
The parcel holds 0 homes.

| Garage          | Parcel    | Footprint (parcel area) | Spaces | Where                                                                                                                                                                                                                               | Today                                                                                                        | Cost in homes                                                 |
| --------------- | --------- | ----------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `garage-rincon` | `3764064` | 10,252 m²               | 1,700  | the green triangle between the I-80 decks and Bryant St, east of Rincon St, bounded by the removed Harrison St off-ramp `19374000`; 18% within 12 m of a kept mainline centreline, 38% within 8 m of a kept ramp, 49% within either | zoned SB-DTR, roll VPUB, land use VACANT; landscaped green under and beside the decks (satellite spot check) | 605 at today's FZP top fill; reported at the 2041 build start |

**Why this parcel (drafter's call, on the owner's site).** Removing the off-ramp frees four parcels
of that green (`3764056`, `3764064`, `3765714`, `3765715`; Freeway land, `i80-soma`). A garage
names one parcel. The two large ones are `3764064` and `3765715` (10,625 m²). `3764064` takes the
garage because about half of it lies under or against the kept Bay Bridge decks and ramps, where a
parking structure fits better than homes; `3765715` (27% under the kept mainline) is freed for
homes. **Known overstatement:** `3765715` and `3764056` are freed whole although about 27% and
28% of them lie under the kept Bay Bridge deck, so the plan overstates their room for homes by up
to about 210 homes (27% of 627 plus 28% of 136; the engine frees whole parcels only). The other
green parcels stay with the kept bridge: `3766010` (63% within 12 m of the
mainline), `3764065` (75% under kept structures), the Rincon Hill Dog Park `3766011` (rule 1) and
`3764066` west of Rincon St, which holds the ramp's loop but lies mostly under the decks and the
Sterling St entrance.

Spaces = footprint × 5 levels ÷ 30 m² per space, rounded down to 50 as v1 did (10,252 → 1,708 →
1,700; PV-spaces-rincon, tier 4). The draft's site `3761062` (23,987 m², 3,950 spaces, cost 40
homes) had more room; the owner chose the Rincon Hill site. The rule uses the whole parcel, as for
every garage, although part of it is under the kept decks. `garage-rincon` starts in 2033 and
opens 1 January 2035, three years before `i80-rincon` starts. No plan check measures a garage's
distance to transit: the nearest Muni stops are about 270 m away (Harrison & 2nd St, Folsom & 1st
St) and Montgomery St BART about 900 m (`transit.json`). `checkPlan` accepts the site: one garage
and one truncation's freeway land, the one pairing `site-reused` allows.

**`garage-alemany` is dropped** (owner): parcel `5820035` is ordinary freed land of
`us101-bayshore`, and no US-101 phase depends on a garage.

**`garage-south` is retired** (spec): its row is removed and parcel `3901004` is an ordinary lot
again (it is an `out` row of `us101-interchange`: a private parking lot across Division St).

**Garage capacity.** Two garages against `maxConcurrent` 2: `garage-north` builds in 2031–2032
and `garage-rincon` in 2033–2034, so at most one is ever under way and the cap stays 2.

### Appendix A changes

Tables for Plan B to transcribe into Appendix A and `plan.json`.

#### Projects added

| `id`                | Field table                             |
| ------------------- | --------------------------------------- |
| `garage-rincon`     | Garages above and "garage-rincon" below |
| `us101-interchange` | Phases, "us101-interchange (added)"     |
| `us101-james-lick`  | Phases, "us101-james-lick (added)"      |
| `us101-bayshore`    | Phases, "us101-bayshore (added)"        |
| `i80-rincon`        | Phases, "i80-rincon (added)"            |

##### garage-rincon

| Field            | `garage-rincon`                                                           |
| ---------------- | ------------------------------------------------------------------------- |
| `id`             | `garage-rincon`                                                           |
| `label`          | Bay Bridge edge garage (Rincon Hill, on the removed Harrison St off-ramp) |
| `kind`           | `edge-garage`                                                             |
| `startYear`      | 2033                                                                      |
| `durationMonths` | 24 (PV-garage)                                                            |
| `dependsOn`      | `[]`                                                                      |
| `site`           | `{ parcel: "3764064" }` (also in `i80-rincon`'s `freewayLand`)            |
| `spaces`         | 1,700 (PV-spaces-rincon)                                                  |

#### Projects changed

| Project                | Field         | v1 value                                             | v1.1 value                                                                                                                 |
| ---------------------- | ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `central-freeway-stub` | `dependsOn`   | `["fulton-brt", "n-judah-priority", "garage-south"]` | `["fulton-brt", "n-judah-priority"]`                                                                                       |
| `central-freeway-stub` | `segments`    | `{ line: […], provenance: PV-line-cfwy }`            | `{ cnn: ["19204001", "19264001"] }`                                                                                        |
| `central-freeway-stub` | `freewayLand` | (none)                                               | parcels `["3502112", "3503002", "3513024", "3513071", "3513074"]`; the 10 `out` rows of `us101-central-stub` as `excluded` |

#### Projects removed

| Project        | Why                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `garage-south` | It sat at the US-101/I-80 interchange, which v1.1 removes; no garage replaces it (the owner dropped `garage-alemany`) |

#### Provenances added

| Id               | `tier` | `label`                                  | `sources` | `method`                                                                                          |
| ---------------- | ------ | ---------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| PV-spaces-rincon | 4      | 1,700 spaces (invented)                  | D2        | 10,252 m² footprint × 5 levels ÷ 30 m² per space, rounded down to 50.                             |
| PV-cap-street-7  | 4      | Seven street projects at once (invented) | —         | Unsourced. The owner raised v1's six to seven (2026-11-03) so the US-101 removal finishes sooner. |

`PV-spaces-south` (with `garage-south`), `PV-line-cfwy` (the stub's drawn line) and
`PV-cap-street` (replaced by PV-cap-street-7) are no longer used. PV-hwy, PV-row-cfwy, PV-garage
and PV-build are reused unchanged.

#### Capacity changed

| `kind`   | v1 `maxConcurrent` | v1.1 `maxConcurrent` | `provenance`    |
| -------- | ------------------ | -------------------- | --------------- |
| `street` | 6 (PV-cap-street)  | 7                    | PV-cap-street-7 |

`garage` stays 2 (two garages, never both under way); `transit` and `housing` are unchanged.

### Schedule

v1's layout and rules: opening = `startYear` + `durationMonths`; capacity counted per calendar
year. Built from a scratch plan (v1's `plan.json` with the changes above and the parcel lists of
`freeway-land.draft.json`, not committed) and checked with `checkPlan(plan, schedulePlan(plan))`,
which returns `[]`; the same plan with `street` at 6 fails on capacity. The calendar-year counts
for every year before 2037 match v1's table except the garage column (`garage-north` alone in
2031–2032, `garage-rincon` in 2033–2034) and the `street` cap (7).

| Year | Starts                                                                                                                      | Opens / completes                                                                                     | Car closures (and the transit they wait for)                                                      | transit | street | garage | housing |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------- | ------ | ------ | ------- |
| 2029 | fulton-brt, 19th-ave-brt                                                                                                    |                                                                                                       |                                                                                                   | 2/4     | 0/7    | 0/2    | 0/15    |
| 2030 | central-subway-north-beach, n-judah-priority                                                                                |                                                                                                       |                                                                                                   | 4/4     | 0/7    | 0/2    | 0/15    |
| 2031 | garage-north                                                                                                                |                                                                                                       |                                                                                                   | 4/4     | 0/7    | 1/2    | 0/15    |
| 2032 | geary-subway-1, lombard-bus-lane, j-church-priority, irving-pedestrian; parking 0700035, 3724067, 7296007, 0327021, 0781034 | fulton-brt, 19th-ave-brt, n-judah-priority (1 Jan); switch day 31 Jan                                 | irving-pedestrian (after n-judah-priority 2032)                                                   | 4/4     | 6/7    | 1/2    | 0/15    |
| 2033 | garage-rincon, van-ness-street, central-freeway-stub; parking 0719001, 0719002, 0347016, 0347017                            | garage-north, irving-pedestrian                                                                       | central-freeway-stub (after fulton-brt 2032, n-judah-priority 2032)                               | 4/4     | 6/7    | 1/2    | 5/15    |
| 2034 | k-ocean-priority; parking 0446003, 0785030, 1450049, 0715015                                                                | lombard-bus-lane, j-church-priority                                                                   |                                                                                                   | 3/4     | 6/7    | 1/2    | 9/15    |
| 2035 | geary-19th-subway-2, columbus-pedestrian; parking 0056007, 0035001, 0685050                                                 | central-subway-north-beach, garage-rincon, van-ness-street, central-freeway-stub clearance (mid-year) | columbus-pedestrian (after central-subway-north-beach 2035)                                       | 3/4     | 5/7    | 0/2    | 13/15   |
| 2036 | central-subway-wharf, fell-oak-street; central-freeway-stub build; parking 0081003, 0147029, 0713033, 3753122, 0743001      | k-ocean-priority, columbus-pedestrian                                                                 |                                                                                                   | 3/4     | 6/7    | 0/2    | 12/15   |
| 2037 | us101-interchange; parking 7080009, 0761065, 1228006, 2413038, 0768073                                                      | fell-oak-street (mid-year)                                                                            | us101-interchange (after fulton-brt 2032, n-judah-priority 2032, central-subway-north-beach 2035) | 3/4     | 7/7    | 0/2    | 13/15   |
| 2038 | i80-rincon; parking 0776010, 0718021, 0817011, 1216019, 1182023                                                             | central-freeway-stub build completes (mid-year)                                                       | i80-rincon (after central-subway-north-beach 2035)                                                | 3/4     | 7/7    | 0/2    | 14/15   |
| 2039 | parking 1101027, 0101031                                                                                                    | us101-interchange clearance (mid-year)                                                                |                                                                                                   | 3/4     | 4/7    | 0/2    | 15/15   |
| 2040 | us101-james-lick; us101-interchange build                                                                                   | i80-rincon clearance (mid-year)                                                                       | us101-james-lick (after j-church-priority 2034, central-subway-north-beach 2035)                  | 3/4     | 2/7    | 0/2    | 13/15   |
| 2041 | geary-trench; i80-rincon build; parking 0286024, 3735060, 3722079, 3721084                                                  | geary-subway-1                                                                                        | geary-trench (after geary-subway-1 2041)                                                          | 2/4     | 6/7    | 0/2    | 9/15    |
| 2042 | parking 0647012, 0647014, 0668003, 1017027, 0658003                                                                         | us101-interchange build completes (mid-year), us101-james-lick clearance (mid-year)                   |                                                                                                   | 2/4     | 7/7    | 0/2    | 8/15    |
| 2043 | us101-bayshore; us101-james-lick build; parking 0266007, 0680001, 3710014, 0643016                                          | i80-rincon build completes (mid-year)                                                                 | us101-bayshore (after central-subway-north-beach 2035, k-ocean-priority 2036)                     | 2/4     | 6/7    | 0/2    | 11/15   |
| 2044 |                                                                                                                             | geary-19th-subway-2, central-subway-wharf, geary-trench clearance                                     |                                                                                                   | 0/4     | 1/7    | 0/2    | 14/15   |
| 2045 | geary-trench build                                                                                                          | us101-james-lick build completes (mid-year), us101-bayshore clearance (mid-year)                      |                                                                                                   | 0/4     | 1/7    | 0/2    | 11/15   |
| 2046 | us101-bayshore build                                                                                                        |                                                                                                       |                                                                                                   | 0/4     | 0/7    | 0/2    | 6/15    |
| 2047 |                                                                                                                             | geary-trench build completes (mid-year)                                                               |                                                                                                   | 0/4     | 0/7    | 0/2    | 2/15    |
| 2048 |                                                                                                                             | us101-bayshore build completes (mid-year)                                                             |                                                                                                   | 0/4     | 0/7    | 0/2    | 1/15    |

Checks:

- **Fillmore rule.** Each new phase starts on or after the opening of every transit project it
  depends on (the Car closures column).
- **Garages before closures.** `garage-rincon` opens 2035 (`i80-rincon` 2038). The US-101 phases
  depend on no garage.
- **Capacity.** No year exceeds a cap. `street` binds in 2037, 2038 and 2042, `housing` in 2039;
  `garage` never binds.
- The last scheduled build completes mid-2048 (v1: mid-2047; the draft with `street` at 6:
  mid-2052).

### Basemap ids

Task 1's verdict on the dataset's `basemap.pmtiles` is **`split`**: the removed stretches can be
picked out by id at every zoom, but at z11–13 US-101 is one merged feature across the Alemany cut,
so the tiles step (Task 7b) moves each phase's roads, clipped at its 25 m corridor, into
`roads_lc`. In that step a listed id is clipped at the corridor, never moved whole, and a
`highway` feature with the phase's `ref` is clipped even when unlisted; ids matter for features
without that `ref` (ramps, unrefed decks). `npm run pipeline -- lesscars-basemap` wrote the
candidates (`basemap-ids.candidates.json`, basemap sha256 `a6a1acc8…`): every `roads` feature with
at least 90% of its length within 25 m of a phase's CNN lines at some zoom. Decisions: keep the
freeway features; drop every street, path and service road that runs under or beside the deck,
because those stay. No kept-stretch feature is kept. After the owner's Rincon Hill decision the
candidates were re-run in a scratch copy against `freeway-land.draft.json` (the committed
candidates file still reflects the draft's partition): the only change is two new `i80-rincon` ids,
35184403218600 (kept) and 35184485600277 (dropped).

| Phase                  | Keep                                                                                                                                                            | Drop, with reason                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `central-freeway-stub` | 35184381011290, 35184400684840, 35184594692050 (the unrefed deck), 35184395963440 (link; also in the interchange phase, clipped per corridor)                   | 35184554756950, 35185049019655, 35185049019658, 35185542535650, 35185928802582 (paths, including the Octavia Boulevard Bike Connector, which stays); 35185250302877 (13th Street, a street under the deck)                                                                                                                                             |
| `us101-interchange`    | 35184381004120, 35184405200290, 35184491326530 (US 101 Central Freeway), 35184381004500, 35184397426580, 35184989818910, 35184989818916, 35184395963440 (links) | 35184403218590 (I 80 between the interchange and 8th St: it stands until `i80-rincon` and is clipped there by its ref); 35184381009460, 35184885684550 (Division Street), 35184399463490, 35185250302877 (13th Street), 35184830868165 (Folsom Street), 35184558487670 (Vermont Street), 35185840232352 (an unnamed minor road), 35185928802582 (path) |
| `us101-james-lick`     | 35184399272190, 35184399272210, 35184430930010 (US 101 James Lick Freeway)                                                                                      | 35184396636672 (23rd Street), 35185404004107 (minor road); 35184399272180, 35184402846890, 35184505870640, 35184505870649, 35184400804710, 35184774418744, 35185714359940 (paths beside the deck)                                                                                                                                                      |
| `us101-bayshore`       | 35184400415770, 35184400415780 (US 101)                                                                                                                         | 35184555287545 (Crescent Avenue), 35184381007588 (Hilton Street)                                                                                                                                                                                                                                                                                       |
| `i80-rincon`           | 35184403218560, 35184403218600, 35184492902240, 35184766532010 (I 80; 35184403218600 is the westbound deck at the Rincon Hill cut), 35184381003980 (link)       | 35184381009267 (Ahern Way), 35184419261616 (Stillman Street), 35184936169434 (Homer Street), 35185425471855 (Perry Street), 35184485600277 (Sterling Street), 35184989819990 (minor road), 35184989820000 (`other`, a service way)                                                                                                                     |

Not in the candidates and worth a look at z14–15 in Plan B before adding: unrefed ramps only partly
within 25 m (share 0.5–0.9): 35184397460280 (interchange, 0.86), 35184381003870 (0.81),
35184381004460 (0.76), 35184381003850 (0.51 James Lick, 0.87 Bayshore), 35184381003910 (0.55),
35184381003960 (Bayshore, 0.57), 35184381003940 (I-80, 0.84) and 35184399860900 (I-80 at z15,
0.68; probably the Harrison St off-ramp itself). Clipping would hide only their
in-corridor part, but some may be ramps of a kept freeway. Where a kept freeway of the same `ref`
continues from a phase end (US-101 south of Alemany; the Bay Bridge approach at Rincon Hill), the
`ref` clip removes up to a band-wide piece of the kept freeway at z14–15; Plan B inspects both ends.

### Evidence

| Item                                       | Value                                                              | Tier | Source                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase duration (PV-hwy)                    | 30 months                                                          | 2    | Central Freeway: demolition began March 2003, Octavia Boulevard opened 9 September 2005 (S10). Applied to every phase; no source for a longer elevated structure was found, so the James Lick and I-80 viaducts may take longer                                                                                                                                                                  |
| Freed land without a public builder        | 20+ years                                                          | 3    | The Octavia parcels: some still vacant in 2023–24 (S11); the initiative builds instead (v1 spec)                                                                                                                                                                                                                                                                                                 |
| Frontage band (60 m, at least half within) | candidate rule only                                                | 4    | Invented (spec); it only proposes candidates                                                                                                                                                                                                                                                                                                                                                     |
| Phase boundaries                           | the cut points under Freeway segments                              | 4    | Invented from the owner's cuts and the CNN end points (tier 0 geometry)                                                                                                                                                                                                                                                                                                                          |
| Garage spaces (PV-spaces-rincon)           | 1,700                                                              | 4    | Invented: footprint × 5 ÷ 30 m²                                                                                                                                                                                                                                                                                                                                                                  |
| Freeway land decisions (in / out)          | the Freeway land tables, `freeway-land.draft.json`                 | 4    | The drafter's rules (Freeway land), applied by script to tier 0 inputs: dataset parcels, DataSF land use 2023, the 2025 assessor roll class, zoning, distance and street-between geometry, and OSM land use and places via the protomaps basemap. The 25 kept-list lots with the largest FZP yield and the four Rincon Hill parcels were checked on satellite imagery (below); the rest were not |
| Rincon Hill ramp and the green it frees    | `19374000`, `19383000`; `3764056`, `3764064`, `3765714`, `3765715` | 0    | The owner's pointer to the map, matched to the DataSF Streets CNN lines and the parcel outlines, and checked on satellite imagery (below)                                                                                                                                                                                                                                                        |
| Street capacity binding the US-101 starts  | 7 (PV-cap-street-7)                                                | 4    | v1's invented 6, raised by the owner (2026-11-03)                                                                                                                                                                                                                                                                                                                                                |

#### Satellite spot check (2026-11-03)

The owner approved on condition of this check. Method: for each lot, Esri World Imagery for the
lot's box padded by 35%, with the parcel outline (DataSF Parcels) and the freeway CNN lines drawn
on it; the share of the lot within 12 m and 30 m of any freeway CNN line was measured on a 1 m
grid. Lots are the 25 largest by FZP yield on the drafted kept lists, so the 20 largest of the
corrected lists are all checked, plus the four Rincon Hill parcels the owner's ramp decision moves.
"Freeway land" means under or inside the freeway structure or its landscaped right-of-way
(correctly blocked); "not freeway land" means a building, yard, track or lot beside it (wrongly
listed). The imagery is a record (tier 0); the verdicts are the drafter's reading of it. Towers
lean in the imagery, so a tower can appear over a lot it does not stand on.

| Parcel     | List             | FZP homes | Within 12 m / 30 m | Verdict          | Reason                                                                                                                      |
| ---------- | ---------------- | --------- | ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `3764066`  | `i80-bay-bridge` | 862       | 63% / 94%          | freeway land     | I-80 decks, the Sterling St entrance and the loop of the removed Harrison St off-ramp; one small building between the decks |
| `4291017`  | `i280-north`     | 744       | 61% / 99%          | freeway land     | The loop of an I-280 ramp and the land under the deck; its north tip reaches a yard with sheds                              |
| `3765715`  | `i80-bay-bridge` | 627       | 27% / 59%¹         | freeway land     | The Harrison St off-ramp, the green it crosses and the I-80 deck; moves to `i80-soma` (owner)                               |
| `3764064`  | `i80-bay-bridge` | 605       | 18% / 72%¹         | freeway land     | I-80 decks and the landscaped green inside the ramps; moves to `i80-soma` as the `garage-rincon` site (owner)               |
| `7147024A` | `i280-south`     | 525       | 88% / 100%         | freeway land     | Landscaped strip along the I-280 lanes                                                                                      |
| `7140038`  | `i280-south`     | 500       | 60% / 98%          | freeway land     | I-280 lanes, a ramp, its wooded verge and the rail line beside it                                                           |
| `5846014`  | `i280-south`     | 486       | 69% / 94%          | freeway land     | I-280 lanes, an off-ramp and landscaped verges                                                                              |
| `4382003`  | `i280-north`     | 467       | 29% / 72%          | not freeway land | A working Muni vehicle storage yard; the I-280 deck covers about half. Removed                                              |
| `7111028`  | `i280-south`     | 445       | 66% / 99%          | freeway land     | I-280 lanes, a ramp, verges and the rail line; a sliver of a store roof at its east corner                                  |
| `5437002`  | `us101-south`    | 418       | 96% / 100%         | freeway land     | US-101 lanes and ramps at the Alemany interchange                                                                           |
| `7095035`  | `i280-south`     | 401       | 62% / 95%          | freeway land     | I-280 lanes, wooded verge and the rail line                                                                                 |
| `7102023`  | `i280-south`     | 397       | 84% / 100%         | freeway land     | I-280 lanes, verges and the rail line                                                                                       |
| `5232007`  | `i280-north`     | 377       | 27% / 52%          | freeway land     | Under two I-280 decks and a ramp; its south-east corner is open ground used for storage beside the Caltrain tracks          |
| `5214004`  | `i280-north`     | 373       | 68% / 97%          | freeway land     | Under the I-280 decks, over the Caltrain cut                                                                                |
| `5391002`  | `i280-south`     | 358       | 87% / 100%         | freeway land     | Lanes and ramps of the I-280/US-101 interchange                                                                             |
| `5846013`  | `i280-south`     | 351       | 71% / 99%          | freeway land     | I-280 lanes, a ramp and landscaped slopes                                                                                   |
| `6973037`  | `i280-south`     | 350       | 96% / 100%         | freeway land     | I-280 lanes in the cut by Balboa Park                                                                                       |
| `7046018`  | `i280-south`     | 344       | 56% / 93%          | freeway land     | I-280 lanes, wooded verge and the rail line                                                                                 |
| `4349004`  | `i280-north`     | 336       | 0% / 13%           | not freeway land | The Caltrain tracks and their verges, beside I-280 and across a road from it. Removed                                       |
| `6777048`  | `i280-south`     | 325       | 78% / 100%         | freeway land     | I-280 lanes and the landscaped verge                                                                                        |
| `3749052`  | `i80-bay-bridge` | 320       | 54% / 88%          | freeway land     | The I-80 exit ramp to Fremont St and the verge under it                                                                     |
| `3736007`  | `i80-bay-bridge` | 316       | 54% / 77%          | freeway land     | The Fremont St exit ramp's right-of-way, partly parking beside it; its south-west end touches a building                    |
| `3766010`  | `i80-bay-bridge` | 290       | 63% / 100%         | freeway land     | The I-80 deck; its south edge takes in part of the Rincon Hill Dog Park's sand                                              |
| `5899068`  | `i280-south`     | 275       | 100% / 100%        | freeway land     | I-280 lanes                                                                                                                 |
| `5232011`  | `i280-north`     | 260       | 6% / 28%           | not freeway land | A lane beside the Caltrain tracks; only its north end is under an I-280 ramp. Removed                                       |
| `3764056`  | `i80-bay-bridge` | 136       | 28% / 70%¹         | freeway land     | The I-80 deck and the dry green inside the ramp; moves to `i80-soma` (owner)                                                |
| `3765714`  | `i80-bay-bridge` | 6         | 0% / 0%¹           | freeway land     | A strip beside the off-ramp's descent to Harrison St; moves to `i80-soma` (owner)                                           |

¹ For the Rincon Hill parcels, measured after the ramp change: within 12 m of the kept Bay Bridge
mainline, and within 30 m of any kept line (mainline or ramp).

22 of 25 kept-list lots are freeway land; 3, all on `i280-north` along the Caltrain line, are not
and are removed (`excluded` in the draft file with the reason above). The lots below the 25 were
not checked; the Caltrain corridor beside I-280 north is where more such lots are likely. The four
Rincon Hill parcels are freeway land. Nothing in the check changes the plan beyond the removals.

**Rail-land pass over the 438 kept lots (2026-11-03).** The three removals were rail land, so
every kept lot was screened for the same fault. Method: for each lot, the distance to the
Caltrain track lines (the agency's GTFS shapes, tier 0), the share within 15 m of them, and the
share within 12 m and 30 m of the freeway CNN lines, measured on parcel outlines in EPSG:7131; the
three removed lots set the signature (little or none of the lot within 12 m of a freeway line,
with the tracks on or beside it, or a yard). Lots with the tracks within 15 m and the freeway
within 30 m, and every kept lot with less than 60% within 30 m of a freeway line and tracks
within 30 m, were looked at on Esri imagery: `4226014`, `4349012`, `4062004`, `5480001` and `5471027`
are verges, ramp loops and slopes inside or beside the freeway right-of-way, not track, and stay
`in`. No kept lot has the removed lots' signature, so none is dropped and the kept totals above
stand. Limits: the tracks come from GTFS shapes, which omit yards and freight spurs; those are
caught only by rule 1's OSM railway test, so a spur lot below 25% OSM rail and away from the
freeway lines would pass both. The lots below the 25 were otherwise not checked by eye.

**Kept-list totals, corrected:**

| List             | Drafted: lots | ha    | FZP homes | Corrected: lots | ha    | FZP homes | Change                        |
| ---------------- | ------------- | ----- | --------- | --------------- | ----- | --------- | ----------------------------- |
| `us101-south`    | 62            | 19.18 | 3,560     | 62              | 19.18 | 3,560     | none                          |
| `i280-south`     | 229           | 47.36 | 12,757    | 229             | 47.36 | 12,757    | none                          |
| `i280-north`     | 140           | 16.20 | 6,639     | 137             | 14.46 | 5,576     | 3 removed by the spot check   |
| `i80-bay-bridge` | 14            | 6.40  | 3,748     | 10              | 4.06  | 2,374     | 4 moved to `i80-soma` (owner) |
| All kept         | 445           | 89.14 | 26,704    | 438             | 85.06 | 24,267    |                               |

"FZP homes" is the sum of today's top-fill yield over the hostable listed lots: the homes the
baseline loses on that land while the freeway stands.

### Open questions for the owner (v1.1): resolved 2026-11-03

1. **Parks under the Central Freeway stub.** Resolved **(owner)**: the SoMa West Skate Park and
   Dog Park (`3513071`, `3513074`) are freed land; the stub frees 0.88 ha of parcels. The Yerba
   Buena Dog Park (`3761063`, under I-80) stays `out`.
2. **Interim uses under the deck.** Resolved by approval: the Division Circle and Bryant
   Navigation Centers, the street tree nursery, the Women's Resource Center and the CHP office lot
   `3758126` stay `in`. The Bryant lot (`3761062`) is no longer a garage site.
3. **Corridor transit.** Resolved by approval: each phase waits on in-city transit only; no
   regional project is added.
4. **Pace of the US-101 removal.** Resolved **(owner)**: `street` capacity 7. The US-101 phases
   start 2033, 2037, 2040 and 2043, `i80-rincon` 2038, and the last build completes mid-2048
   (Schedule).
5. **`garage-rincon` at Rincon Hill.** Resolved **(owner)**: the westbound Harrison St off-ramp
   comes down with `i80-rincon` and `garage-rincon` stands on the green it frees (`3764064`, 1,700
   spaces, cost 605 homes at today's FZP). `garage-alemany` is dropped as well.

Approved by the owner on 2026-11-03.

### Errata from the live check (2026-11-03)

The live check of the first v1.1 build (`2026-11-02-70dfa769`; `docs/dev/lesscars.md`, "v1.1 live
check") found removed freeway still drawn on `/lesscars` after its removal day, and the US-101 cut
about 400 m south of the I-280 crossing. The owner's requirement stands: a removed freeway
disappears from the map on its removal day, while I-280, US-101 south of the Alemany interchange
and the Bay Bridge approach still draw; the US-101 cut is at the Alemany interchange with I-280.
The tables above stay as approved. These errata amend them, and the files follow the amended
tables (`freeway-land.json`, `plan.json`; the transcription tests apply the moves below).

**1. The basemap split takes every freeway road along a removed line.** Two defects had one cause:
the split moved only listed ids and `highway` features carrying the phase's `ref`. An `I 80`
feature along US-101 (`35184403218590`, about 1.1 km at z15, along Vermont St from Division St
south) was never moved and still drew after `us101-interchange` and `us101-james-lick`; the Basemap
ids table's reason for dropping it ("between the interchange and 8th St ... clipped there by its
ref") was wrong: it runs along US-101 south of the interchange, and only its northern 120 m lie in
`i80-rincon`'s corridor.
And ref-less ramps (`motorway_link`) of every removed stretch stayed, among them the Harrison St
off-ramp loop (`35184399860900`, CNN `19374000`) and the ramps listed under Basemap ids as "not in
the candidates". The fix is a rule in the tiles split, not more ids: on every page zoom, every
freeway road (protomaps `kind` `highway`, or any link) inside a phase's 25 m corridor that runs
along one of the phase's CNN lines (within 25 m, directions within 45°: `LC.basemapParallelDeg`)
moves to `roads_lc` with that phase, whatever its `ref`. A road that only crosses the corridor
stays. A part nearer a kept segment's CNN line than a removed one stays, and a road whose refs
only kept segments carry (`I 280`, `CA 1`) never moves unless listed, so I-280 keeps the pieces
where the removed US-101 connectors merge into it. Listed ids still move inside the corridor
whatever their direction. `basemap-ids.json` is unchanged: no id is added or dropped.

**2. US-101 is cut at the Alemany interchange.** `19222002` (northbound US-101 from the Alemany
off-ramp at (−122.40375, 37.73009) to (−122.40797, 37.73862)) moves to the kept `us101-south`.
Northbound US-101 now ends where the removed `19221000` and the removed on-ramp `19200000` meet,
about 350 m north of the I-280 crossing; southbound still begins at (−122.40672, 37.73497), at the
crossing. Kept, `19222002` leads to no exit north of the Alemany off-ramp once `19221000` is gone;
traffic is not modelled, and nothing but freeway land depends on it.

#### CNN moves

| CNN        | From             | To            | Reason                                                                                   |
| ---------- | ---------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `19222002` | `us101-bayshore` | `us101-south` | Northbound US-101 through the Alemany interchange: the owner's cut is at the interchange |

**3. Six `us101-bayshore` lots move to the kept list.** With `19222002` kept, rule 2 of Freeway
land (within 30 m of a kept freeway, at least half within 60 m of it) puts six of the segment's
`in` lots on the kept `us101-south` list, as for the ten that moved there in the draft. `npm run
pipeline -- lesscars-freeway-land` over the amended catalog (dataset `2026-11-02-39fbf039`)
moves no `in` lot's nearest segment; three `out` lots already listed on `us101-south` (`5437002`,
`5438001`, `5375028`) now have it as their nearest segment, which changes no file. Distances and
shares are to `19222002`'s CNN line, on parcel outlines in EPSG:7131.

#### Parcel moves

| Parcel    | From             | To            | Area m² | FZP yield today | Reason                                                                                                                                     |
| --------- | ---------------- | ------------- | ------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `5692045` | `us101-bayshore` | `us101-south` | 6,894   | 220             | Beside the kept US-101 (us101-south, CNN 19222002, 0 m; 73% within 60 m of it): kept freeway land is never freed; moves to us101-south     |
| `5607047` | `us101-bayshore` | `us101-south` | 715     | 41              | Beside the kept US-101 (us101-south, CNN 19222002, 25.8 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south |
| `5693041` | `us101-bayshore` | `us101-south` | 647     | 20              | Beside the kept US-101 (us101-south, CNN 19222002, 26.4 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south |
| `5693038` | `us101-bayshore` | `us101-south` | 121     | 3               | Beside the kept US-101 (us101-south, CNN 19222002, 23.7 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south |
| `5693040` | `us101-bayshore` | `us101-south` | 53      | 1               | Beside the kept US-101 (us101-south, CNN 19222002, 21.4 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south |
| `5607043` | `us101-bayshore` | `us101-south` | 34      | 0               | Beside the kept US-101 (us101-south, CNN 19222002, 26.7 m; 100% within 60 m of it): kept freeway land is never freed; moves to us101-south |

**4. Totals amended.** `us101-bayshore`: 14 CNNs → 13; **32 in, 8.73 ha, FZP yield removed 2,188
→ 26 in, 7.88 ha, 1,903**; its `excluded` list is unchanged. `us101-south`: 28 CNNs → 29; 62
listed, 19.18 ha, 3,560 FZP homes → 68 listed, 20.02 ha, 3,845. All kept lists: 438 lots, 85.06
ha, 24,267 FZP homes → 444 lots, 85.91 ha, 24,552. The `us101-bayshore` phase's `segments` and
`freewayLand.parcels` in `plan.json` follow the amended catalog (13 CNNs, 26 parcels); its dates,
dependencies and `excluded` rows are unchanged. The freed-land and homes figures of the first v1.1
build (`docs/dev/lesscars.md`, "v1.1 live build") predate these errata.

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
