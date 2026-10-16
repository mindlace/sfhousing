# Mini fixture

Hand-made, SODA-shaped dataset that every SQL/chunk/tiles test and the e2e `fixture-0` are built from.
`make-fixture.ts` generates `raw/*.geojson` and `sources.lock.json` deterministically (fixed key order,
coordinates rounded to 1e-7 deg, so re-running yields byte-identical files):

```
npx tsx pipeline/test/fixtures/mini/make-fixture.ts
```

Shapes are in local metres from origin O = (-122.4195, 37.7600) in EPSG:7131, converted to lng/lat. Lot _i_
spans x in [10(i-1), 10i], y in [0, 30] unless stated. SODA conventions are mimicked: lower-case property
names, numbers as strings, booleans as JSON booleans, null properties omitted. The raw files are read by
`name` from `raw/`; their sha256 is verified against `sources.lock.json`. The lock also lists the committed
binary `protomaps-basemap` (`pmtiles extract` of build 20261009 over the fixture bbox) and `protomaps-fonts`
(Noto Sans glyph PBFs + OFL.txt at the pinned basemaps-assets commit); `make-fixture.ts` hashes them but does
not download them.

## Lots

| lot | id(s)                                            | parcel rows                                                     | land use rows                                                | buildings (Overture unless noted)                                                                | exercises                                             |
| --- | ------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 1   | `3512001`                                        | 1, Mission                                                      | RESIDENT, resunits 2, res 2000, totalcomm 0                  | b01 h=12 (`hs=0`)                                                                                | basic; colliding orphan target                        |
| 2   | map lot `3512002`                                | 3 condo rows `3512101/102/103`; `3512103` polygon 0.2 m shorter | RESIDENT, 6 units                                            | b02 h=15                                                                                         | condo dedupe (smallest blklot), sub-lot warning       |
| 3   | `8711023C`                                       | 1                                                               | MIXRES 4 u res 3000 comm 500; RETAIL/ENT 0 u res 0 comm 4000 | b03 no height, num_floors 0 -> `hs=3`                                                            | duplicate rows summed; default height                 |
| 4   | `0026T001A`                                      | 1                                                               | MIXED 3 units                                                | b04 no height, num_floors 4 -> `hs=2`                                                            | 9-char id; floors rule                                |
| 5   | `3512005`                                        | 1 MultiPolygon: A x[40,50] y[0,18], B x[40,50] y[22,30]         | RESIDENT 1 unit                                              | none                                                                                             | multipart ring order                                  |
| 6   | `3512006`                                        | polygon with hole x[53,57] y[10,20]                             | RESIDENT 2 units                                             | b06 courtyard h=9 (outer x[51,59] y[5,25], hole x[54,56] y[12,18]); besri 1.2 m x 1.2 m h=4      | holed parcel; sliver dropped                          |
| 7   | `3512007`                                        | 1                                                               | OPENSPACE 0 units                                            | none                                                                                             | ineligible                                            |
| 8   | `3512008` (x 70-80, straddles Mission/Noe at 75) | 1, analysis_neighborhood explicit Mission                       | landuse null, resunits 12, res 0, comm 0                     | none                                                                                             | `UNKNOWN` eligible; floor-area rule 3 (12x80)         |
| 9   | `3512009`                                        | 1, analysis_neighborhood null (lies in Noe Valley)              | none                                                         | none                                                                                             | `NONE` ineligible; rule 4 (0); nhood spatial fallback |
| 10  | `3512010`                                        | 1                                                               | RESIDENT 3 units                                             | b10 x[95,105] y[5,25] h=18 (shared with 11)                                                      | spanning building -> 2 pieces                         |
| 11  | `3512011`                                        | 1                                                               | RESIDENT 3 units                                             | (b10)                                                                                            |                                                       |
| 12  | `3512012`                                        | 1                                                               | none of its own                                              | none                                                                                             | orphan reassigned here                                |
| 13  | `3512013`                                        | 1                                                               | RESIDENT 5 units                                             | b13 no height/floors; DataSF `mblr` `SF3512013` identical polygon, `hgt_median_m` 21.3 -> `hs=1` | IoU height rule; floor-area rule 2                    |
| 14  | `3512014`                                        | 1                                                               | MIXRES 40 units res 30000 comm 5000                          | b14 h=60 (USGS Lidar)                                                                            | max height                                            |

Extras:

- Retired parcels (`active=false`): `3512099` inside lot 12 (land use RESIDENT 7 units, reassigned to lot 12);
  `3512098` inside lot 1 (land use RESIDENT 9 units, dropped since lot 1 has its own row).
- One active parcel with no `mapblklot` (`blklot` `3512097`, x[150,160]): dropped and counted.
- Overture extras: `bpier` x[20,40] y[-40,-32] h=6 (outside parcels, inside neighborhoods, kept);
  `bunder` in lot 1 with `is_underground=true` (dropped); `bmarin` y[400,410] (outside neighborhoods,
  dropped); `besri` in lot 6 (piece < 2 m2, dropped).
- Footprints: `mblr` `SF3512013` (lot 13, exactly b13), `SF3512001` on lot 1 with IoU < 0.5 vs b01 (unused),
  `CN0000001` right-of-way (ignored, `mblr` not `SF%`). As in live ynuv-fyni, `mblr` is `'SF'` + mapblklot and
  `sf16_bldgid` is a numeric-looking id (e.g. `201006.0000013`).
- Neighborhoods: `Mission` x[-60,75] y[-100,100]; `Noe Valley` x[75,220] y[-100,100].

## Derived row counts (`src_*` after normalisation)

| table               | rows | derivation                                                         |
| ------------------- | ---- | ------------------------------------------------------------------ |
| `src_parcels`       | 19   | 14 lots, lot 2 has 3 rows (16), + 2 retired + 1 null-id            |
| `src_landuse`       | 15   | lots 1, 2, 3 (x2), 4, 5, 6, 7, 8, 10, 11, 13, 14 = 13, + 2 orphans |
| `src_footprints`    | 3    | SF3512013, SF3512001, CN0000001                                    |
| `src_neighborhoods` | 2    | Mission, Noe Valley                                                |
| `src_overture`      | 12   | b01 b02 b03 b04 b06 b10 b13 b14 + bpier bunder bmarin besri        |

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
  tenths) and `tpd` `[13, 0]`: only departures count, and a trip's last stop (m2) is an arrival.
- V14 passes with the fixture profile: 8 stops, one heavy-rail stop (FX-1, "Fixture Station").
