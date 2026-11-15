import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { undoRedo, type CommitKind, type Restores } from '$lib/sim-log';
import { History, type LabelledEntry } from './history';

const e = (
  seq: number,
  label: string,
  r: Restores | null = null,
  kind?: CommitKind
): LabelledEntry => ({
  seq,
  kind: kind ?? (r ? 'restore' : 'edit'),
  restores: r,
  label
});

const arbLog = fc
  .array(
    fc.record({
      pick: fc.integer({ min: 0, max: 9 }),
      pos: fc.nat(),
      as: fc.constantFrom<Restores['as'][]>('undo', 'redo', 'jump')
    }),
    { maxLength: 40 }
  )
  .map((rows) =>
    rows.map((r, i): LabelledEntry => {
      const seq = i + 1;
      if (r.pick === 0) return e(seq, `L${seq}`, null, 'system');
      if (r.pick <= 4 || i === 0) return e(seq, `L${seq}`);
      return e(seq, `L${seq}`, {
        position: r.pos % 3 === 0 ? r.pos % i : Math.max(0, i - 1 - (r.pos % 3)),
        as: r.as
      });
    })
  );

describe('History', () => {
  it('walks the spec table: five edits, two undos, a redo, an edit', () => {
    const h = new History();
    for (let s = 1; s <= 5; s++) h.push(e(s, `L${s}`));
    expect(h.undo).toEqual({ position: 4, label: 'L5' });
    h.push(e(6, 'L5', { position: 4, as: 'undo' }));
    h.push(e(7, 'L4', { position: 3, as: 'undo' }));
    expect(h.redo).toEqual({ position: 6, label: 'L4' });
    h.push(e(8, 'L4', { position: 6, as: 'redo' }));
    expect(h.undo).toEqual({ position: 7, label: 'L4' });
    h.push(e(9, 'L9'));
    expect(h.redo).toBeNull();
    expect(h.undo).toEqual({ position: 8, label: 'L9' });
  });

  it('stops at a system commit', () => {
    const h = new History();
    h.push(e(1, 'Start', null, 'system'));
    expect(h.undo).toBeNull();
    h.push(e(2, 'A'));
    expect(h.undo).toEqual({ position: 1, label: 'A' });
  });

  it('reports the last pushed seq as its position, 0 before any', () => {
    const h = new History();
    expect(h.position).toBe(0);
    h.push(e(1, 'A'));
    h.push(e(2, 'B'));
    expect(h.position).toBe(2);
  });

  it('clones without sharing stacks', () => {
    const h = new History();
    h.push(e(1, 'A'));
    const c = h.clone();
    c.push(e(2, 'B'));
    expect(h.undo).toEqual({ position: 0, label: 'A' });
    expect(c.undo).toEqual({ position: 1, label: 'B' });
    expect(h.position).toBe(1);
    expect(c.position).toBe(2);
  });

  it('gives the positions undoRedo gives, for any log', () => {
    let withRedo = 0;
    let withSystem = 0;
    let withJump = 0;
    expect(() =>
      fc.assert(
        fc.property(arbLog, (log) => {
          const h = new History();
          log.forEach((x) => h.push(x));
          const r = undoRedo(log);
          if (r.redo !== null) withRedo++;
          if (log.some((x) => x.kind === 'system')) withSystem++;
          if (log.some((x) => x.restores?.as === 'jump')) withJump++;
          return (
            (h.undo?.position ?? null) === r.undo &&
            (h.redo?.position ?? null) === r.redo &&
            // The entry at position p was pushed by the commit that follows it: log[p].
            (h.undo?.label ?? null) === (r.undo === null ? null : log[r.undo].label) &&
            (h.redo?.label ?? null) === (r.redo === null ? null : log[r.redo].label) &&
            h.position === (log.at(-1)?.seq ?? 0)
          );
        }),
        { numRuns: 300 }
      )
    ).not.toThrow();
    // Unseeded; over 15 runs redo reached 15-32 of 300 (mean 22), system about 100, jump about 125.
    expect(withRedo).toBeGreaterThan(5);
    expect(withSystem).toBeGreaterThan(0);
    expect(withJump).toBeGreaterThan(0);
  });
});
