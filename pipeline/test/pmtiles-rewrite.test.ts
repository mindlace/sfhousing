import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { fromVectorTileJs } from '@maplibre/vt-pbf';
import Pbf from 'pbf';
import { PMTiles } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { which } from '../lib/exec';
import { NodeFileSource } from '../lib/pmtiles-file';
import { rewritePmtiles } from '../lib/pmtiles-rewrite';
import { MINI } from './helpers';

const MINI_BASEMAP = path.join(MINI, 'raw/protomaps-basemap.pmtiles');
const hasPmtiles = !!(await which('pmtiles'));

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Every tile over the archive's header bounds, decompressed, as z/x/y → base64. */
async function allTiles(file: string): Promise<Record<string, string>> {
  const pm = new PMTiles(new NodeFileSource(file));
  const h = await pm.getHeader();
  const out: Record<string, string> = {};
  for (let z = h.minZoom; z <= h.maxZoom; z++)
    for (let x = tileX(h.minLon, z); x <= tileX(h.maxLon, z); x++)
      for (let y = tileY(h.maxLat, z); y <= tileY(h.minLat, z); y++) {
        const t = await pm.getZxy(z, x, y);
        if (t) out[`${z}/${x}/${y}`] = Buffer.from(t.data).toString('base64');
      }
  return out;
}

describe.skipIf(!hasPmtiles)('rewritePmtiles', () => {
  it('an identity rewrite of the mini basemap reads back tile for tile', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sfh-pmrw-'));
    const tmp = path.join(dir, 'out.pmtiles');
    const r = await rewritePmtiles({
      input: MINI_BASEMAP,
      output: tmp,
      workDir: dir,
      transform: () => null,
      extraLayers: []
    });
    expect(r.changed).toBe(0);
    const want = await allTiles(MINI_BASEMAP);
    expect(r.tiles).toBe(Object.keys(want).length);
    expect(await allTiles(tmp)).toEqual(want);
  });

  it('writes the transformed tiles, keeps the header and metadata, and adds the extra layers', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sfh-pmrw-'));
    const tmp = path.join(dir, 'out.pmtiles');
    const r = await rewritePmtiles({
      input: MINI_BASEMAP,
      output: tmp,
      workDir: dir,
      transform: (z, x, y, mvt) => {
        if (z !== 15) return null;
        const t = new VectorTile(new Pbf(mvt));
        const roads = t.layers.roads;
        const extra = {
          version: roads.version,
          name: 'extra',
          extent: roads.extent,
          length: roads.length,
          feature: (i: number) => roads.feature(i)
        };
        return fromVectorTileJs({ layers: { ...t.layers, extra } });
      },
      extraLayers: [{ id: 'extra', fields: { lc_project: 'String' } }]
    });
    const before = await allTiles(MINI_BASEMAP);
    const after = await allTiles(tmp);
    const z15 = Object.keys(before).filter((k) => k.startsWith('15/'));
    expect(r.changed).toBe(z15.length);
    for (const k of z15) {
      const t = new VectorTile(new Pbf(Buffer.from(after[k], 'base64')));
      expect(Object.keys(t.layers), k).toContain('extra');
      expect(t.layers.extra.length).toBe(t.layers.roads.length);
    }
    const src = new PMTiles(new NodeFileSource(MINI_BASEMAP));
    const out = new PMTiles(new NodeFileSource(tmp));
    const [h0, h1] = [await src.getHeader(), await out.getHeader()];
    expect([h1.minZoom, h1.maxZoom, h1.tileType, h1.tileCompression]).toEqual([
      h0.minZoom,
      h0.maxZoom,
      h0.tileType,
      h0.tileCompression
    ]);
    for (const k of ['minLon', 'minLat', 'maxLon', 'maxLat'] as const)
      expect(h1[k], k).toBeCloseTo(h0[k], 6);
    const m0 = (await src.getMetadata()) as Record<string, unknown>;
    const m1 = (await out.getMetadata()) as Record<string, unknown>;
    const layers = (m: Record<string, unknown>) =>
      (m.vector_layers as { id: string }[]).map((l) => l.id);
    expect(layers(m1)).toEqual([...layers(m0), 'extra']);
    expect(m1.attribution).toBe(m0.attribution);
    expect(m1.name).toBe(m0.name);
  });
});
