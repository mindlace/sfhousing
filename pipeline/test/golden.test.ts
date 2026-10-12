import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { parseManifest } from '../../src/lib/data/manifest';
import { fixture } from '../steps/fixture';
import { which } from '../lib/exec';
import { MINI } from './helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const skipTiles = !(await which('tippecanoe'));
const files = (d: string) =>
  readdirSync(d, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(d.length + 1))
    .sort();
const golden = join(MINI, 'golden');
const COMPARED = (f: string) =>
  f.startsWith('parcels/') ||
  f.startsWith('roofs/') ||
  f === 'neighborhoods.geojson' ||
  f === 'manifest.json' ||
  f === 'report.json';
const stripBuiltAt = (s: string) => s.replace(/"builtAt":"[^"]*"/, '"builtAt":""');

describe('pipeline fixture', () => {
  it('matches the golden byte for byte and is identical across two builds (V12)', async () => {
    const a = mkdtempSync(join(tmpdir(), 'sfh-fx-a-'));
    const b = mkdtempSync(join(tmpdir(), 'sfh-fx-b-'));
    expect(await fixture({ outDir: a, skipTiles })).toBe(0);
    expect(await fixture({ outDir: b, skipTiles })).toBe(0);
    const fa = files(a).filter(COMPARED);
    expect(fa).toEqual(files(golden).filter(COMPARED));
    for (const f of fa) {
      if (f.endsWith('.bin')) {
        expect(readFileSync(join(a, f))).toEqual(readFileSync(join(golden, f)));
        expect(readFileSync(join(a, f))).toEqual(readFileSync(join(b, f)));
        continue;
      }
      const ga = stripBuiltAt(readFileSync(join(a, f), 'utf8'));
      expect(ga, f).toBe(stripBuiltAt(readFileSync(join(golden, f), 'utf8')));
      expect(ga, f).toBe(stripBuiltAt(readFileSync(join(b, f), 'utf8')));
    }
    const m = parseManifest(JSON.parse(readFileSync(join(a, 'manifest.json'), 'utf8')));
    const ids = m.chunks.flatMap((c) =>
      decodeParcelChunk(readFileSync(join(a, c.url.replace('/data/fixture-0/', '')), 'utf8')).map(
        (r) => r.id
      )
    );
    // Spec §4.12: the report states the ODbL offer for the derived artifacts.
    expect(JSON.parse(readFileSync(join(a, 'report.json'), 'utf8')).license).toEqual({
      artifacts: ['basemap.pmtiles', 'buildings.pmtiles', 'parcels/*', 'roofs/*'],
      derivedData: 'ODbL-1.0',
      notice:
        'Derived data files under /data/ that incorporate OpenStreetMap or Overture data are made available under the ODbL 1.0.'
    });
    expect(ids).toContain('0026T001A');
    expect(ids).toContain('8711023C');
    // besri's piece is a dropped sliver but the building is kept, so Esri contributes too.
    expect(m.sources.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        'overture:OpenStreetMap',
        'overture:USGS Lidar',
        'overture:Microsoft ML Buildings',
        'overture:Esri Community Maps'
      ])
    );
  });

  it('e2e/fixtures/data/fixture-0 is the committed output of `pipeline fixture`', () => {
    const e2e = 'e2e/fixtures/data/fixture-0';
    for (const f of files(golden).filter(COMPARED)) {
      expect(readFileSync(join(e2e, f), 'utf8'), f).toBe(readFileSync(join(golden, f), 'utf8'));
    }
  });
});

it('generated mini includes a modelled multi-parcel building and explicit fallback outcomes', () => {
  const manifest = JSON.parse(readFileSync(join(golden, 'manifest.json'), 'utf8'));
  expect(manifest.buildingRoofs?.schemaVersion).toBe(1);
  const audit = JSON.parse(readFileSync(join(golden, 'roofs/audit.json'), 'utf8'));
  expect(audit.buildings.find((b: { buildingId: string }) => b.buildingId === 'b10')).toMatchObject(
    {
      outcome: 'fully_modelled',
      pieceIds: expect.arrayContaining([expect.any(String), expect.any(String)])
    }
  );
  expect(audit.pieces.some((p: { outcome: string }) => p.outcome === 'footprint_fallback')).toBe(
    true
  );
});
