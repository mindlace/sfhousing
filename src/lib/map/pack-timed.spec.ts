import { describe, expect, it } from 'vitest';
import gen from './fixtures/generated-small.json';
import {
  FOOTPRINT_M,
  packTimedCell,
  packTimedTransferables,
  type TimedPackInput
} from './pack-timed';
import { packCell } from './pack';
import { TYPOLOGY_ORDER } from './types';
import type { TimedPackedCell } from './types';
import type { GeneratedBuilding } from '$lib/generator';
import type { Schedule } from '$lib/sim/scenario/types';
import { OPEN_DAY } from '$lib/timelapse/time';

const B = gen as unknown as GeneratedBuilding[];
const RING: [number, number][] = [
  [-122.42, 37.77],
  [-122.42, 37.771],
  [-122.419, 37.771],
  [-122.419, 37.77]
];

function schedule(projectId: string, over: Partial<Schedule> = {}): Schedule {
  return {
    projectId,
    origin: 'simulated',
    parcelIds: ['9000001'],
    pathway: 'discretionary',
    entered: { filed: 100, entitled: 300 },
    end: { kind: 'open' },
    revisions: [{ day: 100, units: 9, stories: 5 }],
    existingUnits: 2,
    multiPhase: false,
    phase: null,
    ...over
  };
}
function item(
  projectId: string,
  massings: TimedPackInput['massings'],
  over: Partial<Schedule> = {},
  pickParcelId = '9000001'
): TimedPackInput {
  return {
    schedule: schedule(projectId, {
      revisions: massings.map((_, i) => ({ day: 100 + 50 * i, units: 10 + i, stories: 5 })),
      ...over
    }),
    massings,
    pickParcelId
  };
}
const bytes = (b: ArrayBuffer) => Array.from(new Uint8Array(b));
const arrays = (p: TimedPackedCell) => [
  p.parcelMeta,
  p.startIndices,
  p.positions,
  p.partTopM,
  p.partSlot,
  p.partAppearance,
  p.partTypology,
  p.partWindow,
  p.slotStages,
  p.slotEnd,
  p.slotPathway
];
const count = (xs: ArrayLike<number>, v: number) => Array.from(xs).filter((x) => x === v).length;

describe('packTimedCell (§4.1.1)', () => {
  it('sorts slots by projectId and lets slots share a pickParcelId', () => {
    const p = packTimedCell('50_25', [
      item('proj-b', [B[0]], {}, '9000007'),
      item('proj-a', [B[1]], {}, '9000007'),
      item('Proj-c', [B[2]], {}, '9000003')
    ]);
    expect(p.slotProjectIds).toEqual(['Proj-c', 'proj-a', 'proj-b']);
    expect(p.parcelIds).toEqual(['9000003', '9000007', '9000007']);
    expect(p.cellId).toBe('50_25');
    expect(Array.from(p.partSlot)).toEqual(Array.from(p.partSlot).sort((x, y) => x - y));
    expect(new Set(p.partSlot)).toEqual(new Set([0, 1, 2]));
  });

  it('parcelMeta describes the final revision: units from the schedule, stories from the building', () => {
    const s = schedule('p', {
      revisions: [
        { day: 100, units: 7, stories: null },
        { day: 200, units: 11, stories: 12 }
      ],
      existingUnits: 4
    });
    const p = packTimedCell('c', [
      { schedule: s, massings: [B[0], B[4]], pickParcelId: '9000009' }
    ]);
    expect(Array.from(p.parcelMeta)).toEqual([
      11,
      4,
      B[4].stories,
      TYPOLOGY_ORDER.indexOf(B[4].typology)
    ]);
  });

  it('a one-revision slot builds the same parts as packCell, with an open window', () => {
    const p = packTimedCell('c', [item('p', [B[4]])]);
    const ref = packCell('c', [{ building: B[4], existingUnits: 2 }]);
    expect(p.partCount).toBe(ref.partCount);
    expect(Array.from(p.positions)).toEqual(Array.from(ref.positions));
    expect(Array.from(p.startIndices)).toEqual(Array.from(ref.startIndices));
    expect(Array.from(p.partTopM)).toEqual(Array.from(ref.partTopM));
    expect(Array.from(p.partAppearance)).toEqual(Array.from(ref.partAppearance));
    expect(Array.from(p.partTypology)).toEqual(Array.from(ref.partTypology));
    expect(Array.from(p.partWindow)).toEqual(
      Array.from({ length: ref.partCount }, () => [100, OPEN_DAY]).flat()
    );
  });

  it('a two-revision slot windows each revision [d0, d1) then [d1, OPEN_DAY)', () => {
    const p = packTimedCell('c', [item('p', [B[0], B[2]])]);
    const n0 = packCell('c', [{ building: B[0], existingUnits: 0 }]).partCount;
    const n1 = packCell('c', [{ building: B[2], existingUnits: 0 }]).partCount;
    expect(p.partCount).toBe(n0 + n1);
    const w = Array.from(p.partWindow);
    expect(w.length).toBe(2 * p.partCount);
    for (let k = 0; k < n0; k++) expect([w[2 * k], w[2 * k + 1]]).toEqual([100, 150]);
    for (let k = n0; k < p.partCount; k++)
      expect([w[2 * k], w[2 * k + 1]]).toEqual([150, OPEN_DAY]);
    expect(p.partWindow[p.partWindow.length - 1]).toBe(OPEN_DAY);
    expect(count(p.partSlot, 0)).toBe(p.partCount);
  });

  it('keeps each revision on its own typology and orders parts by slot then revision', () => {
    const p = packTimedCell('c', [item('b', [B[0], B[1]]), item('a', [B[4], B[5]])]);
    expect(p.slotProjectIds).toEqual(['a', 'b']);
    const slot0 = count(p.partSlot, 0);
    expect(Array.from(p.partSlot.subarray(0, slot0))).toEqual(Array(slot0).fill(0));
    expect(p.partTypology[0]).toBe(TYPOLOGY_ORDER.indexOf(B[4].typology));
    expect(p.partTypology[slot0 - 1]).toBe(TYPOLOGY_ORDER.indexOf(B[5].typology));
  });

  it('a footprint-only slot has FOOTPRINT_M tops, zero stories and typology, appearance 0', () => {
    const p = packTimedCell('c', [
      item('x', [B[0]]),
      item('f', [{ footprint: RING }, { footprint: RING }])
    ]);
    expect(p.slotProjectIds).toEqual(['f', 'x']);
    expect(FOOTPRINT_M).toBe(1);
    expect(p.parcelMeta[0]).toBe(11);
    expect(p.parcelMeta[2]).toBe(0);
    expect(p.parcelMeta[3]).toBe(0);
    expect(p.parcelMeta[4 + 2]).toBe(B[0].stories);
    expect(count(p.partSlot, 0)).toBe(2);
    expect(Array.from(p.partTopM.subarray(0, 2))).toEqual([FOOTPRINT_M, FOOTPRINT_M]);
    expect(Array.from(p.partAppearance.subarray(0, 2))).toEqual([0, 0]);
    expect(Array.from(p.partTypology.subarray(0, 2))).toEqual([0, 0]);
    expect(Array.from(p.partWindow.subarray(0, 4))).toEqual([100, 150, 150, OPEN_DAY]);
  });

  it('normalises a footprint ring to clockwise, with or without a closing vertex', () => {
    const closed = [...RING, RING[0]];
    const p = packTimedCell('c', [item('f', [{ footprint: closed }])]);
    expect(p.partCount).toBe(1);
    // The stored ring is RING.length vertices, or one more when normaliseRing repeats the first
    // vertex to close it; derive the count from startIndices rather than assuming either.
    const n = p.startIndices[1] - p.startIndices[0];
    expect([RING.length, RING.length + 1]).toContain(n);
    expect(p.positions.length).toBe(2 * n);
    if (n === RING.length + 1) {
      expect([p.positions[2 * n - 2], p.positions[2 * n - 1]]).toEqual([
        p.positions[0],
        p.positions[1]
      ]);
    }
    // Shoelace over the n stored vertices (a closing duplicate adds zero), wrapping at the end.
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area +=
        p.positions[2 * i] * p.positions[2 * j + 1] - p.positions[2 * j] * p.positions[2 * i + 1];
    }
    expect(area).toBeLessThan(0);
  });

  it('slotStages is NaN for stages never entered, in STAGE_ORDER', () => {
    const p = packTimedCell('c', [
      item('p', [B[0]], { entered: { filed: 100, entitled: 300, construction: 900 } })
    ]);
    const s = Array.from(p.slotStages);
    expect(s.length).toBe(7);
    expect(s[0]).toBeNaN();
    expect(s[1]).toBe(100);
    expect(s[2]).toBe(300);
    expect(s[3]).toBeNaN();
    expect(s[4]).toBeNaN();
    expect(s[5]).toBe(900);
    expect(s[6]).toBeNaN();
  });

  it('slotEnd and slotPathway for every kind', () => {
    const p = packTimedCell('c', [
      item('a-open', [B[0]], { end: { kind: 'open' }, pathway: 'discretionary' }),
      item('b-done', [B[1]], { end: { kind: 'complete', day: 2000 }, pathway: 'streamlined' }),
      item('c-exit', [B[2]], {
        end: { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: 1500 },
        pathway: 'permitOnly'
      })
    ]);
    expect(p.slotEnd[0]).toBeNaN();
    expect(p.slotEnd[1]).toBe(0);
    expect(Array.from(p.slotEnd.subarray(2))).toEqual([2000, 1, 1500, 2]);
    expect(Array.from(p.slotPathway)).toEqual([0, 1, 2]);
  });

  it('is deterministic: the same input packs to byte-identical buffers', () => {
    const make = () =>
      packTimedCell('c', [
        item('b', [B[0], { footprint: RING }]),
        item('a', [B[4]], { end: { kind: 'exit', stage: 'filed', reason: 'expired', day: 700 } })
      ]);
    const x = arrays(make());
    const y = arrays(make());
    expect(x.length).toBe(11);
    x.forEach((arr, i) => {
      expect(bytes(arr.buffer as ArrayBuffer)).toEqual(bytes(y[i].buffer as ArrayBuffer));
    });
  });

  it('accepts a building source other than user', () => {
    const b = { ...B[0], source: 'scenario' } as unknown as GeneratedBuilding;
    expect(packTimedCell('c', [item('p', [b])]).partCount).toBeGreaterThan(0);
  });

  it('packs no items to an empty cell', () => {
    const p = packTimedCell('c', []);
    expect(p.partCount).toBe(0);
    expect(Array.from(p.startIndices)).toEqual([0]);
    expect(p.slotProjectIds).toEqual([]);
  });

  describe('throws, naming the cell and project', () => {
    it('on massings/revisions length mismatch', () => {
      const bad = item('p-mismatch', [B[0]], {
        revisions: [
          { day: 1, units: 1, stories: 1 },
          { day: 2, units: 1, stories: 1 }
        ]
      });
      expect(() => packTimedCell('cell-9', [bad])).toThrow(/cell-9.*p-mismatch/);
    });
    it('on a slot with no revisions', () => {
      const bad = item('p-none', [], { revisions: [] });
      expect(() => packTimedCell('cell-9', [bad])).toThrow(/cell-9.*p-none/);
    });
    it('on non-ascending revision days', () => {
      const bad = item('p-desc', [B[0], B[1]], {
        revisions: [
          { day: 200, units: 1, stories: 1 },
          { day: 199, units: 1, stories: 1 }
        ]
      });
      expect(() => packTimedCell('cell-9', [bad])).toThrow(/cell-9.*p-desc/);
    });
    it('on equal revision days (ruling R17: §4.1.1 "non-ascending")', () => {
      const bad = item('p-equal', [B[0], B[1]], {
        revisions: [
          { day: 100, units: 1, stories: 1 },
          { day: 100, units: 2, stories: 1 }
        ]
      });
      expect(() => packTimedCell('cell-9', [bad])).toThrow(/cell-9.*p-equal.*day 100/);
    });
    it('on a footprint ring with fewer than 3 distinct vertices', () => {
      const [a, b] = RING;
      for (const footprint of [[], [a], [a, b], [a, b, a], [a, b, b, a]]) {
        const bad = item('p-ring', [{ footprint }]);
        expect(() => packTimedCell('cell-9', [bad])).toThrow(/cell-9.*p-ring.*3 distinct/);
      }
      expect(packTimedCell('c', [item('p', [{ footprint: [a, b, RING[2]] }])]).partCount).toBe(1);
    });
    it('on a building part ring with fewer than 3 distinct vertices', () => {
      const b = structuredClone(B[0]);
      b.parts[0].footprint = [b.parts[0].footprint[0]];
      expect(() => packTimedCell('cell-9', [item('p-part', [b])])).toThrow(/cell-9.*p-part/);
    });
    it('on a duplicate projectId', () => {
      expect(() => packTimedCell('cell-9', [item('p-dup', [B[0]]), item('p-dup', [B[1]])])).toThrow(
        /cell-9.*p-dup/
      );
    });
    it('on an unknown typology', () => {
      const bad = { ...B[0], typology: 'castle' } as unknown as GeneratedBuilding;
      expect(() => packTimedCell('cell-9', [item('p-typ', [B[1], bad])])).toThrow(/cell-9.*p-typ/);
    });
  });
});

describe('packTimedTransferables', () => {
  it('lists the 11 typed-array buffers, all distinct', () => {
    const p = packTimedCell('c', [item('a', [B[4], B[5]]), item('b', [{ footprint: RING }])]);
    const t = packTimedTransferables(p);
    expect(t.length).toBe(11);
    expect(new Set(t).size).toBe(11);
    for (const arr of arrays(p)) expect(t).toContain(arr.buffer);
  });
});
