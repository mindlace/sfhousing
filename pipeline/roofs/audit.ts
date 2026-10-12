/** Complete display-only audit ledger, retaining rejected candidate/archive evidence. */
import { createHash } from 'node:crypto';
import { readFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRoofAudit,
  RoofReasonSchema,
  type RoofAudit,
  type RoofBuildingAudit
} from '../../src/lib/data/roof-audit';
import type {
  ClippedRoofPiece,
  ProcessedBuilding,
  RoofArchive,
  RoofJob,
  RoofInputBuilding
} from './job';
import { roofToolVersions } from './setup';

export interface AuditBuilding {
  buildingId: string;
  bbox: [number, number, number, number];
  neighborhood: string | null;
  heightM: number;
}
const metric = (value: number | null | undefined, reason = 'not_measured') => ({
  value: value ?? null,
  unavailableReason: value == null ? reason : null
});
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildRoofAudit(
  processed: ProcessedBuilding[],
  pieces: ClippedRoofPiece[],
  metadata: AuditBuilding[],
  datasetVersion: string,
  archiveDir: string,
  pieceBboxes: Map<string, [number, number, number, number]>
): RoofAudit {
  const meta = new Map(metadata.map((b) => [b.buildingId, b]));
  if (
    new Set(processed.map((b) => b.buildingId)).size !== processed.length ||
    new Set(pieces.map((p) => p.pieceId)).size !== pieces.length
  )
    throw new Error('duplicate roof audit identity');
  const toolVersions = roofToolVersions();
  const configurationHash = createHash('sha256')
    .update(readFileSync(new URL('./config.json', import.meta.url)))
    .digest('hex');
  const grouped = new Map<string, ClippedRoofPiece[]>();
  for (const p of pieces) {
    const list = grouped.get(p.buildingId) ?? [];
    list.push(p);
    grouped.set(p.buildingId, list);
  }
  const cache = new Map<string, unknown>();
  function archived<T>(ref: RoofArchive, shared = false): T {
    if (!cache.has(ref.sha256)) {
      const bytes = readFileSync(join(archiveDir, ref.sha256));
      if (
        bytes.length !== ref.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== ref.sha256
      )
        throw new Error(`corrupt roof audit evidence: ${ref.archiveKey}`);
      const parsed = JSON.parse(bytes.toString());
      if (!shared) return parsed as T;
      cache.set(ref.sha256, parsed);
    }
    return cache.get(ref.sha256) as T;
  }
  const audit: RoofAudit = { schemaVersion: 1, datasetVersion, buildings: [], pieces: [] };
  for (const b of [...processed].sort((a, b) => cmp(a.buildingId, b.buildingId))) {
    const m = meta.get(b.buildingId);
    if (!m) throw new Error(`missing roof building metadata: ${b.buildingId}`);
    const inputRef = b.archives.find((a) => a.name === `${b.buildingId}-input.json`);
    const input = inputRef
      ? archived<{
          building: RoofInputBuilding & { sourceRelease?: string };
          sources: RoofArchive;
          config: RoofArchive;
        }>(inputRef)
      : null;
    const source = input
      ? archived<Pick<RoofJob, 'sourceStatus' | 'sources'>>(input.sources, true)
      : null;
    const selected = b.candidates.find((c) => c.name === b.selectedCandidate);
    // Rejected metrics remain useful evidence; never turn missing validation into zero error.
    const measured = selected ?? b.candidates.find((c) => c.mesh) ?? b.candidates[0];
    const q = measured?.metrics;
    const refs = [...new Set(b.archives.map((a) => a.archiveKey))].sort(cmp);
    const candidateRefs = b.archives
      .filter((a) => b.candidates.some((c) => a.name === `${b.buildingId}-${c.name}.json`))
      .map((a) => a.archiveKey)
      .sort(cmp);
    const children = grouped.get(b.buildingId) ?? [];
    const accepted = children.filter((p) => p.mesh !== null).length;
    const aerial = source?.sourceStatus.find((s) => s.sourceId === 'roof-aerial')?.spatial;
    const flags = b.flags;
    const reason = b.reason ?? 'not_measured';
    const evidence: Pick<RoofBuildingAudit, 'sources' | 'processing' | 'quality' | 'followUp'> = {
      sources: {
        lockEntries: source?.sourceStatus.map((s) => s.sourceId).sort(cmp) ?? [],
        // One content-addressed descriptor references the complete original lock/file list.
        files: input ? [input.sources.archiveKey] : [],
        acquisitionDates:
          source?.sourceStatus
            .map((s) => ({
              sourceId: s.sourceId,
              date: s.spatial.acquisitionStart,
              unknownReason: s.spatial.acquisitionStart === null ? 'source_date_unavailable' : null
            }))
            .sort((a, b) => cmp(a.sourceId, b.sourceId)) ?? [],
        imageryCoverage: b.diagnostics?.vegetation.includes('aerial_partial_coverage')
          ? 'partial'
          : b.diagnostics?.vegetation.includes('aerial_complete_coverage')
            ? 'complete'
            : flags.includes('aerial_missing')
              ? 'missing'
              : 'unknown',
        imageryAlignment:
          aerial?.alignment === 'verified'
            ? 'aligned'
            : aerial?.alignment === 'unverified'
              ? 'uncertain'
              : 'unavailable',
        groundReference: metric(b.ground?.groundM, 'ground_unavailable'),
        groundEstimationMethod: b.ground?.method ?? 'unavailable'
      },
      processing: {
        algorithm: `roofer-${toolVersions.roofer}-lod2.2`,
        configurationHash: input?.config.sha256 ?? configurationHash,
        toolVersions,
        attempts: b.candidates.map((c) => ({
          candidateId: c.name,
          method:
            c.name === 'landmark'
              ? 'landmark'
              : b.method === 'lidar_aerial'
                ? 'lidar_aerial'
                : 'lidar_only',
          outcome: c.name === b.selectedCandidate ? 'accepted' : c.mesh ? 'rejected' : 'failed',
          reason: c.metrics.reason === null ? null : RoofReasonSchema.parse(c.metrics.reason),
          artifactRefs: b.archives
            .filter((a) => a.name === `${b.buildingId}-${c.name}.json`)
            .map((a) => a.archiveKey)
        })),
        selectedCandidate: b.selectedCandidate,
        detailGuard: {
          applied: !!b.candidates.find((c) => c.name === 'reference'),
          referenceCandidate: b.candidates.some((c) => c.name === 'reference') ? 'reference' : null,
          outcome:
            b.selectedCandidate === 'reference'
              ? 'reference_retained'
              : b.selectedCandidate
                ? 'selected_candidate_retained'
                : 'no_accepted_candidate'
        },
        overrideIds: b.override ? [`${b.buildingId}:${String(b.override.overrideVersion)}`] : []
      },
      quality: {
        returnsBeforeRejection: metric(b.returnCounts?.before, reason),
        returnsAfterRejection: metric(b.returnCounts?.retained, reason),
        retainedRoofTrainingCount: metric(b.returnCounts?.roofTraining, reason),
        rejectedFraction: metric(
          b.returnCounts && b.returnCounts.before > 0
            ? b.returnCounts.rejected / b.returnCounts.before
            : null,
          reason
        ),
        validationSampleCount: metric(q?.validationSamples ?? b.returnCounts?.validation, reason),
        validationCoverage: metric(q?.validationCoverage, reason),
        validationMae: metric(q?.maeM, reason),
        roofCoverage: metric(q?.roofCoverage, reason),
        maximumRelativeHeight: metric(q?.maxHeightM, reason),
        roofSectionCount: metric(q?.roofSections, reason),
        triangleCount: metric(q?.triangleCount, reason),
        detectedSpikes: metric(q?.spikes, reason),
        sourceHeightDisagreement: metric(
          q?.maxHeightM == null ? null : Math.abs(q.maxHeightM - m.heightM),
          reason
        )
      },
      followUp: {
        revisit: b.followUp?.revisit ?? b.mesh === null,
        reasons: (b.followUp?.reasons ?? (b.reason ? [b.reason] : [])).map((r) =>
          RoofReasonSchema.parse(r)
        ),
        candidateArtifactRefs: candidateRefs,
        inputArtifactRefs: refs.filter((r) => !candidateRefs.includes(r))
      }
    };
    const identity = {
      sourceRelease: input?.building.sourceRelease ?? 'unavailable',
      footprintHash: b.footprintHash,
      bbox: m.bbox,
      datasetVersion
    };
    const pieceFailures = children.flatMap((p) =>
      p.reason === 'parcel_clip_failed' || p.reason === 'invalid_geometry' ? [p.reason] : []
    );
    if (pieceFailures.length) {
      evidence.followUp = {
        ...evidence.followUp,
        revisit: true,
        reasons: [...new Set([...evidence.followUp.reasons, ...pieceFailures])]
      };
    }
    audit.buildings.push({
      buildingId: b.buildingId,
      ...identity,
      pieceIds: children.map((p) => p.pieceId).sort(cmp),
      parcelIds: [...new Set(children.map((p) => p.parcelId))].sort((a, b) =>
        a === null ? 1 : b === null ? -1 : cmp(a, b)
      ),
      outcome:
        accepted === 0
          ? 'all_fallback'
          : accepted === children.length
            ? 'fully_modelled'
            : 'partly_modelled',
      ...evidence
    });
    const pieceStart = audit.pieces.length;
    for (const p of children) {
      audit.pieces.push({
        pieceId: p.pieceId,
        buildingId: p.buildingId,
        parcelId: p.parcelId,
        ...identity,
        bbox: pieceBboxes.get(p.pieceId)!,
        outcome: p.mesh ? 'modelled' : 'footprint_fallback',
        method: p.mesh ? b.method : 'footprint',
        reason: p.reason,
        flags: b.flags,
        ...evidence
      });
    }
    // Validate a bounded family, discarding Zod's clone. Keep evidence references shared.
    parseRoofAudit(
      {
        schemaVersion: 1,
        datasetVersion,
        buildings: [audit.buildings.at(-1)!],
        pieces: audit.pieces.slice(pieceStart)
      },
      datasetVersion
    );
  }
  if (audit.pieces.length !== pieces.length) throw new Error('orphan roof audit piece');
  audit.pieces.sort((a, b) => cmp(a.pieceId, b.pieceId));
  return audit;
}

/** Never materialize a city-sized JSON string (177k fallback families exceed Node's limit). */
export function* roofAuditJsonChunks(audit: RoofAudit): Generator<string> {
  yield `{"schemaVersion":1,"datasetVersion":${JSON.stringify(audit.datasetVersion)},"buildings":[`;
  for (let i = 0; i < audit.buildings.length; i++) {
    if (i) yield ',';
    yield JSON.stringify(audit.buildings[i]);
  }
  yield '],"pieces":[';
  for (let i = 0; i < audit.pieces.length; i++) {
    if (i) yield ',';
    yield JSON.stringify(audit.pieces[i]);
  }
  yield ']}';
}

export function writeRoofAudit(path: string, audit: RoofAudit): number {
  const fd = openSync(path, 'w');
  let total = 0;
  try {
    for (const text of roofAuditJsonChunks(audit)) {
      const bytes = Buffer.from(text);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      total += bytes.length;
    }
  } finally {
    closeSync(fd);
  }
  return total;
}
