// Each invariant fails on a mutated fixture.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeScenarioPayload,
  encodeScenarioPayload,
  type ScenarioParcels
} from '../../src/lib/data/scenario-codec';
import { encodeTransit } from '../../src/lib/data/transit-codec';
import { tinyNetwork } from '../../src/lib/data/fixtures/transit-tiny';
import { FIXTURE_PROFILE } from '../config';
import { checkDataset, maxOf } from '../steps/check';
import { fixture } from '../steps/fixture';
import { PARCELS_BIN } from '../lib/scenario-files';

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
const result = async (dir: string, id: string, c = counts) =>
  (await checkDataset(dir, FIXTURE_PROFILE, { counts: c, reencodeIdentical: true })).find(
    (r) => r.id === id
  )!;
/** Decode the copy's parcels.bin, mutate the decoded payload, re-encode and write it back. */
const editScenario = (dir: string, f: (p: ScenarioParcels) => void) => {
  const file = join(dir, PARCELS_BIN);
  const p = decodeScenarioPayload(new Uint8Array(inflateRawSync(readFileSync(file))));
  f(p);
  writeFileSync(file, deflateRawSync(encodeScenarioPayload(p)));
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
  it('V14 passes on a small valid network', async () => {
    const d = copy();
    writeFileSync(join(d, 'transit.json'), encodeTransit(tinyNetwork()));
    const profile = {
      ...FIXTURE_PROFILE,
      transitMinStops: 2,
      transitHeavyRailStations: ['Fixture Station']
    };
    const r = await checkDataset(d, profile, { counts, reencodeIdentical: true });
    expect(r.find((x) => x.id === 'V14')).toMatchObject({
      ok: true,
      detail: '2 stops, 2 patterns, 1 heavy-rail stops'
    });
  });
  it('V14 fails when a named station has no heavy-rail service', async () => {
    const d = copy();
    writeFileSync(join(d, 'transit.json'), encodeTransit(tinyNetwork()));
    const profile = {
      ...FIXTURE_PROFILE,
      transitMinStops: 2,
      transitHeavyRailStations: ['Embarcadero']
    };
    const v14 = (await checkDataset(d, profile, { counts, reencodeIdentical: true })).find(
      (x) => x.id === 'V14'
    )!;
    expect(v14.ok).toBe(false);
    expect(v14.detail).toMatch(/no heavy-rail service at Embarcadero/);
  });
  it('V14 fails when the manifest has no transit', async () => {
    const d = copy();
    const m = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
    delete m.transit;
    writeFileSync(join(d, 'manifest.json'), JSON.stringify(m));
    const v14 = (await checkDataset(d, FIXTURE_PROFILE, { counts, reencodeIdentical: true })).find(
      (x) => x.id === 'V14'
    )!;
    expect(v14.ok).toBe(false);
    expect(v14.detail).toMatch(/manifest has no transit/);
  });
  it('V14 fails on too few stops or an undecodable transit.json', async () => {
    const d = copy();
    writeFileSync(join(d, 'transit.json'), encodeTransit(tinyNetwork()));
    expect(await failed(d)).toContain('V14'); // 2 stops < 8
    writeFileSync(join(d, 'transit.json'), '{"format":"nope"}');
    const v14 = (await checkDataset(d, FIXTURE_PROFILE, { counts, reencodeIdentical: true })).find(
      (x) => x.id === 'V14'
    )!;
    expect(v14.detail).toMatch(/^transit\.json: /);
  });
  it('V15 fails on a wrong count', async () => {
    expect(
      await failed(base, { ...counts, 'parcels.emitted': counts['parcels.emitted'] + 1 })
    ).toContain('V15');
  });
  it('V15 fails when parcels.bin is corrupt', async () => {
    const d = copy();
    writeFileSync(join(d, PARCELS_BIN), Buffer.from('not a deflate stream'));
    const r = await checkDataset(d, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    const v15 = r.find((x) => x.id === 'V15')!;
    expect(v15.ok).toBe(false);
    expect(v15.detail).toMatch(/parcels\.bin/);
  });
  it('V15-V19 fail with a message when parcels.bin is missing', async () => {
    const d = copy();
    rmSync(join(d, PARCELS_BIN));
    const r = await checkDataset(d, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    for (const id of ['V15', 'V16', 'V17', 'V18', 'V19']) {
      const v = r.find((x) => x.id === id)!;
      expect(v.ok, id).toBe(false);
      expect(v.detail, id).toMatch(/parcels\.bin/);
    }
  });
  it('V15 fails when a cell id differs from the chunk cellId', async () => {
    const d = copy();
    editScenario(d, (p) => {
      p.cells[0].cellId = '99_99';
    });
    const v15 = await result(d, 'V15');
    expect(v15.ok).toBe(false);
    expect(v15.detail).toMatch(/14 id\(s\) whose cell ≠ their chunk's cellId/);
  });
  it('V15 fails when an id is in no chunk', async () => {
    const d = copy();
    editScenario(d, (p) => {
      const i = p.id.indexOf('3512001');
      p.id[i] = '3512001X'; // sorts between 3512001 and 3512002, so the order is kept
    });
    const v15 = await result(d, 'V15');
    expect(v15.ok).toBe(false);
    expect(v15.detail).toMatch(/1 id\(s\) in no chunk/);
  });
  it('V15 fails when the chunk record count differs from count', async () => {
    const d = copy();
    // A second manifest chunk with the same records doubles the chunk record count.
    const p = readdirSync(join(d, 'parcels'))[0];
    cpSync(join(d, 'parcels', p), join(d, 'parcels', 'dup.json'));
    const m = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
    m.chunks.push({
      ...m.chunks[0],
      cellId: '999_999',
      url: m.chunks[0].url.replace(/[^/]+\.json$/, 'dup.json')
    });
    writeFileSync(join(d, 'manifest.json'), JSON.stringify(m));
    const v15 = await result(d, 'V15');
    expect(v15.ok).toBe(false);
    expect(v15.detail).toMatch(/28 chunk records ≠ count 14/);
  });
  it('V16 fails when too few eligible parcels have a district', async () => {
    const d = copy();
    editScenario(d, (p) => {
      p.districts.push('');
      p.district[p.index.get('3512001')!] = p.districts.length - 1;
    });
    const v16 = await result(d, 'V16');
    expect(v16.ok).toBe(false);
    expect(v16.detail).toMatch(/eligible with a district 91\.7% < 100%/);
  });
  it('V16 fails on a parse failure', async () => {
    expect(await failed(base, { ...counts, 'scenario.height.parse_fail': 1 })).toContain('V16');
  });
  it('V17 fails on a clamped yield', async () => {
    expect(await failed(base, { ...counts, 'scenario.yield.clamped': 1 })).toContain('V17');
  });
  it('V17 fails on a non-Local-Program base mismatch', async () => {
    expect(await failed(base, { ...counts, 'scenario.yield.nonlp_base_mismatch': 1 })).toContain(
      'V17'
    );
  });
  it('V17 fails when a hostable flag disagrees', async () => {
    const d = copy();
    editScenario(d, (p) => {
      const i = p.hostable.indexOf(1);
      p.hostable[i] = 0;
    });
    const r = await failed(d);
    expect(r).toContain('V17');
    expect(r).not.toContain('V15'); // the mutated file still decodes and re-encodes
  });
  it('V17 fails when a hostableBase flag disagrees', async () => {
    const d = copy();
    editScenario(d, (p) => {
      const i = p.hostableBase.indexOf(1);
      p.hostableBase[i] = 0;
    });
    const v17 = await result(d, 'V17');
    expect(v17.ok).toBe(false);
    expect(v17.detail).toMatch(/1 hostableBase flag\(s\) disagree/);
  });
  it('V17 fails when an ineligible parcel is hostable', async () => {
    const d = copy();
    editScenario(d, (p) => {
      p.hostable[p.index.get('3512007')!] = 1; // lot 7: not eligible
    });
    const v17 = await result(d, 'V17');
    expect(v17.ok).toBe(false);
    expect(v17.detail).toMatch(/1 hostable flag\(s\) disagree/);
  });
  it('V17 fails when fillLevels differ from FILL_LEVELS', async () => {
    const d = copy();
    editScenario(d, (p) => {
      p.fillLevels = [0.2, 0.5, 0.75, 0.9, 1];
    });
    const v17 = await result(d, 'V17');
    expect(v17.ok).toBe(false);
    expect(v17.detail).toMatch(/fillLevels \[0\.2, 0\.5, 0\.75, 0\.9, 1\] ≠ FILL_LEVELS/);
  });
  it('V17 does not warn when the FZP net total is in band', async () => {
    const v17 = await result(base, 'V17', { ...counts, 'scenario.yield.fzp_net_total': 780000 });
    expect(v17).toMatchObject({ ok: true, detail: 'hostable 8/12 eligible' });
  });
  it('V17 passes with a warning when the FZP net total is far from the cross-check', async () => {
    const v17 = (
      await checkDataset(base, FIXTURE_PROFILE, { counts, reencodeIdentical: true })
    ).find((x) => x.id === 'V17')!;
    expect(v17.ok).toBe(true);
    expect(v17.detail).toMatch(/warn: FZP net capacity 28 outside/);
  });
  it('V18 fails on a missing roll year', async () => {
    expect(
      await failed(base, { ...counts, 'scenario.panel.years': counts['scenario.panel.years'] - 1 })
    ).toContain('V18');
  });
  it('V18 fails on a feature mismatch', async () => {
    expect(await failed(base, { ...counts, 'scenario.panel.feature_mismatch': 1 })).toContain(
      'V18'
    );
  });
  it('V18 fails when too few eligible parcels have a latest-year roll row', async () => {
    const v18 = await result(base, 'V18', {
      ...counts,
      'scenario.roll.latest_eligible_matched': 9
    });
    expect(v18.ok).toBe(false);
    expect(v18.detail).toMatch(/eligible with a latest-year roll row 75\.0% < 80%/);
  });
  it('V18 fails when units fall outside the range', async () => {
    expect(await failed(base, { ...counts, 'scenario.units.total': 65 })).toContain('V18');
  });
  it('V19 fails on an oversize file', async () => {
    const r = await checkDataset(
      base,
      { ...FIXTURE_PROFILE, scenarioMaxBytes: 10 },
      { counts, reencodeIdentical: true }
    );
    expect(r.filter((x) => !x.ok).map((x) => x.id)).toEqual(['V19']);
  });
  it('V19 leaves byte numbers out of the stable detail', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, {
      counts,
      reencodeIdentical: true,
      stableDetail: true
    });
    const v19 = r.find((x) => x.id === 'V19')!;
    expect(v19.ok).toBe(true);
    expect(v19.detail).not.toMatch(/\d{3,}/);
  });
  it('V13 is reported as enforced at upload', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    expect(r.find((x) => x.id === 'V13')).toMatchObject({ ok: true, detail: 'enforced at upload' });
  });
});

describe('maxOf', () => {
  it('handles arrays too large to spread', () => {
    const xs = Array.from({ length: 500_000 }, (_, i) => i % 1000);
    expect(maxOf(xs)).toBe(999);
    expect(maxOf([])).toBe(-Infinity);
  });
});
