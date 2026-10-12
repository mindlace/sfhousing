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
    returnsAfterRejection: 100
  }))
    Object.assign(model.quality[key as keyof typeof model.quality], {
      value,
      unavailableReason: null
    });
  model.quality.returnsBeforeRejection = { value: 100, unavailableReason: null };
  audit.buildings[1].outcome = 'fully_modelled';
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
  expect(rebuilt.buildings[0].mesh).toEqual(result.buildings[0].mesh);
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

it('rejects an inward closed mesh even with updated child hash and gzip metadata', async () => {
  const { checkRoofArtifacts } = await import('../roofs/check');
  const { createHash } = await import('node:crypto');
  const { gzipSync } = await import('node:zlib');
  const { d, index, manifest } = await dataset();
  const ref = index.chunks[0],
    header = read(d, `roofs/${ref.chunkId}.json`),
    path = join(d, `roofs/${ref.chunkId}.bin`),
    bin = readFileSync(path);
  for (let i = 0; i < header.buffers.indices.count; i += 3) {
    const at = header.buffers.indices.offset + i * 4,
      a = bin.readUInt32LE(at + 4),
      b = bin.readUInt32LE(at + 8);
    bin.writeUInt32LE(b, at + 4);
    bin.writeUInt32LE(a, at + 8);
  }
  writeFileSync(path, bin);
  ref.meshSha256 = createHash('sha256').update(bin).digest('hex');
  ref.gzipBytes =
    gzipSync(bin, { level: 9 }).length +
    gzipSync(readFileSync(join(d, `roofs/${ref.chunkId}.json`)), { level: 9 }).length;
  write(d, 'roofs/index.json', index);
  expect((await checkRoofArtifacts(d, manifest)).failures.join(' ')).toMatch(/V15/);
});

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
