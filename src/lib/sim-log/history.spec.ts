import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { undoRedo, type HistoryEntry } from './history';
import type { Restores } from './types';

const edit = (seq: number): HistoryEntry => ({ seq, kind: 'edit', restores: null });
const sys = (seq: number): HistoryEntry => ({ seq, kind: 'system', restores: null });
const rest = (seq: number, position: number, as: Restores['as']): HistoryEntry => ({
  seq,
  kind: 'restore',
  restores: { position, as }
});

describe('undoRedo', () => {
  it('follows the spec table (tbl-undo)', () => {
    const log = [1, 2, 3, 4, 5].map(edit);
    expect(undoRedo(log)).toEqual({ undo: 4, redo: null });
    log.push(rest(6, 4, 'undo'));
    expect(undoRedo(log)).toEqual({ undo: 3, redo: 5 });
    log.push(rest(7, 3, 'undo'));
    expect(undoRedo(log)).toEqual({ undo: 2, redo: 6 });
    log.push(rest(8, 6, 'redo'));
    expect(undoRedo(log)).toEqual({ undo: 7, redo: 5 });
    log.push(edit(9));
    expect(undoRedo(log)).toEqual({ undo: 8, redo: null });
    log.push(rest(10, 8, 'undo'));
    expect(undoRedo(log).undo).toBe(7);
  });

  it('starts empty and can undo the first edit to position 0', () => {
    expect(undoRedo([])).toEqual({ undo: null, redo: null });
    expect(undoRedo([edit(1)])).toEqual({ undo: 0, redo: null });
  });

  it('a system commit is a barrier', () => {
    expect(undoRedo([edit(1), sys(2)])).toEqual({ undo: null, redo: null });
    expect(undoRedo([edit(1), edit(2), rest(3, 1, 'undo'), sys(4)])).toEqual({
      undo: null,
      redo: null
    });
    expect(undoRedo([sys(1), edit(2)])).toEqual({ undo: 1, redo: null });
  });

  it('a jump counts as an edit (R14)', () => {
    expect(undoRedo([edit(1), edit(2), rest(3, 1, 'undo'), rest(4, 2, 'jump')])).toEqual({
      undo: 3,
      redo: null
    });
  });

  it('an undo re-applied on a moved tip keeps its target', () => {
    // Tab A undid to 2 while tab B appended 4; A's restore landed at 5.
    expect(undoRedo([edit(1), edit(2), edit(3), edit(4), rest(5, 2, 'undo')])).toEqual({
      undo: 1,
      redo: 4
    });
  });

  it('a restore whose target is not on its stack counts as a jump', () => {
    expect(undoRedo([edit(1), rest(2, 7, 'undo')])).toEqual({ undo: 1, redo: null });
    expect(undoRedo([edit(1), rest(2, 7, 'redo')])).toEqual({ undo: 1, redo: null });
  });

  it('matches a reference editor over random edit, undo, redo, jump and system', () => {
    const op = fc.constantFrom('edit', 'undo', 'redo', 'jump', 'system');
    fc.assert(
      fc.property(fc.array(fc.tuple(op, fc.nat()), { maxLength: 40 }), (ops) => {
        // Reference: a plain editor holding states (numbers) on real stacks.
        // stateAt[p] is the state the log has at position p.
        let cur = 0;
        let next = 1;
        const u: number[] = [];
        const rd: number[] = [];
        const stateAt = [0];
        const log: HistoryEntry[] = [];
        for (const [o, pick] of ops) {
          const t = undoRedo(log);
          const seq = log.length + 1;
          if (o === 'edit') {
            u.push(cur);
            rd.length = 0;
            cur = next++;
            log.push(edit(seq));
          } else if (o === 'system') {
            u.length = 0;
            rd.length = 0;
            cur = next++;
            log.push(sys(seq));
          } else if (o === 'jump') {
            const p = pick % (log.length + 1);
            u.push(cur);
            rd.length = 0;
            cur = stateAt[p];
            log.push(rest(seq, p, 'jump'));
          } else if (o === 'undo') {
            if (u.length === 0) {
              expect(t.undo).toBeNull();
              continue;
            }
            expect(stateAt[t.undo!]).toBe(u.at(-1));
            rd.push(cur);
            cur = u.pop()!;
            log.push(rest(seq, t.undo!, 'undo'));
          } else {
            if (rd.length === 0) {
              expect(t.redo).toBeNull();
              continue;
            }
            expect(stateAt[t.redo!]).toBe(rd.at(-1));
            u.push(cur);
            cur = rd.pop()!;
            log.push(rest(seq, t.redo!, 'redo'));
          }
          stateAt.push(cur);
        }
        const t = undoRedo(log);
        expect(t.undo === null ? null : stateAt[t.undo]).toBe(u.at(-1) ?? null);
        expect(t.redo === null ? null : stateAt[t.redo]).toBe(rd.at(-1) ?? null);
      }),
      { numRuns: 500 }
    );
  });
});
