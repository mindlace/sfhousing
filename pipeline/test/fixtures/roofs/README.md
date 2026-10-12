# Roof input fixtures

The acquisition test defines a tiny EPT tree with an external hierarchy page, parent and
child nodes, and an excluded node. All bodies are synthetic. The Python tests create tiny
LAS 1.4 / point-format-6 LAZ files in temporary directories, with deliberately uncropped
original point positions; they retain original source ordinals after buffered cropping.
No real point cloud or aerial pixels are distributed in this fixture.

The three live coverage bounds are recorded in `pipeline/roofs/source-config.json`.
Source acquisition archives original EPT metadata, hierarchy pages and LAZ nodes without
rewriting their bytes. Aerial tiles remain disabled until permission is confirmed; exact
512-pixel XYZ zoom-19 tile transforms and individual tile coverage are retained when enabled.

## Real USGS cases

`wholefoods.laz`, `corner-cap.laz`, and `protected-pitch.laz` are small extracts derived
from public-domain USGS `CA_SanFrancisco_1_B23` LiDAR, spring 2023; exact acquisition
dates and vertical datum remain unknown. Source: [USGS EPT collection](https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/ept.json).
Credit: USGS 3D Elevation Program. `real-cases.json` records file SHA-256, point counts,
upstream research-cloud hashes, complete footprints and extraction provenance. Each
fixture's own SHA and original LAZ point ordinal define its production split identity.
The earlier research NPY clouds did not preserve original EPT ordinals; no original
EPT identity is claimed for these derived fixtures. Each extract contains class-1
returns inside the footprint and class-2 support within 50 m, in EPSG:7131 metres.
Footprints derive from Overture and retain its ODbL obligations.

`original-cap.json` preserves the historical a96b2333 high-cap reconstruction plus its
research output hash. Its historical split differs from the production SHA/ordinal
split. It tests actual geometric cap detection, not reconstruction determinism across
those different splits. New pinned reconstruction of the fixture has no unstable cap.

No real aerial pixels are distributed. The RGB conjunction test constructs synthetic
pixels explicitly; they are algorithm evidence, not independent imagery ground truth.
The optional local research regression uses original cached aerials only when
`ROOF_LOCAL_AERIAL_RESEARCH=1` is set, with `ROOF_LOCAL_AERIAL_DIR` optionally naming
the local archive. It does not establish permission for published derivation and does
not enable aerials in the source config. It requires Whole Foods lower area >800 m²,
upper area >150 m², masked max <13 m and unmasked diagnostic max >18 m.

Salesforce's versioned authored loft is in `pipeline/roofs/overrides/salesforce.json`.
Its production footprint hash was verified directly against the locked Overture parquet.
The closed union preserves the approved above-ground silhouette; adding unseen bottoms
and unioning authored parts does not cure its insufficient footprint coverage. The
strict checks therefore retain its candidate evidence and a `roof_coverage_low` fallback.
