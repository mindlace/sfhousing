// Tagged `tools`: the tippecanoe/pmtiles tests skip with a message when the tool is absent.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BBOX, LIVE_PROFILE } from '../config';
import { which, run } from '../lib/exec';
import { runSql } from '../lib/sql';
import { copyBasemap, installFonts, writeBuildingsTiles, z12TileBytes } from '../steps/tiles';
import { MINI, miniDuck } from './helpers';

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
  it('copies the basemap and measures z12 tile bytes within the budget', async () => {
    const out = mkdtempSync(join(tmpdir(), 'sfh-basemap-'));
    copyBasemap(join(MINI, 'raw/protomaps-basemap.pmtiles'), out);
    const bytes = await z12TileBytes(join(out, 'basemap.pmtiles'), BBOX);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(LIVE_PROFILE.z12BasemapMax);
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
  });
});
