// Tagged `tools`: the tippecanoe/pmtiles tests skip with a message when the tool is absent.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BBOX, LIVE_PROFILE } from '../config';
import { which, run } from '../lib/exec';
import { runSql } from '../lib/sql';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PMTiles } from 'pmtiles';
import { LC, LESSCARS_BASEMAP_IDS_JSON } from '../lesscars-config';
import { openDuck } from '../lib/duck';
import { readBasemapIds } from '../lib/lesscars/basemap-ids';
import { splitPhasesOf, type SplitPhase } from '../lib/lesscars/basemap-split';
import { NodeFileSource } from '../lib/pmtiles-file';
import { installFonts, writeBasemap, writeBuildingsTiles, z12TileBytes } from '../steps/tiles';
import { MINI, miniDuck } from './helpers';

/** The mini I-80 (src_streets 4000), as fixture-0's plan.json has it. */
const MINI_I80: [number, number][] = [
  [-122.4194997, 37.7606757],
  [-122.4179109, 37.7606753]
];
const lngX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const latY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const hasTippecanoe = !!(await which('tippecanoe'));
const hasPmtiles = !!(await which('pmtiles'));
if (!hasTippecanoe) console.warn('[tools] tippecanoe not found: skipping buildings tiles test');
if (!hasPmtiles) console.warn('[tools] pmtiles not found: skipping pmtiles-based tests');

describe.skipIf(!hasTippecanoe || !hasPmtiles)('tiles [tools]', () => {
  it('writes buildings.pmtiles whose features carry typed parcelId/heightM/baseM/hs', async () => {
    const db = await miniDuck();
    await runSql(db);
    const out = mkdtempSync(join(tmpdir(), 'sfh-tiles-'));
    await writeBuildingsTiles(db, out, out);
    const meta = JSON.parse(
      (await run('pmtiles', ['show', join(out, 'buildings.pmtiles'), '--metadata'])).stdout
    );
    const layer = meta.vector_layers.find((l: { id: string }) => l.id === 'buildings');
    expect(layer.minzoom).toBeLessThanOrEqual(12);
    expect(layer.fields).toMatchObject({
      parcelId: 'String',
      heightM: 'Number',
      baseM: 'Number',
      hs: 'Number'
    });
    const stats = meta.tilestats.layers.find((l: { layer: string }) => l.layer === 'buildings');
    const parcelAttr = stats.attributes.find(
      (a: { attribute: string }) => a.attribute === 'parcelId'
    );
    expect(parcelAttr.type).toBe('string');
    expect(parcelAttr.values).toContain('0026T001A');
    const seq = readFileSync(join(out, 'buildings.geojsonseq'), 'utf8').trim().split('\n');
    const props = seq.map((l) => JSON.parse(l).properties);
    expect(props.some((p: Record<string, unknown>) => !('parcelId' in p))).toBe(true); // pier
    for (const p of props) {
      expect(Object.keys(p).every((k) => ['parcelId', 'heightM', 'baseM', 'hs'].includes(k))).toBe(
        true
      );
    }
  });
});

describe.skipIf(!hasPmtiles)('basemap [tools]', () => {
  const raw = join(MINI, 'raw/protomaps-basemap.pmtiles');
  it('without split phases copies the basemap byte for byte, z12 bytes within the budget', async () => {
    const out = mkdtempSync(join(tmpdir(), 'sfh-basemap-'));
    expect(await writeBasemap(raw, out, null)).toEqual({ tiles: 0, changed: 0 });
    expect(readFileSync(join(out, 'basemap.pmtiles')).equals(readFileSync(raw))).toBe(true);
    const bytes = await z12TileBytes(join(out, 'basemap.pmtiles'), BBOX);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(LIVE_PROFILE.z12BasemapMax);
  });

  it('with the fixture phase, the listed street inside the corridor is only in roads_lc', async () => {
    const ids = readBasemapIds(LESSCARS_BASEMAP_IDS_JSON.fixture)!;
    const db = await openDuck();
    let phases: SplitPhase[];
    try {
      phases = await splitPhasesOf(
        db,
        ids.phases.map((p) => ({ ...p, lines: [MINI_I80] })),
        LC.basemapBandM
      );
    } finally {
      db.close();
    }
    const out = mkdtempSync(join(tmpdir(), 'sfh-basemap-'));
    const work = mkdtempSync(join(tmpdir(), 'sfh-basemap-w-'));
    const r = await writeBasemap(raw, out, {
      phases,
      clipZooms: LC.basemapClipZooms,
      workDir: work
    });
    expect(r.changed).toBeGreaterThan(0);
    const [id] = ids.phases[0].ids;
    const meta = JSON.parse(
      (await run('pmtiles', ['show', join(out, 'basemap.pmtiles'), '--metadata'])).stdout
    );
    expect(meta.vector_layers.map((l: { id: string }) => l.id)).toContain('roads_lc');
    // The crossing of the listed street (Mission Street) with the mini I-80, at each page zoom.
    const pm = new PMTiles(new NodeFileSource(join(out, 'basemap.pmtiles')));
    const crossing: [number, number] = [-122.41929, 37.76067];
    // The listed id is in the mini archive at z14 and z15 only (protomaps merges Mission Street
    // under other ids below z14; the live phases rely on the freeway-road rule there).
    const src = new PMTiles(new NodeFileSource(raw));
    const zooms: number[] = [];
    for (const z of LC.basemapClipZooms) {
      const t = await src.getZxy(z, lngX(crossing[0], z), latY(crossing[1], z));
      const roads = t ? new VectorTile(new Pbf(new Uint8Array(t.data))).layers.roads : undefined;
      for (let i = 0; i < (roads?.length ?? 0); i++)
        if (roads!.feature(i).id === id && !zooms.includes(z)) zooms.push(z);
    }
    expect(zooms).toEqual([14, 15]);
    for (const z of zooms) {
      const [tx, ty] = [lngX(crossing[0], z), latY(crossing[1], z)];
      const t = await pm.getZxy(z, tx, ty);
      expect(t, `z${z}`).toBeDefined();
      const vt = new VectorTile(new Pbf(new Uint8Array(t!.data)));
      const lc = vt.layers.roads_lc;
      expect(lc, `z${z}`).toBeDefined();
      const moved = [...Array(lc.length).keys()]
        .map((i) => lc.feature(i))
        .filter((f) => f.id === id);
      expect(moved.length, `z${z}`).toBe(1);
      expect(moved[0].properties.lc_project).toBe('hwy');
      // what stays in roads under that id lies outside the corridor (25 m of the line)
      const roads = vt.layers.roads;
      let kept = 0;
      for (let i = 0; i < roads.length; i++) {
        const f = roads.feature(i);
        if (f.id !== id) continue;
        const g = f.toGeoJSON(tx, ty, z).geometry as
          | { type: 'LineString'; coordinates: [number, number][] }
          | { type: 'MultiLineString'; coordinates: [number, number][][] };
        const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
        for (const part of parts)
          for (let k = 1; k < part.length; k++) {
            const mid = [(part[k - 1][0] + part[k][0]) / 2, (part[k - 1][1] + part[k][1]) / 2];
            const dy = Math.abs(mid[1] - MINI_I80[0][1]) * 111_320;
            const within = mid[0] > MINI_I80[0][0] && mid[0] < MINI_I80[1][0] && dy < 20;
            expect(within, `z${z} roads part at ${mid}`).toBe(false);
            kept++;
          }
      }
      // the street runs on beyond the corridor: those parts keep the id in roads
      expect(kept, `z${z}`).toBeGreaterThan(0);
    }
  });
});

describe('fonts', () => {
  it('renames stacks without spaces and the glyphs template resolves to existing files', () => {
    const out = mkdtempSync(join(tmpdir(), 'sfh-fonts-'));
    const stacks = installFonts(join(MINI, 'raw/protomaps-fonts'), out);
    expect(stacks.sort()).toEqual(['NotoSans-Italic', 'NotoSans-Medium', 'NotoSans-Regular']);
    for (const s of readdirSync(join(out, 'fonts'))) expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
    const template = 'fonts/{fontstack}/{range}.pbf';
    expect(
      existsSync(
        join(out, template.replace('{fontstack}', 'NotoSans-Regular').replace('{range}', '0-255'))
      )
    ).toBe(true);
    // OFL-1.1 redistribution condition: the licence travels with the glyphs (ruling R7).
    expect(readFileSync(join(out, 'fonts/OFL.txt'), 'utf8')).toBe(
      readFileSync(join(MINI, 'raw/protomaps-fonts/OFL.txt'), 'utf8')
    );
  });
});
