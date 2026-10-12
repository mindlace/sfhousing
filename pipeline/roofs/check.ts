import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  parseRoofHeader,
  parseRoofIndex,
  ROOF_INDEX_MAX_BYTES,
  type DecodedRoofChunk,
  type RoofHeader
} from '../../src/lib/data/building-roofs';
import type { Manifest } from '../../src/lib/data/manifest';
import { roofArtifactUrls } from '../../src/lib/data/roof-paths';
import { decodeRoofChunk } from '../../src/lib/data/roof-codec';
import type { RoofBuildingAudit, RoofPieceAudit } from '../../src/lib/data/roof-audit';
import { streamRoofAudit } from './audit-reader';

export const roofHash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
export function readBounded(path: string, max: number): Buffer {
  if (statSync(path).size > max) throw new Error(`roof artifact exceeds byte limit: ${path}`);
  const bytes = readFileSync(path);
  if (bytes.length > max) throw new Error(`roof artifact exceeds byte limit: ${path}`);
  return bytes;
}

/** Face-split vertices are welded by exact decoded coordinates for watertight edge checks. */
function checkGeometry(chunk: DecodedRoofChunk): void {
  const { positions, indices } = chunk;
  for (const piece of chunk.header.pieces) {
    const edges = new Map<string, { count: number; balance: number }>();
    const point = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    let volume6 = 0;
    const origin = point(indices[piece.firstIndex]);
    for (let at = piece.firstIndex; at < piece.firstIndex + piece.indexCount; at += 3) {
      const v = [0, 1, 2].map((k) => point(indices[at + k]));
      for (const p of v) {
        if (p[2] < 0 || p[2] > 340) throw new Error('roof geometry height bounds');
      }
      const a = v[1].map((x, i) => x - v[0][i]),
        b = v[2].map((x, i) => x - v[0][i]);
      if (
        Math.hypot(
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]
        ) === 0
      )
        throw new Error('degenerate roof triangle');
      const local = v.map((p) => p.map((x, i) => x - origin[i]));
      volume6 +=
        local[0][0] * (local[1][1] * local[2][2] - local[1][2] * local[2][1]) +
        local[0][1] * (local[1][2] * local[2][0] - local[1][0] * local[2][2]) +
        local[0][2] * (local[1][0] * local[2][1] - local[1][1] * local[2][0]);
      const ids = v.map((p) => p.join(','));
      for (let i = 0; i < 3; i++) {
        const x = ids[i],
          y = ids[(i + 1) % 3],
          key = x < y ? `${x}|${y}` : `${y}|${x}`;
        const edge = edges.get(key) ?? { count: 0, balance: 0 };
        edge.count++;
        edge.balance += x < y ? 1 : -1;
        edges.set(key, edge);
      }
    }
    if (volume6 <= 0 || [...edges.values()].some((e) => e.count !== 2 || e.balance !== 0))
      throw new Error('roof mesh is not a closed oriented solid');
  }
}

export async function checkRoofArtifacts(
  outDir: string,
  manifest: Manifest
): Promise<{ ok: boolean; failures: string[]; counts: Record<string, number> }> {
  const failures: string[] = [],
    counts: Record<string, number> = {};
  const descriptor = manifest.buildingRoofs;
  if (!descriptor) return { ok: true, failures, counts };
  const file = (url: string) => join(outDir, url.slice(`/data/${manifest.datasetVersion}/`.length));
  const fail = (id: string, e: unknown) =>
    failures.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
  try {
    for (const u of roofArtifactUrls(descriptor, undefined)) statSync(file(u));
    if (descriptor.schemaVersion !== 1) return { ok: true, failures, counts };
  } catch (e) {
    fail('V14', e);
    return { ok: false, failures, counts };
  }
  const modelled = new Map<string, RoofHeader['pieces'][number]>();
  try {
    const bytes = readBounded(file(descriptor.indexUrl), ROOF_INDEX_MAX_BYTES);
    const raw = JSON.parse(bytes.toString());
    const index = parseRoofIndex(raw, manifest.datasetVersion);
    roofArtifactUrls(descriptor, index);
    // Export emits canonical compact index JSON. For noncanonical input, measured whole-index
    // bytes conservatively include all whitespace/unknown properties rather than undercounting.
    const canonical = bytes.equals(Buffer.from(JSON.stringify(index)));
    counts['roofs.chunks'] = index.chunks.length;
    for (const ref of index.chunks) {
      const hb = readBounded(file(ref.headerUrl), ref.headerBytes),
        bin = readBounded(file(ref.meshUrl), ref.meshBytes);
      if (
        hb.length !== ref.headerBytes ||
        bin.length !== ref.meshBytes ||
        roofHash(hb) !== ref.headerSha256 ||
        roofHash(bin) !== ref.meshSha256
      )
        throw new Error('roof child length/hash mismatch');
      const contribution = canonical ? Buffer.byteLength(JSON.stringify(ref)) : bytes.length;
      const header = parseRoofHeader(
        JSON.parse(hb.toString()),
        ref,
        manifest.datasetVersion,
        hb.length,
        contribution
      );
      if (gzipSync(hb, { level: 9 }).length + gzipSync(bin, { level: 9 }).length !== ref.gzipBytes)
        throw new Error('roof gzip size mismatch');
      if (ref.gzipBytes + contribution > 1024 * 1024) throw new Error('roof gzip budget exceeded');
      const decoded = decodeRoofChunk(header, Uint8Array.from(bin).buffer);
      try {
        checkGeometry(decoded);
      } catch (e) {
        fail('V15', e);
      }
      for (const piece of header.pieces) {
        if (modelled.has(piece.pieceId)) throw new Error('duplicate roof piece across chunks');
        modelled.set(piece.pieceId, piece);
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    fail(/byte limit|byte lengths|gzip|"code": "too_big"/.test(message) ? 'V15' : 'V14', e);
  }
  try {
    const report = JSON.parse(
      readBounded(file(descriptor.reportUrl), ROOF_INDEX_MAX_BYTES).toString()
    );
    if (report.schemaVersion !== 1 || report.datasetVersion !== manifest.datasetVersion)
      throw new Error('roof report identity mismatch');
    const training = (q: RoofBuildingAudit['quality']) =>
      [
        q.returnsBeforeRejection.value,
        q.returnsAfterRejection.value,
        q.retainedRoofTrainingCount?.value ?? null
      ] as const;
    const sufficientTraining = (values: ReturnType<typeof training> | null) => {
      if (!values) return false;
      const [before, retained, roof] = values;
      return (
        before !== null &&
        retained !== null &&
        roof !== null &&
        before >= retained &&
        retained >= roof &&
        roof >= 50
      );
    };
    type Parent = Pick<
      RoofBuildingAudit,
      'buildingId' | 'pieceIds' | 'parcelIds' | 'outcome' | 'footprintHash' | 'sourceRelease'
    > & {
      accepted: number;
      seen: Set<string | null>;
      training: ReturnType<typeof training> | null;
    };
    const parents = new Map<string, Parent>();
    const expected = new Map<string, string>();
    let lastBuilding = '',
      lastPiece = '',
      pieces = 0,
      accepted = 0;
    await streamRoofAudit(file(descriptor.auditUrl), manifest.datasetVersion, (kind, record) => {
      if (kind === 'buildings') {
        const b = record as RoofBuildingAudit;
        if (b.buildingId <= lastBuilding || parents.has(b.buildingId))
          throw new Error('roof building audit order/duplicate');
        lastBuilding = b.buildingId;
        for (const id of b.pieceIds) {
          if (expected.has(id)) throw new Error('duplicate roof piece ownership');
          expected.set(id, b.buildingId);
        }
        parents.set(b.buildingId, {
          buildingId: b.buildingId,
          pieceIds: b.pieceIds,
          parcelIds: b.parcelIds,
          outcome: b.outcome,
          footprintHash: b.footprintHash,
          sourceRelease: b.sourceRelease,
          accepted: 0,
          training: b.outcome === 'all_fallback' ? null : training(b.quality),
          seen: new Set()
        });
      } else {
        const p = record as RoofPieceAudit;
        const b = parents.get(p.buildingId);
        if (
          p.pieceId <= lastPiece ||
          expected.get(p.pieceId) !== p.buildingId ||
          !b ||
          p.footprintHash !== b.footprintHash ||
          p.sourceRelease !== b.sourceRelease
        )
          throw new Error('roof piece audit identity/order mismatch');
        lastPiece = p.pieceId;
        expected.delete(p.pieceId);
        pieces++;
        b.seen.add(p.parcelId);
        const model = modelled.get(p.pieceId);
        if (p.outcome === 'modelled') {
          if (
            !model ||
            model.buildingId !== p.buildingId ||
            model.parcelId !== p.parcelId ||
            model.method !== p.method
          )
            throw new Error('roof model missing/mismatched audit');
          b.accepted++;
          accepted++;
          modelled.delete(p.pieceId);
          const q = p.quality;
          if (p.method !== 'landmark') {
            const measured = training(q);
            if (
              !sufficientTraining(measured) ||
              !sufficientTraining(b.training) ||
              measured.some((value, index) => value !== b.training?.[index])
            )
              fail(
                'V15',
                `missing, insufficient or contradictory retained roof-training evidence: ${p.buildingId}`
              );
          }
          if (
            q.roofCoverage.value === null ||
            q.triangleCount.value === null ||
            q.maximumRelativeHeight.value === null ||
            q.maximumRelativeHeight.value < 2.5 ||
            q.maximumRelativeHeight.value > 340 ||
            q.detectedSpikes.value !== 0 ||
            (p.method !== 'landmark' &&
              (q.validationCoverage.value === null ||
                q.validationSampleCount.value === null ||
                q.validationMae.value === null))
          )
            fail('V15', `missing or failed roof acceptance evidence: ${p.buildingId}`);
          if (
            q.triangleCount.value !== null &&
            q.triangleCount.value > (p.method === 'landmark' ? 16384 : 512)
          )
            fail('V15', `full-building triangle limit: ${p.buildingId}`);
          if (q.roofCoverage.value !== null && q.roofCoverage.value < 0.98)
            fail('V15', `roof coverage: ${p.buildingId}`);
          if (
            p.method !== 'landmark' &&
            ((q.validationCoverage.value !== null && q.validationCoverage.value < 0.95) ||
              (q.validationSampleCount.value !== null && q.validationSampleCount.value < 20))
          )
            fail('V15', `roof validation: ${p.buildingId}`);
        } else if (model) throw new Error('fallback piece has a mesh');
      }
    });
    if (expected.size || modelled.size) throw new Error('incomplete roof audit coverage');
    for (const b of parents.values()) {
      const outcome =
        b.accepted === 0
          ? 'all_fallback'
          : b.accepted === b.pieceIds.length
            ? 'fully_modelled'
            : 'partly_modelled';
      if (
        b.outcome !== outcome ||
        b.seen.size !== b.parcelIds.length ||
        b.parcelIds.some((p) => !b.seen.has(p))
      )
        throw new Error('roof parent summary mismatch');
    }
    Object.assign(counts, {
      'roofs.buildings': parents.size,
      'roofs.pieces': pieces,
      'roofs.modelled': accepted,
      'roofs.fallback': pieces - accepted
    });
    for (const [key, value] of Object.entries(counts))
      if (report.counts?.[key] !== value) throw new Error(`roof report count mismatch: ${key}`);
  } catch (e) {
    fail('V16', e);
  }
  return { ok: failures.length === 0, failures, counts };
}
