// Each invariant fails on a mutated fixture.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { encodeTransit } from '../../src/lib/data/transit-codec';
import { tinyNetwork } from '../../src/lib/data/fixtures/transit-tiny';
import { FIXTURE_PROFILE } from '../config';
import { deriveProjects } from '../project-records/derive';
import {
  checkV21,
  checkV22,
  checkV23,
  checkV24,
  type V2xInputs
} from '../project-records/invariants';
import { checkDataset, maxOf, type CheckExtras, type InvariantResult } from '../steps/check';
import { fixture } from '../steps/fixture';
import { PROJECTS_JSON } from '../steps/projects';
import { miniProjectInput } from './fixtures/mini/projects-raw';

let base: string;
let counts: Record<string, number>;
/** What the build measured: V20's snapshot day and V21-V24, carried as `check` does. */
let measured: Pick<CheckExtras, 'asOf' | 'projectChecks'>;
beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'sfh-inv-'));
  expect(await fixture({ outDir: base, skipTiles: true })).toBe(0);
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
      x.coverage.matchedUnits -= 1;
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
