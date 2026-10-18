// Each invariant fails on a mutated fixture.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
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
import { FIXTURE_PROFILE, LIVE_PROFILE } from '../config';
import { QUALITY_REPORT_MD, QUALITY_RULES, makeQuality } from '../lib/quality';
import { deriveProjects } from '../project-records/derive';
import {
  checkV21,
  checkV22,
  checkV23,
  checkV24,
  type V2xInputs
} from '../project-records/invariants';
import {
  checkDataset,
  checkV30,
  maxOf,
  type CheckExtras,
  type InvariantResult
} from '../steps/check';
import { fixture } from '../steps/fixture';
import { PROJECTS_JSON } from '../steps/projects';
import { miniProjectInput } from './fixtures/mini/projects-raw';
import { PARCELS_BIN } from '../lib/scenario-files';

let base: string;
/** The fixture build's derived cache root (kept, so the T14 report can be read). */
let derived: string;
let counts: Record<string, number>;
/** What the build measured: V20's snapshot day and V21-V24, carried as `check` does. */
let measured: Pick<CheckExtras, 'asOf' | 'projectChecks'>;
beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'sfh-inv-'));
  derived = mkdtempSync(join(tmpdir(), 'sfh-inv-derived-'));
  expect(await fixture({ outDir: base, skipTiles: true, derivedRoot: derived })).toBe(0);
  const report = JSON.parse(readFileSync(join(base, 'report.json'), 'utf8')) as {
    counts: Record<string, number>;
    invariants: InvariantResult[];
  };
  counts = report.counts;
  measured = {
    asOf: counts['projects.asOf'],
    projectChecks: report.invariants.filter((r) => ['V21', 'V22', 'V23', 'V24'].includes(r.id))
  };
});
const copy = () => {
  const d = mkdtempSync(join(tmpdir(), 'sfh-inv-m-'));
  cpSync(base, d, { recursive: true });
  return d;
};
const failed = async (dir: string, c = counts, extra: object = {}) =>
  (
    await checkDataset(dir, FIXTURE_PROFILE, {
      counts: c,
      reencodeIdentical: true,
      ...measured,
      ...extra
    })
  )
    .filter((r) => !r.ok)
    .map((r) => r.id);
/** V21-V24 as the project-records step computes them, with the fixture profile's thresholds. */
const projectChecks = (i: V2xInputs, rerunIdentical = true): InvariantResult[] => [
  checkV21(i, FIXTURE_PROFILE.pipelineCoverageMin),
  checkV22(i, FIXTURE_PROFILE.hiNet, {
    year: FIXTURE_PROFILE.rhnaYearTol,
    total: FIXTURE_PROFILE.rhnaTotalTol
  }),
  checkV23(i, rerunIdentical),
  checkV24(i)
];
/** The mini records' V21-V24 inputs, after `mutate`. */
const inputs = (mutate: (i: V2xInputs) => void = () => {}): V2xInputs => {
  const i = structuredClone(deriveProjects(miniProjectInput()).checks);
  mutate(i);
  return i;
};
const editProjects = (dir: string, f: (p: { projects: Record<string, unknown>[] }) => void) => {
  const p = join(dir, PROJECTS_JSON);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  f(j);
  writeFileSync(p, JSON.stringify(j));
};
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
/** V20 on `dir` with the snapshot day the build measured. */
const measuredV20 = async (dir: string) =>
  (await checkDataset(dir, FIXTURE_PROFILE, { counts, reencodeIdentical: true, ...measured })).find(
    (r) => r.id === 'V20'
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
  it('V17 reads eligibility from flags bit 5: a no-land-use parcel with homes may be hostable', async () => {
    // Lot 9 has no land-use row (chunk `eligible` false). With roll homes it is eligible in the
    // scenario (sd.landuse.none-with-units), so its hostable flags need no chunk eligibility.
    const d = copy();
    editScenario(d, (p) => {
      const i = p.index.get('3512009')!;
      expect(p.eligible[i]).toBe(0);
      p.existingUnits[i] = 2;
      p.eligible[i] = 1;
      p.hostable[i] = 1;
      p.hostableBase[i] = 1;
    });
    const v17 = await result(d, 'V17');
    expect(v17).toMatchObject({
      ok: true,
      detail: expect.stringMatching(/^hostable 9\/13 eligible/)
    });
  });
  it('V17 fails when the eligible flag disagrees with the chunk record and the T14 rule', async () => {
    const d = copy();
    editScenario(d, (p) => {
      p.eligible[p.index.get('3512009')!] = 1; // lot 9: no land-use row and no homes
      p.eligible[p.index.get('3512007')!] = 1; // lot 7: OPENSPACE stays excluded
      const i = p.index.get('3512001')!; // lot 1: eligible chunk record
      p.eligible[i] = 0;
      p.hostable[i] = 0;
      p.hostableBase[i] = 0;
    });
    const v17 = await result(d, 'V17');
    expect(v17.ok).toBe(false);
    expect(v17.detail).toMatch(/3 eligible flag\(s\) disagree with the chunk record/);
  });
  it('V17 fails when a parcel whose eligible flag is 0 is hostable', async () => {
    const d = copy();
    editScenario(d, (p) => {
      p.eligible[p.index.get('3512001')!] = 0; // lot 1 stays hostable
    });
    const v17 = await result(d, 'V17');
    expect(v17.ok).toBe(false);
    expect(v17.detail).toMatch(/1 hostable flag\(s\) disagree/);
  });
  it("V17 fails when the step's hostable flags disagree with its uncapped yields", async () => {
    for (const k of ['scenario.hostable_mismatch', 'scenario.hostable_base_mismatch']) {
      const v17 = await result(base, 'V17', { ...counts, [k]: 1 });
      expect(v17.ok, k).toBe(false);
      expect(v17.detail, k).toContain(`${k} 1 ≠ 0`);
    }
  });
  it('V17 fails when a parcel without an envelope is hostable', async () => {
    const d = copy();
    editScenario(d, (p) => {
      const i = p.index.get('3512012')!; // lot 12: eligible, envelope 0
      p.hostable[i] = 1;
      p.hostableBase[i] = 1;
    });
    const v17 = await result(d, 'V17');
    expect(v17.ok).toBe(false);
    expect(v17.detail).toMatch(/1 hostable flag\(s\) disagree/);
    expect(v17.detail).toMatch(/1 hostableBase flag\(s\) disagree/);
  });
  it('V17 lets an eligible parcel with an envelope and a capped yield of 0 be hostable', async () => {
    // The payload ships capped yields only, so V17 checks the necessary conditions; the step's
    // scenario.hostable_mismatch covers the uncapped rule (partner ruling, option c).
    const d = copy();
    editScenario(d, (p) => {
      const i = p.index.get('3512006')!; // lot 6: eligible, envelope 6, yields 0
      p.hostable[i] = 1;
      p.hostableBase[i] = 1;
    });
    expect((await result(d, 'V17')).ok).toBe(true);
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
  it('V18 counts hostable_base for every panel roll year, each within 5% of the year before', async () => {
    const keys = Object.keys(counts)
      .filter((k) => k.startsWith('scenario.panel.hostable_base.'))
      .sort();
    expect(keys).toEqual([
      'scenario.panel.hostable_base.2023',
      'scenario.panel.hostable_base.2024',
      'scenario.panel.hostable_base.2024.both',
      'scenario.panel.hostable_base.2024.both_prev',
      'scenario.panel.hostable_base.2024.both_rows',
      'scenario.panel.hostable_base.2025',
      'scenario.panel.hostable_base.2025.both',
      'scenario.panel.hostable_base.2025.both_prev',
      'scenario.panel.hostable_base.2025.both_rows'
    ]);
    const v18 = await result(base, 'V18');
    expect(v18.ok).toBe(true);
    expect(v18.detail).toMatch(
      /hostable_base year-on-year change \(parcels in both years\) ≤ 0% ≤ 5%/
    );
  });
  it('V18 fails when hostable_base changes by more than 5% between roll years', async () => {
    const prev = counts['scenario.panel.hostable_base.2025.both_prev'];
    const v18 = await result(base, 'V18', {
      ...counts,
      'scenario.panel.hostable_base.2025.both': Math.ceil(prev * 1.05) + 1
    });
    expect(v18.ok).toBe(false);
    expect(v18.detail).toMatch(/hostable_base 2024 → 2025 changes by \S+% > 5%/);
    // A change of exactly 5%, up or down, passes.
    const at = await result(base, 'V18', {
      ...counts,
      'scenario.panel.hostable_base.2024.both_prev': 100,
      'scenario.panel.hostable_base.2024.both': 105,
      'scenario.panel.hostable_base.2025.both_prev': 100,
      'scenario.panel.hostable_base.2025.both': 95
    });
    expect(at.ok).toBe(true);
  });
  it('V18 fails when a roll year has no hostable_base counts', async () => {
    const c = { ...counts };
    delete c['scenario.panel.hostable_base.2024'];
    const v18 = await result(base, 'V18', c);
    expect(v18.ok).toBe(false);
    expect(v18.detail).toMatch(/hostable_base counted for 2 roll years ≠ 3/);
    const d = { ...counts };
    delete d['scenario.panel.hostable_base.2025.both'];
    expect((await result(base, 'V18', d)).detail).toMatch(
      /hostable_base 2024 → 2025 has no both-years counts/
    );
  });
  it('V18 fails when two consecutive panel years share no parcel', async () => {
    // 0 of 0 would otherwise pass as a 0% change, exempting the pair silently.
    const v18 = await result(base, 'V18', {
      ...counts,
      'scenario.panel.hostable_base.2025.both_rows': 0,
      'scenario.panel.hostable_base.2025.both_prev': 0,
      'scenario.panel.hostable_base.2025.both': 0
    });
    expect(v18.ok).toBe(false);
    expect(v18.detail).toMatch(/hostable_base 2024 → 2025: no parcel has a row in both years/);
  });
  it('V18 fails when units fall outside the range', async () => {
    expect(await failed(base, { ...counts, 'scenario.units.total': 65 })).toContain('V18');
  });
  it('V19 fails on an oversize file', async () => {
    const r = await checkDataset(
      base,
      { ...FIXTURE_PROFILE, scenarioMaxBytes: 10 },
      { counts, reencodeIdentical: true, ...measured }
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
  it('V20 fails when projects.json breaks the T3 validator', async () => {
    const d = copy();
    editProjects(d, (j) => {
      j.projects[1].id = j.projects[0].id;
    });
    expect(await failed(d)).toEqual(['V20']);
    const e = copy();
    editProjects(e, (j) => {
      j.projects[0].parcelIds = ['9999999'];
    });
    expect(await failed(e)).toEqual(['V20']);
  });
  it('V20 passes the score-only M20 and fails empty parcelIds on a project that is not one', async () => {
    const f = JSON.parse(readFileSync(join(base, PROJECTS_JSON), 'utf8')) as {
      projects: { id: string; parcelIds: string[]; multiPhase: boolean; phases: unknown }[];
    };
    expect(f.projects.find((p) => p.id === 'CASE:2012-000020PRX')).toMatchObject({
      parcelIds: [],
      multiPhase: true,
      phases: null
    });
    const d = copy();
    editProjects(d, (j) => {
      const m11 = j.projects.find((p) => p.id === 'PRJ:2026-000011PRJ')!;
      m11.parcelIds = [];
    });
    expect(await failed(d)).toEqual(['V20']);
    expect((await measuredV20(d)).detail).toMatch(/projects\[11\]\.parcelIds: must be non-empty/);
    // A score-only master must carry pr.multiphase.score-only (the rule entry dropped with it).
    const e = copy();
    editProjects(e, (j) => {
      const m20 = j.projects.find((p) => p.id === 'CASE:2012-000020PRX')!;
      m20.quality = ['pr.multiphase.da-netting'];
      const rules = (j as unknown as { qualityRules: { id: string }[] }).qualityRules;
      (j as unknown as { qualityRules: { id: string }[] }).qualityRules = rules.filter(
        (q) => q.id !== 'pr.multiphase.score-only'
      );
    });
    expect(await failed(e)).toEqual(['V20']);
    expect((await measuredV20(e)).detail).toMatch(/projects\[4\]\.parcelIds: must be non-empty/);
  });
  it('V20 fails on a missing projects.json, an unknown snapshot day or the size budget', async () => {
    const d = copy();
    rmSync(join(d, PROJECTS_JSON));
    expect(await failed(d)).toEqual(['V20']);
    expect(await failed(base, counts, { asOf: undefined })).toEqual(['V20']);
    expect(await failed(base, counts, { asOf: measured.asOf! + 1 })).toEqual(['V20']);
    const r = await checkDataset(
      base,
      { ...FIXTURE_PROFILE, projectsMaxBytes: 100 },
      { counts, reencodeIdentical: true, ...measured }
    );
    expect(r.find((x) => x.id === 'V20')).toMatchObject({ ok: false });
  });
  it('V21-V24 fail as not measured when the build did not supply them', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, {
      counts,
      reencodeIdentical: true,
      asOf: measured.asOf
    });
    for (const id of ['V21', 'V22', 'V23', 'V24']) {
      expect(
        r.find((x) => x.id === id),
        id
      ).toEqual({ id, ok: false, detail: 'not measured' });
    }
  });
  it('V21-V24 pass on the mini records and are what the build measured', async () => {
    const checks = projectChecks(inputs());
    expect(checks.map((c) => c.ok)).toEqual([true, true, true, true]);
    expect(checks).toEqual(measured.projectChecks);
  });
  it('V21 fails when in-flight units no longer cover the pipeline rows', async () => {
    const i = inputs((x) => {
      // Just under the fixture's 0.90 (mini covers 699 of 739 units).
      x.coverage.matchedUnits =
        Math.ceil(FIXTURE_PROFILE.pipelineCoverageMin * x.coverage.rowUnits) - 1;
    });
    expect(await failed(base, counts, { projectChecks: projectChecks(i) })).toEqual(['V21']);
  });
  it('V22 fails when a cross-check year drifts from hiNet', async () => {
    const i = inputs((x) => {
      x.rhna.byYear[2023] += 5;
    });
    expect(await failed(base, counts, { projectChecks: projectChecks(i) })).toEqual(['V22']);
  });
  it('V23 fails on a broken history or a rerun that differs', async () => {
    const i = inputs((x) => {
      const h = x.histories.find((y) => y.end.kind === 'complete')!;
      h.end = { kind: 'complete', day: (h.end as { day: number }).day + 1 };
    });
    expect(await failed(base, counts, { projectChecks: projectChecks(i) })).toEqual(['V23']);
    expect(await failed(base, counts, { projectChecks: projectChecks(inputs(), false) })).toEqual([
      'V23'
    ]);
  });
  it('V24 fails when phase units no longer sum to the master', async () => {
    const i = inputs((x) => {
      const m = x.file.projects.find((p) => p.multiPhase && p.phases !== null)!;
      m.phases![0].units -= 1;
    });
    expect(await failed(base, counts, { projectChecks: projectChecks(i) })).toEqual(['V24']);
  });
  it('V24 fails when the last-resort M20 draws on a parcel another in-flight project holds', async () => {
    // M20 is score-only; drawing on its DA parcel lot 6 collides with M11.
    const i = inputs((x) => {
      x.file.projects.find((p) => p.id === 'CASE:2012-000020PRX')!.parcelIds = ['3512006'];
    });
    const checks = projectChecks(i);
    expect(await failed(base, counts, { projectChecks: checks })).toEqual(['V24']);
    expect(checks.find((c) => c.id === 'V24')!.detail).toMatch(
      /CASE:2012-000020PRX: last-resort parcel 3512006 is also in PRJ:2026-000011PRJ/
    );
  });
  it('V24 fails when the score-only M20 has a free DA parcel', async () => {
    // Lot 6 freed: M11 leaves flight and M6's completed history no longer holds it.
    const i = inputs((x) => {
      x.file.projects = x.file.projects.filter((p) => p.id !== 'PRJ:2026-000011PRJ');
      x.histories.find((h) => h.id === 'PRJ:2016-000006PRJ')!.parcelIds = [];
    });
    const checks = projectChecks(i);
    expect(await failed(base, counts, { projectChecks: checks })).toEqual(['V24']);
    expect(checks.find((c) => c.id === 'V24')!.detail).toMatch(
      /CASE:2012-000020PRX: score-only but DA parcel 3512006 is free/
    );
  });
  it('V13 is reported as enforced at upload', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    expect(r.find((x) => x.id === 'V13')).toMatchObject({ ok: true, detail: 'enforced at upload' });
  });
});

describe('V30 data-quality registry', () => {
  /** A one-rule test registry, so the share checks do not depend on the real sd.* and pr.* rules. */
  const one = makeQuality([
    {
      id: 'sd.test.bound',
      owner: 'scenario-data',
      source: 'test-source',
      field: 'test_field',
      kind: 'bound',
      action: 'replace',
      tier: 4,
      valueTier: 2,
      maskBit: 0,
      label: 'A test bound',
      denominator: 'test rows',
      warnShare: 0.01,
      failShare: 0.1,
      unitsWeighted: false
    }
  ]);
  const reported = (fired: number, of: number) => {
    const c: Record<string, number> = {};
    one.recordQuality(c, 'sd.test.bound', { fired, of });
    return c;
  };
  it('passes on mini with a stable detail', async () => {
    const v30 = await result(base, 'V30');
    expect(v30).toEqual({
      id: 'V30',
      ok: true,
      detail: 'every registered rule reports; shares not checked on this profile'
    });
  });
  it('the build writes quality-report.md into the derived folder', () => {
    const md = readFileSync(join(derived, 'fixture-0', QUALITY_REPORT_MD), 'utf8');
    expect(md).toMatch(/^# Data quality report: fixture-0\n/);
    // One reported row per registered rule, scenario-data's sd.* and project-records' pr.* alike.
    const owners = new Set(QUALITY_RULES.map((r) => r.owner));
    expect(owners.has('scenario-data') && owners.has('project-records')).toBe(true);
    for (const r of QUALITY_RULES) {
      expect(md, r.id).toMatch(new RegExp(`^\\| \`${r.id.replaceAll('.', '\\.')}\` \\|`, 'm'));
    }
    // The scenario-data SQL rules recorded into the build's counts.
    expect(md).toMatch(/\| `sd\.roll\.units-capacity` \|.*\| 3 \/ 25 \|/);
    expect(md).not.toContain('| not reported |');
    expect(md).not.toContain('Not reported.');
  });
  it('fails when a registered rule does not report', () => {
    const v30 = checkV30({}, { qualityShares: false }, one.checkQuality);
    expect(v30.ok).toBe(false);
    expect(v30.detail).toMatch(/sd\.test\.bound: not reported/);
  });
  it('fails on an unregistered quality.* key in counts', async () => {
    expect(await failed(base, { ...counts, 'quality.sd.no.such.fired': 0 })).toEqual(['V30']);
  });
  it('with qualityShares fails on a share above failShare; without it passes', () => {
    const c = reported(11, 100);
    const v30 = checkV30(c, { qualityShares: true }, one.checkQuality);
    expect(v30).toEqual({
      id: 'V30',
      ok: false,
      detail: 'sd.test.bound: share 11.00% > failShare 10.00%'
    });
    expect(checkV30(c, FIXTURE_PROFILE, one.checkQuality).ok).toBe(true);
    expect(LIVE_PROFILE.qualityShares).toBe(true);
    expect(FIXTURE_PROFILE.qualityShares).toBe(false);
  });
  it('warns above warnShare and still passes', () => {
    const v30 = checkV30(reported(2, 100), { qualityShares: true }, one.checkQuality);
    expect(v30).toEqual({
      id: 'V30',
      ok: true,
      detail:
        'every registered rule reports; no share above failShare; warn: sd.test.bound: share 2.00% > warnShare 1.00%'
    });
  });
});

describe('maxOf', () => {
  it('handles arrays too large to spread', () => {
    const xs = Array.from({ length: 500_000 }, (_, i) => i % 1000);
    expect(maxOf(xs)).toBe(999);
    expect(maxOf([])).toBe(-Infinity);
  });
});
