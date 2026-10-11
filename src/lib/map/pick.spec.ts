import { describe, expect, it } from 'vitest';
import { cellAt, chunkStatusCollection, resolveExistingHit, tooltipPosition } from './pick';
import type { ChunkStatus } from './types';

const f = (properties: Record<string, unknown> | null) => ({ properties });
const always = (s: ChunkStatus | 'unknown') => (): ChunkStatus | 'unknown' => s;

describe('resolveExistingHit', () => {
  it('returns null when nothing was hit', () => {
    expect(resolveExistingHit([], new Set(), always('ready'))).toBeNull();
  });

  it('a feature with no parcelId gives parcelId null (never hidden)', () => {
    expect(resolveExistingHit([f({ heightM: 9, hs: 3 })], new Set(), always('ready'))).toEqual({
      kind: 'existing',
      parcelId: null,
      chunk: 'unknown',
      summary: null
    });
    expect(resolveExistingHit([f(null)], new Set(), always('ready'))?.parcelId).toBeNull();
  });

  it('skips a hidden id in favour of the next feature', () => {
    const hit = resolveExistingHit(
      [f({ parcelId: 'A' }), f({ parcelId: 'B' })],
      new Set(['A']),
      (id) => (id === 'B' ? 'loading' : 'error')
    );
    expect(hit).toEqual({ kind: 'existing', parcelId: 'B', chunk: 'loading', summary: null });
  });

  it('returns null when every feature is hidden', () => {
    expect(resolveExistingHit([f({ parcelId: 'A' })], new Set(['A']), always('ready'))).toBeNull();
  });

  it('ignores the hs property and coerces numeric ids', () => {
    const a = resolveExistingHit([f({ parcelId: 'A', hs: 'x' })], new Set(), always('ready'));
    const b = resolveExistingHit([f({ parcelId: 'A' })], new Set(), always('ready'));
    expect(a).toEqual(b);
    expect(resolveExistingHit([f({ parcelId: 42 })], new Set(), always('ready'))?.parcelId).toBe(
      '42'
    );
  });
});

const chunks = [
  { cellId: '50_25', bbox: [-122.42, 37.76, -122.41, 37.77] as [number, number, number, number] },
  { cellId: '51_25', bbox: [-122.41, 37.76, -122.4, 37.77] as [number, number, number, number] }
];

describe('cellAt', () => {
  it('finds the containing bbox, or null', () => {
    expect(cellAt(chunks, [-122.415, 37.765])).toBe('50_25');
    expect(cellAt(chunks, [-122.405, 37.765])).toBe('51_25');
    expect(cellAt(chunks, [-122.5, 37.765])).toBeNull();
  });
});

describe('chunkStatusCollection', () => {
  it('emits one bbox polygon per non-ready status, skipping unknown cells', () => {
    const fc = chunkStatusCollection(
      chunks,
      new Map<string, ChunkStatus>([
        ['50_25', 'error'],
        ['51_25', 'ready'],
        ['99_99', 'loading']
      ])
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toEqual({ cellId: '50_25', status: 'error' });
    expect(fc.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-122.42, 37.76],
          [-122.41, 37.76],
          [-122.41, 37.77],
          [-122.42, 37.77],
          [-122.42, 37.76]
        ]
      ]
    });
  });
});

describe('tooltipPosition', () => {
  it('offsets 12 px from the pointer', () => {
    expect(tooltipPosition(100, 100, 50, 20, 800, 600)).toEqual({ left: 112, top: 112 });
  });
  it('flips at the right and bottom edges', () => {
    expect(tooltipPosition(780, 590, 50, 20, 800, 600)).toEqual({ left: 718, top: 558 });
  });
  it('never goes off the left or top edge', () => {
    expect(tooltipPosition(10, 10, 790, 595, 800, 600)).toEqual({ left: 0, top: 0 });
  });
});
