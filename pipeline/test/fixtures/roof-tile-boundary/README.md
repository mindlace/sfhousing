# Roof tile-boundary fixture

Generated test-only PMTiles variant of the two canonical `b10` pieces in
`e2e/fixtures/data/fixture-0/buildings.pmtiles`. The script decodes their committed z15 tile
without relocating geometry or changing properties, then uses real tippecanoe clipping at z20.
Both pieces cross the horizontal edge between `20/167718/405350` and `20/167718/405351`.
Normal tile buffers are retained; generation proves each fragment has a clipped, distinct extent.
The canonical roof index/header/mesh remain valid and unchanged.

Regenerate after a canonical fixture update with tippecanoe and tippecanoe-decode on PATH:

```sh
npx tsx pipeline/test/fixtures/roof-tile-boundary/generate.ts
npx tsx pipeline/test/fixtures/roof-tile-boundary/generate.ts --check
```

`--check` regenerates in a temporary directory, verifies actual decoded north/south geometries,
properties and tile coordinates, and requires byte equality with this committed archive.
Only the native SimMap boundary test selects this archive. App fixtures, production tile zooms,
roof metadata and golden screenshots are unaffected.
