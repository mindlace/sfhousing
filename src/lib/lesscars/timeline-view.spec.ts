import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlanFile, parseSummary } from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON, LESSCARS_START } from '$lib/data/lesscars/schedule';
import { utcParts } from '$lib/fzp/time';
import { mergeMarkers, scrubberMarkers, timelineRows } from './timeline-view';

const DIR = join(process.cwd(), 'e2e/fixtures/data/fixture-0/scenarios/lesscars');
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const planFile = parsePlanFile(read('plan.json'));
const summary = parseSummary(read('summary.json'));
const T = (id: string) => planFile.times.find((t) => t.id === id)!;

describe('timelineRows', () => {
  it('groups rows transit, streets, garages, housing; by startDay, then id', () => {
    expect(timelineRows(planFile).map((r) => `${r.group}:${r.id}`)).toEqual([
      'transit:buslane',
      'transit:subway',
      'transit:tram',
      'streets:ped',
      'streets:hwy',
      'garages:garage',
      'garages:shuttle',
      'housing:parking'
    ]);
  });
});

describe('scrubberMarkers', () => {
  it('SB 79 first, then line openings by year', () => {
    const m = scrubberMarkers(planFile, summary.switchDay);
    expect(m[0]).toMatchObject({ day: summary.switchDay, label: 'SB 79' });
    expect(m.map((x) => x.label)).toContain(String(utcParts(T('subway').openDay).y));
    expect(new Set(m.map((x) => x.name)).size).toBe(m.length);
  });

  it('drops markers outside the range and merges same-day openings', () => {
    const out = scrubberMarkers(planFile, LESSCARS_HORIZON + 10);
    expect(out.some((x) => x.label === 'SB 79')).toBe(false);
    const f = structuredClone(planFile);
    const lines = f.plan.projects.filter((p) => p.kind === 'transit-line');
    const day = T(lines[0].id).openDay;
    for (const p of lines) f.times.find((t) => t.id === p.id)!.openDay = day;
    const merged = scrubberMarkers(f, summary.switchDay).filter((x) => x.day === day);
    expect(merged).toHaveLength(1);
    for (const p of lines) expect(merged[0].name).toContain(p.label);
  });
});

describe('mergeMarkers', () => {
  const SPAN = LESSCARS_HORIZON - LESSCARS_START;
  const px = (day: number, trackPx: number) => ((day - LESSCARS_START) / SPAN) * trackPx;
  const fixture = scrubberMarkers(planFile, summary.switchDay);
  const sb79 = fixture[0];
  const subway = fixture.find((m) => m.day === T('subway').openDay)!;
  const gap = (trackPx: number) => px(subway.day, trackPx) - px(sb79.day, trackPx);

  it('merges SB 79 and the subway opening exactly when their centres are closer than minPx', () => {
    for (const trackPx of [252, 790, 4000]) {
      const out = mergeMarkers(fixture, trackPx);
      const merged = out.some((m) => m.day === subway.day) === false;
      expect(merged, `track ${trackPx} px, gap ${gap(trackPx)} px`).toBe(gap(trackPx) < 48);
    }
    // The phone track always merges them; a track wide enough never does.
    expect(gap(252)).toBeLessThan(48);
    expect(gap(4000)).toBeGreaterThanOrEqual(48);
  });

  it('keeps the first label and day, and names every event it covers', () => {
    const [m] = mergeMarkers(fixture, 252);
    expect(m.label).toBe(sb79.label);
    expect(m.day).toBe(sb79.day);
    expect(m.name).toMatch(/^Jump to /);
    expect(m.name).toContain('SB 79');
    expect(m.name).toContain(subway.name.replace(/^Jump to /, ''));
    expect(m.name.match(/Jump to/g)).toHaveLength(1);
  });

  it('folds a chain of near markers into the first while within minPx of it', () => {
    const at = (x: number) => LESSCARS_START + Math.round((x / 1000) * SPAN);
    const chain = [10, 30, 50, 70].map((x, i) => ({
      day: at(x),
      label: `M${i}`,
      name: `Jump to e${i}`
    }));
    const out = mergeMarkers(chain, 1000);
    // M1 (20 px) and M2 (40 px) fold into M0; M3 is 60 px from M0, so it stands alone.
    expect(out.map((m) => m.label)).toEqual(['M0', 'M3']);
    expect(out[0].name).toBe('Jump to e0; e1; e2');
    expect(out[0].day).toBe(chain[0].day);
    expect(out[1]).toEqual(chain[3]);
  });

  it('leaves markers alone without a measured track or when apart', () => {
    expect(mergeMarkers(fixture, 0)).toEqual(fixture);
    expect(mergeMarkers([], 300)).toEqual([]);
  });
});
