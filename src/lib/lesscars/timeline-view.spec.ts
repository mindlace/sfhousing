import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlanFile, parseSummary } from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON } from '$lib/data/lesscars/schedule';
import { utcParts } from '$lib/fzp/time';
import { scrubberMarkers, timelineRows } from './timeline-view';

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
