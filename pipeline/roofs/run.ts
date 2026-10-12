import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, copyFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
export async function runRoofJob(
  job: RoofJob
): Promise<{ buildings: ProcessedBuilding[]; archives: RoofArchive[] }> {
  mkdirSync(job.workDir, { recursive: true });
  const jobPath = join(job.workDir, 'job.json');
  writeFileSync(jobPath, JSON.stringify(job) + '\n');
  const execution = await run(ROOF_PYTHON, [
    join(ROOT, 'pipeline/roofs/process.py'),
    '--job',
    jobPath
  ]);
  if (execution.code !== 0)
    throw new Error(`roof processing integrity failure: ${execution.stderr || execution.stdout}`);
  const result = validateRoofResult(
    JSON.parse(readFileSync(join(job.workDir, 'result.json'), 'utf8')),
    job.buildings
  );
  const cache = join(ROOT, 'pipeline/.cache/roof-artifacts');
  mkdirSync(cache, { recursive: true });
  for (const a of result.archives) {
    const source = join(job.workDir, 'artifacts', a.sha256);
    if (
      statSync(source).size !== a.bytes ||
      createHash('sha256').update(readFileSync(source)).digest('hex') !== a.sha256
    )
      throw new Error(`roof archive integrity failure: ${a.archiveKey}`);
    copyFileSync(source, join(cache, a.sha256));
  }
  return result;
}
