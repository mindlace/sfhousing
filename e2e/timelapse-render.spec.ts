// Timelapse render e2e (spec §6): time-driven demolition of existing buildings on fixture-0.
// Runs against the VITE_E2E build, which exposes window.__sfhMap (src/lib/map/debug.ts) and
// window.__sfhBrush. e2e/fixtures/timeline/fixture0-timeline.json is built by
// src/lib/map/fixtures/build-timeline-fixture.ts (run deliberately, not in CI).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhMapDebug } from '../src/lib/map/debug';
import type { TimedPackedCell, TimelineUpdate } from '../src/lib/map/types';
import { OPEN_DAY } from '../src/lib/timelapse/time';
import { gotoEditor, jumpAndIdle, type LngLat, type Win } from './helpers/sharing';

type Lookups = Parameters<SfhMapDebug['setTimelineLookups']>[0];
type Json = Record<string, unknown>;

// ---- fixture loading ----------------------------------------------------------------------------

const num = (v: unknown): number => (v === null ? NaN : (v as number));
const f32 = (v: unknown) => Float32Array.from(v as (number | null)[], num);
const f64 = (v: unknown) => Float64Array.from(v as (number | null)[], num);
const u32 = (v: unknown) => Uint32Array.from(v as number[]);
const u8 = (v: unknown) => Uint8Array.from(v as number[]);

/** Plain-JSON typed arrays (NaN as null) back to the `TimelineUpdate` and lookups they came from. */
function reviveTimeline(json: Json): { timeline: TimelineUpdate; lookups: Lookups } {
  const t = json.timeline as Json;
  const cells = (t.cells as Json[]).map((c): TimedPackedCell => ({
    cellId: c.cellId as string,
    parcelIds: c.parcelIds as string[],
    parcelMeta: u32(c.parcelMeta),
    partCount: c.partCount as number,
    startIndices: u32(c.startIndices),
    positions: f64(c.positions),
    partTopM: f32(c.partTopM),
    partSlot: u32(c.partSlot),
    partAppearance: u8(c.partAppearance),
    partTypology: u8(c.partTypology),
    slotProjectIds: c.slotProjectIds as string[],
    partWindow: f32(c.partWindow),
    slotStages: f32(c.slotStages),
    slotEnd: f32(c.slotEnd),
    slotPathway: u8(c.slotPathway),
    slotCohort: u8(c.slotCohort)
  }));
  const l = json.lookups as {
    chance: Record<string, Json>;
    typicalMonths: Lookups['typicalMonths'];
  };
  const chance = Object.fromEntries(
    Object.entries(l.chance).map(([pathway, rows]) => [
      pathway,
      Object.fromEntries(Object.entries(rows).map(([stage, row]) => [stage, f32(row)]))
    ])
  ) as Lookups['chance'];
  return {
    timeline: {
      revision: t.revision as number,
      cells,
      removedCells: t.removedCells as string[],
      demolish: t.demolish as TimelineUpdate['demolish']
    },
    lookups: { chance, typicalMonths: l.typicalMonths }
  };
}

const { timeline, lookups } = reviveTimeline(
  JSON.parse(
    readFileSync(new URL('./fixtures/timeline/fixture0-timeline.json', import.meta.url), 'utf8')
  ) as Json
);

// Fixture parcel label points (lng/lat), decoded from the chunk's 1e-7 degree integers.
const LABELS: Map<string, LngLat> = (() => {
  const chunk = JSON.parse(
    readFileSync(new URL('./fixtures/data/fixture-0/parcels/50_25.json', import.meta.url), 'utf8')
  ) as { id: string[]; label: number[] };
  return new Map(
    chunk.id.map((id, i) => [id, [chunk.label[2 * i] / 1e7, chunk.label[2 * i + 1] / 1e7]])
  );
})();

// The fixture's projects: two construct (and so demolish), one is withdrawn first.
const [FIRST, SECOND] = timeline.demolish;
const NEVER = '3512011';
const DEMOLISHED = [FIRST.parcelId, SECOND.parcelId];
// Camera: between the demolished parcels, close enough that all three buildings are in view.
const FRAME_AT = {
  center: [-122.41893, 37.76014] as LngLat,
  zoom: 17,
  pitch: 0,
  bearing: 0
};

// ---- helpers ------------------------------------------------------------------------------------

/** `state.replaced` of each rendered existing-buildings feature of `id` at its label point. */
async function replacedAt(page: Page, id: string): Promise<unknown[]> {
  return page.evaluate(
    ([parcelId, at]) => {
      const map = (window as Win).__sfhMap!.map!;
      return map
        .queryRenderedFeatures(map.project(at), { layers: ['existing-buildings'] })
        .filter((f) => String(f.id) === parcelId)
        .map((f) => f.state.replaced);
    },
    [id, LABELS.get(id)!] as const
  );
}

/** Sets the time, waits for the pump to apply `applied` entries, then for the map to settle. */
async function timeTo(page: Page, day: number, applied: number): Promise<void> {
  await page.evaluate((d) => (window as Win).__sfhMap!.setTime(d), day);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as Win).__sfhMap!.timelineSnapshot();
        return s ? { day: s.day, applied: s.demolish.applied } : null;
      })
    )
    .toEqual({ day, applied });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) resolve();
        else map.once('idle', () => resolve());
        map.triggerRepaint();
      })
  );
}

// ---- tests --------------------------------------------------------------------------------------

test.describe('timelapse render', () => {
  test('the fixture is self-consistent and stays within the fixture-0 parcels', () => {
    expect(timeline.revision).toBe(0);
    expect(timeline.cells.length).toBeGreaterThan(0);
    for (const c of timeline.cells) {
      // Vertex counts come from startIndices, never from an assumed ring length.
      expect(c.startIndices).toHaveLength(c.partCount + 1);
      expect(c.positions).toHaveLength(2 * c.startIndices[c.partCount]);
      expect(c.partWindow).toHaveLength(2 * c.partCount);
      expect(c.slotEnd).toHaveLength(2 * c.slotProjectIds.length);
      // NaN round-trips as null, and a project that never ends keeps the OPEN_DAY sentinel.
      expect(c.partWindow.some((d) => d === OPEN_DAY)).toBe(true);
      expect(c.slotStages.some(Number.isNaN)).toBe(true);
    }
    expect(timeline.demolish.length).toBeGreaterThanOrEqual(2);
    expect(timeline.demolish.map((d) => d.day)).toEqual(
      timeline.demolish.map((d) => d.day).sort((a, b) => a - b)
    );
    for (const d of timeline.demolish) expect(LABELS.has(d.parcelId)).toBe(true);
    expect(FIRST.day).toBeLessThan(SECOND.day);
    expect(timeline.demolish.map((d) => d.parcelId)).not.toContain(NEVER);
  });

  test('existing buildings are replaced from their construction day and restored on scrub back', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.text().includes('Content Security Policy'))
        errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    // The worker host's own revision-0 snapshot lands before the timeline starts (gotoEditor waits
    // for the brush worker), so it cannot clear the demolish pump's feature-state afterwards.
    await gotoEditor(page);
    await jumpAndIdle(page, FRAME_AT);
    await page.evaluate(
      ([l, u]) => {
        const hook = (window as Win).__sfhMap!;
        hook.setTimelineLookups(l);
        hook.applyTimeline(u);
      },
      [lookups, timeline] as const
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = (window as Win).__sfhMap!.timelineSnapshot();
          return s ? { revision: s.revision, total: s.demolish.total, pending: s.pending } : null;
        })
      )
      .toEqual({ revision: 0, total: timeline.demolish.length, pending: 0 });

    // The buildings must be on screen for the assertions below to mean anything.
    const rendered = async (id: string) => {
      const states = await replacedAt(page, id);
      expect(states.length, `${id} has a rendered existing building`).toBeGreaterThan(0);
      return states;
    };
    const expectState = async (id: string, replaced: true | undefined) => {
      await expect
        .poll(async () => (await rendered(id)).every((s) => s === replaced), {
          message: `${id} state.replaced is ${replaced}`
        })
        .toBe(true);
    };

    // One day before the first construction day: nothing is replaced.
    await timeTo(page, FIRST.day - 1, 0);
    for (const id of [...DEMOLISHED, NEVER]) await expectState(id, undefined);

    // On the first construction day only the first parcel is.
    await timeTo(page, FIRST.day, 1);
    await expectState(FIRST.parcelId, true);
    await expectState(SECOND.parcelId, undefined);
    await expectState(NEVER, undefined);

    // On the second, both are. The withdrawn project's parcel keeps its building.
    await timeTo(page, SECOND.day, 2);
    await expectState(FIRST.parcelId, true);
    await expectState(SECOND.parcelId, true);
    await expectState(NEVER, undefined);

    // Scrubbing back restores them one at a time.
    await timeTo(page, FIRST.day, 1);
    await expectState(FIRST.parcelId, true);
    await expectState(SECOND.parcelId, undefined);
    await timeTo(page, FIRST.day - 1, 0);
    for (const id of DEMOLISHED) await expectState(id, undefined);

    // A jump across both days converges in one go, within the per-frame feature-state budget.
    await timeTo(page, SECOND.day + 1000, 2);
    for (const id of DEMOLISHED) await expectState(id, true);
    const maxOps = await page.evaluate(() => (window as Win).__sfhMap!.demolishMaxFrameOps);
    expect(maxOps).toBeGreaterThan(0);
    expect(maxOps).toBeLessThanOrEqual(2000);

    expect(errors).toEqual([]);
  });
});
