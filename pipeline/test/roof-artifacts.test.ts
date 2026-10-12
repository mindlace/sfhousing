import { afterEach, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upload } from '../steps/upload';
import { encodeRoofArtifacts } from '../roofs/export';
import { buildRoofAudit, writeRoofAudit } from '../roofs/audit';
import { verify } from '../steps/verify';
import type { R2Target } from '../lib/r2';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const read = (d: string, p: string) => JSON.parse(readFileSync(join(d, p), 'utf8'));
const write = (d: string, p: string, v: unknown) => writeFileSync(join(d, p), JSON.stringify(v));
async function dataset(diagnostics: string[] = []) {
  const d = mkdtempSync(join(tmpdir(), 'roof-artifacts-'));
  dirs.push(d);
  cpSync('e2e/fixtures/data/fixture-0', d, { recursive: true });
  const mesh = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 5]
    ] as [number, number, number][],
    triangles: [
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3]
    ] as [number, number, number][],
    semantics: ['GroundSurface', 'RoofSurface', 'RoofSurface', 'RoofSurface']
  };
  const index = await encodeRoofArtifacts(
    [
      {
        pieceId: 'p-model',
        buildingId: 'model',
        parcelId: 'p1',
        method: 'lidar_only',
        cellId: '50_25',
        projectedOrigin: [50500, 25500],
        anchor: [-122.42, 37.76],
        bbox: [-122.42, 37.76, -122.41, 37.77],
        mesh
      }
    ],
    { outDir: d, datasetVersion: 'fixture-0' }
  );
  const audit = buildRoofAudit(
    ['fallback', 'model'].map((buildingId) => ({
      buildingId,
      footprintHash: 'a'.repeat(64),
      method: 'footprint' as const,
      mesh: null,
      selectedCandidate: null,
      reason: 'not_in_coverage',
      flags: [],
      candidates: [],
      ground: null,
      diagnostics: { vegetation: diagnostics },
      archives: []
    })),
    ['fallback', 'model'].map((buildingId) => ({
      pieceId: `p-${buildingId}`,
      buildingId,
      parcelId: 'p1',
      geometry: { type: 'Polygon' as const, coordinates: [] },
      mesh: null,
      reason: 'not_in_coverage' as const
    })),
    ['fallback', 'model'].map((buildingId) => ({
      buildingId,
      bbox: [-122.42, 37.76, -122.41, 37.77] as [number, number, number, number],
      neighborhood: null,
      heightM: 5
    })),
    'fixture-0',
    d,
    new Map(
      ['fallback', 'model'].map((id) => [
        `p-${id}`,
        [-122.42, 37.76, -122.41, 37.77] as [number, number, number, number]
      ])
    )
  );
  const model = audit.pieces[1];
  model.outcome = 'modelled';
  model.method = 'lidar_only';
  model.reason = null;
  model.processing.selectedCandidate = 'simplified';
  for (const [key, value] of Object.entries({
    roofCoverage: 1,
    triangleCount: 4,
    maximumRelativeHeight: 5,
    validationCoverage: 1,
    validationSampleCount: 25,
    validationMae: 0,
    detectedSpikes: 0,
    returnsAfterRejection: 100,
    retainedRoofTrainingCount: 100
  }))
    model.quality[key as keyof typeof model.quality] = { value, unavailableReason: null };
  model.quality.returnsBeforeRejection = { value: 100, unavailableReason: null };
  audit.buildings[1].outcome = 'fully_modelled';
  audit.buildings[1].quality = structuredClone(model.quality);
  writeRoofAudit(join(d, 'roofs/audit.json'), audit);
  write(d, 'roofs/report.json', {
    schemaVersion: 1,
    datasetVersion: 'fixture-0',
    counts: {
      'roofs.buildings': 2,
      'roofs.pieces': 2,
      'roofs.modelled': 1,
      'roofs.fallback': 1,
      'roofs.chunks': 1
    }
  });
  const manifest = read(d, 'manifest.json');
  manifest.buildingRoofs = {
    schemaVersion: 1,
    indexUrl: '/data/fixture-0/roofs/index.json',
    auditUrl: '/data/fixture-0/roofs/audit.json',
    reportUrl: '/data/fixture-0/roofs/report.json'
  };
  write(d, 'manifest.json', manifest);
  const report = read(d, 'report.json');
  report.invariants.push(...['V14', 'V15', 'V16'].map((id) => ({ id, ok: true, detail: '' })));
  report.roofArchives = [];
  write(d, 'report.json', report);
  return { d, index, audit, manifest };
}

it.each([
  'missing mesh',
  'altered mesh',
  'cross-version child',
  'duplicate piece',
  'missing fallback',
  'excessive chunk',
  'missing processing archive'
])('refuses %s before the first put', async (kind) => {
  const { d, index, audit } = await dataset();
  const ref = index.chunks[0];
  if (kind === 'missing mesh') rmSync(join(d, 'roofs', `${ref.chunkId}.bin`));
  if (kind === 'altered mesh') writeFileSync(join(d, 'roofs', `${ref.chunkId}.bin`), 'corrupt');
  if (kind === 'cross-version child') {
    ref.meshUrl = '/data/fixture-9/roofs/x.bin';
    write(d, 'roofs/index.json', index);
  }
  if (kind === 'duplicate piece') {
    audit.pieces.push(audit.pieces[1]);
    writeRoofAudit(join(d, 'roofs/audit.json'), audit);
  }
  if (kind === 'missing fallback') {
    audit.pieces.shift();
    writeRoofAudit(join(d, 'roofs/audit.json'), audit);
  }
  if (kind === 'excessive chunk') {
    ref.meshBytes = 4194305;
    write(d, 'roofs/index.json', index);
  }
  if (kind === 'missing processing archive') {
    const report = read(d, 'report.json');
    report.roofArchives = [
      {
        name: 'missing.json',
        url: '',
        sha256: 'f'.repeat(64),
        bytes: 10,
        archiveKey: `roof-processing/${'f'.repeat(64)}.json`
      }
    ];
    write(d, 'report.json', report);
  }
  const puts: string[] = [];
  const target: R2Target = {
    exists: async () => false,
    get: async () => false,
    put: async (k) => {
      puts.push(k);
    }
  };
  expect(
    await upload({
      outDir: d,
      datasetVersion: 'fixture-0',
      lock: { sources: [] },
      rawDir: d,
      target,
      log: () => {}
    })
  ).toBe(1);
  expect(puts).toEqual([]);
});

it('verify discovers children and rejects a hash change in decoded response bytes', async () => {
  const { d, index } = await dataset();
  const paths: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.slice('/data/fixture-0/'.length);
    paths.push(path);
    if (path.endsWith('.pmtiles') && new Headers(init?.headers).has('range'))
      return new Response('x', { status: 206 });
    if (path.endsWith('.bin')) return new Response(new Uint8Array(index.chunks[0].meshBytes));
    try {
      return new Response(readFileSync(join(d, path)));
    } catch {
      return new Response(null, { status: 404 });
    }
  }) as typeof fetch;
  const result = await verify({ datasetVersion: 'fixture-0', origin: 'http://offline', fetch: f });
  expect(paths).toContain(`roofs/${index.chunks[0].chunkId}.json`);
  expect(paths).toContain(`roofs/${index.chunks[0].chunkId}.bin`);
  expect(result.ok).toBe(false);
});

it('streams complete audit records and rejects truncation and duplicate root keys', async () => {
  const { streamRoofAudit } = await import('../roofs/audit-reader');
  const { d } = await dataset();
  const path = join(d, 'roofs/audit.json');
  const bytes = readFileSync(path);
  const ids: string[] = [];
  await streamRoofAudit(
    path,
    'fixture-0',
    (kind, value) => {
      ids.push(`${kind}:${'pieceId' in value ? value.pieceId : value.buildingId}`);
    },
    { highWaterMark: 7 }
  );
  expect(ids).toEqual([
    'buildings:fallback',
    'buildings:model',
    'pieces:p-fallback',
    'pieces:p-model'
  ]);
  writeFileSync(path, bytes.subarray(0, bytes.length - 1));
  await expect(streamRoofAudit(path, 'fixture-0', () => {})).rejects.toThrow();
  writeFileSync(
    path,
    bytes.toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')
  );
  await expect(streamRoofAudit(path, 'fixture-0', () => {})).rejects.toThrow(/duplicate/);
});

it('accepts a closed synthetic solid with every fallback audit, then detects missing fallback independently of archives', async () => {
  const { checkRoofArtifacts } = await import('../roofs/check');
  const { d, audit, manifest } = await dataset();
  expect(await checkRoofArtifacts(d, manifest)).toMatchObject({ ok: true, failures: [] });
  audit.pieces.shift();
  writeRoofAudit(join(d, 'roofs/audit.json'), audit);
  expect((await checkRoofArtifacts(d, manifest)).failures.join(' ')).toMatch(/V16.*incomplete/);
});

it('checks only top-level artifacts for unsupported roof schema', async () => {
  const { checkRoofArtifacts } = await import('../roofs/check');
  const { d, manifest } = await dataset();
  manifest.buildingRoofs.schemaVersion = 9;
  write(d, 'roofs/index.json', { layout: 'future', url: '/data/fixture-8/elsewhere' });
  expect(await checkRoofArtifacts(d, manifest)).toMatchObject({ ok: true });
});

it('uses actual noncanonical index bytes for chunk accounting', async () => {
  const { checkRoofArtifacts } = await import('../roofs/check');
  const { d, manifest } = await dataset();
  const index = read(d, 'roofs/index.json');
  index.ignored = ' '.repeat(4194304);
  write(d, 'roofs/index.json', index);
  expect((await checkRoofArtifacts(d, manifest)).failures.join(' ')).toMatch(/V15.*budget/);
});

it('restores processing archives with HTTP disabled and rejects altered existing archive bytes', async () => {
  const { restoreRoofArtifacts, toolchainArchives } = await import('../roofs/archives');
  const refs = toolchainArchives();
  const root = mkdtempSync(join(tmpdir(), 'roof-restore-'));
  dirs.push(root);
  let gets = 0;
  const r2: R2Target = {
    exists: async () => false,
    put: async () => {
      throw new Error('no writes');
    },
    get: async (key, file) => {
      const ref = refs.find((a) => a.archiveKey === key);
      if (!ref) return false;
      cpSync(join('pipeline/.cache/roof-dependencies', ref.sha256), file);
      gets++;
      return true;
    }
  };
  await restoreRoofArtifacts({ roofArchives: refs }, root, r2);
  expect(gets).toBe(35);
  writeFileSync(join(root, refs[0].sha256), 'altered');
  await expect(restoreRoofArtifacts({ roofArchives: refs }, root, r2)).rejects.toThrow(/hash/);
});

it('rebuilds just the requested archived building offline and refuses a changed toolchain', async () => {
  const { rebuildRoofBuilding } = await import('../roofs/rebuild');
  const { runRoofJob } = await import('../roofs/run');
  const { toolchainArchives } = await import('../roofs/archives');
  const { roofToolVersions } = await import('../roofs/setup');
  const { resolve } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const root = mkdtempSync(join(tmpdir(), 'roof-rebuild-'));
  dirs.push(root);
  const cases = read('pipeline/test/fixtures/roofs', 'real-cases.json');
  const c = cases.cases ? cases.cases[1] : cases[1];
  const sourceFile = resolve('pipeline/test/fixtures/roofs', c.file),
    sha = createHash('sha256').update(readFileSync(sourceFile)).digest('hex');
  const spatial = {
    horizontalCrs: 'EPSG:7131',
    verticalCrs: null,
    horizontalUnits: 'm' as const,
    verticalUnits: 'm' as const,
    acquisitionStart: null,
    acquisitionEnd: null,
    coverage: [
      { id: 'sf', bbox: [-122.6, 37.6, -122.3, 37.9] as [number, number, number, number] }
    ],
    supportBufferM: 50,
    permission: 'confirmed' as const,
    alignment: 'not-applicable' as const,
    objects: []
  };
  const rawRef = {
    name: c.file,
    url: 'https://upstream-disabled.invalid/source',
    sha256: sha,
    bytes: readFileSync(sourceFile).length,
    archiveKey: `sources/${sha}.laz`
  };
  const result = await runRoofJob({
    schemaVersion: 1,
    datasetVersion: 'fixture-0',
    buildings: [c.building, { ...c.building, buildingId: 'unrequested' }],
    sources: [
      {
        ...spatial,
        kind: 'lidar',
        sourceId: 'roof-lidar',
        name: c.file,
        path: sourceFile,
        sha256: sha,
        url: rawRef.url
      }
    ],
    sourceStatus: [{ sourceId: 'roof-lidar', spatial }],
    sourceArchives: [rawRef],
    configPath: resolve('pipeline/roofs/config.json'),
    toolchainHash: roofToolVersions().roofToolchainHash,
    workDir: join(root, 'original')
  });
  const refs = [...result.archives, ...toolchainArchives()];
  const report = { datasetVersion: 'fixture-0', roofArchives: refs };
  const published = JSON.stringify(report);
  const r2: R2Target = {
    exists: async () => false,
    put: async () => {
      throw new Error('published dataset must stay unchanged');
    },
    get: async (key, file) => {
      if (key === 'data/fixture-0/report.json') {
        writeFileSync(file, published);
        return true;
      }
      if (key === rawRef.archiveKey) {
        cpSync(sourceFile, file);
        return true;
      }
      const ref = refs.find((a) => a.archiveKey === key);
      if (!ref) return false;
      cpSync(join('pipeline/.cache/roof-artifacts', ref.sha256), file);
      return true;
    }
  };
  await rebuildRoofBuilding({
    datasetVersion: 'fixture-0',
    buildingId: c.building.buildingId,
    rawDir: join(root, 'raw'),
    archiveDir: join(root, 'archive'),
    outDir: join(root, 'rebuilt'),
    r2
  });
  const rebuilt = read(join(root, 'rebuilt'), 'result.json');
  expect(rebuilt.buildings).toHaveLength(1);
  expect(rebuilt.buildings[0]).toEqual(result.buildings[0]);
  const input = result.archives.find((a) => a.name === `${c.building.buildingId}-input.json`)!;
  const original = read('pipeline/.cache/roof-artifacts', input.sha256);
  original.toolchainHash = '0'.repeat(64);
  const bytes = Buffer.from(JSON.stringify(original)),
    altered = {
      ...input,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length
    };
  altered.archiveKey = `roof-processing/${altered.sha256}.json`;
  const bad = {
    ...r2,
    get: async (key: string, file: string) => {
      if (key === 'data/fixture-0/report.json') {
        writeFileSync(
          file,
          JSON.stringify({ ...report, roofArchives: refs.map((a) => (a === input ? altered : a)) })
        );
        return true;
      }
      if (key === altered.archiveKey) {
        writeFileSync(file, bytes);
        return true;
      }
      return r2.get(key, file);
    }
  };
  await expect(
    rebuildRoofBuilding({
      datasetVersion: 'fixture-0',
      buildingId: c.building.buildingId,
      rawDir: join(root, 'raw'),
      archiveDir: join(root, 'archive'),
      outDir: join(root, 'bad'),
      r2: bad
    })
  ).rejects.toThrow(/checkout|toolchain/);
}, 30000);

it.each(['archive', 'runtime', 'none'])(
  'publishes generated fixture manifest last only after all archives and runtime bodies succeed (%s)',
  async (failure) => {
    const { readLock } = await import('../lib/lock');
    const fixture = 'e2e/fixtures/data/fixture-0';
    const puts: string[] = [],
      published = new Set<string>();
    const report = read(fixture, 'report.json');
    const target: R2Target = {
      exists: async () => false,
      get: async () => false,
      put: async (key) => {
        puts.push(key);
        if (
          (failure === 'archive' && key.startsWith('roof-processing/')) ||
          (failure === 'runtime' && key.endsWith('.bin'))
        )
          throw new Error('injected persistent failure');
        published.add(key);
      }
    };
    const code = await upload({
      outDir: fixture,
      datasetVersion: 'fixture-0',
      lock: readLock('pipeline/test/fixtures/mini/sources.lock.json'),
      rawDir: 'pipeline/test/fixtures/mini/raw',
      rawByName: true,
      target,
      retries: 0,
      log: () => {}
    });
    expect(code).toBe(failure === 'none' ? 0 : 1);
    expect(published.has('data/fixture-0/manifest.json')).toBe(failure === 'none');
    if (failure === 'none') {
      expect(puts.at(-1)).toBe('data/fixture-0/manifest.json');
      expect(puts.indexOf('data/fixture-0/roofs/index.json')).toBeGreaterThan(
        Math.max(
          ...report.roofArchives.map((a: { archiveKey: string }) => puts.indexOf(a.archiveKey))
        )
      );
    }
  }
);

it('rejects an omitted portable building archive even when every remaining archive hashes correctly', async () => {
  const d = mkdtempSync(join(tmpdir(), 'roof-closure-'));
  dirs.push(d);
  cpSync('e2e/fixtures/data/fixture-0', d, { recursive: true });
  const report = read(d, 'report.json');
  report.roofArchives = report.roofArchives.filter(
    (a: { name: string }) => a.name !== 'b02-input.json'
  );
  write(d, 'report.json', report);
  const puts: string[] = [];
  expect(
    await upload({
      outDir: d,
      datasetVersion: 'fixture-0',
      lock: { sources: [] },
      rawDir: d,
      target: {
        exists: async () => false,
        get: async () => false,
        put: async (key) => {
          puts.push(key);
        }
      },
      log: () => {}
    })
  ).toBe(1);
  expect(puts).toEqual([]);
});

it('rejects modelled audit outcomes without measured acceptance evidence', async () => {
  const { checkRoofArtifacts } = await import('../roofs/check');
  const { d, manifest, audit } = await dataset();
  audit.pieces[1].quality.roofCoverage = { value: null, unavailableReason: 'not_measured' };
  writeRoofAudit(join(d, 'roofs/audit.json'), audit);
  expect((await checkRoofArtifacts(d, manifest)).failures.join(' ')).toMatch(/V15/);
});

it('fetch restore recovers raw and processing inputs into temporary caches with upstream HTTP disabled', async () => {
  const { fetchAll } = await import('../steps/fetch');
  const { readLock } = await import('../lib/lock');
  const root = mkdtempSync(join(tmpdir(), 'roof-offline-fetch-'));
  dirs.push(root);
  const lock = readLock('pipeline/test/fixtures/mini/sources.lock.json');
  write(root, 'lock.json', lock);
  const report = read('e2e/fixtures/data/fixture-0', 'report.json');
  const refs = new Map(
    report.roofArchives.map((a: { archiveKey: string; sha256: string }) => [
      a.archiveKey,
      join('pipeline/.cache/roof-artifacts', a.sha256)
    ])
  );
  for (const source of lock.sources)
    for (const f of source.files)
      refs.set(f.archiveKey, join('pipeline/test/fixtures/mini/raw', f.name));
  const r2: R2Target = {
    exists: async () => false,
    put: async () => {
      throw new Error('restore is read-only');
    },
    get: async (key, file) => {
      if (key === 'data/fixture-0/report.json') {
        writeFileSync(file, JSON.stringify(report));
        return true;
      }
      const source = refs.get(key);
      if (typeof source !== 'string') return false;
      cpSync(source, file);
      return true;
    }
  };
  expect(
    await fetchAll({
      restore: true,
      roofRun: 'fixture-0',
      lockPath: join(root, 'lock.json'),
      rawDir: join(root, 'raw'),
      roofArchiveDir: join(root, 'processing'),
      r2,
      http: {
        get: async () => {
          throw new Error('upstream HTTP disabled');
        }
      }
    })
  ).toBe(0);
  const roof = lock.sources.find((s) => s.id === 'roof-lidar')!.files[0];
  expect(readFileSync(join(root, 'raw', roof.sha256))).toEqual(
    readFileSync(join('pipeline/test/fixtures/mini/raw', roof.name))
  );
  expect(readFileSync(join(root, 'processing', report.roofArchives[0].sha256)).length).toBe(
    report.roofArchives[0].bytes
  );
});

it.each(['inward', 'repeated vertices', 'collinear vertices'])(
  'rejects %s geometry even with updated child hash and gzip metadata',
  async (kind) => {
    const { checkRoofArtifacts } = await import('../roofs/check');
    const { createHash } = await import('node:crypto');
    const { gzipSync } = await import('node:zlib');
    const { d, index, manifest } = await dataset();
    const ref = index.chunks[0],
      header = read(d, `roofs/${ref.chunkId}.json`),
      path = join(d, `roofs/${ref.chunkId}.bin`),
      bin = readFileSync(path);
    if (kind === 'inward') {
      for (let i = 0; i < header.buffers.indices.count; i += 3) {
        const at = header.buffers.indices.offset + i * 4,
          a = bin.readUInt32LE(at + 4),
          b = bin.readUInt32LE(at + 8);
        bin.writeUInt32LE(b, at + 4);
        bin.writeUInt32LE(a, at + 8);
      }
    } else {
      const points =
        kind === 'repeated vertices'
          ? [
              [0, 0, 0],
              [0, 0, 0],
              [0, 1, 0]
            ]
          : [
              [0, 0, 0],
              [1, 0, 0],
              [2, 0, 0]
            ];
      for (let i = 0; i < 3; i++) {
        const vertex = bin.readUInt32LE(header.buffers.indices.offset + i * 4);
        for (let axis = 0; axis < 3; axis++)
          bin.writeFloatLE(
            points[i][axis],
            header.buffers.positions.offset + (vertex * 3 + axis) * 4
          );
      }
    }
    writeFileSync(path, bin);
    ref.meshSha256 = createHash('sha256').update(bin).digest('hex');
    ref.gzipBytes =
      gzipSync(bin, { level: 9 }).length +
      gzipSync(readFileSync(join(d, `roofs/${ref.chunkId}.json`)), { level: 9 }).length;
    write(d, 'roofs/index.json', index);
    expect((await checkRoofArtifacts(d, manifest)).failures.join(' ')).toMatch(/V15/);
  }
);

it('rejects a missing clipping dependency referenced only transitively by the processing archive', async () => {
  const d = mkdtempSync(join(tmpdir(), 'roof-clip-closure-'));
  dirs.push(d);
  cpSync('e2e/fixtures/data/fixture-0', d, { recursive: true });
  const report = read(d, 'report.json');
  report.roofArchives = report.roofArchives.filter((a: { name: string }) => a.name !== 'export.ts');
  write(d, 'report.json', report);
  const puts: string[] = [];
  const logs: string[] = [];
  const { readLock } = await import('../lib/lock');
  expect(
    await upload({
      outDir: d,
      datasetVersion: 'fixture-0',
      lock: readLock('pipeline/test/fixtures/mini/sources.lock.json'),
      rawDir: 'pipeline/test/fixtures/mini/raw',
      rawByName: true,
      target: {
        exists: async () => false,
        get: async () => false,
        put: async (key) => {
          puts.push(key);
        }
      },
      log: (s) => logs.push(s)
    })
  ).toBe(1);
  expect(puts).toEqual([]);
  expect(logs.join(' ')).toMatch(/closure/);
});

it('verify hashes decoded bodies rather than compressed transport lengths', async () => {
  const fixture = 'e2e/fixtures/data/fixture-0';
  const fetched: string[] = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const rel = new URL(String(url)).pathname.replace('/data/fixture-0/', '');
    fetched.push(rel);
    if (new Headers(init?.headers).has('Range')) return new Response('range', { status: 206 });
    try {
      return new Response(readFileSync(join(fixture, rel)), {
        headers: { 'Content-Encoding': 'gzip', 'Content-Length': '1' }
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }) as typeof fetch;
  expect(await verify({ datasetVersion: 'fixture-0', origin: 'http://decoded', fetch: f })).toEqual(
    { ok: true, failures: [] }
  );
  const index = read(fixture, 'roofs/index.json');
  for (const c of index.chunks) {
    expect(fetched).toContain(c.headerUrl.replace('/data/fixture-0/', ''));
    expect(fetched).toContain(c.meshUrl.replace('/data/fixture-0/', ''));
  }
});

it('applies minimum height acceptance to the full building, allowing a lower clipped parcel piece', async () => {
  const { checkRoofArtifacts } = await import('../roofs/check');
  const { createHash } = await import('node:crypto');
  const { gzipSync } = await import('node:zlib');
  const { d, index, manifest } = await dataset();
  const ref = index.chunks[0],
    header = read(d, `roofs/${ref.chunkId}.json`),
    path = join(d, `roofs/${ref.chunkId}.bin`),
    bin = readFileSync(path);
  for (let i = 2; i < header.buffers.positions.count; i += 3) {
    const at = header.buffers.positions.offset + i * 4;
    bin.writeFloatLE(bin.readFloatLE(at) * 0.2, at);
  }
  writeFileSync(path, bin);
  ref.meshSha256 = createHash('sha256').update(bin).digest('hex');
  ref.gzipBytes =
    gzipSync(bin, { level: 9 }).length +
    gzipSync(readFileSync(join(d, `roofs/${ref.chunkId}.json`)), { level: 9 }).length;
  write(d, 'roofs/index.json', index);
  expect(await checkRoofArtifacts(d, manifest)).toMatchObject({ ok: true, failures: [] });
});

it('audits complete imagery only with measured coverage evidence', async () => {
  const complete = await dataset(['aerial_complete_coverage']),
    unknown = await dataset(),
    partial = await dataset(['aerial_complete_coverage', 'aerial_partial_coverage']);
  expect(complete.audit.buildings[0].sources.imageryCoverage).toBe('complete');
  expect(unknown.audit.buildings[0].sources.imageryCoverage).toBe('unknown');
  expect(partial.audit.pieces[0].sources.imageryCoverage).toBe('partial');
});

/** Each hostile mutation starts from the actual generated, publishable archive closure. */
async function publishableFixture() {
  const { readLock } = await import('../lib/lock');
  const d = mkdtempSync(join(tmpdir(), 'roof-reviewed-'));
  dirs.push(d);
  cpSync('e2e/fixtures/data/fixture-0', d, { recursive: true });
  const puts: string[] = [],
    logs: string[] = [];
  const args = {
    outDir: d,
    datasetVersion: 'fixture-0',
    lock: readLock('pipeline/test/fixtures/mini/sources.lock.json'),
    rawDir: 'pipeline/test/fixtures/mini/raw',
    rawByName: true,
    target: {
      exists: async () => false,
      get: async () => false,
      put: async (key: string) => {
        puts.push(key);
      }
    },
    log: (line: string) => {
      logs.push(line);
    }
  };
  expect(await upload(args), logs.join('\n')).toBe(0);
  puts.length = 0;
  logs.length = 0;
  return { d, args, puts, logs };
}

it('V16 and upload reject a fallback omitted from both parent and audit despite matching roof summaries', async () => {
  const { checkDataset } = await import('../steps/check');
  const { FIXTURE_PROFILE } = await import('../config');
  const { d, args, puts, logs } = await publishableFixture();
  const report = read(d, 'report.json');
  const before = await checkDataset(d, FIXTURE_PROFILE, {
    counts: report.counts,
    reencodeIdentical: true
  });
  expect(before.every((r) => r.ok)).toBe(true);
  const audit = read(d, 'roofs/audit.json');
  const piece = audit.pieces.find((p: { outcome: string }) => p.outcome === 'footprint_fallback');
  const parent = audit.buildings.find(
    (b: { buildingId: string }) => b.buildingId === piece.buildingId
  );
  audit.pieces = audit.pieces.filter((p: { pieceId: string }) => p.pieceId !== piece.pieceId);
  parent.pieceIds = parent.pieceIds.filter((id: string) => id !== piece.pieceId);
  parent.parcelIds = [
    ...new Set(
      audit.pieces
        .filter((p: { buildingId: string }) => p.buildingId === parent.buildingId)
        .map((p: { parcelId: string | null }) => p.parcelId)
    )
  ];
  write(d, 'roofs/audit.json', audit);
  for (const path of ['report.json', 'roofs/report.json']) {
    const summary = read(d, path);
    summary.counts['roofs.pieces']--;
    summary.counts['roofs.fallback']--;
    write(d, path, summary);
  }
  const results = await checkDataset(d, FIXTURE_PROFILE, {
    counts: report.counts,
    reencodeIdentical: true
  });
  expect.soft(results.find((r) => r.id === 'V16')).toMatchObject({
    ok: false,
    detail: expect.stringMatching(/SQL pieces/)
  });
  expect(await upload(args)).toBe(1);
  expect(logs.join('\n')).toMatch(/SQL pieces/);
  expect(puts).toEqual([]);
});

it('rejects changed audit piece identity against the archived clipping identity even when all counts agree', async () => {
  const { d, args, puts, logs } = await publishableFixture();
  const audit = read(d, 'roofs/audit.json');
  const piece = audit.pieces.find((p: { outcome: string }) => p.outcome === 'footprint_fallback');
  const parent = audit.buildings.find(
    (b: { buildingId: string }) => b.buildingId === piece.buildingId
  );
  const oldId = piece.pieceId;
  piece.pieceId += '-forged';
  parent.pieceIds = parent.pieceIds.map((id: string) => (id === oldId ? piece.pieceId : id)).sort();
  audit.pieces.sort((a: { pieceId: string }, b: { pieceId: string }) =>
    a.pieceId.localeCompare(b.pieceId)
  );
  write(d, 'roofs/audit.json', audit);
  expect(await upload(args)).toBe(1);
  expect(logs.join('\n')).toMatch(/clipping.*identity/);
  expect(puts).toEqual([]);
});

it.each([
  '49',
  '50',
  'missing',
  'null',
  'ground-only',
  'zero-total',
  'null-total',
  'parent-disagrees'
])(
  'checks retained roof-training evidence through check, upload and HTTP verify (%s)',
  async (kind) => {
    const { checkRoofArtifacts } = await import('../roofs/check');
    const { d, args, puts, logs } = await publishableFixture();
    const audit = read(d, 'roofs/audit.json');
    const parents = new Set(
      audit.pieces
        .filter(
          (p: { outcome: string; method: string }) =>
            p.outcome === 'modelled' && p.method !== 'landmark'
        )
        .map((p: { buildingId: string }) => p.buildingId)
    );
    for (const record of [...audit.buildings, ...audit.pieces]) {
      if (!parents.has(record.buildingId)) continue;
      record.quality.retainedRoofTrainingCount = { value: 50, unavailableReason: null };
      if (kind === '49' || kind === 'ground-only')
        record.quality.retainedRoofTrainingCount.value = kind === '49' ? 49 : 0;
      if (kind === 'missing') delete record.quality.retainedRoofTrainingCount;
      if (kind === 'null')
        record.quality.retainedRoofTrainingCount = {
          value: null,
          unavailableReason: 'not_measured'
        };
      if (kind === 'zero-total') record.quality.returnsAfterRejection.value = 0;
      if (kind === 'null-total')
        record.quality.returnsAfterRejection = { value: null, unavailableReason: 'not_measured' };
      if (kind === 'parent-disagrees' && !('pieceId' in record))
        record.quality.retainedRoofTrainingCount.value = 51;
    }
    write(d, 'roofs/audit.json', audit);
    const result = await checkRoofArtifacts(d, read(d, 'manifest.json'));
    const valid = kind === '50';
    expect(result.ok).toBe(valid);
    if (!valid) expect(result.failures.join('\n')).toMatch(/V15.*retained roof.training/);
    expect(await upload(args), logs.join('\n')).toBe(valid ? 0 : 1);
    if (!valid) {
      expect(logs.join('\n')).toMatch(/V15.*retained roof.training/);
      expect(puts).toEqual([]);
    }
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).has('range')) return new Response('x', { status: 206 });
      const path = new URL(String(input)).pathname.slice('/data/fixture-0/'.length);
      return new Response(readFileSync(join(d, path)));
    }) as typeof fetch;
    const verified = await verify({
      datasetVersion: 'fixture-0',
      origin: 'http://offline',
      fetch: f
    });
    expect(verified.ok).toBe(valid);
    if (!valid) expect(verified.failures.join('\n')).toMatch(/V15.*retained roof.training/);
  }
);

it('emits the measured class-1 candidate count separately from retained ground support', () => {
  const d = 'e2e/fixtures/data/fixture-0';
  const audit = read(d, 'roofs/audit.json'),
    report = read(d, 'report.json');
  expect(audit.buildings.some((b: { pieceIds: string[] }) => b.pieceIds.length === 0)).toBe(true);
  for (const parent of audit.buildings.filter(
    (b: { outcome: string }) => b.outcome !== 'all_fallback'
  )) {
    const selected = parent.processing.selectedCandidate;
    const ref = report.roofArchives.find(
      (a: { name: string }) => a.name === `${parent.buildingId}-${selected}.json`
    );
    const candidate = read('pipeline/.cache/roof-artifacts', ref.sha256);
    expect(parent.quality.retainedRoofTrainingCount.value).toBe(candidate.trainingCount);
    expect(parent.quality.retainedRoofTrainingCount.value).toBeGreaterThanOrEqual(50);
    expect(parent.quality.retainedRoofTrainingCount.value).toBeLessThan(
      parent.quality.returnsAfterRejection.value
    );
  }
});

async function referenceGraph() {
  const { createHash } = await import('node:crypto');
  const root = mkdtempSync(join(tmpdir(), 'roof-references-'));
  dirs.push(root);
  const refs: import('../roofs/job').RoofArchive[] = [];
  const save = (name: string, value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const ref = {
      name,
      url: '',
      sha256,
      bytes: bytes.length,
      archiveKey: `roof-processing/${sha256}.${name.endsWith('.gz') ? 'gz' : 'json'}`
    };
    writeFileSync(join(root, sha256), bytes);
    refs.push(ref);
    return ref;
  };
  const raw = {
    name: 'node.laz',
    url: '',
    sha256: 'a'.repeat(64),
    bytes: 9,
    archiveKey: `sources/${'a'.repeat(64)}.laz`
  };
  const sourceData = {
    sources: [
      {
        kind: 'lidar',
        name: 'node.laz',
        sha256: raw.sha256,
        horizontalCrs: 'EPSG:7131',
        horizontalUnits: 'm',
        verticalUnits: 'm',
        supportBufferM: 50
      }
    ],
    sourceArchives: [raw],
    sourceStatus: [] as { spatial: { objects: { name: string; sha256: string }[] } }[]
  };
  const sources = save('sources.json', sourceData);
  const records = save('b-point-records.npy.gz', 'record-body');
  const pointData = {
    kind: 'roof-point-references',
    schemaVersion: 1,
    count: 3,
    sources,
    sourceShas: [raw.sha256],
    records,
    recordEncoding: 'npy-gzip-source-u32-ordinal-u64-le-v1',
    coordinateRecipe: 'laspy-scaled-xy-to-epsg7131-z-unchanged-v1',
    order: 'source-sha-ordinal-v1',
    logicalSha256: 'b'.repeat(64)
  };
  const points = save('b-points.refs.json', pointData);
  const mask = save('b-mask.npy.gz', 'mask-body');
  const preTrainingRows = save('b-preTrainingRows.npy.gz', 'pretraining-body');
  const validationRows = save('b-validationRows.npy.gz', 'validation-body');
  const subsetData = {
    kind: 'roof-point-subsets',
    schemaVersion: 1,
    points,
    mask,
    preTrainingRows,
    preTrainingCount: 2,
    validationRows,
    validationCount: 1,
    rowEncoding: 'npy-gzip-u64-le-v1',
    groundMHex: '0x1.0000000000000p+0',
    trainingLogicalSha256: 'c'.repeat(64),
    validationLogicalSha256: 'd'.repeat(64)
  };
  const subsets = save('b-subsets.refs.json', subsetData);
  return {
    root,
    refs,
    save,
    sources,
    sourceData,
    pointData,
    points,
    subsetData,
    subsets,
    records,
    mask,
    preTrainingRows,
    validationRows
  };
}

it.each(['sources', 'records', 'points', 'mask', 'preTrainingRows', 'validationRows'] as const)(
  'rejects missing nested point child %s before the first upload put',
  async (role) => {
    const graph = await referenceGraph();
    const { checkRoofArchives } = await import('../roofs/archives');
    const refs = graph.refs.filter((r) => r !== graph[role]);
    await expect(checkRoofArchives({ roofArchives: refs }, graph.root)).rejects.toThrow(
      `missing roof archive closure: ${graph[role].archiveKey}`
    );
    const { d } = await dataset();
    const report = read(d, 'report.json');
    report.roofArchives = refs;
    write(d, 'report.json', report);
    const puts: string[] = [],
      logs: string[] = [];
    const code = await upload({
      outDir: d,
      datasetVersion: 'fixture-0',
      lock: { sources: [] },
      rawDir: graph.root,
      roofArchiveDir: graph.root,
      target: {
        exists: async () => false,
        get: async () => false,
        put: async (k) => {
          puts.push(k);
        }
      },
      log: (s) => logs.push(s)
    });
    expect(code).toBe(1);
    expect(puts).toEqual([]);
    expect(logs.join('\n')).toMatch(/missing roof archive closure/);
  }
);

it.each([
  'version',
  'dictionary',
  'source metadata',
  'source role',
  'raw source',
  'hierarchy',
  'conflict',
  'subset count',
  'encoding'
])('fails closed on malformed point reference %s', async (failure) => {
  const g = await referenceGraph();
  const { checkRoofArchives } = await import('../roofs/archives');
  if (failure === 'version') g.pointData.schemaVersion = 2;
  if (failure === 'dictionary') g.pointData.sourceShas.push(g.pointData.sourceShas[0]);
  if (failure === 'source metadata') g.sourceData.sources = [];
  if (failure === 'raw source') g.sourceData.sourceArchives = [];
  if (failure === 'hierarchy')
    g.sourceData.sourceStatus.push({
      spatial: { objects: [{ name: 'ept-hierarchy/0-0-0-0.json', sha256: 'e'.repeat(64) }] }
    });
  if (failure === 'conflict')
    g.sourceData.sources.push({ ...g.sourceData.sources[0], supportBufferM: 51 });
  if (failure === 'subset count') g.subsetData.preTrainingCount = 4;
  if (failure === 'encoding') g.subsetData.rowEncoding = 'npy-u16';
  const sources = g.save('sources.json', g.sourceData);
  const points = g.save('b-points.refs.json', { ...g.pointData, sources });
  const subsets = g.save('b-subsets.refs.json', { ...g.subsetData, points });
  const refs = g.refs.filter((r) => ![g.sources, g.points, g.subsets].includes(r));
  // Content-addressed duplicate source objects collapse in the report.
  const unique = [...new Map(refs.map((r) => [r.archiveKey, r])).values()];
  if (failure === 'source role') sources.name = 'renamed.json';
  expect(subsets.name).toBe('b-subsets.refs.json');
  await expect(checkRoofArchives({ roofArchives: unique }, g.root)).rejects.toThrow(
    /point|subset|source/
  );
  const { d } = await dataset();
  const report = read(d, 'report.json');
  report.roofArchives = unique;
  write(d, 'report.json', report);
  const puts: string[] = [];
  expect(
    await upload({
      outDir: d,
      datasetVersion: 'fixture-0',
      lock: { sources: [] },
      rawDir: g.root,
      roofArchiveDir: g.root,
      target: {
        exists: async () => false,
        get: async () => false,
        put: async (key) => {
          puts.push(key);
        }
      },
      log: () => {}
    })
  ).toBe(1);
  expect(puts).toEqual([]);
});

it('keeps frozen old/new meshes, headers and all audit fields except input archive references identical', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const { prepareRoofPiece, projectedToLocal } = await import('../roofs/export');
  const proj4 = (await import('proj4')).default;
  const { ROOF_PYTHON } = await import('../roofs/setup');
  const root = mkdtempSync(join(tmpdir(), 'roof-export-parity-'));
  dirs.push(root);
  execFileSync(
    ROOF_PYTHON,
    [
      '-m',
      'unittest',
      'test_point_archives.PointArchivesTests.test_permitted_aerial_frozen_native_parity_and_independent_membership'
    ],
    {
      cwd: 'pipeline/roofs/tests',
      env: { ...process.env, ROOF_PARITY_OUTPUT: root }
    }
  );
  const runs = read(root, 'parity.json') as {
    building: import('../roofs/job').ProcessedBuilding;
    pieces: import('../roofs/job').ClippedRoofPiece[];
  }[];
  expect(runs[0].building.candidates).toEqual(runs[1].building.candidates);
  expect(runs[0].pieces).toEqual(runs[1].pieces);
  const audits = [];
  for (const [i, run] of runs.entries()) {
    const anchor = proj4('EPSG:7131', 'EPSG:4326', [0, 0]) as [number, number];
    const bbox: [number, number, number, number] = [
      anchor[0],
      anchor[1],
      anchor[0] + 0.0001,
      anchor[1] + 0.0001
    ];
    const method = run.building.method;
    if (method === 'footprint') throw new Error('parity fixture must model a roof');
    const exported = run.pieces
      .filter((p) => p.mesh)
      .map((p) =>
        prepareRoofPiece({
          pieceId: p.pieceId,
          buildingId: 'aerial',
          parcelId: p.parcelId,
          method,
          cellId: '0_0',
          projectedOrigin: [0, 0],
          anchor,
          mesh: { ...p.mesh!, vertices: p.mesh!.vertices.map((v) => projectedToLocal(v, anchor)) },
          bbox
        })
      );
    await encodeRoofArtifacts(exported, {
      outDir: join(root, String(i)),
      datasetVersion: 'fixture-0'
    });
    const audit = buildRoofAudit(
      [run.building],
      run.pieces,
      [{ buildingId: 'aerial', bbox, neighborhood: null, heightM: 5 }],
      'fixture-0',
      join(root, 'artifacts'),
      new Map(run.pieces.map((p) => [p.pieceId, bbox]))
    );
    // The only intentional audit difference in this fixed-version comparison.
    for (const record of [...audit.buildings, ...audit.pieces])
      record.followUp.inputArtifactRefs = [];
    audits.push(audit);
  }
  expect(audits[0]).toEqual(audits[1]);
  for (const name of readdirSync(join(root, '0/roofs')))
    expect(readFileSync(join(root, '0/roofs', name))).toEqual(
      readFileSync(join(root, '1/roofs', name))
    );
}, 30000);

const invalidGroundHex = [
  '0x1.0000000000000p+1024',
  '0x1.0000000000000p-1075',
  '0x1.0000000000000p-1023',
  '0x0.0000000000000p-1022',
  '0x0.0p-0',
  '0x1.0p+0',
  '0x1.0000000000000p+00',
  '0x1.0000000000000p-0',
  '0x1.0000000000000p+0\n'
];
const canonicalGroundHex = [
  '0x1.0000000000000p+0',
  '0x1.fffffffffffffp+1023',
  '-0x1.fffffffffffffp+1023',
  '0x1.0000000000000p-1022',
  '0x0.fffffffffffffp-1022',
  '0x0.0000000000001p-1022',
  '-0x0.0000000000001p-1022',
  '0x0.0p+0',
  '-0x0.0p+0'
];

it.each([
  'length',
  'corruption',
  'source-role-laz',
  'source-role-metadata',
  'source-role-hierarchy',
  ...invalidGroundHex,
  ...canonicalGroundHex
])(
  'checks private roof integrity %s from an otherwise valid upload before the first put',
  async (failure) => {
    const { createHash } = await import('node:crypto');
    const { symlinkSync, statSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { readLock } = await import('../lib/lock');
    const root = mkdtempSync(join(tmpdir(), 'roof-raw-length-'));
    dirs.push(root);
    const out = join(root, 'dataset'),
      archiveDir = join(root, 'archives');
    cpSync('e2e/fixtures/data/fixture-0', out, { recursive: true });
    cpSync('pipeline/test/fixtures/mini/raw', join(root, 'raw'), { recursive: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(archiveDir);
    const report = read(out, 'report.json');
    const original = report.roofArchives as import('../roofs/job').RoofArchive[];
    for (const ref of original)
      symlinkSync(
        resolve('pipeline/.cache/roof-artifacts', ref.sha256),
        join(archiveDir, ref.sha256)
      );
    const puts: string[] = [],
      logs: string[] = [];
    const opts = {
      outDir: out,
      datasetVersion: 'fixture-0',
      lock: readLock('pipeline/test/fixtures/mini/sources.lock.json'),
      rawDir: join(root, 'raw'),
      rawByName: true,
      roofArchiveDir: archiveDir,
      target: {
        exists: async () => false,
        get: async () => false,
        put: async (key: string) => {
          puts.push(key);
        }
      },
      log: (s: string) => logs.push(s)
    };
    const replacements = new Map<string, import('../roofs/job').RoofArchive>();
    const save = (ref: import('../roofs/job').RoofArchive, value: unknown) => {
      const bytes = Buffer.from(JSON.stringify(value));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const next = {
        ...ref,
        sha256,
        bytes: bytes.length,
        archiveKey: `roof-processing/${sha256}.json`
      };
      writeFileSync(join(archiveDir, sha256), bytes);
      replacements.set(ref.archiveKey, next);
    };
    const rewrite = (value: unknown): unknown => {
      if (typeof value === 'string') return replacements.get(value)?.archiveKey ?? value;
      if (!value || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(rewrite);
      const record = value as Record<string, unknown>;
      if (typeof record.archiveKey === 'string' && replacements.has(record.archiveKey))
        return replacements.get(record.archiveKey);
      return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, rewrite(v)]));
    };
    const edited = new Set<string>();
    const publish = () => {
      for (let pass = 0; pass < 5; pass++) {
        for (const ref of original.filter(
          (a) => a.archiveKey.endsWith('.json') && !edited.has(a.archiveKey)
        )) {
          const value = read(archiveDir, ref.sha256),
            next = rewrite(value);
          if (JSON.stringify(next) !== JSON.stringify(value)) save(ref, next);
        }
      }
      report.roofArchives = original.map((a) => replacements.get(a.archiveKey) ?? a);
      const audit = rewrite(read(out, 'roofs/audit.json')) as Parameters<typeof writeRoofAudit>[1];
      const auditBytes = writeRoofAudit(join(out, 'roofs/audit.json'), audit);
      const roofReport = read(out, 'roofs/report.json');
      for (const counts of [report.counts, roofReport.counts]) {
        counts['roofs.audit_bytes'] = auditBytes;
        counts['roofs.archive_bytes'] = report.roofArchives.reduce(
          (n: number, a: { bytes: number }) => n + a.bytes,
          0
        );
      }
      write(out, 'report.json', report);
      write(out, 'roofs/report.json', roofReport);
    };
    const sourceRef = original.find((a) => a.name === 'sources.json')!;
    edited.add(sourceRef.archiveKey);
    const source = read(archiveDir, sourceRef.sha256);
    const raw = source.sourceArchives.find((a: { name: string }) => a.name.endsWith('.laz'));
    expect(statSync(join(opts.rawDir, raw.name)).size).toBe(raw.bytes);
    // Give the successful baseline real, hash-valid metadata/hierarchy closure as well.
    if (failure.startsWith('source-role-')) {
      for (const name of ['ept.json', 'ept-hierarchy.json']) {
        const bytes = Buffer.from(JSON.stringify({ name }));
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        writeFileSync(join(opts.rawDir, name), bytes);
        const ref = { name, sha256, bytes: bytes.length, archiveKey: `sources/${sha256}.json` };
        source.sourceArchives.push(ref);
        source.sourceStatus[1].spatial.objects.push({ name, sha256 });
      }
      save(sourceRef, source);
      publish();
    }
    expect(await upload(opts), logs.join('\n')).toBe(0);
    expect(puts.at(-1)).toBe('data/fixture-0/manifest.json');
    puts.length = 0;
    logs.length = 0;
    let expected = /raw roof archive.*length/;
    if (failure.startsWith('source-role-')) {
      const missing =
        failure === 'source-role-laz'
          ? raw.name
          : failure === 'source-role-metadata'
            ? 'ept.json'
            : 'ept-hierarchy.json';
      rmSync(join(opts.rawDir, missing));
      report.roofArchives.find((a: { name: string }) => a.name === 'sources.json').name =
        'renamed.json';
      write(out, 'report.json', report);
      expected = /source.*role/;
    } else if (failure === 'corruption') {
      const path = join(opts.rawDir, raw.name),
        bytes = readFileSync(path);
      bytes[0] ^= 1;
      writeFileSync(path, bytes);
      expected = /raw roof archive.*hash/;
    } else {
      if (failure === 'length') {
        raw.bytes++;
        save(sourceRef, source);
      } else {
        const ref = original.find((a) => a.name.endsWith('-subsets.refs.json'))!;
        edited.add(ref.archiveKey);
        save(ref, { ...read(archiveDir, ref.sha256), groundMHex: failure });
        expected = /malformed point subset/;
      }
      publish();
    }
    const valid = canonicalGroundHex.includes(failure);
    expect(await upload(opts), logs.join('\n')).toBe(valid ? 0 : 1);
    if (valid) expect(puts.at(-1)).toBe('data/fixture-0/manifest.json');
    else {
      expect(puts).toEqual([]);
      expect(logs.join('\n')).toMatch(expected);
    }
  },
  30000
);

it('reports the effective prerelease algorithm for every building and piece', async () => {
  const { audit } = await dataset();
  for (const row of [...audit.buildings, ...audit.pieces]) {
    expect(row.processing.algorithm).toBe('roofer-1.1.0-beta.1-lod2.2');
    expect(row.processing.toolVersions.roofer).toBe('1.1.0-beta.1');
  }
});
