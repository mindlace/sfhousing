import { describe, expect, it } from 'vitest';
import { DemolishPump, type PumpDeps } from './demolish';
import { SLICE_IDS } from '../hide';
import { DAYS, SLOT, timelineSmall } from '../fixtures/timeline-small';
import type { ParcelId } from '$lib/data/parcel';

type Entry = { parcelId: ParcelId; day: number };

interface FakePump extends PumpDeps {
  /** One list per flushed frame (index 0 = before any frame). */
  setCalls: ParcelId[][];
  clearCalls: ParcelId[][];
  clearAllCount: number;
  replaced: Set<ParcelId>;
  ran: number[];
  cancelled: number[];
  pendingFrames(): number;
  /** Runs the callbacks queued before this call; ones queued meanwhile wait for the next. */
  flushFrame(): void;
}

function fake(): FakePump {
  let next = 1;
  const queue = new Map<number, () => void>();
  const f: FakePump = {
    setCalls: [[]],
    clearCalls: [[]],
    clearAllCount: 0,
    replaced: new Set(),
    ran: [],
    cancelled: [],
    setReplaced(id) {
      f.replaced.add(id);
      f.setCalls[f.setCalls.length - 1].push(id);
    },
    clearReplaced(id) {
      f.replaced.delete(id);
      f.clearCalls[f.clearCalls.length - 1].push(id);
    },
    clearAllReplaced() {
      f.clearAllCount++;
      f.replaced.clear();
    },
    raf(cb) {
      const h = next++;
      queue.set(h, () => cb(0));
      return h;
    },
    cancelRaf(h) {
      f.cancelled.push(h);
      queue.delete(h);
    },
    pendingFrames: () => queue.size,
    flushFrame() {
      f.setCalls.push([]);
      f.clearCalls.push([]);
      for (const [h, cb] of [...queue]) {
        if (!queue.delete(h)) continue;
        f.ran.push(h);
        cb();
      }
    }
  };
  return f;
}

/** n entries on distinct parcels, days 1000, 1001, … */
function entries(n: number): Entry[] {
  return Array.from({ length: n }, (_, i) => ({ parcelId: `p${i}`, day: 1000 + i }));
}
const lastCall = <T>(a: T[][]) => a[a.length - 1];

describe('DemolishPump', () => {
  it('moves at most SLICE_IDS per frame forward and converges in ceil(n/SLICE_IDS) frames', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace(entries(5000));
    expect(d.clearAllCount).toBe(1);
    pump.setTarget(1000 + 4999);
    expect(pump.pending).toBe(true);
    expect(d.pendingFrames()).toBe(1);
    d.flushFrame();
    expect(lastCall(d.setCalls)).toHaveLength(SLICE_IDS);
    expect(pump.applied).toBe(2000);
    expect(pump.lastFrameOps).toBe(2000);
    d.flushFrame();
    expect(lastCall(d.setCalls)).toHaveLength(SLICE_IDS);
    expect(pump.pending).toBe(true);
    d.flushFrame();
    expect(lastCall(d.setCalls)).toHaveLength(1000);
    expect(pump.applied).toBe(5000);
    expect(pump.total).toBe(5000);
    expect(pump.pending).toBe(false);
    expect(pump.maxFrameOps).toBe(2000);
    expect(d.replaced.size).toBe(5000);
  });

  it('moves at most SLICE_IDS per frame backward', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace(entries(5000));
    pump.setTarget(1e9);
    d.flushFrame();
    d.flushFrame();
    d.flushFrame();
    expect(pump.applied).toBe(5000);
    pump.setTarget(999);
    expect(pump.pending).toBe(true);
    d.flushFrame();
    expect(lastCall(d.clearCalls)).toHaveLength(SLICE_IDS);
    expect(pump.applied).toBe(3000);
    d.flushFrame();
    expect(lastCall(d.clearCalls)).toHaveLength(SLICE_IDS);
    expect(pump.pending).toBe(true);
    d.flushFrame();
    expect(lastCall(d.clearCalls)).toHaveLength(1000);
    expect(pump.applied).toBe(0);
    expect(pump.pending).toBe(false);
    expect(d.replaced.size).toBe(0);
    expect(pump.lastFrameOps).toBe(1000);
  });

  it('schedules no frame inside a gap between entry days and one frame per crossing', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace([
      { parcelId: 'a', day: 100 },
      { parcelId: 'b', day: 200 }
    ]);
    pump.setTarget(150);
    expect(d.pendingFrames()).toBe(1); // crosses day 100 from the initial (before-all) target
    d.flushFrame();
    expect(pump.applied).toBe(1);
    for (const t of [101, 150, 199, 120, 100]) {
      pump.setTarget(t);
      expect(d.pendingFrames()).toBe(0);
    }
    pump.setTarget(200);
    expect(d.pendingFrames()).toBe(1);
    pump.setTarget(201);
    pump.setTarget(250);
    expect(d.pendingFrames()).toBe(1); // a second call while one is queued does not queue more
    d.flushFrame();
    expect(pump.applied).toBe(2);
    pump.setTarget(199);
    expect(d.pendingFrames()).toBe(1); // crossing back over day 200
    d.flushFrame();
    expect(pump.applied).toBe(1);
    expect(pump.has('a')).toBe(true);
    expect(pump.has('b')).toBe(false);
  });

  it('keeps a parcel in two entries replaced until both are unapplied', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace([
      { parcelId: 'x', day: 100 },
      { parcelId: 'y', day: 150 },
      { parcelId: 'x', day: 200 }
    ]);
    pump.setTarget(120);
    d.flushFrame();
    expect(pump.has('x')).toBe(true);
    pump.setTarget(300);
    d.flushFrame();
    expect(pump.applied).toBe(3);
    expect(d.setCalls.flat().filter((id) => id === 'x')).toHaveLength(1); // set on 0 to 1 only
    pump.setTarget(160); // between the two days: second x unapplied, first remains
    d.flushFrame();
    expect(pump.applied).toBe(2);
    expect(pump.has('x')).toBe(true);
    expect(d.replaced.has('x')).toBe(true);
    expect(d.clearCalls.flat()).toEqual([]);
    pump.setTarget(99);
    d.flushFrame();
    expect(pump.has('x')).toBe(false);
    expect(d.replaced.has('x')).toBe(false);
    expect(d.clearCalls.flat().filter((id) => id === 'x')).toHaveLength(1);
  });

  it('handles the fixture parcel shared by slots a and h', () => {
    expect(SLOT.h.parcelId).toBe(SLOT.a.parcelId);
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace(timelineSmall.demolish);
    expect(pump.total).toBe(4);
    pump.setTarget(DAYS.h.construction);
    d.flushFrame();
    expect(pump.applied).toBe(4);
    expect([...pump.appliedIds()].sort()).toEqual(
      [SLOT.a.parcelId, SLOT.c.parcelId, SLOT.e.parcelId].sort()
    );
    pump.setTarget(DAYS.h.construction - 1); // only h unapplied; a's entry still holds the parcel
    d.flushFrame();
    expect(pump.applied).toBe(3);
    expect(pump.has(SLOT.a.parcelId)).toBe(true);
    expect(d.replaced.has(SLOT.a.parcelId)).toBe(true);
    pump.setTarget(DAYS.a.construction - 1); // below both a and h
    d.flushFrame();
    expect(pump.has(SLOT.a.parcelId)).toBe(false);
    expect(d.replaced.has(SLOT.a.parcelId)).toBe(false);
    expect(pump.has(SLOT.e.parcelId)).toBe(true);
  });

  it('sorts by (day, parcelId) and does not mutate the input', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    const list: Entry[] = [
      { parcelId: 'b', day: 10 },
      { parcelId: 'c', day: 5 },
      { parcelId: 'a', day: 10 }
    ];
    pump.replace(list);
    pump.setTarget(10);
    d.flushFrame();
    expect(d.setCalls.flat()).toEqual(['c', 'a', 'b']);
    expect(list.map((e) => e.parcelId)).toEqual(['b', 'c', 'a']);
  });

  it('replace mid-flight cancels the pending frame and converges from 0 to the target', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace(entries(5000));
    expect(d.clearAllCount).toBe(1);
    pump.setTarget(1000 + 4999);
    d.flushFrame();
    expect(pump.applied).toBe(2000);
    const oldHandle = d.ran[d.ran.length - 1] + 1; // the frame rescheduled by that flush
    expect(pump.pending).toBe(true);
    pump.replace(entries(3000));
    expect(d.cancelled).toEqual([oldHandle]);
    expect(d.clearAllCount).toBe(2);
    expect(d.replaced.size).toBe(0);
    expect(pump.applied).toBe(0);
    expect(pump.total).toBe(3000);
    expect(pump.pending).toBe(true); // the retained target still lies beyond the new cursor
    d.flushFrame();
    d.flushFrame();
    expect(d.ran).not.toContain(oldHandle);
    expect(pump.applied).toBe(3000);
    expect(pump.pending).toBe(false);
    expect(d.replaced.size).toBe(3000);
    expect(d.clearAllCount).toBe(2);
  });

  it('replace with a target before every entry schedules nothing', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.setTarget(0);
    pump.replace(entries(10));
    expect(d.pendingFrames()).toBe(0);
    expect(pump.pending).toBe(false);
    expect(pump.applied).toBe(0);
  });

  it('has and appliedIds reflect the applied set', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace(entries(5));
    expect(pump.has('p0')).toBe(false);
    pump.setTarget(1002);
    expect(pump.has('p0')).toBe(false); // not applied until the frame runs
    d.flushFrame();
    expect(pump.has('p0')).toBe(true);
    expect(pump.has('p2')).toBe(true);
    expect(pump.has('p3')).toBe(false);
    expect([...pump.appliedIds()]).toEqual(['p0', 'p1', 'p2']);
    pump.setTarget(1000);
    d.flushFrame();
    expect([...pump.appliedIds()]).toEqual(['p0']);
  });

  it('destroy cancels the pending frame and ignores later calls', () => {
    const d = fake();
    const pump = new DemolishPump(d);
    pump.replace(entries(10));
    pump.setTarget(2000);
    expect(pump.pending).toBe(true);
    pump.destroy();
    expect(pump.pending).toBe(false);
    expect(d.pendingFrames()).toBe(0);
    pump.setTarget(0);
    pump.setTarget(2000);
    pump.replace(entries(3));
    expect(d.pendingFrames()).toBe(0);
    expect(pump.has('p0')).toBe(false);
  });

  it('schedules one bound frame callback, so setTarget allocates no closure (§4.7)', () => {
    const d = fake();
    const callbacks: ((t: number) => void)[] = [];
    const raf = d.raf;
    d.raf = (cb) => {
      callbacks.push(cb);
      return raf(cb);
    };
    const pump = new DemolishPump(d);
    pump.replace(entries(3));
    pump.setTarget(1000);
    d.flushFrame();
    pump.setTarget(1001);
    d.flushFrame();
    pump.setTarget(999);
    d.flushFrame();
    expect(callbacks.length).toBe(3);
    expect(new Set(callbacks).size).toBe(1);
  });
});
