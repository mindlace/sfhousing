import { describe, expect, it } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import type { PackedCell } from '$lib/map/types';
import type { Envelope } from '$lib/plan';
import { score, type Target } from '$lib/scoreboard';
import { createDisplay, type DisplayDeps, type UpdateMeta } from './display';
import type { DiffResponse, OpStats } from './protocol';

const TARGETS: Target[] = [
  { id: 't1', label: 'Target', units: 1000, source: { label: 'src', url: 'https://example.org' } }
];

function rec(id: string, hood: string): ParcelRecord {
  return {
    id,
    polygon: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10]
      ]
    ],
    labelPoint: [-122.4, 37.7],
    areaM2: 100,
    existingUnits: 2,
    existingFloorAreaM2: 100,
    existingHeightM: 6,
    landUse: 'RESIDENT',
    eligible: true,
    neighborhood: hood
  };
}

// Cell c0: a1..a3; cell c1: b1..b3.
const CELL: Record<string, string> = {
  a1: 'c0',
  a2: 'c0',
  a3: 'c0',
  b1: 'c1',
  b2: 'c1',
  b3: 'c1'
};
const RECS = new Map<ParcelId, ParcelRecord>(
  Object.keys(CELL).map((id) => [id, rec(id, CELL[id] === 'c0' ? 'North' : 'South')])
);

interface Posted {
  msg: DiffResponse;
  transfer: ArrayBuffer[];
}

function setup(batchParcels = 5000) {
  const memo = new Map<string, GeneratedBuilding | null>();
  const posts: Posted[] = [];
  let builds = 0;
  const deps: DisplayDeps = {
    record: (id) => RECS.get(id),
    cellOf: (id) => CELL[id],
    build(r, env) {
      const key = `${r.id}|${env.maxStories}`;
      if (memo.has(key)) return memo.get(key)!;
      builds++;
      const s = env.maxStories;
      const b: GeneratedBuilding | null =
        s > 2
          ? {
              parcelId: r.id,
              source: 'user',
              typology: 'midrise',
              parts: [
                {
                  footprint: [
                    [0, 0],
                    [0, 1],
                    [1, 1],
                    [1, 0]
                  ],
                  baseM: 0,
                  topM: 3.1 * s
                }
              ],
              stories: s,
              units: s,
              floorAreaM2: 100 * s,
              replacesExisting: true
            }
          : null;
      memo.set(key, b);
      return b;
    },
    targets: TARGETS,
    post: (msg, transfer) => posts.push({ msg, transfer }),
    batchParcels
  };
  const display = createDisplay(deps);
  return { display, posts, builds: () => builds };
}

function meta(over: Partial<UpdateMeta> = {}): UpdateMeta {
  return { rev: 1, phase: 'commit', complete: () => true, ...over };
}

function envs(m: Record<string, number | null>): (id: ParcelId) => Envelope | null {
  return (id) => {
    const s = m[id];
    return s == null ? null : { maxStories: s };
  };
}

const ids = (p: PackedCell | null) => (p ? p.parcelIds : null);
const cellById = (msg: DiffResponse, cellId: string) =>
  msg.render.cells.find((c) => c.settled.cellId === cellId);

function buffersOf(p: PackedCell): ArrayBuffer[] {
  return [
    p.parcelMeta.buffer,
    p.startIndices.buffer,
    p.positions.buffer,
    p.partTopM.buffer,
    p.partSlot.buffer,
    p.partTypology.buffer
  ] as ArrayBuffer[];
}

describe('createDisplay', () => {
  it('posts a revision-0 snapshot first: settled-only cells, no removals, ascending hide.add', () => {
    const { display, posts } = setup();
    expect(display.revision).toBe(-1);
    display.update(['b2', 'a3', 'a1', 'b1', 'a1'], envs({ a1: 5, a3: 4, b1: 6, b2: 1 }), meta());
    expect(posts).toHaveLength(1);
    const { msg } = posts[0];
    expect(msg.type).toBe('diff');
    expect(msg.rev).toBe(1);
    expect(msg.phase).toBe('commit');
    expect(msg.complete).toBe(true);
    expect(msg.render.revision).toBe(0);
    expect(display.revision).toBe(0);
    expect(msg.render.removedCells).toEqual([]);
    expect(msg.render.cells.map((c) => c.settled.cellId)).toEqual(['c0', 'c1']);
    expect(msg.render.cells.every((c) => c.rising === null)).toBe(true);
    expect(ids(cellById(msg, 'c0')!.settled)).toEqual(['a1', 'a3']);
    expect(ids(cellById(msg, 'c1')!.settled)).toEqual(['b1']);
    expect(msg.render.hide).toEqual({ add: ['a1', 'a3', 'b1'], remove: [] });
  });

  it('puts new and taller parcels in rising and shrunk ones in settled only', () => {
    const { display, posts } = setup();
    display.update(['a1', 'a2'], envs({ a1: 5, a2: 8 }), meta());
    display.update(
      ['a1', 'a2', 'a3'],
      envs({ a1: 9, a2: 4, a3: 3 }),
      meta({ rev: 2, phase: 'preview' })
    );
    expect(posts).toHaveLength(2);
    const { msg } = posts[1];
    expect(msg.render.revision).toBe(1);
    expect(msg.rev).toBe(2);
    expect(msg.phase).toBe('preview');
    const c0 = cellById(msg, 'c0')!;
    expect(ids(c0.rising)).toEqual(['a1', 'a3']);
    expect(ids(c0.settled)).toEqual(['a2']);
    expect(msg.render.hide).toEqual({ add: ['a3'], remove: [] });
    expect(msg.render.removedCells).toEqual([]);
  });

  it('drops a parcel whose build becomes null, un-hides it and removes an emptied sent cell', () => {
    const { display, posts } = setup();
    display.update(['a1', 'a2', 'b1'], envs({ a1: 5, a2: 5, b1: 5 }), meta());
    display.update(['a1', 'b1'], envs({ a1: 2, b1: null }), meta({ rev: 2 }));
    const { msg } = posts[1];
    expect(msg.render.revision).toBe(1);
    const c0 = cellById(msg, 'c0')!;
    expect(ids(c0.settled)).toEqual(['a2']);
    expect(c0.rising).toBeNull();
    expect(cellById(msg, 'c1')).toBeUndefined();
    expect(msg.render.removedCells).toEqual(['c1']);
    expect(msg.render.hide).toEqual({ add: [], remove: ['a1', 'b1'] });
    expect(display.building('a1')).toBeNull();
    expect(display.renderedEnv('a1')).toEqual({ maxStories: 2 });
    expect(display.renderedEnv('b1')).toBeNull();
  });

  it('lists only sent cells in removedCells', () => {
    const { display, posts } = setup();
    display.update(['a1'], envs({ a1: 5 }), meta());
    display.update(['b1'], envs({ b1: 5 }), meta({ rev: 2 }));
    display.update(['b1'], envs({ b1: 3 }), meta({ rev: 3 }));
    display.update(['a1'], envs({ a1: null }), meta({ rev: 4 }));
    expect(posts[3].msg.render.removedCells).toEqual(['c0']);
    display.update(['a2'], envs({ a2: 2 }), meta({ rev: 5 })); // env but no building
    expect(posts[4].msg.render.removedCells).toEqual([]);
    expect(posts[4].msg.render.cells).toEqual([]);
  });

  it('posts exactly one empty diff with revision +1 when nothing changed', () => {
    const { display, posts } = setup();
    display.update(['a1'], envs({ a1: 5 }), meta());
    display.update(['a1', 'a2', 'zz'], envs({ a1: 5 }), meta({ rev: 2 }));
    expect(posts).toHaveLength(2);
    expect(posts[1].msg.render).toEqual({
      revision: 1,
      cells: [],
      removedCells: [],
      hide: { add: [], remove: [] }
    });
    expect(posts[1].transfer).toEqual([]);
  });

  it('batches whole cells to batchParcels, with stats on the last diff and a running score', () => {
    const { display, posts } = setup(3);
    const stats: OpStats = {
      opId: 'op1',
      kind: 'paint',
      stories: 5,
      covered: 5,
      ineligible: 0,
      built: 5,
      notBigger: 0,
      removed: 0,
      partial: false
    };
    let n = 0;
    display.update(
      ['b3', 'b2', 'b1', 'a2', 'a1'],
      envs({ a1: 5, a2: 6, b1: 7, b2: 8, b3: 9 }),
      meta({ stats, complete: () => ++n === 2 })
    );
    expect(posts).toHaveLength(2);
    const [d1, d2] = posts.map((p) => p.msg);
    expect(d1.render.revision).toBe(0);
    expect(d2.render.revision).toBe(1);
    expect(d1.render.cells.map((c) => c.settled.cellId)).toEqual(['c0']);
    expect(ids(d1.render.cells[0].settled)).toEqual(['a1', 'a2']);
    expect(d2.render.cells.map((c) => c.settled.cellId)).toEqual(['c1']);
    expect(ids(d2.render.cells[0].rising)).toEqual(['b1', 'b2', 'b3']);
    expect(ids(d2.render.cells[0].settled)).toEqual([]);
    expect(d1.stats).toBeUndefined();
    expect(d2.stats).toEqual(stats);
    expect(d1.complete).toBe(false);
    expect(d2.complete).toBe(true);
    expect(d1.render.hide).toEqual({ add: ['a1', 'a2'], remove: [] });
    expect(d2.render.hide).toEqual({ add: ['b1', 'b2', 'b3'], remove: [] });

    const entry = (id: string): [ParcelRecord, GeneratedBuilding] => [
      RECS.get(id)!,
      display.building(id)!
    ];
    expect(d1.score).toEqual(score(['a1', 'a2'].map(entry), TARGETS));
    expect(d2.score).toEqual(score(['a1', 'a2', 'b1', 'b2', 'b3'].map(entry), TARGETS));
    expect(d2.score.grossUnits).toBe(35);
    expect(d2.score.demolishedUnits).toBe(10);
  });

  it('never splits a cell, even when it has more changes than batchParcels', () => {
    const { display, posts } = setup(2);
    display.update(['a1', 'a2', 'a3'], envs({ a1: 5, a2: 5, a3: 5 }), meta());
    expect(posts).toHaveLength(1);
    expect(ids(posts[0].msg.render.cells[0].settled)).toEqual(['a1', 'a2', 'a3']);
  });

  it('reset posts nothing and makes the next update a revision-0 snapshot', () => {
    const { display, posts } = setup();
    display.update(['a1', 'b1'], envs({ a1: 5, b1: 5 }), meta());
    display.update(['a1'], envs({ a1: 6 }), meta({ rev: 2 }));
    display.reset();
    expect(posts).toHaveLength(2);
    expect(display.renderedEnv('a1')).toBeNull();
    expect(display.building('a1')).toBeNull();
    display.update(['a1'], envs({ a1: 6 }), meta({ rev: 3, phase: 'load' }));
    const { msg } = posts[2];
    expect(msg.render.revision).toBe(0);
    expect(msg.render.cells).toHaveLength(1);
    expect(msg.render.cells[0].rising).toBeNull();
    expect(ids(msg.render.cells[0].settled)).toEqual(['a1']);
    expect(msg.render.hide).toEqual({ add: ['a1'], remove: [] });
    expect(msg.render.removedCells).toEqual([]);
    expect(msg.score.parcelsChanged).toBe(1);
  });

  it('transfers every typed-array buffer of every posted pack', () => {
    const { display, posts } = setup();
    display.update(['a1', 'b1'], envs({ a1: 5, b1: 5 }), meta());
    display.update(['a1', 'a2', 'b1'], envs({ a1: 4, a2: 7, b1: 9 }), meta({ rev: 2 }));
    for (const { msg, transfer } of posts) {
      const expected = msg.render.cells.flatMap((c) => [
        ...buffersOf(c.settled),
        ...(c.rising ? buffersOf(c.rising) : [])
      ]);
      expect(expected.length).toBeGreaterThan(0);
      expect(transfer).toHaveLength(expected.length);
      for (const b of expected) expect(transfer).toContain(b);
    }
  });

  it('tracks renderedEnv and building as the latest state', () => {
    const { display } = setup();
    expect(display.renderedEnv('a1')).toBeNull();
    display.update(['a1', 'a2'], envs({ a1: 5, a2: 1 }), meta());
    expect(display.renderedEnv('a1')).toEqual({ maxStories: 5 });
    expect(display.building('a1')?.stories).toBe(5);
    expect(display.renderedEnv('a2')).toEqual({ maxStories: 1 });
    expect(display.building('a2')).toBeNull();
    display.update(['a1'], envs({ a1: 7 }), meta({ rev: 2 }));
    expect(display.building('a1')?.stories).toBe(7);
    expect(display.building('zz')).toBeNull();
  });
});
