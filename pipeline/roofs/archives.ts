import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256File } from '../lib/lock';
import type { R2Target } from '../lib/r2';
import type { RoofArchive } from './job';
import toolchain from './toolchain.json';

export const ROOF_ARCHIVE_DIR = resolve(import.meta.dirname, '../.cache/roof-artifacts');
export const ROOF_DEPENDENCY_DIR = resolve(import.meta.dirname, '../.cache/roof-dependencies');
export function parseRoofArchives(report: unknown): RoofArchive[] {
  const refs = (report as { roofArchives?: unknown })?.roofArchives;
  if (!Array.isArray(refs)) throw new Error('missing roofArchives: rebuild this dataset');
  const seen = new Set<string>();
  for (const a of refs) {
    if (
      !a ||
      typeof a.name !== 'string' ||
      typeof a.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(a.sha256) ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes < 0 ||
      typeof a.archiveKey !== 'string' ||
      !new RegExp(`^roof-processing/${a.sha256}\\.[a-z0-9]+$`).test(a.archiveKey) ||
      seen.has(a.archiveKey)
    )
      throw new Error('invalid or duplicate roof archive descriptor');
    seen.add(a.archiveKey);
  }
  return refs as RoofArchive[];
}
export async function verifyRoofArchive(ref: RoofArchive, archiveDir: string): Promise<void> {
  const path = join(archiveDir, ref.sha256);
  if (
    !existsSync(path) ||
    statSync(path).size !== ref.bytes ||
    (await sha256File(path)) !== ref.sha256
  )
    throw new Error(`roof archive missing or hash/length mismatch: ${ref.archiveKey}`);
}
/** All pinned wheels and roofer source/releases are part of a reproducible offline run. */
export function toolchainArchives(): RoofArchive[] {
  const pins = [
    ...toolchain.wheels,
    toolchain.roofer.source,
    ...Object.values(toolchain.roofer.platforms)
  ];
  return pins.map((p) => ({
    name: 'filename' in p ? String(p.filename) : new URL(p.url).pathname.split('/').at(-1)!,
    url: p.url,
    sha256: p.sha256,
    bytes: p.bytes,
    archiveKey: `roof-processing/${p.sha256}.${'filename' in p ? 'whl' : 'gz'}`
  }));
}
export async function archiveRoofDependencies(
  archiveDir = ROOF_ARCHIVE_DIR,
  cacheDir = ROOF_DEPENDENCY_DIR
): Promise<RoofArchive[]> {
  const refs = toolchainArchives();
  mkdirSync(archiveDir, { recursive: true });
  for (const ref of refs) {
    const target = join(archiveDir, ref.sha256);
    if (!existsSync(target)) {
      await verifyRoofArchive(ref, cacheDir);
      copyFileSync(join(cacheDir, ref.sha256), target);
    }
    await verifyRoofArchive(ref, archiveDir);
  }
  return refs;
}
/** Check transitive portable input descriptors as well as every named archive's bytes. */
export async function checkRoofArchives(
  report: unknown,
  archiveDir: string
): Promise<RoofArchive[]> {
  const refs = parseRoofArchives(report),
    byKey = new Map(refs.map((a) => [a.archiveKey, a]));
  for (const ref of refs) await verifyRoofArchive(ref, archiveDir);
  const requireRef = (raw: unknown) => {
    const a = raw as RoofArchive,
      known = byKey.get(a?.archiveKey);
    if (!known || known.sha256 !== a.sha256 || known.bytes !== a.bytes)
      throw new Error(`missing roof archive closure: ${a?.archiveKey}`);
  };
  for (const ref of refs.filter((a) => a.name.endsWith('-input.json'))) {
    const input = JSON.parse(readFileSync(join(archiveDir, ref.sha256), 'utf8'));
    requireRef(input.sources);
    requireRef(input.config);
    if (
      !Array.isArray(input.dependencies) ||
      !input.dependencies.length ||
      !Array.isArray(input.extracts)
    )
      throw new Error('incomplete portable roof job');
    for (const child of [...input.dependencies, ...input.extracts]) requireRef(child);
  }
  for (const ref of refs.filter((a) => a.name.endsWith('-clip.json'))) {
    const clip = JSON.parse(readFileSync(join(archiveDir, ref.sha256), 'utf8'));
    if (!Array.isArray(clip.dependencies) || !Array.isArray(clip.inputArtifactRefs))
      throw new Error('incomplete clipping archive closure');
    for (const dependency of clip.dependencies) requireRef(dependency);
    for (const key of clip.inputArtifactRefs)
      if (!byKey.has(key)) throw new Error(`missing clipping input archive closure: ${key}`);
  }
  for (const ref of toolchainArchives()) requireRef(ref);
  return refs;
}
export async function restoreRoofArtifacts(
  report: unknown,
  archiveDir: string,
  r2: R2Target
): Promise<void> {
  const refs = parseRoofArchives(report);
  mkdirSync(archiveDir, { recursive: true });
  for (const ref of refs) {
    const dest = join(archiveDir, ref.sha256),
      part = `${dest}.part`;
    if (existsSync(dest)) {
      await verifyRoofArchive(ref, archiveDir);
      continue;
    }
    try {
      if (!(await r2.get(ref.archiveKey, part)))
        throw new Error(`missing roof processing archive ${ref.archiveKey}`);
      if (statSync(part).size !== ref.bytes || (await sha256File(part)) !== ref.sha256)
        throw new Error(`roof archive hash/length mismatch: ${ref.archiveKey}`);
      renameSync(part, dest);
    } finally {
      rmSync(part, { force: true });
    }
  }
  await checkRoofArchives(report, archiveDir);
}

/** Raw references live once in the shared portable source descriptor. */
export function roofRawArchives(refs: RoofArchive[], archiveDir: string): RoofArchive[] {
  const files = new Map<string, RoofArchive>();
  for (const ref of refs.filter((a) => a.name === 'sources.json')) {
    const source = JSON.parse(readFileSync(join(archiveDir, ref.sha256), 'utf8'));
    if (!Array.isArray(source.sourceArchives)) throw new Error('missing portable source archives');
    for (const a of source.sourceArchives) {
      if (
        !a ||
        !/^[a-f0-9]{64}$/.test(a.sha256) ||
        !Number.isSafeInteger(a.bytes) ||
        a.bytes < 0 ||
        !new RegExp(`^sources/${a.sha256}\\.[a-z0-9]+$`).test(a.archiveKey)
      )
        throw new Error('invalid raw roof archive reference');
      const old = files.get(a.archiveKey);
      if (old && (old.bytes !== a.bytes || old.sha256 !== a.sha256))
        throw new Error('conflicting raw roof archive reference');
      files.set(a.archiveKey, a);
    }
    const sourceHashes = new Set(source.sourceArchives.map((a: RoofArchive) => a.sha256));
    for (const s of source.sources)
      if (!sourceHashes.has(s.sha256))
        throw new Error(`missing raw roof source closure: ${s.name}`);
  }
  return [...files.values()];
}

export async function checkAuditArchiveClosure(
  auditPath: string,
  version: string,
  refs: RoofArchive[],
  archiveDir: string
): Promise<void> {
  const { streamRoofAudit } = await import('./audit-reader');
  const byKey = new Map(refs.map((a) => [a.archiveKey, a]));
  const inputs = new Map(
    refs.filter((a) => a.name.endsWith('-input.json')).map((a) => [a.name, a])
  );
  const clips = new Map(refs.filter((a) => a.name.endsWith('-clip.json')).map((a) => [a.name, a]));
  const clippedPieces = new Map<
    string,
    { buildingId: string; parcelId: string | null; modelled: boolean }
  >();
  let buildings = 0;
  await streamRoofAudit(auditPath, version, (kind, value) => {
    for (const key of [
      ...value.sources.files,
      ...value.followUp.inputArtifactRefs,
      ...value.followUp.candidateArtifactRefs,
      ...value.processing.attempts.flatMap((a) => a.artifactRefs)
    ])
      if (!byKey.has(key)) throw new Error(`missing audit processing archive ${key}`);
    if (kind === 'buildings') {
      buildings++;
      const parent = value as import('../../src/lib/data/roof-audit').RoofBuildingAudit;
      const clipRef = clips.get(`${value.buildingId}-clip.json`);
      if (clipRef) {
        const clip = JSON.parse(readFileSync(join(archiveDir, clipRef.sha256), 'utf8'));
        if (
          clip.buildingId !== value.buildingId ||
          !Array.isArray(clip.pieces) ||
          clip.pieces.length !== parent.pieceIds.length
        )
          throw new Error('archived clipping piece identity mismatch');
        const expectedIds = new Set(parent.pieceIds);
        for (const piece of clip.pieces) {
          if (
            piece.buildingId !== value.buildingId ||
            !expectedIds.delete(piece.pieceId) ||
            clippedPieces.has(piece.pieceId)
          )
            throw new Error('archived clipping piece identity mismatch');
          clippedPieces.set(piece.pieceId, {
            buildingId: piece.buildingId,
            parcelId: piece.parcelId,
            modelled: piece.mesh !== null
          });
        }
        if (expectedIds.size) throw new Error('archived clipping piece identity mismatch');
      }
      const ref = inputs.get(`${value.buildingId}-input.json`);
      if (!ref) throw new Error(`missing portable building archive ${value.buildingId}`);
      const input = JSON.parse(readFileSync(join(archiveDir, ref.sha256), 'utf8'));
      if (
        input.datasetVersion !== version ||
        input.building.buildingId !== value.buildingId ||
        input.building.footprintHash !== value.footprintHash ||
        input.config.sha256 !== value.processing.configurationHash
      )
        throw new Error('portable building/audit identity mismatch');
    } else {
      const piece = value as import('../../src/lib/data/roof-audit').RoofPieceAudit;
      const clipped = clippedPieces.get(piece.pieceId);
      if (
        clips.has(`${piece.buildingId}-clip.json`) &&
        (!clipped ||
          clipped.buildingId !== piece.buildingId ||
          clipped.parcelId !== piece.parcelId ||
          clipped.modelled !== (piece.outcome === 'modelled'))
      )
        throw new Error('archived clipping piece identity mismatch');
      clippedPieces.delete(piece.pieceId);
    }
  });
  if (clippedPieces.size) throw new Error('archived clipping piece identity mismatch');
  if (buildings !== inputs.size) throw new Error('orphan portable building archive');
}
