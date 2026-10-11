// Each invariant fails on a mutated fixture.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PROFILE } from '../config';
import { checkDataset } from '../steps/check';
import { fixture } from '../steps/fixture';

let base: string;
let counts: Record<string, number>;
beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'sfh-inv-'));
  expect(await fixture({ outDir: base, skipTiles: true })).toBe(0);
  counts = JSON.parse(readFileSync(join(base, 'report.json'), 'utf8')).counts;
});
const copy = () => {
  const d = mkdtempSync(join(tmpdir(), 'sfh-inv-m-'));
  cpSync(base, d, { recursive: true });
  return d;
};
const failed = async (dir: string, c = counts, extra: object = {}) =>
  (await checkDataset(dir, FIXTURE_PROFILE, { counts: c, reencodeIdentical: true, ...extra }))
    .filter((r) => !r.ok)
    .map((r) => r.id);
const editChunk = (dir: string, f: (c: Record<string, unknown>) => void) => {
  const p = join(dir, 'parcels', readdirSync(join(dir, 'parcels'))[0]);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  f(c);
  writeFileSync(p, JSON.stringify(c));
};

describe('invariants', () => {
  it('all pass on the unmutated fixture', async () => {
    expect(await failed(base)).toEqual([]);
  });
  it('V1 fails when units drift', async () => {
    const d = copy();
    editChunk(d, (c) => {
      (c.units as number[])[0] += 50;
    });
    expect(await failed(d)).toContain('V1');
  });
  it('V2 fails when parcel count differs from source', async () => {
    expect(
      await failed(base, {
        ...counts,
        'parcels.distinct_active_ids': counts['parcels.emitted'] + 1
      })
    ).toContain('V2');
  });
  it('V3 fails on low land-use match', async () => {
    expect(await failed(base, { ...counts, 'landuse.matched_parcels': 1 })).toContain('V3');
  });
  it('V4 fails on an unknown landuse value', async () => {
    expect(await failed(base, { ...counts, 'landuse.unknown_values': 1 })).toContain('V4');
  });
  it('V5 fails on low height coverage with the fallback hint', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, {
      counts: { ...counts, 'buildings.hs3': counts['buildings.kept'] },
      reencodeIdentical: true
    });
    expect(r.find((x) => x.id === 'V5')!.detail).toMatch(
      /^height coverage .*%: set config\.renderSource='datasf'$/
    );
  });
  it('V6 fails when piece area lacks parcelId', async () => {
    expect(await failed(base, { ...counts, 'pieces.area_with_parcel_m2': 0 })).toContain('V6');
  });
  it('V7 fails on an unknown neighborhood', async () => {
    const d = copy();
    editChunk(d, (c) => {
      (c.dict as { neighborhood: string[] }).neighborhood[0] = 'Atlantis';
    });
    expect(await failed(d)).toContain('V7');
  });
  it('V8 fails when a parcel appears in two chunks', async () => {
    const d = copy();
    const p = readdirSync(join(d, 'parcels'))[0];
    cpSync(join(d, 'parcels', p), join(d, 'parcels', 'dup.json'));
    // The checker reads chunks from the manifest, so list the duplicate there too.
    const m = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
    m.chunks.push({
      ...m.chunks[0],
      cellId: '999_999',
      url: m.chunks[0].url.replace(/[^/]+\.json$/, 'dup.json')
    });
    writeFileSync(join(d, 'manifest.json'), JSON.stringify(m));
    expect(await failed(d)).toContain('V8');
  });
  it('V8 fails on a duplicated id even when Σ parcelCount still matches', async () => {
    const d = copy();
    // Same count and columns: record 1 takes record 0's id, so one id is doubled, one is missing.
    editChunk(d, (c) => {
      const ids = c.id as string[];
      ids[1] = ids[0];
    });
    const r = await checkDataset(d, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    const v8 = r.find((x) => x.id === 'V8')!;
    expect(v8.ok).toBe(false);
    expect(v8.detail).toMatch(/more than one chunk/);
    expect(v8.detail).toMatch(/13 distinct ids ≠ V2 14/);
    expect(v8.detail).not.toMatch(/Σ parcelCount/);
  });
  it('V7 fails on an empty polygon', async () => {
    const d = copy();
    editChunk(d, (c) => {
      const rings = c.rings as number[][];
      const nv = rings[0].reduce((a, b) => a + b, 0);
      rings[0] = [];
      (c.xy as number[]).splice(0, 2 * nv); // record 0's vertices come first
    });
    const r = await checkDataset(d, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    const v7 = r.find((x) => x.id === 'V7')!;
    expect(v7.ok).toBe(false);
    expect(v7.detail).toMatch(/1 empty polygon/);
    expect(r.find((x) => x.id === 'V8')!.ok).toBe(true); // still decodes consistently
  });
  it('V9 fails on an oversized chunk', async () => {
    expect(
      (
        await checkDataset(
          base,
          { ...FIXTURE_PROFILE, maxChunkParcels: 1 },
          { counts, reencodeIdentical: true }
        )
      ).find((r) => r.id === 'V9')!.ok
    ).toBe(false);
  });
  it('V10 fails when max height is out of range', async () => {
    const d = copy();
    editChunk(d, (c) => {
      (c.height as number[])[0] = 500;
    });
    expect(await failed(d)).toContain('V10');
  });
  it('V11 fails on an oversized manifest budget', async () => {
    expect(
      (
        await checkDataset(
          base,
          { ...FIXTURE_PROFILE, manifestMax: 10 },
          { counts, reencodeIdentical: true }
        )
      ).find((r) => r.id === 'V11')!.ok
    ).toBe(false);
  });
  it('V12 fails when re-encoding differs', async () => {
    expect(await failed(base, counts, { reencodeIdentical: false })).toContain('V12');
  });
  it('V13 is reported as enforced at upload', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    expect(r.find((x) => x.id === 'V13')).toMatchObject({ ok: true, detail: 'enforced at upload' });
  });
});
