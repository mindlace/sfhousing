import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CELL_ID_RE } from '$lib/data/manifest';
import { CELL_ID_RE_COPY, checkManifestShape } from './manifest-shape';

const FIXTURE = fileURLToPath(
  new URL('../../../e2e/fixtures/data/fixture-0/manifest.json', import.meta.url)
);
const fixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
type Chunk = { cellId: string; bbox: number[]; url: string; parcelCount: number };
const withChunk = (patch: Partial<Chunk>) => {
  const m = fixture();
  const chunks = m.chunks as Chunk[];
  chunks[0] = { ...chunks[0], ...patch };
  return m;
};

describe('checkManifestShape', () => {
  it('accepts the fixture-0 manifest', () => {
    expect(checkManifestShape(fixture())).toBeNull();
  });

  it.each([null, [], 'x'])('rejects a non-object %j', (v) => {
    expect(checkManifestShape(v)).toBe('manifest is not an object');
  });

  it('rejects a bad datasetVersion', () => {
    expect(checkManifestShape({ ...fixture(), datasetVersion: 'v1' })).toBe('bad datasetVersion');
  });

  it('rejects chunks that are not an array', () => {
    expect(checkManifestShape({ ...fixture(), chunks: {} })).toBe('chunks is not an array');
  });

  it('rejects an invalid cellId', () => {
    expect(checkManifestShape(withChunk({ cellId: 'q00' }))).toBe('chunks.0.cellId is invalid');
  });

  it('rejects a bbox with w > e', () => {
    expect(checkManifestShape(withChunk({ bbox: [1, 0, 0, 1] }))).toBe('chunks.0.bbox is invalid');
  });

  it('rejects a bbox containing NaN', () => {
    expect(checkManifestShape(withChunk({ bbox: [0, NaN, 1, 1] }))).toBe(
      'chunks.0.bbox is invalid'
    );
  });

  it('rejects a chunk url outside the version prefix', () => {
    expect(checkManifestShape(withChunk({ url: '/data/other/parcels/a.json' }))).toBe(
      'chunks.0.url is invalid'
    );
  });

  it.each([-1, 1.5])('rejects parcelCount %d', (n) => {
    expect(checkManifestShape(withChunk({ parcelCount: n }))).toBe(
      'chunks.0.parcelCount is invalid'
    );
  });

  it('rejects duplicate cellIds', () => {
    const m = fixture();
    const chunks = m.chunks as Chunk[];
    chunks.push({ ...chunks[0], url: chunks[0].url.replace(/[^/]+$/, 'dup.json') });
    expect(checkManifestShape(m)).toBe('chunks.1.cellId is a duplicate');
  });

  it('CELL_ID_RE_COPY equals the zod module CELL_ID_RE', () => {
    expect(String(CELL_ID_RE_COPY)).toBe(String(CELL_ID_RE));
  });
});
