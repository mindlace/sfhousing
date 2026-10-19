import { describe, expect, it } from 'vitest';
import { cumulativeIncidence } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import { PATHWAYS, STAGE_ORDER } from '$lib/timelapse/types';
import type { Pathway, Stage } from '$lib/timelapse/types';
import { transitionSectionId } from './card';
import { fixtureCalibration, tier3Calibration } from './fixtures/calibration';
import { PROJECTS_JSON, PROJECTS_JSON_NO_RULES } from './fixtures/projects';
import { FIX_ASOF, TIMELINE_SCORE, TIMELINE_SCORE_NO_PHASING } from './fixtures/timeline-score';
import { EXIT_LABEL, TIER_LABEL, inStageLabel } from './labels';
import {
  NOT_SF_NOTE,
  PERMIT_WINDOW_SENTENCE,
  PHASE_GAP_SENTENCE,
  QUALITY_LOAD_FAILED,
  loadProjectsFile,
  provenanceLines,
  provenanceSections,
  qualityRows,
  transitionShares,
  type ProvEntry,
  type ProvSection
} from './provenance';

const cal = fixtureCalibration();
const sections = provenanceSections(cal, TIMELINE_SCORE, FIX_ASOF);

const section = (id: string, list: ProvSection[] = sections) => {
  const found = list.find((s) => s.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
};
const entryOf = (id: string, list: ProvSection[] = sections): ProvEntry => {
  for (const s of list) {
    const found = s.entries.find((e) => e.id === id);
    if (found) return found;
  }
  throw new Error(`no entry ${id}`);
};
const textOf = (s: ProvSection) =>
  [s.intro, s.entries.flatMap((e) => [e.title, ...e.lines, ...e.shares])]
    .flat(2)
    .concat(s.tables.flatMap((t) => [t.caption, ...t.head, ...t.rows.flat()]));

const transitions: [Pathway, Stage][] = PATHWAYS.flatMap((p) =>
  STAGE_ORDER.filter((s) => cal.transitions[p][s as Exclude<Stage, 'complete'>]).map(
    (s) => [p, s] as [Pathway, Stage]
  )
);

describe('transitionShares', () => {
  describe.each(transitions)('%s %s', (p, s) => {
    const t = cal.transitions[p][s as Exclude<Stage, 'complete'>]!;
    it('has the 12, 24 and 60 month lines from cumulativeIncidence', () => {
      const lines = transitionShares(t);
      expect(lines).toHaveLength(3);
      [12, 24, 60].forEach((k, i) => {
        const inc = cumulativeIncidence(t, k);
        const parts = [`${Math.round(100 * inc.advance)}% advanced`];
        for (const [r, v] of Object.entries(inc.exit)) {
          parts.push(`${Math.round(100 * v)}% ${EXIT_LABEL[r as keyof typeof EXIT_LABEL]}`);
        }
        expect(lines[i]).toBe(`Within ${k} months: ${parts.join(', ')}`);
      });
    });
  });

  it('reads like the spec example', () => {
    const t = cal.transitions.discretionary.entitled!;
    expect(transitionShares(t)[0]).toMatch(/^Within 12 months: \d+% advanced(, \d+% [a-z ]+)*$/);
  });
});

describe('provenanceLines', () => {
  it('lists tier label, label, method, count and window', () => {
    const t = cal.transitions.discretionary.filed!;
    const lines = provenanceLines(t.provenance);
    expect(lines.slice(0, 3)).toEqual([
      TIER_LABEL[t.provenance.tier],
      t.provenance.label,
      t.provenance.method
    ]);
    expect(lines).toContain(`based on ${t.provenance.n} records`);
    expect(lines).toContain(
      `records from ${t.provenance.window![0]} to ${t.provenance.window![1]}`
    );
  });

  it('omits the count and the window when absent', () => {
    const lines = provenanceLines({ tier: 4, label: 'L', sources: [], method: 'M' });
    expect(lines).toEqual([TIER_LABEL[4], 'L', 'M']);
  });
});

describe('provenanceSections', () => {
  it('has the sections in spec order', () => {
    expect(sections.map((s) => s.id)).toEqual([
      'src-how-to-read',
      'src-actual',
      'src-transitions',
      'src-initiation',
      'src-size',
      'src-revision',
      'src-pathway',
      'src-targets',
      'src-multiphase'
    ]);
  });

  it('has an entry for every calibration parameter present', () => {
    const ids = sections.flatMap((s) => s.entries.map((e) => e.id));
    for (const [p, s] of transitions) expect(ids).toContain(transitionSectionId(p, s));
    for (const id of [
      'src-local-program',
      'src-initiation-model',
      'src-size-model',
      'src-revision-model',
      'src-pathway-for-new',
      'src-ppa-share',
      'src-phase-gap',
      'src-baseline'
    ]) {
      expect(ids).toContain(id);
    }
    for (const r of TIMELINE_SCORE.references) expect(ids).toContain(`src-reference-${r.id}`);
    for (const { target } of TIMELINE_SCORE.targets) {
      expect(ids).toContain(`src-target-${target.id}`);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows tier label, label, method, count and window on each transition entry', () => {
    for (const [p, s] of transitions) {
      const t = cal.transitions[p][s as Exclude<Stage, 'complete'>]!;
      const entry = entryOf(transitionSectionId(p, s));
      expect(entry.lines).toEqual(expect.arrayContaining(provenanceLines(t.provenance)));
      expect(entry.prov).toBe(t.provenance);
      expect(entry.shares).toEqual(transitionShares(t));
      expect(entry.tail).toBe(t.tailProvenance);
    }
  });

  it('puts the Local Program entry after the streamlined entries', () => {
    const ids = section('src-transitions').entries.map((e) => e.id);
    const local = ids.indexOf('src-local-program');
    const lastStreamlined = ids.findLastIndex((id) => id.startsWith('src-transition-streamlined-'));
    expect(local).toBe(lastStreamlined + 1);
    expect(entryOf('src-local-program').prov).toBe(cal.streamlinedForLocalProgram);
    expect(entryOf('src-local-program').tail).toBeNull();
    expect(entryOf('src-local-program').shares).toEqual([]);
  });

  it('every permit-side transition window starts 2007-01-01', () => {
    const permitSide: Stage[] = ['permitFiled', 'permitIssued', 'construction'];
    for (const [p, s] of transitions) {
      const entry = entryOf(transitionSectionId(p, s));
      if (permitSide.includes(s)) {
        expect(entry.prov.window?.[0]).toBe('2007-01-01');
        expect(entry.lines).toContain(PERMIT_WINDOW_SENTENCE);
      } else {
        expect(entry.lines).not.toContain(PERMIT_WINDOW_SENTENCE);
      }
    }
  });

  it('puts the permit sentence after the window line', () => {
    const lines = entryOf(transitionSectionId('permitOnly', 'permitFiled')).lines;
    expect(lines.indexOf(PERMIT_WINDOW_SENTENCE)).toBeGreaterThan(
      lines.findIndex((l) => l.startsWith('records from'))
    );
  });

  it('never names 1989 or 2000 as a transition window', () => {
    for (const [p, s] of transitions) {
      expect(entryOf(transitionSectionId(p, s)).lines.join(' ')).not.toMatch(/1989|2000/);
    }
    expect(PERMIT_WINDOW_SENTENCE).not.toMatch(/1989|2000/);
  });

  it('the phase gap entry carries its sentence and its own window line when present', () => {
    expect(cal.phaseGap.provenance.window).toBeUndefined();
    const bare = entryOf('src-phase-gap');
    expect(bare.lines).toContain(PHASE_GAP_SENTENCE);
    expect(bare.lines.some((l) => l.startsWith('records from'))).toBe(false);

    const windowed = structuredClone(cal);
    windowed.phaseGap.provenance.window = ['1989-01-01', '2026-10-10'];
    const withWindow = entryOf('src-phase-gap', provenanceSections(windowed, TIMELINE_SCORE));
    expect(withWindow.lines).toContain('records from 1989-01-01 to 2026-10-10');
    expect(withWindow.lines).toContain(PHASE_GAP_SENTENCE);
  });

  it('flags tier 3 and 4 entries as research', () => {
    expect(entryOf(transitionSectionId('discretionary', 'entitled')).research).toBe(false);
    const tier3 = provenanceSections(tier3Calibration(), TIMELINE_SCORE);
    expect(entryOf(transitionSectionId('discretionary', 'entitled'), tier3).research).toBe(true);
    expect(entryOf('src-size-model').research).toBe(true);
    expect(entryOf('src-initiation-model').research).toBe(true);
    expect(NOT_SF_NOTE).toBe('Not from San Francisco records.');
  });

  it('shows the initiation intercept when there are no terms', () => {
    const [table] = section('src-initiation').tables;
    expect(cal.initiation.terms).toEqual([]);
    expect(table.rows).toEqual([[`Intercept only: −2.94`]]);
  });

  it('renders initiation terms as feature, bin and coefficient rows', () => {
    const custom = structuredClone(cal);
    custom.initiation.terms = [
      { feature: 'yearBuilt', bins: [1900, 1950, 2000], coef: [0.5, -0.25, 0] },
      { feature: 'lotAreaM2', bins: [0], coef: [1.5] },
      { feature: 'landUseClass', bins: [0, 1, 3], coef: [0.1, 0.2, 0.3] }
    ];
    const [table] = section('src-initiation', provenanceSections(custom, TIMELINE_SCORE)).tables;
    expect(table.head).toHaveLength(3);
    expect(table.rows.map((r) => r[1])).toEqual([
      'under 1950',
      '1950 to under 2000',
      '2000 or more',
      'any',
      'residential',
      'mixed',
      'pdr'
    ]);
    expect(table.rows[0][2]).toBe('0.5');
    expect(table.rows[1][2]).toBe('−0.25');
    expect(table.rows[0][0]).toBe(table.rows[1][0]);
  });

  it('renders the size table with whole percents', () => {
    const [table] = section('src-size').tables;
    expect(table.rows).toHaveLength(cal.size.fillLevels.length * cal.size.byEnvelope.length);
    expect(table.rows[0]).toEqual(['Up to 999 stories', '25% of the allowed height', '0%']);
    expect(table.rows.at(-1)).toEqual(['Up to 999 stories', '100% of the allowed height', '100%']);
  });

  it('renders one revision row per stage with shrink and grow shares', () => {
    const [table] = section('src-revision').tables;
    expect(table.rows.map((r) => r[0])).toEqual(cal.revision.at.map((a) => inStageLabel(a.stage)));
    const custom = structuredClone(cal);
    custom.revision.at = [
      {
        stage: 'permitFiled',
        probability: 0.3,
        ratio: { edges: [0.5, 0.9, 1, 1.5, 2], probs: [0.2, 0.3, 0.4, 0.1] }
      }
    ];
    const [t2] = section('src-revision', provenanceSections(custom, TIMELINE_SCORE)).tables;
    // shrink: edges[j+1] <= 1 -> 0.2 + 0.3; grow: edges[j] >= 1 -> 0.4 + 0.1
    expect(t2.rows).toEqual([[inStageLabel('permitFiled'), '30%', '50%', '50%']]);
  });

  it('opens the pathway section with the Local Program rule and shows the shares', () => {
    const s = section('src-pathway');
    expect(s.intro[0]).toMatch(
      /^New projects on Local Program parcels always take the streamlined/
    );
    expect(s.intro[0]).toContain('180-day clock');
    expect(entryOf('src-pathway-for-new').prov).toBe(cal.pathwayForNew.provenance);
    expect(entryOf('src-ppa-share').prov).toBe(cal.ppaShare.provenance);
    const rows = s.tables[0].rows;
    expect(rows).toHaveLength(3);
    expect(rows[0].slice(1)).toEqual([
      `${Math.round(100 * cal.pathwayForNew.discretionary)}%`,
      `${Math.round(100 * cal.ppaShare.discretionary)}%`
    ]);
  });

  it('lists the baseline, targets and references with their sources', () => {
    expect(entryOf('src-baseline').prov).toBe(TIMELINE_SCORE.baseline.provenance);
    for (const { target } of TIMELINE_SCORE.targets) {
      const e = entryOf(`src-target-${target.id}`);
      expect(e.title).toBe(target.label);
      expect(e.prov.sources).toEqual([target.source]);
    }
    for (const r of TIMELINE_SCORE.references) {
      const e = entryOf(`src-reference-${r.id}`);
      expect(e.title).toBe(r.label);
      expect(e.prov).toBe(r.provenance);
    }
    expect(entryOf('src-reference-planning-entitlements').lines).toContain(
      'Compared with: Plan effect, approved'
    );
    expect(entryOf('src-reference-controller-2045').lines).toContain(
      'Compared with: Plan effect, completed'
    );
  });

  it('states the twin, the N3 difference and when simulated counts start', () => {
    const text = textOf(section('src-targets')).join('\n');
    expect(text).toContain(
      "Under the old zoning a real project's resize is capped by the old height limit, so its size can differ between the two runs. That difference is a real effect of the plan, but it appears only in 'from today's pipeline', not in 'what the plan added', so that the published estimates compare like with like."
    );
    expect(text).toContain('Simulated counts start on Oct 16, 2026.');
    expect(text).toContain('same luck');
  });

  it('describes the multi-phase counts and both unenriched lists', () => {
    const s = section('src-multiphase');
    const text = textOf(s).join('\n');
    expect(text).toContain('2 multi-phase projects');
    expect(text).toContain('1 have a published Development Agreement phasing plan');
    expect(text).toContain('5 phases are scheduled');
    expect(text).toContain('3 are estimated');
    expect(s.tables.map((t) => t.caption)).toEqual([
      'Drawn as one footprint (1)',
      'Counted but not drawn (1)'
    ]);
    expect(s.tables[0].rows).toEqual([['CASE:2012-000020PRX', '120']]);
    expect(s.tables[1].rows).toEqual([['Score Only Yards', '80']]);
    expect(s.entries.map((e) => e.id)).toEqual(['src-phase-gap']);
  });

  it('omits an empty unenriched list with its heading', () => {
    const score = {
      ...TIMELINE_SCORE,
      phasing: {
        ...TIMELINE_SCORE.phasing,
        unenriched: TIMELINE_SCORE.phasing.unenriched.filter((u) => u.drawn)
      }
    };
    const s = section('src-multiphase', provenanceSections(cal, score));
    expect(s.tables.map((t) => t.caption)).toEqual(['Drawn as one footprint (1)']);
  });

  it('drops multi-phase for a score with no masters', () => {
    const ids = provenanceSections(cal, TIMELINE_SCORE_NO_PHASING).map((s) => s.id);
    expect(ids).not.toContain('src-multiphase');
    expect(ids).toContain('src-targets');
  });

  it('shows the calibration sections alone while there is no score', () => {
    const ids = provenanceSections(cal, null).map((s) => s.id);
    expect(ids).toEqual([
      'src-how-to-read',
      'src-transitions',
      'src-initiation',
      'src-size',
      'src-revision',
      'src-pathway'
    ]);
  });

  it('defaults the simulated start to the calibration snapshot day', () => {
    const text = textOf(section('src-targets', provenanceSections(cal, TIMELINE_SCORE))).join('\n');
    expect(text).toContain('Simulated counts start on Oct 10, 2026.');
  });

  it('opens with the tier table', () => {
    const s = section('src-how-to-read');
    expect(s.intro).toEqual([
      'Every number the simulation uses comes from the best evidence available, and says which kind it is.'
    ]);
    expect(s.tables[0].rows.map((r) => r[1])).toEqual(
      [0, 1, 2, 3, 4].map((i) => TIER_LABEL[i as 0 | 1 | 2 | 3 | 4])
    );
  });
});

describe('qualityRows', () => {
  const dropped: string[] = [];
  const file = parseProjectsFile(PROJECTS_JSON, {
    onInvalid: (path) => dropped.push(path)
  });

  it('drops the invalid project without throwing', () => {
    expect(dropped).toEqual(['projects[3].id']);
    expect(file.projects).toHaveLength(3);
  });

  it('has a row per rule in id order with project counts', () => {
    const rows = qualityRows(file);
    expect(rows.map((r) => r.id)).toEqual([
      'pr.date.valid-range',
      'pr.pipeline.status-date-linked',
      'pr.stages.forward-clamp'
    ]);
    expect(rows.find((r) => r.id === 'pr.stages.forward-clamp')!.count).toBe(2);
    // The dropped project carried status-date-linked too: it is not counted.
    expect(rows.find((r) => r.id === 'pr.pipeline.status-date-linked')!.count).toBe(1);
    expect(rows[0].label).toBe('A date outside 1970 to the snapshot day was treated as missing');
  });

  it('shows valueTier when set, else the rule tier', () => {
    const rows = qualityRows(file);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['pr.pipeline.status-date-linked'].tierLabel).toBe('San Francisco project records');
    expect(byId['pr.pipeline.status-date-linked'].research).toBe(false);
    expect(byId['pr.stages.forward-clamp'].tierLabel).toBe(TIER_LABEL[2]);
    expect(byId['pr.date.valid-range'].tierLabel).toBe('Assumption, not data');
    expect(byId['pr.date.valid-range'].research).toBe(true);
  });

  it('is empty when no rule fired', () => {
    expect(qualityRows(parseProjectsFile(PROJECTS_JSON_NO_RULES))).toEqual([]);
  });
});

describe('loadProjectsFile', () => {
  const ok = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

  it('fetches, parses and drops invalid projects', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(PROJECTS_JSON), { status: 200 });
    }) as unknown as typeof fetch;
    const file = await loadProjectsFile('/data/v/scenarios/fzp/projects.json', fetchFn);
    expect(calls).toEqual(['/data/v/scenarios/fzp/projects.json']);
    expect(file.projects.map((p) => p.id)).toEqual([
      'BP:2024-0001',
      'BP:2024-0002',
      'BP:2024-0003'
    ]);
  });

  it('rejects when the fetch rejects', async () => {
    const fetchFn = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(loadProjectsFile('/x', fetchFn)).rejects.toThrow('offline');
  });

  it('rejects on a non-ok response', async () => {
    const fetchFn = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(loadProjectsFile('/x', fetchFn)).rejects.toThrow();
  });

  it('rejects on a file-level violation', async () => {
    const bad = { ...(PROJECTS_JSON as object), schema: 2 };
    await expect(loadProjectsFile('/x', ok(bad))).rejects.toThrow(/schema/);
  });

  it('has the failure copy', () => {
    expect(QUALITY_LOAD_FAILED).toBe("The list of data checks couldn't be loaded.");
  });
});
