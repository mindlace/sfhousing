# Mini fixture

Hand-made, SODA-shaped dataset that every SQL/chunk/tiles test and the e2e `fixture-0` are built from.
`make-fixture.ts` generates `raw/*.geojson`, `raw/*.csv` and `sources.lock.json` deterministically (fixed
key and row order, coordinates rounded to 1e-7 deg, so re-running yields byte-identical files):

```
npx tsx pipeline/test/fixtures/mini/make-fixture.ts
```

Shapes are in local metres from origin O = (-122.4195, 37.7600) in EPSG:7131, converted to lng/lat. Lot _i_
spans x in [10(i-1), 10i], y in [0, 30] unless stated; lots 15–17 are placed against the shoreline at
x = E (below). SODA conventions are mimicked: lower-case property
names, numbers as strings, booleans as JSON booleans, null properties omitted. The two CSV sources follow SODA
CSV export: a quoted header, every value quoted, null as an empty unquoted field, booleans `"true"`/`"false"`,
dates `"2024-06-30T00:00:00.000"`, and numeric roll columns as `"2.0"` (`closed_roll_year` and
`year_property_built` as plain integers, as live `wv5m-vpq2` writes them). The raw files are read by
`name` from `raw/`; their sha256 is verified against `sources.lock.json`. The lock also lists the committed
binary `protomaps-basemap` (`pmtiles extract` of build 20261009 over the fixture bbox) and `protomaps-fonts`
(Noto Sans glyph PBFs + OFL.txt at the pinned basemaps-assets commit); `make-fixture.ts` hashes them but does
not download them.

## Lots

| lot | id(s)                                            | parcel rows                                                     | land use rows                                                | buildings (Overture unless noted)                                                                | exercises                                                                              | zoning    | height district                | roll (use/class, built, stories, units, area, land/impr)                                 |
| --- | ------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | `3512001`                                        | 1, Mission                                                      | RESIDENT, resunits 2, res 2000, totalcomm 0                  | b01 h=12 (`hs=0`)                                                                                | basic; colliding orphan target                                                         | RH-2      | `40//65-R-4`                   | SRES/F 1912, 2 st, 2 u, 2000 sf, 400k/300k; 2025+2024                                    |
| 2   | map lot `3512002`                                | 3 condo rows `3512101/102/103`; `3512103` polygon 0.2 m shorter | RESIDENT, 6 units                                            | b02 h=15                                                                                         | condo dedupe (smallest blklot), sub-lot warning                                        | RH-2 (x3) | `40//65-R-4`                   | 3 condo rows `3512101/102/103` SRES/Z 1975, 3 st, 1 u, 800 sf, 200k/300k each; 2025+2024 |
| 3   | `8711023C`                                       | 1                                                               | MIXRES 4 u res 3000 comm 500; RETAIL/ENT 0 u res 0 comm 4000 | b03 no height, num_floors 0 -> `hs=3`                                                            | duplicate rows summed; default height                                                  | NCT       | `40//65-R-4`                   | `8711023C` COMH/H1 hotel 1920, 3 st, 5000 u, 3000 sf, 500k/500k; 2025+2023 (no 2024)     |
| 4   | `0026T001A`                                      | 1                                                               | MIXED 3 units                                                | b04 no height, num_floors 4 -> `hs=2`                                                            | 9-char id; floors rule                                                                 | NC-1      | `40//65-R-4`                   | `0026T001A` MRES/A 1925, 3 st, 3 u (2024: 900 u), 3000 sf, 300k/600k; 2025+2024+2023     |
| 5   | `3512005`                                        | 1 MultiPolygon: A x[40,50] y[0,18], B x[40,50] y[22,30]         | RESIDENT 1 unit                                              | none                                                                                             | multipart ring order                                                                   | RH-1      | 40% `40//65-R-4`, 60% `65-X`   | SRES/D 1950 (2024: `"0"`), 1 st, 1 u, 1000 sf, 300k/100k; 2025+2024                      |
| 6   | `3512006`                                        | polygon with hole x[53,57] y[10,20]                             | RESIDENT 2 units                                             | b06 courtyard h=9 (outer x[51,59] y[5,25], hole x[54,56] y[12,18]); besri 1.2 m x 1.2 m h=4      | holed parcel; sliver dropped                                                           | RM-1      | `65-X`                         | MRES/F 1940, 2 st, 2 u, 2200 sf, 350k/250k; 2025+2024                                    |
| 7   | `3512007`                                        | 1                                                               | OPENSPACE 0 units                                            | none                                                                                             | ineligible                                                                             | P         | `65-X`                         | MISC/V built empty, 0 st, 0 u, 0 sf, 100k/0; 2025+2024                                   |
| 8   | `3512008` (x 70-80, straddles Mission/Noe at 75) | 1, analysis_neighborhood explicit Mission                       | landuse null, resunits 12, res 0, comm 0                     | none                                                                                             | `UNKNOWN` eligible; floor-area rule 3 (12x80)                                          | RH-2      | `65-X`                         | MRES/A 1960, 4 st, 12 u, 10000 sf, 800k/1.2M; 2025+2024                                  |
| 9   | `3512009`                                        | 1, analysis_neighborhood null (lies in Noe Valley)              | none                                                         | none                                                                                             | `NONE` ineligible; rule 4 (0); nhood spatial fallback                                  | P         | `65-X`                         | none                                                                                     |
| 10  | `3512010`                                        | 1                                                               | RESIDENT 3 units                                             | b10 x[95,105] y[5,25] h=18 (shared with 11)                                                      | spanning building -> 2 pieces                                                          | RH-3      | 70% `65-X`, 30% `85//120-R-4`  | MRES/F 1930, 2 st, 3 u, 3000 sf, 400k/400k; 2025+2024                                    |
| 11  | `3512011`                                        | 1                                                               | RESIDENT 3 units                                             | (b10)                                                                                            |                                                                                        | RH-3      | `85//120-R-4`                  | GOVT/X status `N` 1955, 3 st, 0 u, 6000 sf, 0/0; 2025+2024                               |
| 12  | `3512012`                                        | 1                                                               | none of its own                                              | none                                                                                             | orphan reassigned here                                                                 | P         | `Special Height District`      | none of its own (retired `3512099`)                                                      |
| 13  | `3512013`                                        | 1                                                               | RESIDENT 5 units                                             | b13 no height/floors; DataSF `mblr` `SF3512013` identical polygon, `hgt_median_m` 21.3 -> `hs=1` | IoU height rule; floor-area rule 2                                                     | C-3-O     | `120/400-R-2  //  140/520-R-2` | MRES/A 1970, 3 st, 5 u, 5000 sf, 500k/500k; 2024 only                                    |
| 14  | `3512014`                                        | 1                                                               | MIXRES 40 units res 30000 comm 5000                          | b14 h=60 (USGS Lidar)                                                                            | max height                                                                             | C-3-G     | `120/400//120/650-R4`          | MRES/A 2015, 6 st, 40 u, 30000 sf, 3M/9M; 2025+2024                                      |
| 15  | `3512015` x[E−30, E+10]                          | 1, Bayview Hunters Point                                        | VACANT 0 units                                               | bbay x[E+2, E+8] y[10, 20] h=6, on the water side                                                | shoreline crossing: `clipped` to 2 dry pieces (land part and bbay), ~960 m²            | RH-2      | `65-X`                         | MISC/V built empty, 0 st, 0 u, 0 sf, 100k/0; 2025+2024                                   |
| 16  | `3512016` x[E+20, E+40]                          | 1, Bayview Hunters Point                                        | VACANT 0 units                                               | none                                                                                             | wholly in the water: `underwater`, outline and 600 m² kept, ineligible, its homes kept | RH-2      | `65-X`                         | SRES/D 1950, 1 st, 2 u, 1200 sf, 300k/100k; 2025+2024                                    |
| 17  | `3512017` x[E−30, E+0.1] y[40, 70]               | 1, Bayview Hunters Point                                        | VACANT 0 units                                               | none                                                                                             | grazes the shoreline (3 m² < 5 m²): `jitter`, geometry kept                            | RH-2      | `65-X`                         | MISC/V built empty, 0 st, 0 u, 0 sf, 100k/0; 2025+2024                                   |

Shoreline: the basemap extract has z15 `earth` in tile columns 5240 and 5241 only, so the east edge of
tile 5241 (lng −122.40966796875) is the fixture's shoreline: east of it there is no land. `E` is that
meridian's local x at y = 15 m, computed in `make-fixture.ts` through the projection (≈ 866.4 m). All three
shoreline lots lie outside the tiles read in part or whole, so `land.outside_tiles` is 3.

Extras:

- Retired parcels (`active=false`): `3512099` inside lot 12 (land use RESIDENT 7 units, reassigned to lot 12);
  `3512098` inside lot 1 (land use RESIDENT 9 units, dropped since lot 1 has its own row).
- Retired parcel `3512096` x[E+3, E+7] y[22, 28] (`date_rec_drop` 2024-06-30, no land use or roll row):
  its centroid lies in lot 15's water part, so lineage matches it to lot 15 on the original polygon.
- One active parcel with no `mapblklot` (`blklot` `3512097`, x[150,160]): dropped and counted.
- Overture extras: `bpier` x[20,40] y[-40,-32] h=6 (outside parcels, inside neighborhoods, kept);
  `bunder` in lot 1 with `is_underground=true` (dropped); `bmarin` y[400,410] (outside neighborhoods,
  dropped); `besri` in lot 6 (piece < 2 m2, dropped); `bbay` on lot 15's water side (its dry piece).
- Footprints: `mblr` `SF3512013` (lot 13, exactly b13), `SF3512001` on lot 1 with IoU < 0.5 vs b01 (unused),
  `CN0000001` right-of-way (ignored, `mblr` not `SF%`). As in live ynuv-fyni, `mblr` is `'SF'` + mapblklot and
  `sf16_bldgid` is a numeric-looking id (e.g. `201006.0000013`).
- Neighborhoods: `Mission` x[-60,75] y[-100,100]; `Noe Valley` x[75,220] y[-100,100]; `Bayview Hunters
Point` x[E−50, E+50] y[-100,100].
- Height and bulk districts (`datasf-height-bulk`, h9wh-cg3m; `height`, `gen_hght` as strings), all
  y[-100,100]: x[-60,44) `40//65-R-4` `"65"`; [44,97) `65-X` `"65"`; [97,110) `85//120-R-4` `"120"`;
  [110,120) `Special Height District` `"4444"`; [120,130) `120/400-R-2  //  140/520-R-2` `"520"`; [130,140)
  `120/400//120/650-R4` `"650"`; [E−50, E+50) `65-X` `"65"`. The null-id parcel (x[150,160]) lies in no
  district.
- Parcel attributes (`datasf-parcel-attrs`, acdm-wktn CSV): one row per parcel row above, in the same order,
  with the zoning in the lot table; retired rows `RH-2`, null-id row `P`. `centroid_latitude`/`_longitude`
  are each row's polygon centroid through the same projection. `date_rec_drop` is `2024-06-30` for `3512099`
  and `3512096`, and `2019-03-01` for `3512098`; `date_rec_add` is empty throughout (mostly empty in live acdm-wktn).
  Lot 4 is `NC-1` (ruling C2): an NC lot inside R-4 that is not Local Program, so its pre-FZP cap (4)
  differs from its FZP cap (none, form-based density).
- Assessor roll (`datasf-assessor-roll`, wv5m-vpq2 CSV): roll years 2025, 2024, then 2023, `status_code`
  `NA` unless stated in the lot table. Lots 9 and 12 have no rows; lot 13 has no 2025 row; retired `3512099`
  (centroid in lot 12) has a 2024 row only: MRES/A 1910, 2 st, 7 u, 5600 sf, 300k/200k. Lot 2's condos are
  built 1975, not 1985 as in scenario-data spec §4.11 (ruled), so the condo rule of the rent-control
  exclusion is exercised.
- Roll year 2023 has rows for lots 3 and 4 only: they carry the RA1 units cases of scenario-data spec
  §4.11. Lot 3's 5,000 units (2023 and 2025) exceed its capacity of 90 (300 m² × 3 stories / 10 m²) in
  every year, so `sd.roll.units-capacity` replaces both with its LUDB 4 (bit 3), and its missing 2024 is
  carried from 2023 (`sd.roll.year-gap`, bits 3 and 5); T11 `existingUnits` is 4. Lot 4's 900 in 2024
  fails the same rule, and the tie between 2023 and 2025 goes to the earlier year (3); the spike rule
  never sees it. `scenario.units.total` is 72 (`FIXTURE_PROFILE.scenarioUnitsRange`): 70 plus underwater lot
  16's 2.

## Derived row counts (`src_*` after normalisation)

| table               | rows | derivation                                                                                                  |
| ------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `src_parcels`       | 23   | 17 lots, lot 2 has 3 rows (19), + 3 retired + 1 null-id                                                     |
| `src_landuse`       | 18   | lots 1, 2, 3 (x2), 4, 5, 6, 7, 8, 10, 11, 13, 14, 15, 16, 17 = 16, + 2 orphans                              |
| `src_footprints`    | 3    | SF3512013, SF3512001, CN0000001                                                                             |
| `src_neighborhoods` | 3    | Bayview Hunters Point, Mission, Noe Valley                                                                  |
| `src_overture`      | 13   | b01 b02 b03 b04 b06 b10 b13 b14 + bpier bunder bmarin besri bbay                                            |
| `src_height_bulk`   | 7    | the seven districts                                                                                         |
| `src_parcel_attrs`  | 23   | as `src_parcels`                                                                                            |
| `src_roll`          | 35   | 2025: 16 (lots 1, 2 x3, 3–8, 10, 11, 14–17); 2024: those less 3, + 13 + `3512099` = 17; 2023: lots 3, 4 = 2 |

## Transit

`make-fixture.ts` also writes three loose GTFS feeds, `raw/gtfs-{muni,bart,caltrain}/*.txt` (calendar,
calendar_dates, routes, stops, stop_times, trips), each one lock entry of six files. Every trip runs on the
weekday service `WKDY` (2026-09-01..2026-12-31) and calls at its stops one minute apart. Stop positions are in
local metres from O. The lock's newest `retrievedAt` is 2026-10-10, so the build targets Tuesday 2026-10-13.

| feed     | stops (local m)                                                                                                 | routes and trips                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muni     | m1 (0,-50), m2 (0,-250), m3 (170,-50), m4 "Metro Fixture Station/Downtown" (100,100), m5 (300,300), mx (3000,0) | 22 bus m1-m2 both ways, every 10 min from 07:00 (12 trips) + 12:00; 14 bus m3-m1-mx every 15 min (8); N light rail m4-m5 every 12 min (10)                           |
| BART     | station FXST "Fixture Station" (120,110), platform FX-1 under it, FAR (6000,0)                                  | 7 "Red-S" FX-1-FAR every 15 min from 07:00 (8); bus bridge BB-A (route_type 3) is dropped                                                                            |
| Caltrain | station fixture_ct (-40,-80), platforms 70011 / 70012 under it, far_ct (0,-8000), far_ct_n (0,8000)             | 77119 Local Weekday, 70012-far_ct and far_ct-70011-far_ct_n, 40 trips each way every 25 min from 05:00: 80/day at the station, 5 per direction 07:00-09:00 (2.5 tph) |

Expected in `golden/transit.json`:

- 8 stops: m1 m2 m3 m4 m5 FX-1 70011 70012. mx, FAR, far_ct and far_ct_n lie more than 1 km outside the
  neighborhoods and are clipped.
- `calendar_dates` removes Muni's 2026-10-13, so Muni counts 2026-10-20 while BART and Caltrain count
  2026-10-13.
- m4 and FX-1 share a `place` (within 150 m, both named "Fixture Station").
- Pattern `muni:22:0:0`: 12 trips in the two-hour peak (6 tph, `tph` `[60, 0]` on the wire, which stores
  tenths) and `tpd` `[13, 13]`: peak `tph` counts departures only, so a trip's last stop (m2) adds
  none, while `tpd` counts every train serving the stop.
- V14 passes with the fixture profile: 8 stops, one heavy-rail stop (FX-1, "Fixture Station").
