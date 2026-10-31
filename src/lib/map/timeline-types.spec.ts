import { describe, expect, it } from 'vitest';
import { stubHandle } from '$lib/brush/test/sim-map-stub';
import type { ParcelId } from '$lib/data/parcel';
import type { chanceTable, typicalMonths } from '$lib/timelapse/model';
import { OPEN_DAY, type Day } from '$lib/timelapse/time';
import type {
  PackedCell,
  SimMapHandle,
  SimMapProps,
  TimedPackedCell,
  TimelinePick,
  TimelineUpdate
} from './types';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// Each row below is restated literally from the design doc T7 row
// (docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md), then compared with the export.

interface RowTimedPackedCell extends PackedCell {
  slotProjectIds: string[]; // render slots are keyed by project; parcelIds may repeat across slots
  partWindow: Float32Array; // per part: [fromDay, toDay) the part's revision is current; toDay = OPEN_DAY if open
  slotStages: Float32Array; // per slot: STAGE_ORDER.length entry days, NaN = never
  slotEnd: Float32Array; // per slot: [endDay, endKind] (0 open, 1 complete, 2 exit)
  slotPathway: Uint8Array; // index into ['discretionary','streamlined','permitOnly']
  slotCohort: Uint8Array; // per slot: 0 = fresh (new projects' lookups), 1 = in flight (Call 15)
}

interface RowTimelineUpdate {
  revision: number; // 0 = snapshot
  cells: TimedPackedCell[];
  removedCells: string[];
  demolish: { parcelId: ParcelId; day: Day }[]; // complete list in revision 0; empty afterwards
}

type RowApplyTimeline = (u: TimelineUpdate) => void;
type RowSetTime = (day: Day) => void;
type RowLookupSet = {
  chance: ReturnType<typeof chanceTable>;
  typicalMonths: ReturnType<typeof typicalMonths>;
};
// Call 15: absent `inFlight` = in-flight slots read the fresh set
type RowSetTimelineLookups = (l: RowLookupSet & { inFlight?: RowLookupSet }) => void;
type RowTimelinePick = (
  p:
    | { projectId: string; parcelId: ParcelId; x: number; y: number; kind: 'hover' | 'tap' }
    | { projectId: null; kind: 'hover' | 'tap' }
) => void;

const rowsMatch: Assert<
  Equals<TimedPackedCell, RowTimedPackedCell> extends true
    ? Equals<TimelineUpdate, RowTimelineUpdate> extends true
      ? Equals<SimMapHandle['applyTimeline'], RowApplyTimeline> extends true
        ? Equals<SimMapHandle['setTime'], RowSetTime> extends true
          ? Equals<SimMapHandle['setTimelineLookups'], RowSetTimelineLookups> extends true
            ? Equals<SimMapProps['timelinePick'], RowTimelinePick | undefined> extends true
              ? Equals<TimelinePick, Parameters<RowTimelinePick>[0]> extends true
                ? true
                : false
              : false
            : false
          : false
        : false
      : false
    : false
> = true;

describe('T7 timeline types', () => {
  it('match the design-doc row', () => {
    expect(rowsMatch).toBe(true);
  });

  it('stubHandle exposes the three timeline no-ops', () => {
    const update: TimelineUpdate = { revision: 0, cells: [], removedCells: [], demolish: [] };
    expect(() => stubHandle.applyTimeline(update)).not.toThrow();
    expect(() => stubHandle.setTime(OPEN_DAY)).not.toThrow();
    expect(() =>
      stubHandle.setTimelineLookups({
        chance: {} as ReturnType<typeof chanceTable>,
        typicalMonths: {} as ReturnType<typeof typicalMonths>
      })
    ).not.toThrow();
  });
});
