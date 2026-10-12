import { z } from 'zod';
import { DATASET_VERSION_RE } from './dataset-version';
import { RoofBboxSchema, RoofMethodSchema } from './building-roofs';
export const RoofReasonSchema = z.enum([
  'not_in_coverage',
  'lidar_missing',
  'lidar_sparse',
  'ground_missing',
  'aerial_missing',
  'aerial_alignment_uncertain',
  'aerial_rights_unconfirmed',
  'vegetation_ambiguous',
  'capture_mismatch',
  'source_height_disagreement',
  'fit_failed',
  'validation_insufficient',
  'invalid_geometry',
  'roof_coverage_low',
  'spike_unresolved',
  'complexity_limit',
  'parcel_clip_failed',
  'override_stale'
]);
export type RoofReason = z.infer<typeof RoofReasonSchema>;
const id = z.string().min(1);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative().max(0xffffffff);
/** Every unavailable measurement retains an explicit explanation. */
const metric = (value: z.ZodNumber) =>
  z
    .object({ value: value.nullable(), unavailableReason: id.nullable() })
    .refine((m) =>
      m.value === null ? m.unavailableReason !== null : m.unavailableReason === null
    );
const ratio = z.number().min(0).max(1);
const nonnegative = z.number().nonnegative();
const quality = z
  .object({
    returnsBeforeRejection: metric(count),
    returnsAfterRejection: metric(count),
    rejectedFraction: metric(ratio),
    validationSampleCount: metric(count),
    validationCoverage: metric(ratio),
    validationMae: metric(nonnegative),
    roofCoverage: metric(ratio),
    maximumRelativeHeight: metric(nonnegative),
    roofSectionCount: metric(count),
    triangleCount: metric(count),
    detectedSpikes: metric(count),
    sourceHeightDisagreement: metric(nonnegative)
  })
  .refine(
    (q) =>
      q.returnsBeforeRejection.value === null ||
      q.returnsAfterRejection.value === null ||
      q.returnsAfterRejection.value <= q.returnsBeforeRejection.value
  );
const sources = z.object({
  lockEntries: z.array(id),
  files: z.array(id),
  acquisitionDates: z.array(
    z
      .object({ sourceId: id, date: z.iso.date().nullable(), unknownReason: id.nullable() })
      .refine((d) => (d.date === null ? d.unknownReason !== null : d.unknownReason === null))
  ),
  imageryCoverage: z.enum(['complete', 'partial', 'missing', 'unknown']),
  imageryAlignment: z.enum(['aligned', 'uncertain', 'unavailable']),
  groundReference: metric(z.number()),
  groundEstimationMethod: id
});
const processing = z.object({
  algorithm: id,
  configurationHash: hash,
  toolVersions: z.record(id, id),
  attempts: z.array(
    z.object({
      candidateId: id,
      method: RoofMethodSchema,
      outcome: z.enum(['accepted', 'rejected', 'failed']),
      reason: RoofReasonSchema.nullable(),
      artifactRefs: z.array(id)
    })
  ),
  selectedCandidate: id.nullable(),
  detailGuard: z.object({ applied: z.boolean(), referenceCandidate: id.nullable(), outcome: id }),
  overrideIds: z.array(id)
});
const followUp = z.object({
  revisit: z.boolean(),
  reasons: z.array(RoofReasonSchema),
  candidateArtifactRefs: z.array(id),
  inputArtifactRefs: z.array(id)
});
const evidence = { sources, processing, quality, followUp };
const identity = {
  sourceRelease: id,
  footprintHash: hash,
  bbox: RoofBboxSchema,
  datasetVersion: z.string().regex(DATASET_VERSION_RE)
};
const pieceSchema = z
  .object({
    pieceId: id,
    buildingId: id,
    parcelId: id.nullable(),
    ...identity,
    outcome: z.enum(['modelled', 'footprint_fallback']),
    method: z.union([RoofMethodSchema, z.literal('footprint')]),
    reason: RoofReasonSchema.nullable(),
    flags: z.array(RoofReasonSchema),
    ...evidence
  })
  .refine((p) =>
    p.outcome === 'modelled'
      ? p.reason === null && p.method !== 'footprint' && p.processing.selectedCandidate !== null
      : p.reason !== null && p.method === 'footprint'
  );
const buildingSchema = z.object({
  buildingId: id,
  ...identity,
  pieceIds: z.array(id).min(1),
  parcelIds: z.array(id.nullable()),
  outcome: z.enum(['fully_modelled', 'partly_modelled', 'all_fallback']),
  ...evidence
});
const auditSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersion: z.string().regex(DATASET_VERSION_RE),
  buildings: z.array(buildingSchema),
  pieces: z.array(pieceSchema)
});
export type RoofAudit = z.infer<typeof auditSchema>;
export type RoofBuildingAudit = RoofAudit['buildings'][number];
export type RoofPieceAudit = RoofAudit['pieces'][number];
export function parseRoofAudit(raw: unknown, datasetVersion: string): RoofAudit {
  const audit = auditSchema.parse(raw);
  if (audit.datasetVersion !== datasetVersion) throw new Error('roof audit version mismatch');
  const pieces = new Map(audit.pieces.map((p) => [p.pieceId, p]));
  const buildings = new Set(audit.buildings.map((b) => b.buildingId));
  if (pieces.size !== audit.pieces.length || buildings.size !== audit.buildings.length)
    throw new Error('duplicate roof audit identity');
  const used = new Set<string>();
  for (const b of audit.buildings) {
    if (b.datasetVersion !== datasetVersion || new Set(b.pieceIds).size !== b.pieceIds.length)
      throw new Error('roof building identity');
    let accepted = 0;
    for (const pieceId of b.pieceIds) {
      const p = pieces.get(pieceId);
      if (
        !p ||
        used.has(pieceId) ||
        p.buildingId !== b.buildingId ||
        p.datasetVersion !== datasetVersion ||
        p.sourceRelease !== b.sourceRelease ||
        p.footprintHash !== b.footprintHash
      )
        throw new Error('roof piece parent mismatch');
      used.add(pieceId);
      if (p.outcome === 'modelled') accepted++;
    }
    const outcome =
      accepted === 0
        ? 'all_fallback'
        : accepted === b.pieceIds.length
          ? 'fully_modelled'
          : 'partly_modelled';
    const parcels = new Set(b.pieceIds.map((id) => pieces.get(id)!.parcelId));
    if (
      b.outcome !== outcome ||
      new Set(b.parcelIds).size !== b.parcelIds.length ||
      parcels.size !== b.parcelIds.length ||
      b.parcelIds.some((id) => !parcels.has(id))
    )
      throw new Error('invalid roof parent summary');
  }
  if (used.size !== pieces.size) throw new Error('orphan roof piece');
  return audit;
}
