import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { TIMELINE_PART_LAYER, TimelineController } from './timeline-controller';
import { makeFakeTimelineDeps, type FakeTimelineDeps } from './test/fake-timeline-deps';
import { DAYS, SLOT, timelineSmall, timelineSmallRev1 } from './fixtures/timeline-small';
import { timelineLookups } from './fixtures/timeline-lookups';
import { packTimedCell } from './pack-timed';
import { MAX_CELLS_PER_SLICE } from './hide';
import { TYPOLOGY_ORDER, type TimedPackedCell, type TimelineUpdate } from './types';
import type { BarAttrs } from './timelapse/types';

interface Props {
  id: string;
  data: unknown;
  beforeId?: string;
  extensions: unknown[];
  updateTriggers: Record<string, unknown>;
  parameters?: { depthWriteEnabled?: boolean };
  pickable: boolean;
  autoHighlight: boolean;
  highlightColor: number[];
  timelapsePass: number;
  getFillColor: unknown;
  getTlA: (o: unknown, info: { index: number }) => number[];
  getTlC: (o: unknown, info: { index: number }) => number[];
  chance: unknown;
  clock: unknown;
}
const props = (l: Layer) => l.props as unknown as Props;
const ids = (f: FakeTimelineDeps) => f.lastLayers.map((l) => l.id);
const byId = (f: FakeTimelineDeps, id: string) => f.lastLayers.find((l) => l.id === id)!;
const solid = (cellId: string) => `timeline-solid-${cellId}`;
const ghost = (cellId: string) => `timeline-ghost-${cellId}`;
const A = SLOT.a.cellId;
const B = SLOT.b.cellId;
const cellOf = (cellId: string) => timelineSmall.cells.find((c) => c.cellId === cellId)!;
const projectsIn = (cellId: string) =>
  Object.values(SLOT)
    .filter((s) => s.cellId === cellId)
    .map((s) => s.projectId);
const barsOf = (f: FakeTimelineDeps) => props(byId(f, 'timeline-bars')).data as BarAttrs[];

function update(revision: number, partial: Partial<TimelineUpdate> = {}): TimelineUpdate {
  return { revision, cells: [], removedCells: [], demolish: [], ...partial };
}
/** `n` distinct cells sharing the fixture's buffers. */
function manyCells(n: number): TimedPackedCell[] {
  return Array.from({ length: n }, (_, i) => ({
    ...timelineSmall.cells[i % 2],
    cellId: `n${String(i).padStart(2, '0')}`
  }));
}

let deps: FakeTimelineDeps;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  deps = makeFakeTimelineDeps();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function controller(beforeId?: string, lookups = true) {
  const c = new TimelineController(deps, 'light', beforeId);
  if (lookups) c.setLookups(timelineLookups);
  return c;
}

describe('TimelineController ordering', () => {
  it('discards an out-of-order revision and asks for a resync', () => {
    const c = controller();
    c.apply(timelineSmall);
    const layers = deps.layerHistory.length;
    const events = deps.events.length;
    c.apply({ ...timelineSmallRev1, revision: 2 });
    expect(deps.resyncCount).toBe(1);
    expect(deps.layerHistory).toHaveLength(layers);
    expect(deps.events).toHaveLength(events);
    expect(c.debugSnapshot().revision).toBe(0);
    expect(ids(deps)).toContain(solid(B));
  });

  it('asks for a resync on a revision before any snapshot', () => {
    const c = controller();
    c.apply(timelineSmallRev1);
    expect(deps.resyncCount).toBe(1);
    expect(deps.layerHistory).toHaveLength(0);
    expect(c.debugSnapshot().revision).toBe(-1);
  });

  it('accepts a band-only update with no emit, feature-state call or resync', () => {
    const c = controller();
    c.apply(timelineSmall);
    const layers = deps.layerHistory.length;
    const events = deps.events.length;
    c.apply(update(1));
    expect(c.debugSnapshot().revision).toBe(1);
    expect(deps.layerHistory).toHaveLength(layers);
    expect(deps.events).toHaveLength(events);
    expect(deps.resyncCount).toBe(0);
    expect(deps.pendingFrames()).toBe(0);
    c.apply({ ...timelineSmallRev1, revision: 2 });
    expect(c.debugSnapshot().revision).toBe(2);
    expect(ids(deps)).not.toContain(solid(B));
    expect(deps.resyncCount).toBe(0);
  });

  it('installs at most MAX_CELLS_PER_SLICE cells per frame: 9 cells as 4, 4, 1', () => {
    expect(MAX_CELLS_PER_SLICE).toBe(4);
    const c = controller();
    c.apply(update(0, { cells: manyCells(9) }));
    const counts = [c.debugSnapshot().cells];
    deps.flushFrame();
    counts.push(c.debugSnapshot().cells);
    deps.flushFrame();
    counts.push(c.debugSnapshot().cells);
    expect(counts).toEqual([4, 8, 9]);
    expect(deps.pendingFrames()).toBe(0);
    expect(c.debugSnapshot().pending).toBe(0);
    deps.flushFrame();
    expect(c.debugSnapshot().cells).toBe(9);
  });

  it('builds bars once, when the slice queue drains', () => {
    const c = controller();
    c.apply(update(0, { cells: manyCells(9) }));
    expect(ids(deps)).not.toContain('timeline-bars');
    deps.flushFrame();
    expect(ids(deps)).not.toContain('timeline-bars');
    deps.flushFrame();
    expect(ids(deps)).toContain('timeline-bars');
    expect(c.debugSnapshot().bars).toBeGreaterThan(0);
  });

  it('queues a later revision behind the slices of an earlier one', () => {
    const c = controller();
    c.apply(update(0, { cells: manyCells(9) }));
    c.apply(update(1, { removedCells: ['n00'] }));
    expect(c.debugSnapshot().revision).toBe(1);
    expect(c.debugSnapshot().cells).toBe(4);
    deps.flushFrame();
    deps.flushFrame();
    expect(c.debugSnapshot().cells).toBe(9);
    deps.flushFrame();
    expect(c.debugSnapshot().cells).toBe(8);
    expect(ids(deps)).not.toContain(solid('n00'));
  });

  it('revision 0 cancels queued slices and replaces the demolish list before installing', () => {
    const c = controller();
    c.setTime(DAYS.horizon);
    c.apply(update(0, { cells: manyCells(9), demolish: timelineSmall.demolish }));
    deps.flushFrame(); // second slice and the first pump frame
    expect(deps.replaced.size).toBeGreaterThan(0);
    const before = deps.events.length;
    c.apply(timelineSmall);
    const after = deps.events.slice(before);
    expect(after[0]).toEqual(['clearAllReplaced']);
    expect(after[1][0]).toBe('setLayers');
    expect(deps.replaced.size).toBe(0);
    expect(c.debugSnapshot().cells).toBe(2);
    deps.flushFrame();
    deps.flushFrame();
    expect(c.debugSnapshot().cells).toBe(2);
    expect(ids(deps).filter((id) => TIMELINE_PART_LAYER.test(id))).toEqual([
      solid(A),
      solid(B),
      ghost(A),
      ghost(B)
    ]);
  });

  it('throws a TypeError naming the cell before applying anything', () => {
    const c = controller();
    const bad = { ...cellOf(B), slotProjectIds: [] };
    expect(() => c.apply({ ...timelineSmall, cells: [cellOf(A), bad] })).toThrow(TypeError);
    expect(() => c.apply({ ...timelineSmall, cells: [cellOf(A), bad] })).toThrow(B);
    expect(deps.layerHistory).toHaveLength(0);
    expect(deps.events).toHaveLength(0);
    expect(c.debugSnapshot().revision).toBe(-1);
    c.apply(timelineSmall);
    expect(() => c.apply(update(1, { cells: [bad] }))).toThrow(TypeError);
    expect(c.debugSnapshot().revision).toBe(0);
  });

  it('ignores a non-empty demolish list after revision 0, with one console.error', () => {
    const c = controller();
    c.apply(timelineSmall);
    c.apply({
      ...timelineSmallRev1,
      demolish: [{ parcelId: SLOT.b.parcelId, day: DAYS.start }]
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(c.debugSnapshot().revision).toBe(1);
    expect(ids(deps)).not.toContain(solid(B));
    expect(c.debugSnapshot().demolish.total).toBe(timelineSmall.demolish.length);
    c.setTime(DAYS.horizon);
    deps.flushFrame();
    expect(deps.replaced.has(SLOT.b.parcelId)).toBe(false);
  });

  it('ignores an unknown removed cell and emits no layers for a cell with zero parts', () => {
    const c = controller();
    const empty = packTimedCell('tl-Z', []);
    expect(empty.partCount).toBe(0);
    c.apply({ ...timelineSmall, cells: [...timelineSmall.cells, empty] });
    expect(ids(deps).some((id) => id.endsWith('tl-Z'))).toBe(false);
    expect(c.debugSnapshot().cells).toBe(3);
    const before = ids(deps);
    expect(() => c.apply(update(1, { removedCells: ['no-such-cell'] }))).not.toThrow();
    expect(c.debugSnapshot().revision).toBe(1);
    expect(ids(deps)).toEqual(before);
    c.apply(update(2, { removedCells: ['tl-Z'] }));
    expect(c.debugSnapshot().cells).toBe(2);
  });
});

describe('TimelineController layers', () => {
  it('emits solids by cellId, ghosts by cellId, timeline-bars, then the overlay', () => {
    const c = controller('label-1');
    c.apply({ ...timelineSmall, cells: [cellOf(B), cellOf(A)] });
    c.setOverlayLayers([new SolidPolygonLayer({ id: 'brush', data: [] })]);
    expect(ids(deps)).toEqual([solid(A), solid(B), ghost(A), ghost(B), 'timeline-bars', 'brush']);
    for (const l of deps.lastLayers) expect(props(l).beforeId).toBe('label-1');
  });

  it('omits beforeId when none is given', () => {
    const c = controller();
    c.apply(timelineSmall);
    for (const l of deps.lastLayers) expect(props(l).beforeId).toBeUndefined();
  });

  it('sets the passes, depth, picking and the shared extension on the cell layers', () => {
    const c = controller();
    c.apply(timelineSmall);
    const s = props(byId(deps, solid(A)));
    const g = props(byId(deps, ghost(A)));
    expect(s.timelapsePass).toBe(0);
    expect(g.timelapsePass).toBe(1);
    expect(s.pickable).toBe(true);
    expect(s.autoHighlight).toBe(true);
    expect(s.highlightColor).toHaveLength(4);
    expect(g.pickable).toBe(true);
    expect(g.parameters).toEqual({ depthWriteEnabled: false });
    expect(s.parameters?.depthWriteEnabled).not.toBe(false);
    expect(s.data).toBe(g.data);
    expect(s.extensions).toHaveLength(1);
    expect(g.extensions[0]).toBe(s.extensions[0]);
    expect(props(byId(deps, solid(B))).extensions[0]).toBe(s.extensions[0]);
  });

  it('feeds the encoded part attributes through the accessors, one vec4 per part', () => {
    const c = controller();
    c.apply(timelineSmall);
    const cell = cellOf(A);
    const s = props(byId(deps, solid(A)));
    const data = s.data as { length: number; startIndices: Uint32Array };
    expect(data.length).toBe(cell.partCount);
    expect(data.startIndices).toBe(cell.startIndices);
    const s0 = cell.partSlot[0];
    const a = s.getTlA(null, { index: 0 });
    expect(a).toHaveLength(4);
    expect(a[0]).toBe(Math.fround(cell.partWindow[0]));
    expect(a[1]).toBe(Math.fround(cell.partWindow[1]));
    expect(s.getTlC(null, { index: 0 })[2]).toBe(cell.parcelMeta[4 * s0 + 2]);
  });

  it('keeps settled layers referentially stable across emits', () => {
    const c = controller();
    c.apply(timelineSmall);
    const first = deps.lastLayers;
    c.setOverlayLayers([new SolidPolygonLayer({ id: 'brush', data: [] })]);
    c.apply(update(1, { removedCells: ['no-such-cell'] }));
    const last = deps.lastLayers;
    for (const id of [solid(A), solid(B), ghost(A), ghost(B), 'timeline-bars'])
      expect(last.find((l) => l.id === id)).toBe(first.find((l) => l.id === id));
  });

  it('repacks one cell and removes another, with its bars (timelineSmallRev1)', () => {
    const c = controller();
    c.apply(timelineSmall);
    const oldB = projectsIn(B);
    expect(barsOf(deps).some((b) => oldB.includes(b.projectId))).toBe(true);
    const oldSolidA = byId(deps, solid(A));
    c.apply(timelineSmallRev1);
    expect(ids(deps)).toEqual([solid(A), ghost(A), 'timeline-bars']);
    expect(byId(deps, solid(A))).not.toBe(oldSolidA);
    const bars = barsOf(deps);
    expect(bars.some((b) => oldB.includes(b.projectId))).toBe(false);
    expect(bars.some((b) => projectsIn(A).includes(b.projectId))).toBe(true);
    expect(c.debugSnapshot().bars).toBe(bars.length);
  });

  it('declutters the bars it emits', () => {
    const c = controller();
    c.apply(timelineSmall);
    const bars = barsOf(deps);
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every((b) => b.minZoom >= 15 && b.minZoom <= 18)).toBe(true);
    expect(props(byId(deps, 'timeline-bars')).clock).toBeDefined();
    expect(props(byId(deps, 'timeline-bars')).chance).toBeDefined();
  });

  it('rejects reserved overlay ids', () => {
    const c = controller();
    expect(() =>
      c.setOverlayLayers([new SolidPolygonLayer({ id: 'timeline-x', data: [] })])
    ).toThrow(/reserved/);
    expect(() =>
      c.setOverlayLayers([new SolidPolygonLayer({ id: 'generated-x', data: [] })])
    ).toThrow(/reserved/);
  });

  it('setTheme rebuilds the cell layers with the same extension instance', () => {
    const c = controller();
    c.apply(timelineSmall);
    const before = byId(deps, solid(A));
    const bars = byId(deps, 'timeline-bars');
    const emits = deps.layerHistory.length;
    c.setTheme('light');
    expect(deps.layerHistory).toHaveLength(emits);
    c.setTheme('dark');
    const after = byId(deps, solid(A));
    expect(after).not.toBe(before);
    expect(props(after).extensions[0]).toBe(props(before).extensions[0]);
    expect(props(byId(deps, ghost(A))).extensions[0]).toBe(props(before).extensions[0]);
    expect(props(after).getFillColor).not.toBe(props(before).getFillColor);
    expect(props(after).updateTriggers.getFillColor).toBe('dark');
    expect(props(after).highlightColor).not.toEqual(props(before).highlightColor);
    expect(byId(deps, 'timeline-bars')).toBe(bars);
  });
});

describe('TimelineController lookups', () => {
  it('emits no timeline-bars without lookups, and warns once in dev', () => {
    const c = controller(undefined, false);
    c.apply(timelineSmall);
    expect(ids(deps)).toEqual([solid(A), solid(B), ghost(A), ghost(B)]);
    c.apply(timelineSmallRev1);
    expect(ids(deps)).not.toContain('timeline-bars');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('setLookups after install bumps getTlC and adds timeline-bars without a re-send', () => {
    const c = controller(undefined, false);
    c.apply(timelineSmall);
    const ghostBefore = props(byId(deps, ghost(A)));
    const solidBefore = props(byId(deps, solid(A)));
    const tlcBefore = ghostBefore.getTlC(null, { index: 0 })[1];
    c.setLookups(timelineLookups);
    const ghostAfter = props(byId(deps, ghost(A)));
    expect(ghostAfter.updateTriggers.getTlC).not.toEqual(ghostBefore.updateTriggers.getTlC);
    expect(props(byId(deps, solid(A))).updateTriggers.getTlC).not.toEqual(
      solidBefore.updateTriggers.getTlC
    );
    expect(ghostAfter.getTlC(null, { index: 0 })[1]).not.toBe(tlcBefore);
    expect(ids(deps)).toEqual([solid(A), solid(B), ghost(A), ghost(B), 'timeline-bars']);
    expect(c.debugSnapshot().revision).toBe(0);
    expect(c.debugSnapshot().bars).toBeGreaterThan(0);
  });

  it('stores lookups set before the first apply without emitting', () => {
    const c = controller();
    expect(deps.layerHistory).toHaveLength(0);
    c.apply(timelineSmall);
    expect(ids(deps)).toContain('timeline-bars');
    expect(warn).not.toHaveBeenCalled();
  });

  it('lets the RangeError of a chance row longer than 2048 propagate, changing nothing', () => {
    const c = controller(undefined, false);
    c.apply(timelineSmall);
    const emits = deps.layerHistory.length;
    const long = {
      ...timelineLookups,
      chance: {
        ...timelineLookups.chance,
        discretionary: { ...timelineLookups.chance.discretionary, filed: new Float32Array(2049) }
      }
    };
    expect(() => c.setLookups(long)).toThrow(RangeError);
    expect(deps.layerHistory).toHaveLength(emits);
    expect(ids(deps)).not.toContain('timeline-bars');
  });

  it('replaces the chance texture object on each setLookups', () => {
    const c = controller();
    c.apply(timelineSmall);
    const before = props(byId(deps, 'timeline-bars')).chance;
    c.setLookups(timelineLookups);
    expect(props(byId(deps, 'timeline-bars')).chance).not.toBe(before);
  });
});

describe('TimelineController time', () => {
  it('setTime touches no layer or feature-state until a frame flushes', () => {
    const c = controller();
    c.apply(timelineSmall);
    const emits = deps.layerHistory.length;
    const events = deps.events.length;
    for (let i = 0; i < 1000; i++) c.setTime(DAYS.start + i * 9);
    expect(deps.repaintCount).toBe(1000);
    expect(deps.layerHistory).toHaveLength(emits);
    expect(deps.events).toHaveLength(events);
    expect(c.debugSnapshot().day).toBe(DAYS.start + 999 * 9);
    deps.flushFrame();
    expect(deps.layerHistory).toHaveLength(emits);
    expect(deps.events.slice(events).every((e) => e[0] === 'setReplaced')).toBe(true);
    expect(deps.replaced.has(SLOT.a.parcelId)).toBe(true);
  });

  it('throws a RangeError on a non-finite day', () => {
    const c = controller();
    expect(() => c.setTime(NaN)).toThrow(RangeError);
    expect(() => c.setTime(Infinity)).toThrow(RangeError);
    expect(() => c.setTime(-Infinity)).toThrow(RangeError);
    expect(deps.repaintCount).toBe(0);
  });

  it('pumps the demolish list by day and exposes the applied set', () => {
    const c = controller();
    c.setTime(DAYS.a.construction); // before the first apply: stored and used
    c.apply(timelineSmall);
    deps.flushFrame();
    expect(c.demolished.has(SLOT.a.parcelId)).toBe(true);
    expect(c.demolished.has(SLOT.c.parcelId)).toBe(true);
    expect(c.demolished.has(SLOT.e.parcelId)).toBe(true);
    expect(c.debugSnapshot().demolish).toEqual({ total: 4, applied: 3 });
    c.setTime(DAYS.h.construction);
    deps.flushFrame();
    expect(c.debugSnapshot().demolish.applied).toBe(4);
    c.setTime(DAYS.start);
    deps.flushFrame();
    expect(c.debugSnapshot().demolish.applied).toBe(0);
    expect(deps.replaced.size).toBe(0);
  });

  it('reapplyDemolished re-sends the applied set', () => {
    const c = controller();
    c.apply(timelineSmall);
    c.setTime(DAYS.a.construction);
    deps.flushFrame();
    const before = deps.events.length;
    c.reapplyDemolished();
    const sent = deps.events.slice(before);
    expect(sent.every((e) => e[0] === 'setReplaced')).toBe(true);
    expect(new Set(sent.map((e) => e[1]))).toEqual(
      new Set([SLOT.a.parcelId, SLOT.c.parcelId, SLOT.e.parcelId])
    );
  });
});

describe('TimelineController lookup, snapshot and destroy', () => {
  it('resolves a part on either layer to its slot', () => {
    const c = controller();
    c.apply(timelineSmall);
    const cell = cellOf(A);
    const s = cell.slotProjectIds.indexOf(SLOT.a.projectId);
    const k = cell.partSlot.indexOf(s);
    expect(k).toBeGreaterThanOrEqual(0);
    const hit = c.lookup(ghost(A), k);
    expect(hit).toEqual({
      projectId: SLOT.a.projectId,
      parcelId: SLOT.a.parcelId,
      typology: TYPOLOGY_ORDER[cell.parcelMeta[4 * s + 3]],
      stories: cell.parcelMeta[4 * s + 2],
      units: cell.parcelMeta[4 * s],
      existingUnits: cell.parcelMeta[4 * s + 1]
    });
    expect(c.lookup(solid(A), k)).toEqual(hit);
    expect(c.lookup(ghost(A), cell.partCount)).toBeNull();
    expect(c.lookup(ghost(A), -1)).toBeNull();
    expect(c.lookup(`generated-${A}`, k)).toBeNull();
    expect(c.lookup('timeline-bars', 0)).toBeNull();
    expect(c.lookup(ghost('no-such-cell'), 0)).toBeNull();
  });

  it('TIMELINE_PART_LAYER matches the cell layers only', () => {
    expect(TIMELINE_PART_LAYER.test(solid(A))).toBe(true);
    expect(TIMELINE_PART_LAYER.test(ghost(A))).toBe(true);
    expect(TIMELINE_PART_LAYER.test('timeline-bars')).toBe(false);
    expect(TIMELINE_PART_LAYER.test(`generated-${A}`)).toBe(false);
  });

  it('reports a debug snapshot', () => {
    const c = controller();
    c.apply(timelineSmall);
    c.setTime(DAYS.a.construction);
    const snap = c.debugSnapshot();
    expect(snap).toMatchObject({
      revision: 0,
      cells: 2,
      parts: cellOf(A).partCount + cellOf(B).partCount,
      day: DAYS.a.construction,
      demolish: { total: 4, applied: 0 },
      layerIds: ids(deps)
    });
    expect(snap.bars).toBeGreaterThan(0);
    expect(snap.pending).toBe(1); // the pump frame
    deps.flushFrame();
    expect(c.debugSnapshot().pending).toBe(0);
  });

  it('destroy cancels frames and ignores later calls', () => {
    const c = controller();
    c.apply(update(0, { cells: manyCells(9) }));
    c.setTime(DAYS.horizon);
    expect(deps.pendingFrames()).toBeGreaterThan(0);
    c.destroy();
    expect(deps.pendingFrames()).toBe(0);
    const emits = deps.layerHistory.length;
    c.apply(timelineSmall);
    c.setTime(DAYS.start);
    deps.flushFrame();
    expect(deps.layerHistory).toHaveLength(emits);
  });
});
