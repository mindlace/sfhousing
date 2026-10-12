import { RoofReasonSchema } from '../../src/lib/data/roof-audit';
import { sha256File } from '../lib/lock';
import { mkdirSync, copyFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createReadStream, openSync, writeSync, closeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { run } from '../lib/exec';
import { ROOF_PYTHON } from './setup';
import type { RoofJob, ProcessedBuilding, RoofArchive, RoofMesh } from './job';

const ROOT = resolve(import.meta.dirname, '../..');
function validMesh(mesh: RoofMesh): boolean {
  if (
    !Array.isArray(mesh.vertices) ||
    !Array.isArray(mesh.triangles) ||
    !mesh.triangles.length ||
    !Array.isArray(mesh.semantics) ||
    mesh.semantics.length !== mesh.triangles.length
  )
    return false;
  if (!mesh.vertices.every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)))
    return false;
  return mesh.triangles.every(
    (t) =>
      Array.isArray(t) &&
      t.length === 3 &&
      t.every((i) => Number.isSafeInteger(i) && i >= 0 && i < mesh.vertices.length) &&
      new Set(t).size === 3
  );
}
export function usedRoofSourceIds(
  buildings: Pick<ProcessedBuilding, 'method' | 'usedSources'>[]
): string[] {
  return [...new Set(buildings.flatMap((b) => b.usedSources ?? []))].sort();
}

export function validateRoofResult(
  value: unknown,
  inputs: RoofJob['buildings']
): {
  buildings: ProcessedBuilding[];
  archives: RoofArchive[];
} {
  const result = value as { buildings: ProcessedBuilding[]; archives: RoofArchive[] };
  if (
    !result ||
    !Array.isArray(result.buildings) ||
    result.buildings.length !== inputs.length ||
    !Array.isArray(result.archives)
  )
    throw new Error('roof result missing building outcomes');
  const expected = new Map(inputs.map((b) => [b.buildingId, b.footprintHash]));
  const seen = new Set<string>();
  for (const b of result.buildings) {
    if (
      !b ||
      !expected.has(b.buildingId) ||
      expected.get(b.buildingId) !== b.footprintHash ||
      seen.has(b.buildingId)
    )
      throw new Error('roof result building identity mismatch');
    seen.add(b.buildingId);
    if (
      !['footprint', 'lidar_only', 'lidar_aerial', 'landmark'].includes(b.method) ||
      (b.usedSources !== undefined &&
        (!Array.isArray(b.usedSources) ||
          !b.usedSources.every((s) => ['roof-lidar', 'roof-aerial'].includes(s)))) ||
      !Array.isArray(b.flags) ||
      !Array.isArray(b.candidates) ||
      !Array.isArray(b.archives)
    )
      throw new Error('corrupt roof result building');
    if (
      b.method === 'footprint'
        ? b.mesh !== null || !b.reason
        : !b.mesh || b.reason !== null || !validMesh(b.mesh)
    )
      throw new Error('corrupt roof result mesh/outcome');
    if (!b.flags.every((flag) => RoofReasonSchema.safeParse(flag).success))
      throw new Error('unsupported roof result flag');
    if (b.method !== 'footprint') {
      const selected = b.candidates.find((c) => c.name === b.selectedCandidate);
      if (
        !selected?.mesh ||
        selected.metrics?.reason !== null ||
        JSON.stringify(selected.mesh) !== JSON.stringify(b.mesh) ||
        !b.ground ||
        !Number.isFinite(b.ground.groundM)
      )
        throw new Error('corrupt roof selected candidate/ground evidence');
    }
  }
  const refs = new Map<string, RoofArchive>();
  for (const a of result.archives) {
    if (
      !a ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes < 0 ||
      !new RegExp(`^roof-processing/${a.sha256}\\.[a-z0-9]+$`).test(a.archiveKey) ||
      refs.has(a.archiveKey)
    )
      throw new Error('corrupt roof archive descriptor');
    refs.set(a.archiveKey, a);
  }
  for (const b of result.buildings)
    for (const a of b.archives) {
      const ref = refs.get(a.archiveKey);
      if (!ref || ref.sha256 !== a.sha256 || ref.bytes !== a.bytes)
        throw new Error('inconsistent roof archive reference');
    }
  return result;
}
/** Bounded internal records avoid Node's city-scale single-string limit. */
export function writeRoofRecords(path: string, groups: Record<string, Iterable<unknown>>): void {
  const fd = openSync(path, 'w');
  const counts: Record<string, number> = {};
  const write = (value: unknown) => {
    const data = Buffer.from(JSON.stringify(value) + '\n');
    let offset = 0;
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset);
  };
  try {
    for (const [type, values] of Object.entries(groups)) {
      let count = 0;
      for (const value of values) {
        write({ type, value });
        count++;
      }
      counts[`${type}Count`] = count;
    }
    write({ type: 'end', ...counts });
  } finally {
    closeSync(fd);
  }
}

async function readRecords(path: string, kinds: string[]): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = Object.fromEntries(kinds.map((k) => [k, []]));
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let ended = false;
  try {
    for await (const line of lines) {
      if (ended) throw new Error('roof record after terminal counts');
      const record = JSON.parse(line);
      if (record.type === 'end') {
        if (kinds.some((k) => record[`${k}Count`] !== result[k].length))
          throw new Error('roof terminal counts mismatch');
        ended = true;
      } else if (kinds.includes(record.type) && record.value) {
        result[record.type].push(record.value);
      } else throw new Error('unknown roof record');
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  if (!ended) throw new Error('incomplete roof records');
  return result;
}

export async function readRoofResultRecords(path: string, inputs: RoofJob['buildings']) {
  const records = await readRecords(path, ['building', 'archive']);
  return validateRoofResult({ buildings: records.building, archives: records.archive }, inputs);
}

export async function runRoofJob(
  job: RoofJob
): Promise<{ buildings: ProcessedBuilding[]; archives: RoofArchive[] }> {
  mkdirSync(job.workDir, { recursive: true });
  const jobPath = join(job.workDir, 'job.json');
  writeFileSync(jobPath, JSON.stringify(job) + '\n');
  const execution = await run(ROOF_PYTHON, [
    join(ROOT, 'pipeline/roofs/process.py'),
    '--job',
    jobPath,
    '--result-format',
    'ndjson'
  ]);
  if (execution.code !== 0)
    throw new Error(`roof processing integrity failure: ${execution.stderr || execution.stdout}`);
  const result = await readRoofResultRecords(join(job.workDir, 'result.ndjson'), job.buildings);
  const cache = join(ROOT, 'pipeline/.cache/roof-artifacts');
  mkdirSync(cache, { recursive: true });
  for (const a of result.archives) {
    const source = join(job.workDir, 'artifacts', a.sha256);
    if (statSync(source).size !== a.bytes || (await sha256File(source)) !== a.sha256)
      throw new Error(`roof archive integrity failure: ${a.archiveKey}`);
    copyFileSync(source, join(cache, a.sha256));
  }
  return result;
}

/** Identity and intersection use the same offline canonical geometry implementation. */
export async function clipRoofPieces(
  buildings: ProcessedBuilding[],
  pieces: import('./job').RoofInputPiece[],
  workDir: string
): Promise<import('./job').ClippedRoofPiece[]> {
  mkdirSync(workDir, { recursive: true });
  const path = join(workDir, 'clip-job.ndjson');
  writeRoofRecords(path, {
    building: buildings.map(({ buildingId, mesh, reason }) => ({ buildingId, mesh, reason })),
    piece: pieces
  });
  const execution = await run(ROOF_PYTHON, [
    join(ROOT, 'pipeline/roofs/process.py'),
    '--clip-job',
    path,
    '--result-format',
    'ndjson'
  ]);
  if (execution.code !== 0) throw new Error(`roof clipping integrity failure: ${execution.stderr}`);
  const records = await readRecords(join(workDir, 'result.ndjson'), ['piece']);
  const result = records.piece as import('./job').ClippedRoofPiece[];
  if (result.length !== pieces.length) throw new Error('missing roof piece outcomes');
  const expected = new Map(pieces.map((p) => [JSON.stringify([p.buildingId, p.parcelId]), p]));
  const seen = new Set<string>();
  for (const p of result) {
    const key = JSON.stringify([p.buildingId, p.parcelId]);
    if (!expected.delete(key) || seen.has(p.pieceId) || !/^p-[a-f0-9]{24}$/.test(p.pieceId))
      throw new Error('roof piece identity mismatch');
    seen.add(p.pieceId);
    if (
      p.mesh
        ? p.reason !== null || !validMesh(p.mesh)
        : !RoofReasonSchema.safeParse(p.reason).success
    )
      throw new Error('invalid clipped roof outcome');
  }
  return result;
}
