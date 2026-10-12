import { expect, it } from 'vitest';
import { parseRoofAudit, type RoofAudit } from './roof-audit';
it('rejects a fallback without its reason and incomplete evidence', () => {
  expect(() =>
    parseRoofAudit(
      {
        schemaVersion: 1,
        datasetVersion: 'fixture-0',
        buildings: [],
        pieces: [{ pieceId: 'a', outcome: 'footprint_fallback', reason: null }]
      },
      'fixture-0'
    )
  ).toThrow();
});

function auditFixture(): RoofAudit {
  const absent = { value: null, unavailableReason: 'no source' };
  const evidence = {
    sources: {
      lockEntries: ['lidar-1'],
      files: ['source.laz'],
      acquisitionDates: [{ sourceId: 'lidar-1', date: null, unknownReason: 'not recorded' }],
      imageryCoverage: 'missing' as const,
      imageryAlignment: 'unavailable' as const,
      groundReference: absent,
      groundEstimationMethod: 'unavailable'
    },
    processing: {
      algorithm: 'roofer',
      configurationHash: 'a'.repeat(64),
      toolVersions: { roofer: '1.0.0' },
      attempts: [],
      selectedCandidate: null,
      detailGuard: { applied: false, referenceCandidate: null, outcome: 'unavailable' },
      overrideIds: []
    },
    quality: {
      returnsBeforeRejection: absent,
      returnsAfterRejection: absent,
      rejectedFraction: absent,
      validationSampleCount: absent,
      validationCoverage: absent,
      validationMae: absent,
      roofCoverage: absent,
      maximumRelativeHeight: absent,
      roofSectionCount: absent,
      triangleCount: absent,
      detectedSpikes: absent,
      sourceHeightDisagreement: absent
    },
    followUp: {
      revisit: true,
      reasons: ['lidar_missing' as const],
      candidateArtifactRefs: [],
      inputArtifactRefs: ['archive/source.laz']
    }
  };
  const identity = {
    sourceRelease: '2026-01',
    footprintHash: 'b'.repeat(64),
    bbox: [-122, 37, -121, 38] as [number, number, number, number],
    datasetVersion: 'fixture-0'
  };
  return {
    schemaVersion: 1,
    datasetVersion: 'fixture-0',
    buildings: [
      {
        buildingId: 'b',
        ...identity,
        pieceIds: ['p'],
        parcelIds: [null],
        outcome: 'all_fallback',
        ...evidence
      }
    ],
    pieces: [
      {
        pieceId: 'p',
        buildingId: 'b',
        parcelId: null,
        ...identity,
        outcome: 'footprint_fallback',
        method: 'footprint',
        reason: 'lidar_missing',
        flags: [],
        ...evidence
      }
    ]
  };
}
it('retains complete fallback source and rerun evidence', () => {
  const raw = auditFixture();
  expect(parseRoofAudit(raw, 'fixture-0')).toEqual(raw);
});
it.each([
  'reason',
  'acceptedReason',
  'duplicatePiece',
  'duplicateBuilding',
  'parent',
  'metric',
  'orphan',
  'version'
])('rejects inconsistent audit %s', (kind) => {
  const a = auditFixture();
  if (kind === 'reason') a.pieces[0].reason = null;
  if (kind === 'acceptedReason') {
    a.pieces[0].outcome = 'modelled';
    a.pieces[0].method = 'lidar_only';
    a.pieces[0].processing.selectedCandidate = 'candidate';
    a.buildings[0].outcome = 'fully_modelled';
  }
  if (kind === 'duplicatePiece') a.pieces.push(a.pieces[0]);
  if (kind === 'duplicateBuilding') a.buildings.push(a.buildings[0]);
  if (kind === 'parent') a.buildings[0].outcome = 'fully_modelled';
  if (kind === 'metric') a.pieces[0].quality.roofCoverage.unavailableReason = null;
  if (kind === 'orphan') a.buildings = [];
  if (kind === 'version') a.pieces[0].datasetVersion = 'fixture-1';
  expect(() => parseRoofAudit(a, 'fixture-0')).toThrow();
});
it('accepts modelled and partially modelled parent outcomes', () => {
  const a = auditFixture();
  a.pieces[0].outcome = 'modelled';
  a.pieces[0].method = 'lidar_only';
  a.pieces[0].reason = null;
  a.pieces[0].processing.selectedCandidate = 'candidate';
  a.buildings[0].outcome = 'fully_modelled';
  expect(parseRoofAudit(a, 'fixture-0').buildings[0].outcome).toBe('fully_modelled');
  const fallback = structuredClone(a.pieces[0]);
  fallback.pieceId = 'q';
  fallback.outcome = 'footprint_fallback';
  fallback.method = 'footprint';
  fallback.reason = 'parcel_clip_failed';
  a.pieces.push(fallback);
  a.buildings[0].pieceIds.push('q');
  a.buildings[0].outcome = 'partly_modelled';
  expect(parseRoofAudit(a, 'fixture-0').pieces).toHaveLength(2);
});
