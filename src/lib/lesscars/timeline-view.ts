// The /lesscars project timeline: rows grouped and ordered for the dialog, and the scrubber
// markers (SB 79 and the transit-line openings).
import type { LessCarsPlanFile } from '$lib/data/lesscars/codec';
import { TRANSIT_KINDS, type ProjectKind } from '$lib/data/lesscars/plan';
import { LESSCARS_HORIZON, LESSCARS_START } from '$lib/data/lesscars/schedule';
import { formatMonthYear } from '$lib/fzp/format';
import { utcParts } from '$lib/fzp/time';
import type { Marker } from '$lib/fzp/types';
import type { Day } from '$lib/timelapse/time';

export type TimelineGroup = 'transit' | 'streets' | 'garages' | 'housing';

export const GROUP_LABEL: Record<TimelineGroup, string> = {
  transit: 'Transit',
  streets: 'Streets',
  garages: 'Garages and shuttle',
  housing: 'Parking conversions'
};

export const KIND_LABEL: Record<ProjectKind, string> = {
  'transit-line': 'New line',
  'tram-priority': 'Tram priority',
  'bus-lane': 'Bus lanes',
  'street-change': 'Street change',
  'highway-truncation': 'Highway truncation',
  'street-removal': 'Street removal',
  'parking-conversion': 'Parking conversion',
  'edge-garage': 'Edge garage',
  'car-shuttle': 'Car shuttle'
};

export interface TimelineRow {
  id: string;
  label: string;
  kind: ProjectKind;
  group: TimelineGroup;
  startDay: Day;
  openDay: Day;
  build: { startDay: Day; completeDay: Day } | null;
}

export const GROUP_ORDER: TimelineGroup[] = ['transit', 'streets', 'garages', 'housing'];

function groupOf(kind: ProjectKind): TimelineGroup {
  if (TRANSIT_KINDS.includes(kind)) return 'transit';
  if (kind === 'edge-garage' || kind === 'car-shuttle') return 'garages';
  if (kind === 'parking-conversion') return 'housing';
  return 'streets';
}

/** Groups in GROUP_LABEL order; within a group by startDay, then id. */
export function timelineRows(f: LessCarsPlanFile): TimelineRow[] {
  const times = new Map(f.times.map((t) => [t.id, t]));
  const rows: TimelineRow[] = [];
  for (const p of f.plan.projects) {
    const t = times.get(p.id);
    if (!t) continue;
    rows.push({
      id: p.id,
      label: p.label,
      kind: p.kind,
      group: groupOf(p.kind),
      startDay: t.startDay,
      openDay: t.openDay,
      build: t.build
    });
  }
  return rows.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      a.startDay - b.startDay ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

const inRange = (d: Day) => d >= LESSCARS_START && d <= LESSCARS_HORIZON;

/** "SB 79" at switchDay, then each transit-line opening (same day merged, names joined). */
export function scrubberMarkers(f: LessCarsPlanFile, switchDay: Day): Marker[] {
  const out: Marker[] = [];
  if (inRange(switchDay)) out.push({ day: switchDay, label: 'SB 79', name: 'Jump to SB 79' });
  const times = new Map(f.times.map((t) => [t.id, t]));
  const byDay = new Map<Day, string[]>();
  for (const p of f.plan.projects) {
    const t = times.get(p.id);
    if (p.kind !== 'transit-line' || !t || !inRange(t.openDay)) continue;
    byDay.set(t.openDay, [...(byDay.get(t.openDay) ?? []), p.label]);
  }
  for (const [day, labels] of [...byDay].sort((a, b) => a[0] - b[0]))
    out.push({
      day,
      label: String(utcParts(day).y),
      name: `Jump to ${labels.join(' and ')} opening, ${formatMonthYear(day)}`
    });
  return out.sort((a, b) => a.day - b.day);
}

const JUMP = 'Jump to ';

/**
 * Folds scrubber markers whose centres sit closer than `minPx` on a `trackPx`-wide track into one
 * (WCAG 2.5.8: TimeScrubber places markers absolutely, so near ones overlap). Each marker is
 * compared with the first of its group, where the merged marker is drawn: the merged marker keeps
 * that marker's label and day, and its name lists every event it covers ("Jump to a; b").
 * Markers must be sorted by day. With no measured track (`trackPx <= 0`), returns them unchanged.
 */
export function mergeMarkers(
  markers: readonly Marker[],
  trackPx: number,
  minPx = 48,
  start: Day = LESSCARS_START,
  end: Day = LESSCARS_HORIZON
): Marker[] {
  if (!(trackPx > 0)) return [...markers];
  const span = Math.max(end - start, 1);
  const x = (d: Day) => ((Math.min(Math.max(d, start), end) - start) / span) * trackPx;
  const out: { head: Marker; events: string[] }[] = [];
  for (const m of markers) {
    const g = out.at(-1);
    const event = m.name.startsWith(JUMP) ? m.name.slice(JUMP.length) : m.name;
    if (g && x(m.day) - x(g.head.day) < minPx) g.events.push(event);
    else out.push({ head: m, events: [event] });
  }
  return out.map(({ head, events }) =>
    events.length === 1 ? head : { ...head, name: `${JUMP}${events.join('; ')}` }
  );
}
