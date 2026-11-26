import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { TIMELINE_PART_LAYER, TimelineController, type DebugView } from './timeline-controller';
import { makeFakeTimelineDeps, type FakeTimelineDeps } from './test/fake-timeline-deps';
import { DAYS, SLOT, timelineSmall, timelineSmallRev1 } from './fixtures/timeline-small';
import { timelineLookups } from './fixtures/timeline-lookups';
import { packTimedCell } from './pack-timed';
import { MAX_CELLS_PER_SLICE, SWAP_CELLS_PER_SLICE } from './hide';
import { TYPOLOGY_ORDER, type TimedPackedCell, type TimelineUpdate } from './types';
import type { BarAttrs } from './timelapse/types';
import { buildHalos, evalHalo, type HaloAttrs } from './timelapse/halos';
import { encodeParts } from './timelapse/encode';
import { SLOT_FLAG, type CityDelta } from './types';
import { cityGroup } from './timelapse/city-grid';
import { buildBars, evalBar } from './timelapse/bars';
import { FAR_UNITS_PER_SLICE, FarDeclutter, declutter } from './timelapse/declutter';
import { SYNTHETIC_LOOKUPS, makeSyntheticTimeline } from './test/synthetic-timeline';
import { STAGE_ORDER } from '$lib/timelapse/types';

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
const halosOf = (f: FakeTimelineDeps) => props(byId(f, 'timeline-halos')).data as HaloAttrs[];

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

  it('applies demolish after revision 0 like revision-0 entries', () => {
    const c = controller();
    c.apply(timelineSmall);
    c.apply({
      ...timelineSmallRev1,
      demolish: [{ parcelId: SLOT.b.parcelId, day: DAYS.start }]
    });
    expect(c.debugSnapshot().revision).toBe(1);
    expect(c.debugSnapshot().demolish.total).toBe(timelineSmall.demolish.length + 1);
    c.setTime(DAYS.horizon);
    deps.flushFrame();
    expect(deps.replaced.has(SLOT.b.parcelId)).toBe(true);
    expect(c.demolished.has(SLOT.b.parcelId)).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  it('restore shows the existing building again on every day', () => {
    const lot = SLOT.c.parcelId;
    expect(timelineSmall.demolish.some((e) => e.parcelId === lot)).toBe(true);
    const c = controller();
    c.apply(timelineSmall);
    c.setTime(DAYS.horizon);
    deps.flushFrame();
    expect(deps.replaced.has(lot)).toBe(true);
    c.apply({ ...timelineSmallRev1, restore: [lot] });
    deps.flushFrame();
    expect(deps.replaced.has(lot)).toBe(false);
    for (const day of [DAYS.start, DAYS.horizon]) {
      c.setTime(day);
      deps.flushFrame();
      expect(deps.replaced.has(lot)).toBe(false);
      expect(c.demolished.has(lot)).toBe(false);
    }
    expect(error).not.toHaveBeenCalled();
  });

  it('an update with no restore and empty demolish leaves the pump as it was', () => {
    const c = controller();
    c.apply(timelineSmall);
    c.setTime(DAYS.horizon);
    deps.flushFrame();
    const before = { demolish: c.debugSnapshot().demolish, replaced: [...deps.replaced] };
    const events = deps.events.filter((e) => e[0] !== 'setLayers').length;
    c.apply(timelineSmallRev1);
    while (deps.pendingFrames() > 0) deps.flushFrame();
    expect(c.debugSnapshot().demolish).toEqual(before.demolish);
    expect([...deps.replaced]).toEqual(before.replaced);
    expect(deps.events.filter((e) => e[0] !== 'setLayers')).toHaveLength(events);
    expect(error).not.toHaveBeenCalled();
  });

  it('a revision gap with demolish changes nothing and asks for resync', () => {
    const c = controller();
    c.apply(timelineSmall);
    c.apply({
      ...timelineSmallRev1,
      revision: 2,
      demolish: [{ parcelId: SLOT.b.parcelId, day: DAYS.start }],
      restore: [SLOT.c.parcelId]
    });
    expect(deps.resyncCount).toBe(1);
    expect(c.debugSnapshot().revision).toBe(0);
    expect(c.debugSnapshot().demolish.total).toBe(timelineSmall.demolish.length);
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
    deps.flushFrame(); // the re-encode slice
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

  it('re-encodes installed cells in the slice queue, 4 a frame, none in the call', () => {
    const c = controller();
    c.apply(update(0, { cells: manyCells(9) }));
    while (c.debugSnapshot().pending > 0) deps.flushFrame();
    const tlc = (id: string) => props(byId(deps, solid(id))).updateTriggers.getTlC;
    const before = tlc('n00');
    const emits = deps.layerHistory.length;
    const bars = byId(deps, 'timeline-bars');
    c.setLookups({ ...timelineLookups });
    expect(deps.layerHistory).toHaveLength(emits);
    expect(c.debugSnapshot().pending).toBe(3);
    const done = () => manyCells(9).filter((x) => tlc(x.cellId) !== before).length;
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      deps.flushFrame();
      counts.push(done());
      // The bars are rebuilt once, when the last re-encode slice has run.
      expect(byId(deps, 'timeline-bars') === bars).toBe(i < 2);
    }
    expect(counts).toEqual([4, 8, 9]);
    expect(c.debugSnapshot().pending).toBe(0);
  });

  it('skips cells a queued slice is about to install', () => {
    const c = controller();
    c.apply(update(0, { cells: manyCells(9) })); // 4 installed, 5 queued in 2 slices
    c.setLookups({ ...timelineLookups });
    expect(c.debugSnapshot().pending).toBe(3); // one re-encode slice, for the 4 installed
    while (c.debugSnapshot().pending > 0) deps.flushFrame();
    const triggers = new Set(
      manyCells(9).map((x) => props(byId(deps, solid(x.cellId))).updateTriggers.getTlC)
    );
    expect(triggers.size).toBe(1);
    expect(ids(deps)).toContain('timeline-bars');
  });

  it('a revision 0 right after setLookups drops the queued re-encode', () => {
    const c = controller();
    c.apply(update(0, { cells: manyCells(9) }));
    while (c.debugSnapshot().pending > 0) deps.flushFrame();
    c.setLookups({ ...timelineLookups });
    expect(c.debugSnapshot().pending).toBe(3);
    c.apply(update(0, { cells: manyCells(9) }));
    expect(c.debugSnapshot().pending).toBe(2); // revision 0's own slices only
    let frames = 0;
    for (; c.debugSnapshot().pending > 0; frames++) deps.flushFrame();
    expect(frames).toBe(2);
  });

  it('setLookups with no cells installed rebuilds the bars at once', () => {
    const c = controller();
    c.apply(update(0));
    const emits = deps.layerHistory.length;
    c.setLookups({ ...timelineLookups });
    expect(deps.layerHistory).toHaveLength(emits + 1);
    expect(c.debugSnapshot().pending).toBe(0);
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
    deps.flushFrame(); // the re-encode slice, then the bars
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
  it('debugSnapshot().installs counts every installed cell across revisions', () => {
    const c = controller();
    c.apply(timelineSmall);
    for (let i = 0; i < 4; i++) deps.flushFrame();
    expect(c.debugSnapshot().installs).toBe(timelineSmall.cells.length);
    c.apply(timelineSmallRev1);
    for (let i = 0; i < 4; i++) deps.flushFrame();
    const total = timelineSmall.cells.length + timelineSmallRev1.cells.length;
    expect(c.debugSnapshot().installs).toBe(total);
    c.setLookups(timelineLookups); // a re-encode installs nothing
    for (let i = 0; i < 4; i++) deps.flushFrame();
    expect(c.debugSnapshot().installs).toBe(total);
  });

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

/** `n` distinct cells `${prefix}NN` sharing the fixture's buffers. */
function named(prefix: string, n: number): TimedPackedCell[] {
  return manyCells(n).map((c, i) => ({ ...c, cellId: `${prefix}${String(i).padStart(2, '0')}` }));
}
const cellIdsIn = (layers: Layer[]) =>
  layers.filter((l) => l.id.startsWith('timeline-solid-')).map((l) => l.id.slice(15));
const onMap = (f: FakeTimelineDeps) => cellIdsIn(f.lastLayers).sort();
function drain(c: TimelineController): void {
  for (let i = 0; c.debugSnapshot().pending > 0; i++) {
    if (i > 1000) throw new Error('controller did not converge');
    deps.flushFrame();
  }
}
const tlcOf = (id: string) => props(byId(deps, solid(id))).updateTriggers.getTlC;

describe('TimelineController swap', () => {
  it('a swap revision 0 never empties the layers', () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    const from = deps.layerHistory.length;
    c.apply(update(0, { cells: named('s', 8), swap: true }));
    drain(c);
    const after = deps.layerHistory.slice(from);
    expect(after.length).toBeGreaterThan(0);
    for (const layers of after) expect(cellIdsIn(layers).length).toBeGreaterThanOrEqual(8);
    expect(onMap(deps)).toEqual([...named('o', 8), ...named('s', 8)].map((x) => x.cellId).sort());
    c.apply(update(1, { complete: true }));
    drain(c);
    for (const layers of deps.layerHistory.slice(from))
      expect(cellIdsIn(layers).length).toBeGreaterThanOrEqual(8);
    expect(onMap(deps)).toEqual(named('s', 8).map((x) => x.cellId));
  });

  it('a swap installs SWAP_CELLS_PER_SLICE cells per frame', () => {
    expect(SWAP_CELLS_PER_SLICE).toBe(16);
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    let last = c.debugSnapshot().installs;
    const deltas: number[] = [];
    const step = () => {
      const now = c.debugSnapshot().installs;
      deltas.push(now - last);
      last = now;
    };
    c.apply(update(0, { cells: named('s', 40), swap: true, complete: true }));
    step();
    while (c.debugSnapshot().pending > 0) {
      deps.flushFrame();
      step();
    }
    expect(deltas).toEqual([16, 16, 8]);
    expect(onMap(deps)).toEqual(named('s', 40).map((x) => x.cellId));
  });

  it('later revisions of a swap run use the swap budget until leftovers go', () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    c.apply(update(0, { cells: named('s', 4), swap: true }));
    drain(c);
    const before = c.debugSnapshot().installs;
    c.apply(update(1, { cells: named('t', 20), complete: true }));
    expect(c.debugSnapshot().installs - before).toBe(16);
    drain(c);
    expect(onMap(deps)).toEqual([...named('s', 4), ...named('t', 20)].map((x) => x.cellId));
    // The swap has ended: a later revision is back on MAX_CELLS_PER_SLICE.
    const mid = c.debugSnapshot().installs;
    c.apply(update(2, { cells: named('u', 9) }));
    expect(c.debugSnapshot().installs - mid).toBe(MAX_CELLS_PER_SLICE);
  });

  it('leftover cells go once a complete update has installed', () => {
    const c = controller();
    const [a, b, cc, d, e] = named('x', 5);
    c.apply(update(0, { cells: [a, b, cc] }));
    drain(c);
    c.apply(update(0, { cells: [b, d], swap: true, complete: false }));
    drain(c);
    expect(onMap(deps)).toEqual([a, b, cc, d].map((x) => x.cellId));
    c.apply(update(1, { cells: [e], complete: true }));
    drain(c);
    expect(onMap(deps)).toEqual([b, d, e].map((x) => x.cellId));
    expect(c.debugSnapshot().cells).toBe(3);
    expect(ids(deps)).toContain('timeline-bars');
  });

  it("a second swap before complete keeps both runs' leftovers until its own complete", () => {
    const c = controller();
    const [a, b, cc, d] = named('x', 4);
    c.apply(update(0, { cells: [a, b] }));
    drain(c);
    c.apply(update(0, { cells: [cc], swap: true, complete: false }));
    drain(c);
    c.apply(update(0, { cells: [d], swap: true, complete: false }));
    drain(c);
    expect(onMap(deps)).toEqual([a, b, cc, d].map((x) => x.cellId));
    c.apply(update(1, { complete: true })); // band-only, but it completes the run
    drain(c);
    expect(onMap(deps)).toEqual([d.cellId]);
  });

  it("a superseded swap's queued cells never install", () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    c.apply(update(0, { cells: named('s', 40), swap: true, complete: true }));
    deps.flushFrame();
    expect(c.debugSnapshot().installs).toBe(8 + 32);
    const from = deps.layerHistory.length;
    c.apply(update(0, { cells: named('t', 4), swap: true, complete: true }));
    drain(c);
    const late = new Set(
      named('s', 40)
        .slice(32)
        .map((x) => x.cellId)
    );
    for (const layers of deps.layerHistory.slice(from))
      for (const id of cellIdsIn(layers)) expect(late.has(id)).toBe(false);
    expect(c.debugSnapshot().installs).toBe(8 + 32 + 4);
    expect(onMap(deps)).toEqual(named('t', 4).map((x) => x.cellId));
  });

  it('setLookups during a swap re-encodes the cells still on the map, and leftovers still go at complete', () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    c.apply(update(0, { cells: named('s', 40), swap: true }));
    c.setLookups({ ...timelineLookups });
    drain(c);
    const latest = tlcOf('s39'); // installed after setLookups
    expect(onMap(deps)).toHaveLength(48);
    for (const id of onMap(deps)) expect(tlcOf(id)).toBe(latest);
    c.apply(update(1, { complete: true }));
    drain(c);
    expect(onMap(deps)).toEqual(named('s', 40).map((x) => x.cellId));
    for (const id of onMap(deps)) expect(tlcOf(id)).toBe(latest);
  });

  it('a swap keeps the queued re-encode of cells still on the map', () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    c.setLookups({ ...timelineLookups }); // two re-encode slices queued, none run
    c.apply(update(0, { cells: named('s', 4), swap: true }));
    drain(c);
    const latest = tlcOf('s00');
    expect(onMap(deps)).toHaveLength(12);
    for (const id of onMap(deps)) expect(tlcOf(id)).toBe(latest);
  });

  it('setTheme during a swap rebuilds every cell layer with the new theme', () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    c.apply(update(0, { cells: named('s', 40), swap: true }));
    c.setTheme('dark');
    const theme = (l: Layer) => props(l).updateTriggers.getFillColor;
    const cellLayers = () => deps.lastLayers.filter((l) => TIMELINE_PART_LAYER.test(l.id));
    expect(cellLayers()).toHaveLength(2 * 24);
    for (const l of cellLayers()) expect(theme(l)).toBe('dark');
    drain(c);
    c.apply(update(1, { complete: true }));
    drain(c);
    expect(cellLayers()).toHaveLength(2 * 40);
    for (const l of cellLayers()) expect(theme(l)).toBe('dark');
  });

  it('a cell removed during a swap stays until leftovers go', () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 2) }));
    drain(c);
    c.apply(update(0, { cells: named('s', 2), swap: true }));
    drain(c);
    const from = deps.layerHistory.length;
    c.apply(update(1, { removedCells: ['s01', 'o00'] }));
    drain(c);
    for (const layers of deps.layerHistory.slice(from))
      expect(cellIdsIn(layers).length).toBeGreaterThanOrEqual(4);
    c.apply(update(2, { complete: true }));
    drain(c);
    expect(onMap(deps)).toEqual(['s00']);
  });

  it('a plain revision 0 still clears (snapshot)', () => {
    const c = controller();
    c.apply(update(0, { cells: named('o', 8) }));
    drain(c);
    c.apply(update(0, { cells: named('s', 4), swap: true }));
    drain(c);
    expect(onMap(deps)).toHaveLength(12);
    c.apply(update(0, { cells: named('p', 9) }));
    expect(onMap(deps)).toEqual(named('p', 4).map((x) => x.cellId)); // MAX_CELLS_PER_SLICE again
    drain(c);
    c.apply(update(1, { complete: true }));
    drain(c);
    expect(onMap(deps)).toEqual(named('p', 9).map((x) => x.cellId));
  });

  it('a swap revision 0 diffs the demolish list', () => {
    const c = controller();
    c.setTime(DAYS.horizon);
    c.apply(update(0, { cells: named('o', 2), demolish: timelineSmall.demolish }));
    drain(c);
    expect(deps.replaced.size).toBeGreaterThan(0);
    const before = deps.events.length;
    const kept = timelineSmall.demolish[0];
    const next = [kept, { parcelId: 'new-parcel', day: DAYS.start }];
    c.apply(update(0, { cells: named('s', 2), demolish: next, swap: true, complete: true }));
    drain(c);
    const after = deps.events.slice(before);
    expect(after.some((e) => e[0] === 'clearAllReplaced')).toBe(false);
    expect(after.some((e) => e[0] === 'setReplaced' && e[1] === kept.parcelId)).toBe(false);
    expect([...deps.replaced].sort()).toEqual([kept.parcelId, 'new-parcel'].sort());
    expect(c.debugSnapshot().demolish).toEqual({ total: 2, applied: 2 });
  });
});

describe('TimelineController halos', () => {
  const FROM = DAYS.start;
  /** Cell A with slot (a) flagged. */
  function flaggedA(): TimedPackedCell {
    const a = cellOf(A);
    const flags = new Uint8Array(a.slotProjectIds.length);
    flags[a.slotProjectIds.indexOf(SLOT.a.projectId)] = SLOT_FLAG.zoning;
    return { ...a, slotFlags: flags };
  }

  /** Every slot of a cell under the policy: only flagged slots have a mark. */
  const flagAll = (cell: TimedPackedCell): TimedPackedCell => ({
    ...cell,
    slotFlags: new Uint8Array(cell.slotProjectIds.length).fill(SLOT_FLAG.zoning)
  });
  const allFlagged = () => ({ ...timelineSmall, cells: timelineSmall.cells.map(flagAll) });

  it('emits no timeline-halos until setHalos, then after timeline-bars and before the overlay', () => {
    const c = controller('label-1');
    c.apply({ ...timelineSmall, cells: [cellOf(B), cellOf(A)] });
    c.setOverlayLayers([new SolidPolygonLayer({ id: 'brush', data: [] })]);
    expect(ids(deps)).not.toContain('timeline-halos');
    expect(deps.haloLayers).toHaveLength(0);
    c.setHalos({ from: FROM });
    expect(ids(deps)).toEqual([
      solid(A),
      solid(B),
      ghost(A),
      ghost(B),
      'timeline-bars',
      'timeline-halos',
      'brush'
    ]);
    const halo = props(byId(deps, 'timeline-halos'));
    expect(halo.beforeId).toBe('label-1');
    expect(halo.pickable).toBe(false);
    expect(halo.clock).toBe(props(byId(deps, 'timeline-bars')).clock);
  });

  it('builds halo records once per update, when the slice queue drains', () => {
    const c = controller();
    c.setHalos({ from: FROM }); // before the first apply: kept, nothing emitted
    expect(deps.layerHistory).toHaveLength(0);
    c.apply(update(0, { cells: manyCells(9).map(flagAll) }));
    expect(ids(deps)).not.toContain('timeline-halos');
    deps.flushFrame();
    expect(deps.haloLayers).toHaveLength(0);
    deps.flushFrame();
    expect(deps.haloLayers).toHaveLength(1);
    expect(ids(deps)).toContain('timeline-halos');
    expect(halosOf(deps).length).toBeGreaterThan(0);
    // A re-encode (new lookups) changes no cell: the halos stay as they are.
    c.setLookups({ ...timelineLookups });
    drain(c);
    expect(deps.haloLayers).toHaveLength(1);
    // A band-only update changes no cell either.
    c.apply(update(1));
    expect(deps.haloLayers).toHaveLength(1);
  });

  it('setTime constructs no layer and calls setLayers none', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    c.apply(timelineSmall);
    const emits = deps.layerHistory.length;
    const halos = deps.haloLayers.length;
    const layer = byId(deps, 'timeline-halos');
    for (let i = 0; i < 100; i++) c.setTime(DAYS.start + i * 90);
    expect(deps.layerHistory.length - emits).toBe(0);
    expect(deps.haloLayers.length - halos).toBe(0);
    expect(byId(deps, 'timeline-halos')).toBe(layer);
    expect(c.debugSnapshot().day).toBe(DAYS.start + 99 * 90);
  });

  it('setHalos(null) removes the layer; setHalos({ from }) rebuilds the records once', () => {
    const c = controller();
    c.apply(allFlagged());
    c.setHalos({ from: FROM });
    expect(deps.haloLayers).toHaveLength(1);
    const all = halosOf(deps).length;
    const emits = deps.layerHistory.length;
    c.setHalos({ from: FROM }); // unchanged: nothing to do
    expect(deps.haloLayers).toHaveLength(1);
    expect(deps.layerHistory).toHaveLength(emits);
    c.setHalos(null);
    expect(ids(deps)).not.toContain('timeline-halos');
    expect(c.debugSnapshot()).toMatchObject({ marks: 0, marksShown: 0 });
    c.setHalos(null);
    expect(deps.layerHistory).toHaveLength(emits + 1);
    c.setHalos({ from: DAYS.a.construction });
    expect(deps.haloLayers).toHaveLength(2);
    expect(halosOf(deps).length).toBeLessThan(all);
  });

  it('records leave out events on or before from', () => {
    const c = controller();
    c.apply(allFlagged());
    c.setHalos({ from: DAYS.a.construction });
    const hs = halosOf(deps);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) expect(h.day).toBeGreaterThan(DAYS.a.construction);
  });

  it("a replaced cell's marks follow its new schedule; a removed cell's go", () => {
    const c = controller();
    c.apply({ ...timelineSmall, cells: [flagAll(cellOf(A)), flagAll(cellOf(B))] });
    c.setHalos({ from: FROM });
    const first = (hs: HaloAttrs[]) => hs.find((h) => h.projectId === SLOT.a.projectId)!.day;
    expect(first(halosOf(deps))).toBe(DAYS.a.preApplication);
    expect(halosOf(deps).some((h) => projectsIn(B).includes(h.projectId))).toBe(true);
    const a = flagAll(cellOf(A));
    const stages = a.slotStages.slice();
    const at =
      STAGE_ORDER.length * a.slotProjectIds.indexOf(SLOT.a.projectId) +
      STAGE_ORDER.indexOf('preApplication');
    stages[at] += 100;
    c.apply(update(1, { cells: [{ ...a, slotStages: stages }], removedCells: [B] }));
    const hs = halosOf(deps);
    expect(first(hs)).toBe(DAYS.a.preApplication + 100);
    expect(hs.some((h) => projectsIn(B).includes(h.projectId))).toBe(false);
    expect(hs.every((h) => projectsIn(A).includes(h.projectId))).toBe(true);
  });

  it('builds halos without lookups (bars need them, halos do not)', () => {
    const c = controller(undefined, false);
    c.apply(allFlagged());
    c.setHalos({ from: FROM });
    expect(ids(deps)).toContain('timeline-halos');
    expect(ids(deps)).not.toContain('timeline-bars');
    expect(halosOf(deps).length).toBeGreaterThan(0);
  });

  it('setTheme keeps the halo layer; destroy ignores later halo calls', () => {
    const c = controller();
    c.apply(timelineSmall);
    c.setHalos({ from: FROM });
    const layer = byId(deps, 'timeline-halos');
    c.setTheme('dark');
    expect(byId(deps, 'timeline-halos')).toBe(layer);
    c.destroy();
    const emits = deps.layerHistory.length;
    c.setHalos({ from: DAYS.a.construction });
    expect(deps.layerHistory).toHaveLength(emits);
  });

  it('reports marks and marksShown in the debug snapshot', () => {
    const c = controller();
    c.apply({ ...timelineSmall, cells: [flaggedA(), cellOf(B)] });
    expect(c.debugSnapshot()).toMatchObject({ marks: 0, marksShown: 0 });
    c.setHalos({ from: FROM });
    c.setTime(DAYS.a.construction);
    const recs = buildHalos([flaggedA(), cellOf(B)], FROM);
    expect(recs).toHaveLength(1);
    expect(halosOf(deps)).toEqual(recs);
    expect(c.debugSnapshot()).toMatchObject({ marks: 1, marksShown: 1 });
    expect(c.debugSnapshot()).not.toHaveProperty('halos');
    expect(c.debugSnapshot()).not.toHaveProperty('ringMinZoom');
    c.setTime(DAYS.start - 1);
    expect(c.debugSnapshot()).toMatchObject({ marks: 1, marksShown: 0 });
  });

  it('counts the drawn slots with a flag in the debug snapshot, halos on or off', () => {
    const c = controller();
    expect(c.debugSnapshot().flagged).toBe(0);
    c.apply({ ...timelineSmall, cells: [flaggedA(), cellOf(B)] });
    expect(c.debugSnapshot().flagged).toBe(1);
    c.setHalos({ from: FROM });
    expect(c.debugSnapshot()).toMatchObject({ flagged: 1, marks: 1 });
    c.setHalos(null);
    expect(c.debugSnapshot()).toMatchObject({ flagged: 1, marks: 0 });
  });
});

describe('TimelineController city', () => {
  const FROM = DAYS.start;
  interface Marker {
    row: number;
    lngLat: [number, number];
    days: [number, number, number];
    homes: number;
    flags?: number;
  }
  function cityDelta(rows: number, ms: Marker[], from?: number): CityDelta {
    return {
      rows,
      ...(from === undefined ? {} : { from }),
      row: Int32Array.from(ms.map((m) => m.row)),
      lngLat: Float32Array.from(ms.flatMap((m) => m.lngLat)),
      days: Float32Array.from(ms.flatMap((m) => m.days)),
      homes: Uint16Array.from(ms.map((m) => m.homes)),
      existing: new Uint16Array(ms.length),
      flags: Uint8Array.from(ms.map((m) => m.flags ?? 0))
    };
  }
  /** The fake map's view: ±0.02° around the Mission, as clip space with w = 1. */
  const MISSION: [number, number] = [-122.4194, 37.7599];
  function viewAt(zoom: number): DebugView {
    return {
      zoom,
      centre: MISSION,
      clip: (lng, lat) => [(lng - MISSION[0]) / 0.02, (lat - MISSION[1]) / 0.02, 1]
    };
  }
  // Two in the Mission (one flagged), one to the west (4.5 km), off the fake view and in reach.
  const MARKERS: Marker[] = [
    {
      row: 0,
      lngLat: MISSION,
      days: [DAYS.a.entitled, DAYS.a.construction, DAYS.a.complete],
      homes: 40
    },
    {
      row: 1,
      lngLat: [-122.419, 37.7601],
      days: [DAYS.b.entitled, NaN, NaN],
      homes: 12,
      flags: SLOT_FLAG.zoning
    },
    {
      row: 2,
      lngLat: [-122.47, 37.78],
      days: [DAYS.a.permitIssued, DAYS.a.construction, NaN],
      homes: 8
    }
  ];
  const CITY = cityDelta(3, MARKERS);

  it('stores the city from a revision 0 and replaces it on the next revision 0; a revision 0 without city clears it', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    c.apply({ ...timelineSmall, city: CITY });
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 3, cityFlagged: 1 });
    // The next revision 0 replaces the store whole, never merges.
    const one = cityDelta(1, [{ ...MARKERS[2], row: 0 }]);
    c.apply({ ...timelineSmall, city: one });
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 1, cityFlagged: 0 });
    // A swap's revision 0 replaces it too.
    c.apply({ ...timelineSmall, swap: true, complete: true, city: CITY });
    drain(c);
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 3, cityFlagged: 1 });
    // A revision 0 with no city (no feed) clears it.
    c.apply(timelineSmall);
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 0, cityFlagged: 0 });
    expect(ids(deps)).not.toContain('timeline-city');
  });

  it('a later delta overwrites rows and drops those at or past rows', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    c.apply({ ...timelineSmall, city: CITY });
    const later = cityDelta(2, [{ ...MARKERS[0], homes: 99 }]);
    c.apply(update(1, { city: later }));
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 2, cityFlagged: 1 });
    // A revision gap carrying city changes nothing and asks for a resync.
    c.apply(update(3, { city: CITY }));
    expect(deps.resyncCount).toBe(1);
    expect(c.debugSnapshot().cityMarkers).toBe(2);
  });

  it('a later delta with from forgets the markers at or past it first', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    c.apply({ ...timelineSmall, city: CITY });
    // Row 1 withdrawn by an edit; row 2 re-created with other days.
    const moved: Marker = { ...MARKERS[2], days: [DAYS.d.permitIssued, NaN, NaN] };
    const edit = cityDelta(3, [moved], 1);
    c.apply(update(1, { city: edit }));
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 2, cityFlagged: 0 });
    // A delta with from and no rows forgets markers too.
    c.apply(update(2, { city: cityDelta(1, [], 1) }));
    expect(c.debugSnapshot().cityMarkers).toBe(1);
  });

  it('emits no timeline-city, with halos on and markers held', () => {
    const c = controller('label-1');
    c.apply({ ...timelineSmall, cells: [cellOf(B), cellOf(A)], city: CITY });
    c.setOverlayLayers([new SolidPolygonLayer({ id: 'brush', data: [] })]);
    c.setHalos({ from: FROM });
    expect(ids(deps)).toEqual([
      solid(A),
      solid(B),
      ghost(A),
      ghost(B),
      'timeline-bars',
      'timeline-halos',
      'brush'
    ]);
    expect(c.debugSnapshot().layerIds).not.toContain('timeline-city');
    expect(c.debugSnapshot().cityMarkers).toBeGreaterThan(0);
  });

  it('a city-only update stores the markers and emits nothing', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    c.apply({ ...timelineSmall, city: CITY });
    drain(c);
    const emits = deps.layerHistory.length;
    const events = deps.events.length;
    const halos = deps.haloLayers.length;
    c.apply(update(1, { city: cityDelta(3, [{ ...MARKERS[1], homes: 30 }]) }));
    expect(deps.layerHistory.length).toBe(emits);
    expect(deps.events.length).toBe(events);
    expect(deps.haloLayers.length).toBe(halos);
    expect(deps.pendingFrames()).toBe(0);
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 3, cityFlagged: 1 });
  });

  it('marksShown follows the gate: one diamond a square below zoom 14, every one from 14', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    // Every slot of both cells under the policy.
    const flagAll = (cell: TimedPackedCell) => ({
      ...cell,
      slotFlags: new Uint8Array(cell.slotProjectIds.length).fill(SLOT_FLAG.zoning)
    });
    c.apply({ ...timelineSmall, cells: [flagAll(cellOf(A)), flagAll(cellOf(B))], city: CITY });
    const marks = halosOf(deps);
    for (const t of [DAYS.start, DAYS.a.construction, DAYS.horizon - 1]) {
      c.setTime(t);
      const standing = marks.filter((h) => evalHalo(h, t));
      const squares = new Set(standing.map((h) => cityGroup(...h.anchor))).size;
      deps.view = viewAt(13);
      expect(c.debugSnapshot()).toMatchObject({ marks: marks.length, marksShown: squares });
      deps.view = viewAt(14);
      expect(c.debugSnapshot().marksShown).toBe(standing.length);
    }
    // The fixture's marks share squares, so below 14 there are fewer diamonds than projects.
    c.setTime(DAYS.a.construction);
    deps.view = viewAt(13);
    const below = c.debugSnapshot().marksShown;
    deps.view = viewAt(14);
    expect(below).toBeGreaterThan(0);
    expect(below).toBeLessThan(c.debugSnapshot().marksShown);
  });

  it('rejects a malformed city delta before installing anything', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    c.apply({ ...timelineSmall, city: CITY });
    const emits = deps.layerHistory.length;
    const bad = cityDelta(3, [MARKERS[1], MARKERS[0]]); // rows not ascending
    expect(() => c.apply(update(1, { cells: [cellOf(A)], city: bad }))).toThrow(RangeError);
    expect(() => c.apply({ ...timelineSmall, city: bad })).toThrow(RangeError);
    const short = { ...CITY, homes: new Uint16Array(1) };
    expect(() => c.apply(update(1, { city: short }))).toThrow(RangeError);
    expect(deps.layerHistory).toHaveLength(emits);
    expect(c.debugSnapshot()).toMatchObject({ revision: 0, cityMarkers: 3, installs: 2 });
    // The stream goes on from where it was.
    c.apply(update(1, { city: cityDelta(3, [MARKERS[0]]) }));
    expect(c.debugSnapshot().revision).toBe(1);
  });

  it('reports cityMarkers, cityFlagged and projects in the debug snapshot', () => {
    const c = controller();
    const projects = timelineSmall.cells.reduce((n, p) => n + new Set(p.partSlot).size, 0);
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 0, cityFlagged: 0, projects: 0 });
    c.apply({ ...timelineSmall, city: CITY });
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 3, cityFlagged: 1, projects });
    c.setHalos({ from: FROM });
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 3, cityFlagged: 1, projects });
  });

  it('destroy drops the city', () => {
    const c = controller();
    c.setHalos({ from: FROM });
    c.apply({ ...timelineSmall, city: CITY });
    c.destroy();
    expect(c.debugSnapshot()).toMatchObject({ cityMarkers: 0, layerIds: [] });
  });
});

describe('TimelineController bar modes', () => {
  const barLayer = () => byId(deps, 'timeline-bars');
  const far = () => (barLayer().props as unknown as { far?: boolean }).far;
  /** A flat fake view around the fixture (w = 1 everywhere: the zoom at every anchor is `zoom`). */
  const CENTRE: [number, number] = [-122.4194, 37.7599];
  function viewAt(zoom: number, half = 0.02): DebugView {
    return {
      zoom,
      centre: CENTRE,
      clip: (lng, lat) => [(lng - CENTRE[0]) / half, (lat - CENTRE[1]) / half, 1]
    };
  }

  it('a controller that never calls setBarMode builds the same bars as before', () => {
    const c = controller();
    c.apply(timelineSmall);
    const want = buildBars(
      [...timelineSmall.cells].sort((a, b) => (a.cellId < b.cellId ? -1 : 1)),
      timelineLookups
    );
    declutter(want);
    expect(barsOf(deps)).toEqual(want);
    expect(barsOf(deps).every((b) => b.minZoom >= 15)).toBe(true);
    expect(far()).toBe(false);
    expect(c.debugSnapshot().barMode).toBe('street');
  });

  it('setBarMode rebuilds the bars once with far and reports barMode; the same mode again does nothing', () => {
    const c = controller();
    c.apply(timelineSmall);
    const street = barLayer();
    const emits = deps.layerHistory.length;
    c.setBarMode('far');
    // The street layer stays up while the far declutter runs in slices, then swaps in once.
    expect(deps.layerHistory).toHaveLength(emits);
    expect(c.debugSnapshot().pending).toBeGreaterThan(0);
    drain(c);
    expect(deps.layerHistory).toHaveLength(emits + 1);
    expect(barLayer()).not.toBe(street);
    expect(far()).toBe(true);
    expect(barsOf(deps).every((b) => b.minZoom >= 12 && b.minZoom <= 18)).toBe(true);
    expect(barsOf(deps).some((b) => b.minZoom < 15)).toBe(true);
    expect(c.debugSnapshot().barMode).toBe('far');
    const farLayer = barLayer();
    c.setBarMode('far');
    expect(deps.layerHistory).toHaveLength(emits + 1);
    expect(barLayer()).toBe(farLayer);
    // Back to street: today's bars again, at once.
    c.setBarMode('street');
    expect(deps.layerHistory).toHaveLength(emits + 2);
    expect(far()).toBe(false);
    expect(barsOf(deps).every((b) => b.minZoom >= 15)).toBe(true);
  });

  it('setBarMode before the first apply is kept: the first bars are far, built once', () => {
    const c = controller();
    c.setBarMode('far');
    expect(deps.layerHistory).toHaveLength(0);
    c.apply(timelineSmall);
    expect(ids(deps)).not.toContain('timeline-bars');
    drain(c);
    expect(far()).toBe(true);
    expect(c.debugSnapshot().barMode).toBe('far');
    // Without lookups there are no bars; the mode is kept for when they come.
    const d = makeFakeTimelineDeps();
    const bare = new TimelineController(d, 'light');
    bare.setBarMode('far');
    bare.apply(timelineSmall);
    expect(d.lastLayers.map((l) => l.id)).not.toContain('timeline-bars');
    bare.setLookups(timelineLookups);
    drainWith(d, bare);
    expect(
      (d.lastLayers.find((l) => l.id === 'timeline-bars')!.props as unknown as { far: boolean }).far
    ).toBe(true);
  });

  it('far: setTime and camera reads build no bars and move no gate (no declutter per frame or pan)', () => {
    const c = controller();
    c.setBarMode('far');
    c.apply(timelineSmall);
    drain(c);
    const layer = barLayer();
    const gates = barsOf(deps).map((b) => b.minZoom);
    const emits = deps.layerHistory.length;
    for (let i = 0; i < 200; i++) {
      c.setTime(DAYS.start + i * 40);
      // A pan or zoom: the controller hears of the camera only through the debug snapshot.
      if (i % 20 === 0) {
        deps.view = viewAt(12 + (i % 7), 0.01 + i / 10_000);
        c.debugSnapshot();
      }
    }
    expect(deps.layerHistory).toHaveLength(emits);
    expect(barLayer()).toBe(layer);
    expect(barsOf(deps).map((b) => b.minZoom)).toEqual(gates);
  });

  it('a flagged slot wins its collision in far mode', () => {
    const c = controller();
    c.setBarMode('far');
    // (a)'s cell twice over at the same place: one flagged copy, one not, as two projects.
    const a = cellOf(A);
    const s = a.slotProjectIds.indexOf(SLOT.a.projectId);
    const mine = {
      ...a,
      cellId: 'mine',
      slotProjectIds: a.slotProjectIds.map((p) => `mine-${p}`),
      slotFlags: Uint8Array.from(a.slotProjectIds, (_, i) => (i === s ? SLOT_FLAG.zoning : 0))
    };
    c.apply(update(0, { cells: [a, mine] }));
    drain(c);
    const bars = barsOf(deps);
    const gate = (id: string) => bars.find((b) => b.projectId === id)!.minZoom;
    expect(bars.find((b) => b.projectId === `mine-${SLOT.a.projectId}`)!.policy).toBe(true);
    expect(gate(`mine-${SLOT.a.projectId}`)).toBeLessThan(gate(SLOT.a.projectId));
  });

  it('far: the declutter runs FAR_UNITS_PER_SLICE units a frame; the old layer stays until one swap', () => {
    const u = makeSyntheticTimeline(3, 2_000, 1500, false);
    const c = new TimelineController(deps, 'light');
    c.setLookups(SYNTHETIC_LOOKUPS);
    c.apply(u);
    drain(c);
    const street = barLayer();
    const units = new FarDeclutter(barsOf(deps)).units;
    expect(units).toBeGreaterThan(FAR_UNITS_PER_SLICE);
    const emits = deps.layerHistory.length;
    c.setBarMode('far');
    // One frame for the setup, then one per FAR_UNITS_PER_SLICE units; nothing emitted till the
    // last, and the street layer stays drawn.
    let frames = 0;
    while (c.debugSnapshot().pending > 0) {
      expect(barLayer()).toBe(street);
      expect(deps.layerHistory).toHaveLength(emits);
      deps.flushFrame();
      frames++;
    }
    expect(frames).toBe(1 + Math.ceil(units / FAR_UNITS_PER_SLICE));
    expect(deps.layerHistory).toHaveLength(emits + 1);
    expect(far()).toBe(true);
    expect(barsOf(deps).length).toBeGreaterThan(units / 2);
  });

  /** Far bars a fresh controller lays for `cells` at revision 0 (what the map should end on). */
  function farBarsFor(cells: TimedPackedCell[]): BarAttrs[] {
    const d = makeFakeTimelineDeps();
    const fresh = new TimelineController(d, 'light');
    fresh.setLookups(SYNTHETIC_LOOKUPS);
    fresh.setBarMode('far');
    fresh.apply(update(0, { cells }));
    drainWith(d, fresh);
    return (props(d.lastLayers.find((l) => l.id === 'timeline-bars')!).data as BarAttrs[]).slice();
  }
  /** Far bar layers swapped in after `from` emits (the one on the map then not counted). */
  const farLayers = (from: number) => {
    const barsIn = (ls: Layer[] | undefined) => ls?.find((l) => l.id === 'timeline-bars');
    const onMap = barsIn(deps.layerHistory[from - 1]);
    return new Set(
      deps.layerHistory
        .slice(from)
        .map(barsIn)
        .filter((l) => l && l !== onMap && (l.props as unknown as { far?: boolean }).far)
    );
  };

  it('far: an update mid-declutter lets the run swap in, then one more run drops what it withdrew', () => {
    const u = makeSyntheticTimeline(3, 2_000, 1500, false);
    const c = new TimelineController(deps, 'light');
    c.setLookups(SYNTHETIC_LOOKUPS);
    c.setBarMode('far');
    c.apply(u);
    deps.flushFrame(); // the declutter's setup; its steps are still to come
    expect(c.debugSnapshot().pending).toBeGreaterThan(0);
    // A later revision removes the first cell while the declutter is under way.
    const gone = u.cells[0];
    const before = deps.layerHistory.length;
    c.apply(update(1, { removedCells: [gone.cellId] }));
    drain(c);
    // The run in flight was newer than the map (no bars at all): it swapped in, then one more.
    expect(farLayers(before).size).toBe(2);
    expect(barsOf(deps).some((b) => gone.slotProjectIds.includes(b.projectId))).toBe(false);
    expect(barsOf(deps)).toEqual(farBarsFor(u.cells.slice(1)));
  });

  it('far: updates every few frames for longer than one run still swap bars in, and the last run reflects the last update', () => {
    const u = makeSyntheticTimeline(5, 6_000, 500, false);
    const c = new TimelineController(deps, 'light');
    c.setLookups(SYNTHETIC_LOOKUPS);
    c.setBarMode('far');
    c.apply(u);
    drain(c);
    const run =
      1 +
      Math.ceil(
        new FarDeclutter(buildBars(u.cells, SYNTHETIC_LOOKUPS)).units / FAR_UNITS_PER_SLICE
      );
    expect(run).toBeGreaterThan(3);
    // A fill: an update with cells every 2 frames for 4 run lengths (each one would restart a run
    // that was dropped on update, so none would ever swap in).
    const before = deps.layerHistory.length;
    const cells = new Map(u.cells.map((cell) => [cell.cellId, cell]));
    let rev = 0;
    let frame = 0;
    const emitsBySetTime: number[] = [];
    for (; frame < 4 * run; frame++) {
      if (frame % 2 === 0) {
        const cell = u.cells[(frame / 2) % u.cells.length];
        cells.set(cell.cellId, cell);
        c.apply(update(++rev, { cells: [cell] }));
      }
      const emits = deps.layerHistory.length;
      c.setTime(DAYS.start + frame);
      emitsBySetTime.push(deps.layerHistory.length - emits);
      deps.flushFrame();
    }
    expect(emitsBySetTime.every((n) => n === 0)).toBe(true); // setTime builds nothing
    // Bars progressed during the fill: at least one run swapped in while updates kept coming.
    expect(farLayers(before).size).toBeGreaterThanOrEqual(1);
    // The last update withdraws a cell; once the stream ends the last run reflects it.
    const gone = u.cells[3];
    cells.delete(gone.cellId);
    c.apply(update(rev + 1, { removedCells: [gone.cellId] }));
    drain(c);
    expect(barsOf(deps).some((b) => gone.slotProjectIds.includes(b.projectId))).toBe(false);
    expect(barsOf(deps)).toEqual(farBarsFor([...cells.values()]));
  });

  it('far: new lookups, a mode change or destroy mid-declutter drop the run; it never swaps in', () => {
    const u = makeSyntheticTimeline(3, 2_000, 1500, false);
    const start = (): TimelineController => {
      const c = new TimelineController(deps, 'light');
      c.setLookups(SYNTHETIC_LOOKUPS);
      c.setBarMode('far');
      c.apply(u);
      deps.flushFrame(); // the setup
      expect(c.debugSnapshot().pending).toBeGreaterThan(0);
      return c;
    };
    // New lookups: one run swaps in, the one started after them.
    let c = start();
    let before = deps.layerHistory.length;
    const later = { ...SYNTHETIC_LOOKUPS };
    c.setLookups(later);
    drain(c);
    expect(farLayers(before).size).toBe(1);
    expect(barsOf(deps)).toEqual(farBarsFor(u.cells));
    c.destroy();
    // Street mid-run: the street bars at once, and no far layer ever after.
    c = start();
    before = deps.layerHistory.length;
    c.setBarMode('street');
    drain(c);
    expect(farLayers(before).size).toBe(0);
    expect(far()).toBe(false);
    c.destroy();
    // destroy: nothing more is emitted.
    c = start();
    before = deps.layerHistory.length;
    c.destroy();
    for (let i = 0; i < 20; i++) deps.flushFrame();
    expect(deps.layerHistory).toHaveLength(before);
  });

  it('far: a revision 0 mid-declutter drops the run; the new bars swap in once', () => {
    const u = makeSyntheticTimeline(3, 2_000, 1500, false);
    const c = new TimelineController(deps, 'light');
    c.setLookups(SYNTHETIC_LOOKUPS);
    c.setBarMode('far');
    c.apply(u);
    deps.flushFrame();
    expect(c.debugSnapshot().pending).toBeGreaterThan(0);
    c.apply(timelineSmall);
    drain(c);
    const ids = new Set(barsOf(deps).map((b) => b.projectId));
    for (const s of Object.values(SLOT)) expect(ids.has(s.projectId)).toBe(true);
    expect(barsOf(deps).every((b) => !b.projectId.startsWith('syn-'))).toBe(true);
  });

  it('counts the bars shown on the clock day at the zoom at each anchor, in view', () => {
    const c = controller();
    c.apply(timelineSmall);
    const t = DAYS.a.construction;
    c.setTime(t);
    const inTime = barsOf(deps).filter((b) => b.from <= t && t < b.to).length;
    expect(inTime).toBeGreaterThan(0);
    // No map: every bar in time (as marksShown without a view).
    expect(c.debugSnapshot().barsShown).toBe(inTime);
    // A view that holds the whole fixture (its clip is flat: every anchor's zoom is 13).
    deps.view = viewAt(13, 1);
    expect(c.debugSnapshot().barsShown).toBe(0); // street: below 15
    c.setBarMode('far');
    drain(c);
    const shown = barsOf(deps).filter(
      (b) => evalBar(b, timelineLookups, t, 13, 'far').visible
    ).length;
    expect(shown).toBeGreaterThan(0);
    expect(c.debugSnapshot().barsShown).toBe(shown);
    // Every anchor 8 times deeper than the view's centre: zoom 10 there, below the ramp to 12.
    deps.view = {
      ...viewAt(13),
      clip: (lng, lat) => (lng === CENTRE[0] && lat === CENTRE[1] ? [0, 0, 1] : [0, 0, 8])
    };
    expect(c.debugSnapshot().barsShown).toBe(0);
    // The anchor's zoom is read at its raised anchor (anchor[2], roof plus 2 m), as the shader's.
    const byAlt = (raised: number, ground: number): DebugView => ({
      ...viewAt(13, 1),
      clip: (lng, lat, alt = 0) => [
        (lng - CENTRE[0]) / 1,
        (lat - CENTRE[1]) / 1,
        lng === CENTRE[0] && lat === CENTRE[1] ? 1 : alt > 0 ? raised : ground
      ]
    });
    expect(barsOf(deps).every((b) => b.anchor[2] > 0)).toBe(true);
    deps.view = byAlt(1, 8);
    expect(c.debugSnapshot().barsShown).toBe(shown);
    deps.view = byAlt(8, 1);
    expect(c.debugSnapshot().barsShown).toBe(0);
    // A view that holds none of the fixture.
    deps.view = { ...viewAt(13), clip: () => [5, 5, 1] };
    expect(c.debugSnapshot().barsShown).toBe(0);
  });
});

function drainWith(d: FakeTimelineDeps, c: TimelineController): void {
  for (let i = 0; i < 1000 && c.debugSnapshot().pending > 0; i++) d.flushFrame();
  expect(c.debugSnapshot().pending).toBe(0);
}

describe('setMerged', () => {
  const RUN_SOLID = 'timeline-solid-run';
  const RUN_GHOST = 'timeline-ghost-run';
  const KEYS = ['getElevation', 'getFillColor', 'getTlA', 'getTlB', 'getTlC'] as const;
  type Acc = (o: unknown, info: { index: number }) => number | ArrayLike<number>;
  interface Joined {
    length: number;
    startIndices: Uint32Array;
    attributes: { getPolygon: { value: Float64Array; size: number } };
  }
  const joinOf = (f: FakeTimelineDeps, id = RUN_SOLID) => props(byId(f, id)).data as Joined;
  /** A copy of an accessor's value (vec4 accessors share a scratch array). */
  const read = (l: Layer, key: string, index: number) => {
    const v = (l.props as unknown as Record<string, Acc>)[key](null, { index });
    return typeof v === 'number' ? v : Array.from(v);
  };
  /** B with A's parts: a changed cell B. */
  const changedB = (): TimedPackedCell => ({ ...cellOf(A), cellId: B });
  /** Props with functions and the extension instances named, for comparing controllers. */
  const shape = (l: Layer) =>
    Object.fromEntries(
      Object.entries(l.props).map(([k, v]) => [
        k,
        typeof v === 'function'
          ? 'fn'
          : k === 'extensions'
            ? (v as object[]).map((e) => e.constructor.name)
            : v
      ])
    );
  /** Installed A and B, drained, with halos and an overlay layer. */
  function ready(f: FakeTimelineDeps = deps, beforeId = 'label-1', lookups = true) {
    const c = new TimelineController(f, 'light', beforeId);
    if (lookups) c.setLookups(timelineLookups);
    c.setHalos({ from: DAYS.start });
    c.apply({
      ...timelineSmall,
      cells: timelineSmall.cells.map((x) => ({
        ...x,
        slotFlags: new Uint8Array(x.slotProjectIds.length).fill(SLOT_FLAG.zoning)
      }))
    });
    c.setOverlayLayers([new SolidPolygonLayer({ id: 'brush', data: [] })]);
    drainWith(f, c);
    return c;
  }

  it('emits one merged pair in place of the per-cell layers, the tail unchanged', () => {
    const c = ready();
    const unmerged = ids(deps);
    const tail = unmerged.filter((id) => !TIMELINE_PART_LAYER.test(id));
    expect(tail).toEqual(['timeline-bars', 'timeline-halos', 'brush']);
    c.setMerged(true);
    expect(ids(deps)).toEqual([RUN_SOLID, RUN_GHOST, ...tail]);
    expect(ids(deps).filter((id) => TIMELINE_PART_LAYER.test(id))).toEqual([]);
    expect(c.lookup(RUN_SOLID, 0)).toBeNull();
  });

  it('joins the cells in cell-id order', () => {
    const c = ready();
    const cells = deps.lastLayers;
    c.setMerged(true);
    const a = cellOf(A);
    const b = cellOf(B);
    const j = joinOf(deps);
    expect(joinOf(deps, RUN_GHOST)).toBe(j);
    expect(j.length).toBe(a.partCount + b.partCount);
    expect(j.attributes.getPolygon.size).toBe(2);
    expect([...j.attributes.getPolygon.value]).toEqual([...a.positions, ...b.positions]);
    const vertsA = a.positions.length / 2;
    expect([...j.startIndices]).toEqual([
      ...a.startIndices.slice(0, a.partCount),
      ...[...b.startIndices].map((s) => s + vertsA)
    ]);
    for (const [run, perCell] of [
      [RUN_SOLID, solid],
      [RUN_GHOST, ghost]
    ] as const) {
      const m = byId(deps, run);
      const la = cells.find((l) => l.id === perCell(A))!;
      const lb = cells.find((l) => l.id === perCell(B))!;
      for (const key of KEYS) {
        for (let i = 0; i < a.partCount; i++) expect(read(m, key, i)).toEqual(read(la, key, i));
        for (let i = 0; i < b.partCount; i++)
          expect(read(m, key, a.partCount + i)).toEqual(read(lb, key, i));
      }
    }
  });

  it('gives the merged layers the per-cell layers’ props apart from id and data', () => {
    const c = ready();
    const cells = deps.lastLayers;
    c.setMerged(true);
    for (const [run, perCell] of [
      [RUN_SOLID, solid(A)],
      [RUN_GHOST, ghost(A)]
    ]) {
      const m = byId(deps, run).props as unknown as Record<string, unknown>;
      const p = cells.find((l) => l.id === perCell)!.props as unknown as Record<string, unknown>;
      const fns = (o: Record<string, unknown>) =>
        Object.keys(o)
          .filter((k) => typeof o[k] === 'function')
          .sort();
      expect(fns(m)).toEqual(fns(p));
      const keys = Object.keys(p).filter(
        (k) => !['id', 'data', 'updateTriggers'].includes(k) && typeof p[k] !== 'function'
      );
      expect(keys).toEqual(
        expect.arrayContaining([
          'extruded',
          '_normalize',
          '_windingOrder',
          'elevationScale',
          'extensions',
          'timelapsePass',
          'pickable',
          'beforeId',
          ...(run === RUN_SOLID ? ['autoHighlight', 'highlightColor'] : ['parameters'])
        ])
      );
      expect(Object.keys(m).sort()).toEqual(Object.keys(p).sort());
      for (const k of keys) expect(m[k], k).toEqual(p[k]);
      expect((m.extensions as unknown[])[0]).toBe((p.extensions as unknown[])[0]);
      expect({ ...(m.updateTriggers as object), getTlC: 0 }).toEqual({
        ...(p.updateTriggers as object),
        getTlC: 0
      });
    }
  });

  it('unmerged, emits the layers of a controller never merged', () => {
    const c = ready();
    const before = deps.lastLayers;
    c.setMerged(true);
    c.setMerged(false);
    const after = deps.lastLayers;
    for (const l of after.filter((x) => TIMELINE_PART_LAYER.test(x.id)))
      expect(l).toBe(before.find((x) => x.id === l.id));
    const other = makeFakeTimelineDeps();
    ready(other);
    expect(after.map((l) => l.id)).toEqual(other.lastLayers.map((l) => l.id));
    after.forEach((l, i) => {
      if (TIMELINE_PART_LAYER.test(l.id)) expect(shape(l)).toEqual(shape(other.lastLayers[i]));
    });
  });

  it('rebuilds the join after an update that changes a cell while merged', () => {
    const c = ready();
    c.setMerged(true);
    const before = joinOf(deps);
    c.apply(update(1, { cells: [changedB()] }));
    drainWith(deps, c);
    const after = joinOf(deps);
    expect(after).not.toBe(before);
    const a = cellOf(A);
    const b = changedB();
    expect(after.length).toBe(a.partCount + b.partCount);
    expect([...after.attributes.getPolygon.value]).toEqual([...a.positions, ...b.positions]);
    expect(joinOf(deps, RUN_GHOST)).toBe(after);
  });

  it('setTime while merged joins nothing and emits no more than unmerged', () => {
    const c = ready();
    c.setMerged(true);
    const join = joinOf(deps);
    const emits = deps.layerHistory.length;
    c.setTime(DAYS.horizon);
    drainWith(deps, c);
    expect(joinOf(deps)).toBe(join);
    const merged = deps.layerHistory.length - emits;
    const other = makeFakeTimelineDeps();
    const u = ready(other);
    const otherEmits = other.layerHistory.length;
    u.setTime(DAYS.horizon);
    drainWith(other, u);
    expect(merged).toBeLessThanOrEqual(other.layerHistory.length - otherEmits);
  });

  it('an update while merged, then unmerged, gives the updated cell’s layers', () => {
    const c = ready();
    c.setMerged(true);
    c.apply(update(1, { cells: [changedB()] }));
    drainWith(deps, c);
    c.setMerged(false);
    const b = changedB();
    for (const id of [solid(B), ghost(B)]) {
      const d = props(byId(deps, id)).data as Joined;
      expect(d.length).toBe(b.partCount);
      expect(d.attributes.getPolygon.value).toBe(b.positions);
    }
    expect(ids(deps)).not.toContain(RUN_SOLID);
  });

  it('a value already in force emits nothing', () => {
    const c = ready();
    c.setMerged(true);
    const emits = deps.layerHistory.length;
    c.setMerged(true);
    expect(deps.layerHistory).toHaveLength(emits);
    const fresh = makeFakeTimelineDeps();
    const f = ready(fresh);
    const freshEmits = fresh.layerHistory.length;
    f.setMerged(false);
    expect(fresh.layerHistory).toHaveLength(freshEmits);
  });

  it('re-encodes the merged getTlC with new lookups', () => {
    const c = ready(deps, 'label-1', false);
    c.setMerged(true);
    const tlc = () => {
      const m = byId(deps, RUN_SOLID);
      return Array.from({ length: joinOf(deps).length }, (_, i) => read(m, 'getTlC', i));
    };
    const before = tlc();
    c.setLookups(timelineLookups);
    drainWith(deps, c);
    const expected = [cellOf(A), cellOf(B)].flatMap((x) => {
      const t = encodeParts(x, timelineLookups).tlC;
      return Array.from({ length: x.partCount }, (_, i) => [...t.subarray(4 * i, 4 * i + 4)]);
    });
    expect(tlc()).toEqual(expected);
    expect(tlc()).not.toEqual(before);
  });

  it('setTheme while merged gives the merged fill colours of that theme', () => {
    const c = ready();
    c.setMerged(true);
    const light = byId(deps, RUN_SOLID);
    c.setTheme('dark');
    const m = byId(deps, RUN_SOLID);
    expect(props(m).updateTriggers.getFillColor).toBe('dark');
    const a = cellOf(A);
    const b = cellOf(B);
    const n = a.partCount + b.partCount;
    const colours = (l: Layer) => Array.from({ length: n }, (_, i) => read(l, 'getFillColor', i));
    c.setMerged(false);
    const perCell = [
      ...Array.from({ length: a.partCount }, (_, i) =>
        read(byId(deps, solid(A)), 'getFillColor', i)
      ),
      ...Array.from({ length: b.partCount }, (_, i) =>
        read(byId(deps, solid(B)), 'getFillColor', i)
      )
    ];
    expect(colours(m)).toEqual(perCell);
    expect(colours(m)).not.toEqual(colours(light));
  });

  it('a cell removed while merged leaves a join of the rest', () => {
    const c = ready();
    c.setMerged(true);
    c.apply(update(1, { removedCells: [B] }));
    drainWith(deps, c);
    const a = cellOf(A);
    const j = joinOf(deps);
    expect(j.length).toBe(a.partCount);
    expect([...j.attributes.getPolygon.value]).toEqual([...a.positions]);
    expect([...j.startIndices]).toEqual([...a.startIndices]);
  });

  it('emits no merged layer when no cell has parts', () => {
    const c = controller();
    c.setMerged(true);
    const empty = (id: string) => packTimedCell(id, []);
    c.apply(update(0, { cells: [empty('e0'), empty('e1')] }));
    drainWith(deps, c);
    expect(ids(deps).filter((id) => id.startsWith('timeline-solid-'))).toEqual([]);
    expect(ids(deps).filter((id) => id.startsWith('timeline-ghost-'))).toEqual([]);
    expect(c.debugSnapshot().cells).toBe(2);
  });
});
