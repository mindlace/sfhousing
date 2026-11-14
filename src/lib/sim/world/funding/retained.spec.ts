// Guard (memory): what funding keeps outside a world is held per timeline, never per world or per
// funding system. Worlds stepped on one timeline, each through its own `createFundingSystem`,
// leave the module caches (the rowless memo's tables, `frameMoney`'s frames) as the first world
// left them, within a table of a byte per lot per (first month, last change read); and a world and
// its due list hold the same typed-array bytes with the memo on and off. Counts and byte lengths of
// retained structures, not the heap: no GC timing enters.
import { describe, expect, it } from 'vitest';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import type { Due, World } from '../types';
import { withFunding } from '../world';
import { ELIGIBILITY, rowlessMemoSize } from './apply';
import { frameMoneySize } from './frame-money';
import { createFundingSystem } from './system';
import { fundedMini, oneMoneyTimeline, replanAt } from './test/fixtures';

/** Months planned and stepped (10 years); every frame re-identified from `A` and again from `B`. */
const W = 120;
const A = 40;
const B = 80;
const INPUT = fundedMini();
const NOWHERE = { event() {} };

const timelineOf = (): PolicyTimeline =>
  replanAt(replanAt(oneMoneyTimeline(INPUT, INPUT.finance!), A), B);

/** One world on `t` with its own funding system: created, planned through `W`, stepped `W` months. */
function runWorld(
  statics: Statics,
  t: PolicyTimeline,
  seed: number,
  memo = true
): { world: World; due: Due } {
  ELIGIBILITY.memo = memo;
  try {
    const core = withFunding(createFundingSystem());
    const world = core.createWorld(statics, t, seed, NOWHERE);
    const due = core.planDue(world, statics, t, seed, W);
    for (let m = 1; m <= W; m++) core.step(world, due, statics, t, seed, NOWHERE);
    return { world, due };
  } finally {
    ELIGIBILITY.memo = true;
  }
}

/** Bytes of the distinct typed-array buffers reachable from `root`. */
function typedBytes(root: unknown): number {
  const seen = new Set<object>();
  const buffers = new Set<ArrayBufferLike>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const x = stack.pop();
    if (x === null || typeof x !== 'object' || seen.has(x)) continue;
    seen.add(x);
    if (ArrayBuffer.isView(x)) buffers.add(x.buffer);
    else if (x instanceof Map) for (const [k, v] of x) stack.push(k, v);
    else if (x instanceof Set) for (const v of x) stack.push(v);
    else for (const v of Object.values(x)) stack.push(v);
  }
  let bytes = 0;
  for (const b of buffers) bytes += b.byteLength;
  return bytes;
}

describe('funding memory: held per timeline, not per world', () => {
  const statics = staticsOf(INPUT);

  it('six worlds on one timeline, each with its own funding system, leave the caches one world left', () => {
    const t = timelineOf();
    runWorld(statics, t, 1);
    const one = { memo: rowlessMemoSize(t), frames: frameMoneySize(t) };
    for (let seed = 2; seed <= 6; seed++) runWorld(statics, t, seed);
    const six = { memo: rowlessMemoSize(t), frames: frameMoneySize(t) };
    expect(six).toEqual(one);
    // The bound: a table per (first month, last change read) within the stepped months, a byte
    // per lot each, whatever the number of worlds.
    const changes = t.changes().filter((c) => c <= W).length;
    expect(one.memo.tables).toBeGreaterThan(1);
    expect(one.memo.tables).toBeLessThanOrEqual(changes + 1);
    expect(one.memo.bytes).toBe(one.memo.tables * statics.parcelId.length);
    expect(one.frames).toBeGreaterThan(0);
  });

  it('a second timeline object gets its own caches; the first keeps its own', () => {
    const t1 = timelineOf();
    const t2 = timelineOf();
    runWorld(statics, t1, 1);
    const before = rowlessMemoSize(t1);
    runWorld(statics, t2, 1);
    expect(rowlessMemoSize(t1)).toEqual(before);
    expect(rowlessMemoSize(t2)).toEqual(before);
  });

  it.each([1, 2, 3])(
    'seed %i: the world and its due list hold the same typed-array bytes, memo on and off',
    (seed) => {
      const t = timelineOf();
      const off = runWorld(statics, t, seed, false);
      const on = runWorld(statics, t, seed, true);
      expect(typedBytes(on.world)).toBe(typedBytes(off.world));
      expect(typedBytes(on.due)).toBe(typedBytes(off.due));
      expect(typedBytes(on.world)).toBeGreaterThan(0);
    }
  );
});
