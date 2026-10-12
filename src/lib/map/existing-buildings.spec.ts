import { describe, expect, it } from 'vitest';
import { ExistingBuildings } from './existing-buildings';

function setup(mode: 'parcel' | 'piece' = 'piece') {
  const states = new Map<string, Record<string, boolean>>();
  const writes: [string, string, unknown][] = [];
  const changes: { hidden: string[]; changed: readonly string[]; mirror: ReadonlySet<string> }[] =
    [];
  const existing = new ExistingBuildings({
    mode,
    setState(id, state) {
      states.set(id, { ...states.get(id), ...state });
      writes.push(['set', id, state]);
    },
    clearState(id, key) {
      delete states.get(id)?.[key];
      writes.push(['clear', id, key]);
    },
    onReplacementChange({ hidden, changed }) {
      changes.push({ hidden: [...hidden], changed, mirror: hidden });
    }
  });
  return { existing, states, writes, changes };
}

const pieces = [
  { pieceId: 'building-1:a', parcelId: 'parcel-a' },
  { pieceId: 'building-1:b', parcelId: 'parcel-b' },
  { pieceId: 'building-2:a', parcelId: 'parcel-a' },
  { pieceId: 'unmatched', parcelId: null }
];

describe('ExistingBuildings', () => {
  it('late pieces inherit replacement without hiding the other parcel of a shared building', () => {
    const { existing, states } = setup();
    existing.setReplaced('parcel-a');
    existing.observePieces(pieces);
    expect(states.get('building-1:a')).toEqual({ replaced: true });
    expect(states.get('building-2:a')).toEqual({ replaced: true });
    expect(states.get('building-1:b')?.replaced).toBeUndefined();
    expect(states.get('unmatched')?.replaced).toBeUndefined();
    existing.clearReplaced('parcel-a');
    expect(states.get('building-1:a')?.replaced).toBeUndefined();
    expect(states.get('building-2:a')?.replaced).toBeUndefined();
    expect([...existing.hidden]).toEqual([]);
  });

  it('replacement reaches every already observed piece of the parcel', () => {
    const { existing, states, changes } = setup();
    existing.observePieces(pieces);
    existing.setReplaced('parcel-a');
    expect(states.get('building-1:a')).toEqual({ replaced: true });
    expect(states.get('building-2:a')).toEqual({ replaced: true });
    expect(states.has('building-1:b')).toBe(false);
    expect(states.has('unmatched')).toBe(false);
    expect(changes.map(({ changed }) => changed)).toEqual([['parcel-a']]);
  });

  it('deduplicates tile observations and repeated replacement mutations', () => {
    const { existing, writes, changes } = setup();
    existing.setReplaced('parcel-a');
    existing.observePieces([...pieces, ...pieces]);
    existing.observePieces(pieces);
    existing.setReplaced('parcel-a');
    expect(writes).toEqual([
      ['set', 'building-1:a', { replaced: true }],
      ['set', 'building-2:a', { replaced: true }]
    ]);
    expect(changes).toHaveLength(1);
    existing.clearReplaced('parcel-a');
    existing.clearReplaced('parcel-a');
    expect(writes).toHaveLength(4);
    expect(changes).toHaveLength(2);
  });

  it('clearing replacements preserves readiness, including readiness set before observation', () => {
    const { existing, states } = setup();
    existing.setRoofReady(['piece-a'], true);
    existing.setReplaced('parcel-a');
    states.clear(); // The source was unavailable when readiness was first announced.
    existing.observePieces([{ pieceId: 'piece-a', parcelId: 'parcel-a' }]);
    expect(states.get('piece-a')).toEqual({ roofReady: true, replaced: true });
    existing.clearAllReplaced();
    expect(existing.roofReady.has('piece-a')).toBe(true);
    expect(states.get('piece-a')).toEqual({ roofReady: true });
    expect(existing.hidden.size).toBe(0);
  });

  it('readiness removal retains replacement and never promotes readiness to a sibling piece', () => {
    const { existing, states, writes, changes } = setup();
    existing.observePieces(pieces);
    existing.setReplaced('parcel-a');
    existing.setRoofReady(['building-1:a', 'building-1:a'], true);
    existing.setRoofReady(['building-1:a'], true);
    expect(states.get('building-1:a')).toEqual({ replaced: true, roofReady: true });
    expect(states.get('building-2:a')).toEqual({ replaced: true });
    expect(
      writes.filter(([, , state]) => typeof state === 'object' && 'roofReady' in state!)
    ).toHaveLength(1);
    existing.setRoofReady(['building-1:a'], false);
    existing.setRoofReady(['building-1:a'], false);
    expect(states.get('building-1:a')).toEqual({ replaced: true });
    expect(existing.roofReady.size).toBe(0);
    expect(existing.hidden.has('parcel-a')).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it('replays replacement and readiness after the source is re-added', () => {
    const { existing, states, changes } = setup();
    existing.observePieces(pieces);
    existing.setReplaced('parcel-a');
    existing.setRoofReady(['building-1:a', 'unmatched'], true);
    states.clear();
    existing.replay();
    expect(states.get('building-1:a')).toEqual({ replaced: true, roofReady: true });
    expect(states.get('building-2:a')).toEqual({ replaced: true });
    expect(states.get('unmatched')).toEqual({ roofReady: true });
    expect(states.has('building-1:b')).toBe(false);
    expect(changes).toHaveLength(1);
  });

  it('a 2,000-id transaction issues one notification with a live hidden mirror', () => {
    const { existing, changes } = setup();
    const mirror = existing.hidden;
    existing.transaction(() => {
      for (let i = 0; i < 2000; i++) existing.setReplaced(`parcel-${i}`);
      expect(changes).toHaveLength(0);
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].changed).toHaveLength(2000);
    expect(new Set(changes[0].changed).size).toBe(2000);
    expect(changes[0].hidden).toHaveLength(2000);
    expect(changes[0].mirror).toBe(mirror);
    expect(mirror.size).toBe(2000);
    existing.clearAllReplaced();
    expect(changes).toHaveLength(2);
    expect(changes[1].changed).toEqual(changes[0].changed);
    expect(changes[1].hidden).toEqual([]);
    expect(changes[1].mirror).toBe(mirror);
    existing.clearAllReplaced();
    expect(changes).toHaveLength(2);
  });

  it('nested transactions deduplicate changed ids and notify only after all mutations', () => {
    const { existing, changes } = setup();
    existing.transaction(() => {
      existing.setReplaced('parcel-a');
      existing.transaction(() => {
        existing.clearReplaced('parcel-a');
        existing.setReplaced('parcel-b');
      });
      expect(changes).toHaveLength(0);
    });
    expect(changes.map(({ changed, hidden }) => ({ changed, hidden }))).toEqual([
      { changed: ['parcel-a', 'parcel-b'], hidden: ['parcel-b'] }
    ]);
  });

  it('a throwing transaction still reports its completed mutations and releases the batch', () => {
    const { existing, changes } = setup();
    expect(() =>
      existing.transaction(() => {
        existing.setReplaced('parcel-a');
        throw new Error('interrupted');
      })
    ).toThrow('interrupted');
    existing.setReplaced('parcel-b');
    expect(changes.map(({ changed }) => changed)).toEqual([['parcel-a'], ['parcel-b']]);
  });

  it('legacy mode addresses parcels directly and never applies piece readiness to parcel ids', () => {
    const { existing, states, writes } = setup('parcel');
    existing.setReplaced('parcel-a');
    existing.observePieces(pieces);
    existing.setRoofReady(['building-1:a'], true);
    expect(states.get('parcel-a')).toEqual({ replaced: true });
    expect(states.has('building-1:a')).toBe(false);
    states.clear();
    existing.replay();
    expect(states.get('parcel-a')).toEqual({ replaced: true });
    expect(states.has('building-1:a')).toBe(false);
    existing.clearAllReplaced();
    expect(states.get('parcel-a')).toEqual({});
    expect(writes).toEqual([
      ['set', 'parcel-a', { replaced: true }],
      ['set', 'parcel-a', { replaced: true }],
      ['clear', 'parcel-a', 'replaced']
    ]);
  });

  it('destroy releases mirrors and observations and stops future callbacks', () => {
    const { existing, writes, changes } = setup();
    existing.observePieces(pieces);
    existing.setReplaced('parcel-a');
    existing.setRoofReady(['building-1:a'], true);
    existing.destroy();
    const writeCount = writes.length;
    existing.setReplaced('parcel-b');
    existing.clearReplaced('parcel-a');
    existing.clearAllReplaced();
    existing.setRoofReady(['building-1:b'], true);
    existing.observePieces(pieces);
    existing.replay();
    expect(existing.hidden.size).toBe(0);
    expect(existing.roofReady.size).toBe(0);
    expect(writes).toHaveLength(writeCount);
    expect(changes).toHaveLength(1);
  });
});
