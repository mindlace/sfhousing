import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '$lib/data/manifest';
import { decodeParcelChunk } from '$lib/data/parcel-chunk';
import { GRID_CHUNKS } from '$lib/plan/fixtures/grid-20x20';

const DIR = join(import.meta.dirname, 'data', 'fixture-1');
const read = (p: string): unknown => JSON.parse(readFileSync(join(DIR, p), 'utf8'));

describe('fixture-1', () => {
  it('has a manifest that parseManifest accepts', () => {
    const m = parseManifest(read('manifest.json'));
    expect(m.datasetVersion).toBe('fixture-1');
    expect(m.chunks.map((c) => c.cellId)).toEqual(['0_0', '1_0', '0_1', '1_1']);
  });

  it('decodes every chunk to its 100 grid records, inside its bbox', () => {
    const m = parseManifest(read('manifest.json'));
    m.chunks.forEach((c, k) => {
      expect(c.url).toBe(`/data/fixture-1/parcels/${c.cellId}.json`);
      expect(c.parcelCount).toBe(100);
      const recs = decodeParcelChunk(read(`parcels/${c.cellId}.json`));
      expect(recs).toHaveLength(100);
      expect(recs.map((r) => r.id)).toEqual(GRID_CHUNKS[k].records.map((r) => r.id));
      for (const r of recs) {
        const [lng, lat] = r.labelPoint;
        expect(lng >= c.bbox[0] && lng <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3]).toBe(
          true
        );
      }
    });
  });
});
