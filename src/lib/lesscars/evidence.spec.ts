import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlanFile, parseSummary } from '$lib/data/lesscars/codec';
import type { PlanProject } from '$lib/data/lesscars/plan';
import { TIER_LABEL } from '$lib/fzp/labels';
import { evidenceSectionId, evidenceSections } from './evidence';
import { KIND_LABEL } from './timeline-view';

const DIR = join(process.cwd(), 'e2e/fixtures/data/fixture-0/scenarios/lesscars');
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const planFile = parsePlanFile(read('plan.json'));
const summary = parseSummary(read('summary.json'));

function paramCount(p: PlanProject): number {
  let n = 1;
  if ('peakTph' in p) n++;
  if ('rowHalfWidthM' in p) n++;
  if ('spaces' in p) n++;
  if ('build' in p && p.build) n++;
  if ('segments' in p) n += p.segments.filter((s) => 'line' in s).length;
  return n;
}
const countParams = (projects: PlanProject[]) => projects.reduce((a, p) => a + paramCount(p), 0);

describe('evidenceSections', () => {
  it('every Param of every project appears once', () => {
    const n = evidenceSections(planFile, summary)
      .filter((x) => x.id.startsWith('ev-') && !['ev-model', 'ev-capacity'].includes(x.id))
      .reduce((a, x) => a + x.rows.length, 0);
    expect(n).toBe(countParams(planFile.plan.projects));
  });

  it('orders model, capacity, then one section per project in plan order', () => {
    const s = evidenceSections(planFile, summary);
    expect(s.map((x) => x.id)).toEqual([
      'ev-model',
      'ev-capacity',
      ...planFile.plan.projects.map((p) => evidenceSectionId(p.id))
    ]);
    const p = planFile.plan.projects[0];
    expect(s[2].heading).toBe(`${p.label} (${KIND_LABEL[p.kind]})`);
    expect(s[2].rows[0]).toMatchObject({ name: 'Duration' });
    expect(s[2].rows[0].value).toMatch(/^\d+ months?$/);
  });

  it('capacity has one row per rule', () => {
    const c = evidenceSections(planFile, summary)[1];
    expect(c.rows).toHaveLength(planFile.plan.capacity.length);
    expect(c.rows[0].name).toMatch(/ projects at once$/);
    expect(c.rows[0].value).toBe(`${planFile.plan.capacity[0].maxConcurrent} at once`);
  });

  it('tier 4 rows are invented and read "Assumption, not data"', () => {
    const all = evidenceSections(planFile, summary).flatMap((x) => x.rows);
    const rows = all.filter((r) => r.prov.tier === 4);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.invented && r.lines[0] === TIER_LABEL[4])).toBe(true);
    expect(all.filter((r) => r.prov.tier !== 4).every((r) => !r.invented)).toBe(true);
  });

  it('the model section carries the summary provenance and counts futures, not records', () => {
    const m = evidenceSections(planFile, summary)[0];
    expect(m.id).toBe('ev-model');
    expect(m.rows[0].lines).toContain(`over ${summary.seeds} paired futures`);
    // The tier-3 label itself reads "…not SF records", so match the record-count lines only.
    expect(m.rows[0].lines.some((l) => /^(based on|records from) /.test(l))).toBe(false);
  });
});
