import { describe, expect, it } from 'vitest';
import type { ProjectCard } from '$lib/sim/protocol';
import { chanceTable } from '$lib/timelapse/model';
import { monthsIn } from '$lib/timelapse/time';
import type { Stage } from '$lib/timelapse/types';
import {
  LOCAL_PROGRAM_SECTION_ID,
  SIMULATED_DISCLAIMER,
  SOURCE_DATASETS,
  chanceLine,
  chanceProvenance,
  cardStatus,
  dataNotes,
  massingNote,
  phaseLine,
  revisionLines,
  sizeLine,
  sourceLinks,
  statusText,
  storiesText,
  timelineRows,
  transitionSectionId,
  type ChanceTable
} from './card';
import {
  APPROXIMATE,
  EXITED,
  FIX_ASOF,
  NO_QUALITY,
  NULL_STORIES,
  PHASE_ESTIMATED,
  PHASE_SCHEDULED,
  REAL_ACTUAL,
  REVISED,
  SIMULATED,
  SIMULATED_LOCAL,
  TIER0,
  TIER3,
  TIER4_MASSING,
  TIER4_SCALED,
  TIER_NULL,
  UNENRICHED,
  WITH_QUALITY
} from './fixtures/cards';
import { fixtureCalibration, tier3Calibration } from './fixtures/calibration';
import { HORIZON, dayFromUtc } from './time';

/** A scrubbed day past every fixture stage: the whole card shows. */
const LATE = HORIZON;

const cal = fixtureCalibration();
const chance = chanceTable(cal);

const stageDay = (card: { stages: { stage: Stage; day: number }[] }, stage: Stage) => {
  const found = card.stages.find((s) => s.stage === stage);
  if (!found) throw new Error(`no ${stage}`);
  return found.day;
};

describe('cardStatus', () => {
  const cards = { REAL_ACTUAL, SIMULATED, SIMULATED_LOCAL, REVISED, EXITED, PHASE_ESTIMATED };

  describe.each(Object.entries(cards))('%s', (_name, card) => {
    it('reports the entered stage on its entry day and the next stage from its start', () => {
      for (let i = 0; i < card.stages.length; i++) {
        const cur = card.stages[i];
        const here = cardStatus(card, cur.day, chance);
        expect(here).toMatchObject({
          kind: 'inStage',
          stage: cur.stage,
          monthsInStage: 0,
          day: cur.day
        });
        const next = card.stages[i + 1];
        if (!next) continue;
        const mid = cur.day + Math.floor((next.day - cur.day) / 2);
        const midStatus = cardStatus(card, mid, chance);
        expect(midStatus?.stage).toBe(cur.stage);
        expect(midStatus?.monthsInStage).toBe(monthsIn(cur.day, mid));
        const after = cardStatus(card, next.day + 1, chance);
        expect(after).toMatchObject({ kind: 'inStage', stage: next.stage });
        expect(after?.monthsInStage).toBe(monthsIn(next.day, next.day + 1));
      }
    });
  });

  it('is null before the first stage', () => {
    expect(cardStatus(SIMULATED, SIMULATED.stages[0].day - 1, chance)).toBeNull();
    expect(cardStatus(REAL_ACTUAL, REAL_ACTUAL.stages[0].day - 400, chance)).toBeNull();
    expect(cardStatus({ ...SIMULATED, stages: [] }, FIX_ASOF, chance)).toBeNull();
  });

  it('turns exited after end.day and not before', () => {
    const end = EXITED.end;
    if (end?.kind !== 'exit') throw new Error('EXITED must end in an exit');
    expect(cardStatus(EXITED, end.day - 1, chance)).toMatchObject({
      kind: 'inStage',
      stage: 'filed'
    });
    const exited = cardStatus(EXITED, end.day, chance);
    expect(exited).toMatchObject({ kind: 'exited', stage: 'filed', chance: null });
    expect(cardStatus(EXITED, end.day + 900, chance)?.kind).toBe('exited');
  });

  it('turns complete at end.day', () => {
    const end = REAL_ACTUAL.end;
    if (end?.kind !== 'complete') throw new Error('REAL_ACTUAL must complete');
    expect(cardStatus(REAL_ACTUAL, end.day - 1, chance)).toMatchObject({
      kind: 'inStage',
      stage: 'construction'
    });
    expect(cardStatus(REAL_ACTUAL, end.day, chance)).toMatchObject({
      kind: 'complete',
      stage: 'complete',
      chance: null
    });
  });

  it('takes units and stories from the last revision on or before the day', () => {
    const resize = REVISED.revisions[1].day;
    expect(cardStatus(REVISED, resize - 1, chance)).toMatchObject({ units: 24, stories: 6 });
    expect(cardStatus(REVISED, resize, chance)).toMatchObject({ units: 30, stories: 8 });
    expect(cardStatus(REVISED, resize + 400, chance)).toMatchObject({ units: 30, stories: 8 });
  });

  it('reads the chance table at the months in stage', () => {
    const day = stageDay(SIMULATED, 'entitled') + 150;
    const status = cardStatus(SIMULATED, day, chance);
    const m = monthsIn(stageDay(SIMULATED, 'entitled'), day);
    expect(m).toBeGreaterThan(0);
    expect(status?.chance).toBe(chance.discretionary.entitled?.[m]);
  });

  it('clamps the chance index at 240 months', () => {
    const old = {
      ...SIMULATED,
      stages: [{ stage: 'filed' as const, day: FIX_ASOF - 9300, actual: true }],
      end: null
    };
    const status = cardStatus(old, FIX_ASOF, chance);
    expect(status?.monthsInStage).toBeGreaterThan(240);
    expect(status?.chance).toBe(chance.discretionary.filed?.[240]);
  });

  it('has a null chance when the table lacks the stage', () => {
    const empty: ChanceTable = { discretionary: {}, streamlined: {}, permitOnly: {} };
    const status = cardStatus(SIMULATED, stageDay(SIMULATED, 'filed') + 5, empty);
    expect(status).toMatchObject({ kind: 'inStage', stage: 'filed', chance: null });
  });
});

describe('statusText', () => {
  const at = (card: typeof REAL_ACTUAL, day: number) => {
    const status = cardStatus(card, day, chance);
    if (!status) throw new Error('no status');
    return statusText(status, card, FIX_ASOF);
  };

  it('counts months so far', () => {
    const start = stageDay(REAL_ACTUAL, 'construction');
    expect(at(REAL_ACTUAL, start + 122)).toBe('Under construction, 4 months so far');
    expect(at(REAL_ACTUAL, start + 31)).toBe('Under construction, 1 month so far');
    expect(at(REAL_ACTUAL, start)).toBe('Under construction, 0 months so far');
  });

  it('dates completion with the card date rule', () => {
    const end = REAL_ACTUAL.end;
    if (end?.kind !== 'complete') throw new Error('REAL_ACTUAL must complete');
    const status = cardStatus(REAL_ACTUAL, end.day, chance);
    if (!status) throw new Error('no status');
    expect(statusText(status, REAL_ACTUAL, FIX_ASOF)).toBe('Completed Nov 2027');
    expect(statusText(status, REAL_ACTUAL, end.day)).toBe('Completed Nov 20, 2027');
  });

  it('names the stage an exit stopped in', () => {
    expect(at(EXITED, dayFromUtc(2032, 1, 1))).toBe(
      'Stopped during In Planning review (withdrawn), Mar 2031'
    );
  });
});

describe('storiesText', () => {
  it.each([
    ['unknown', NULL_STORIES, null, null],
    ['simulated', SIMULATED, 6, '6 stories'],
    ['recorded', TIER0, 6, '6 stories'],
    ['parsed from description', TIER3, 6, 'about 6 stories, from the project description'],
    ['simulator massing', TIER4_MASSING, 6, 'about 6 stories (simulated)'],
    ['scaled revision', TIER4_SCALED, 6, 'about 6 stories (simulated)'],
    ['no tier treated as 4', TIER_NULL, 5, 'about 5 stories (simulated)']
  ])('%s', (_name, card, stories, text) => {
    expect(storiesText(card, stories)).toBe(text);
  });

  it('storiesText tier 1 reads "8 stories, from the development plan"', () => {
    const tier1: ProjectCard = { ...TIER4_MASSING, storiesTier: 1 };
    expect(storiesText(tier1, 8)).toBe('8 stories, from the development plan');
  });

  it('says story for one and rounds a scaled count', () => {
    expect(storiesText(TIER0, 1)).toBe('1 story');
    expect(storiesText(TIER4_SCALED, 5.6)).toBe('about 6 stories (simulated)');
  });
});

describe('sizeLine', () => {
  it('prints homes, stories, existing homes and net', () => {
    expect(sizeLine(NO_QUALITY, FIX_ASOF, false)).toBe(
      '24 homes · 6 stories · replaces 2 existing homes (assessor) (net +22)'
    );
  });

  it('omits the stories part and its separator when unknown', () => {
    expect(sizeLine(NULL_STORIES, FIX_ASOF, false)).toBe(
      '24 homes · replaces 2 existing homes (assessor) (net +22)'
    );
  });

  it('marks the assessor value and prints existingUnits 0 as given', () => {
    expect(sizeLine(WITH_QUALITY, FIX_ASOF, true)).toBe(
      '24 homes · 6 stories · replaces 0 existing homes (assessor*) (net +24)'
    );
  });

  it('shows a negative net with a minus sign', () => {
    const card = { ...NO_QUALITY, existingUnits: 27 };
    expect(sizeLine(card, FIX_ASOF, false)).toContain('(net −3)');
  });

  it('follows the revision in force at the day', () => {
    const resize = REVISED.revisions[1].day;
    expect(sizeLine(REVISED, resize - 1, false)).toMatch(/^24 homes · 6 stories/);
    expect(sizeLine(REVISED, resize, false)).toMatch(/^30 homes · 8 stories/);
  });
});

describe('revisionLines', () => {
  it('lists a resize after asOf as simulated, with the month only', () => {
    expect(revisionLines(REVISED, LATE, FIX_ASOF)).toEqual([
      'Resized: 24 → 30 homes, Mar 2028, simulated'
    ]);
  });

  it('lists a recorded resize with a full date and no suffix', () => {
    expect(revisionLines(REVISED, LATE, dayFromUtc(2029, 1, 1))).toEqual([
      'Resized: 24 → 30 homes, Mar 10, 2028'
    ]);
  });

  it('has none for a card never resized', () => {
    expect(revisionLines(SIMULATED, LATE, FIX_ASOF)).toEqual([]);
  });

  it('omits a resize after the scrubbed day (spec §4.8: no future stages)', () => {
    const resize = REVISED.revisions[1].day;
    expect(revisionLines(REVISED, resize - 1, FIX_ASOF)).toEqual([]);
    expect(revisionLines(REVISED, resize, FIX_ASOF)).toEqual([
      'Resized: 24 → 30 homes, Mar 2028, simulated'
    ]);
  });
});

describe('chanceLine', () => {
  it('prints a whole percent', () => {
    expect(chanceLine(0.62)).toBe('Chance of finishing from here: 62%');
    expect(chanceLine(0.004)).toBe('Chance of finishing from here: under 1%');
    expect(chanceLine(0.999)).toBe('Chance of finishing from here: over 99%');
  });
});

describe('chanceProvenance', () => {
  it('lists each remaining transition, main then tail, in pathway order', () => {
    const { entries, research } = chanceProvenance(cal, REAL_ACTUAL, 'permitFiled');
    const expected = (['permitFiled', 'permitIssued', 'construction'] as const).flatMap((s) => {
      const tr = cal.transitions.discretionary[s];
      if (!tr) throw new Error('fixture lacks transition');
      const sectionId = `src-transition-discretionary-${s}`;
      return [
        { sectionId, tier: tr.provenance.tier, label: tr.provenance.label },
        { sectionId, tier: tr.tailProvenance.tier, label: tr.tailProvenance.label }
      ];
    });
    expect(entries).toEqual(expected);
    expect(research).toBe(false);
  });

  it('starts a Local Program project with the proxy provenance', () => {
    const { entries } = chanceProvenance(cal, SIMULATED_LOCAL, 'permitFiled');
    expect(entries[0]).toEqual({
      sectionId: LOCAL_PROGRAM_SECTION_ID,
      tier: cal.streamlinedForLocalProgram.tier,
      label: cal.streamlinedForLocalProgram.label
    });
    expect(entries[1].sectionId).toBe('src-transition-streamlined-permitFiled');
    expect(entries).toHaveLength(1 + 6);
  });

  it('does not add the proxy entry for other projects', () => {
    const { entries } = chanceProvenance(cal, SIMULATED, 'permitFiled');
    expect(entries.some((e) => e.sectionId === LOCAL_PROGRAM_SECTION_ID)).toBe(false);
  });

  it('flags research estimates only when a listed transition is tier 3 or worse', () => {
    const t3 = tier3Calibration();
    expect(chanceProvenance(t3, REAL_ACTUAL, 'filed').research).toBe(true);
    expect(chanceProvenance(t3, REAL_ACTUAL, 'entitled').research).toBe(true);
    expect(chanceProvenance(t3, REAL_ACTUAL, 'permitFiled').research).toBe(false);
    expect(chanceProvenance(cal, REAL_ACTUAL, 'filed').research).toBe(false);
  });

  it('flags a tier 4 preApplication table', () => {
    expect(chanceProvenance(cal, REAL_ACTUAL, 'preApplication').research).toBe(true);
  });

  it('skips a transition the calibration lacks and lists nothing for complete', () => {
    const { entries } = chanceProvenance(cal, { ...REAL_ACTUAL, pathway: 'permitOnly' }, 'filed');
    expect(entries).toEqual([]);
    expect(chanceProvenance(cal, REAL_ACTUAL, 'complete').entries).toEqual([]);
  });

  it('does not mutate the shared calibration when building the tier 3 copy', () => {
    tier3Calibration();
    expect(cal.transitions.discretionary.entitled?.provenance.tier).toBe(0);
  });
});

describe('transitionSectionId', () => {
  it('names the dialog section', () => {
    expect(transitionSectionId('permitOnly', 'construction')).toBe(
      'src-transition-permitOnly-construction'
    );
    expect(LOCAL_PROGRAM_SECTION_ID).toBe('src-local-program');
  });
});

describe('massingNote', () => {
  it('reads the three cases', () => {
    expect(massingNote(APPROXIMATE)).toBe('Building shape approximate');
    expect(massingNote(UNENRICHED)).toBe(
      "Multi-phase project without published or estimated phases; drawn as one footprint on the site's lots that no other project holds"
    );
    expect(massingNote({ ...SIMULATED, massing: 'none' })).toBe(
      'Building not drawn; footprint only'
    );
    expect(massingNote(PHASE_ESTIMATED)).toBeNull();
    expect(massingNote(SIMULATED)).toBeNull();
  });
});

describe('phaseLine', () => {
  it('names the phase and master', () => {
    expect(phaseLine(PHASE_ESTIMATED)).toBe('Phase 3 of 12, Candlestick Point');
    expect(phaseLine(SIMULATED)).toBeNull();
  });
});

describe('simulated disclaimer', () => {
  it('says it is not a real proposal', () => {
    expect(SIMULATED_DISCLAIMER).toMatch(/^Not a real proposal\. /);
  });
});

describe('timelineRows', () => {
  it('uses the entered label, the date rule and Recorded or Simulated', () => {
    const rows = timelineRows(REAL_ACTUAL, LATE, FIX_ASOF, false).map((r) => r.text);
    expect(rows[0]).toBe('Planning application filed · Jul 4, 2023 · Recorded');
    expect(rows).toHaveLength(REAL_ACTUAL.stages.length + 1);
    expect(rows.at(-1)).toBe('Completed · Nov 2027 · Simulated');
  });

  it('shows a simulated stage as month and year', () => {
    const rows = timelineRows(SIMULATED, LATE, FIX_ASOF, false);
    expect(rows[0].text).toMatch(/^Planning application filed · [A-Z][a-z]{2} \d{4} · Simulated$/);
    expect(rows.every((r) => r.heading === null)).toBe(true);
  });

  it('stars Recorded when the card is marked', () => {
    const rows = timelineRows(REAL_ACTUAL, LATE, FIX_ASOF, true).map((r) => r.text);
    expect(rows[0]).toMatch(/ · Recorded\*$/);
    expect(rows.at(-1)).toMatch(/ · Simulated$/);
  });

  it('reads an end that has passed as Recorded', () => {
    const rows = timelineRows(REAL_ACTUAL, LATE, dayFromUtc(2030, 1, 1), false);
    expect(rows.at(-1)?.text).toBe('Completed · Nov 20, 2027 · Recorded');
  });

  it('omits stages and an end after the scrubbed day (spec §4.8: no future stages)', () => {
    const issued = REAL_ACTUAL.stages[3].day;
    const rows = timelineRows(REAL_ACTUAL, issued, FIX_ASOF, false).map((r) => r.text);
    expect(rows).toHaveLength(4);
    expect(rows.at(-1)).toMatch(/^Building permit issued · /);
    expect(rows.some((t) => t.startsWith('Completed'))).toBe(false);

    if (REAL_ACTUAL.end?.kind !== 'complete') throw new Error('REAL_ACTUAL must complete');
    const end = REAL_ACTUAL.end.day;
    expect(timelineRows(REAL_ACTUAL, end - 1, FIX_ASOF, false)).toHaveLength(5);
    expect(timelineRows(REAL_ACTUAL, end, FIX_ASOF, false).at(-1)?.text).toBe(
      'Completed · Nov 2027 · Simulated'
    );
  });

  it('keeps the "This phase" heading off until the phase permit row is reached', () => {
    const permit = PHASE_ESTIMATED.stages[2].day;
    expect(
      timelineRows(PHASE_ESTIMATED, permit - 1, FIX_ASOF, false).map((r) => r.heading)
    ).toEqual([null, null]);
  });

  it('reads a stop with its reason', () => {
    const rows = timelineRows(EXITED, LATE, FIX_ASOF, false);
    expect(rows.at(-1)?.text).toBe('Stopped (withdrawn) · Mar 2031 · Simulated');
  });

  it('labels master rows on a phase card and starts "This phase" at the permit', () => {
    const rows = timelineRows(PHASE_ESTIMATED, LATE, FIX_ASOF, false);
    expect(rows.map((r) => r.heading)).toEqual([null, null, 'This phase']);
    expect(rows[0].text).toMatch(
      /^Master plan application filed · [A-Z][a-z]{2} \d{1,2}, \d{4} · Recorded$/
    );
    expect(rows[1].text).toMatch(
      /^Master plan approved · [A-Z][a-z]{2} \d{1,2}, \d{4} · Recorded$/
    );
    expect(rows[2].text).toMatch(
      /^Building permit filed · [A-Z][a-z]{2} \d{4} · Simulated \(start estimated\)$/
    );
  });

  it('treats every row before permitFiled as master, including an unknown stage', () => {
    const card = {
      ...PHASE_ESTIMATED,
      stages: [
        PHASE_ESTIMATED.stages[0],
        PHASE_ESTIMATED.stages[1],
        { stage: 'designReview' as Stage, day: FIX_ASOF - 3000, actual: true },
        PHASE_ESTIMATED.stages[2]
      ]
    };
    const rows = timelineRows(card, LATE, FIX_ASOF, false);
    expect(rows.map((r) => r.heading)).toEqual([null, null, null, 'This phase']);
    expect(rows[2].text).toMatch(
      /^Master plan: designReview · [A-Z][a-z]{2} \d{1,2}, \d{4} · Recorded$/
    );
    expect(rows[3].text).toMatch(/^Building permit filed · /);
  });

  it('has no master rows when permitFiled is the first row of a phase card', () => {
    const card = { ...PHASE_ESTIMATED, stages: [PHASE_ESTIMATED.stages[2]] };
    const rows = timelineRows(card, LATE, FIX_ASOF, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].heading).toBe('This phase');
    expect(rows[0].text).toMatch(/^Building permit filed · /);
  });

  it('says published plan date for a scheduled phase start', () => {
    const rows = timelineRows(PHASE_SCHEDULED, LATE, FIX_ASOF, false);
    expect(rows[2].text).toMatch(/ · Simulated \(published plan date\)$/);
  });

  it('reads only phase.start, never sources', () => {
    const card = {
      ...PHASE_ESTIMATED,
      sources: [{ dataset: '6jgi-cpb4', id: 'PLAN-DATE', key: 'case_no' }]
    };
    expect(timelineRows(card, LATE, FIX_ASOF, false)[2].text).toMatch(/\(start estimated\)$/);
  });

  it('does not add a phase suffix to a recorded permit row', () => {
    const card = {
      ...PHASE_ESTIMATED,
      stages: PHASE_ESTIMATED.stages.map((s) => ({ ...s, actual: true }))
    };
    expect(timelineRows(card, LATE, FIX_ASOF, false)[2].text).toMatch(/ · Recorded$/);
  });
});

describe('dataNotes', () => {
  it('lists each rule with the tier shown, value tier first', () => {
    const notes = dataNotes(WITH_QUALITY);
    expect(notes).toEqual({
      heading: "* About this record's data",
      items: [
        'Dates taken from the Planning record on this lot (San Francisco project records)',
        'Counted in the score but not drawn: no free lot in the plan area (Inferred from San Francisco records)',
        'A date outside 1970 to the snapshot day was treated as missing (Assumption, not data)'
      ],
      footer:
        "The data checks changed or estimated some values on this card, so not every value is the record's own."
    });
  });

  it('is null without quality entries', () => {
    expect(dataNotes(NO_QUALITY)).toBeNull();
  });
});

describe('sourceLinks', () => {
  it('uses the entry key when present', () => {
    expect(sourceLinks([{ dataset: '6jgi-cpb4', id: '2007.0001PRX', key: 'case_no' }])).toEqual([
      {
        text: 'Development pipeline 2007.0001PRX: DataSF record (JSON)',
        href: 'https://data.sf.gov/resource/6jgi-cpb4.json?case_no=2007.0001PRX'
      }
    ]);
  });

  it('encodes the dataset and the key', () => {
    expect(sourceLinks([{ dataset: 'a b/c?', id: '1' }])[0].href).toBe(
      'https://data.sf.gov/d/a%20b%2Fc%3F'
    );
    expect(sourceLinks([{ dataset: '6jgi-cpb4', id: '1', key: 'a&b=c' }])[0].href).toBe(
      'https://data.sf.gov/resource/6jgi-cpb4.json?a%26b%3Dc=1'
    );
  });

  it.each([
    ['i98e-djp9', 'permit_number', 'Building permit'],
    ['qvu5-m3a2', 'record_id', 'Planning project'],
    ['y673-d69b', 'record_id', 'Planning record'],
    ['d4jk-jw33', 'b1_alt_id', 'Planning review'],
    ['j67f-aayr', 'building_permit_application', 'Completion certificate'],
    ['xdht-4php', 'bpa', 'Housing production record'],
    ['6jgi-cpb4', 'bpa_no', 'Development pipeline']
  ])('uses the record-id field of %s', (dataset, key, name) => {
    expect(SOURCE_DATASETS[dataset]).toEqual({ key, name });
    expect(sourceLinks([{ dataset, id: 'A B/1' }])).toEqual([
      {
        text: `${name} A B/1: DataSF record (JSON)`,
        href: `https://data.sf.gov/resource/${dataset}.json?${key}=A%20B%2F1`
      }
    ]);
  });

  it('links an unknown dataset to its page', () => {
    expect(sourceLinks([{ dataset: 'zzzz-0000', id: '42' }])).toEqual([
      { text: 'zzzz-0000 42', href: 'https://data.sf.gov/d/zzzz-0000' }
    ]);
  });

  it('has one link per source, in order', () => {
    expect(sourceLinks(REAL_ACTUAL.sources).map((l) => l.text)).toEqual([
      'Development pipeline 2007.0001PRX: DataSF record (JSON)',
      'Building permit 201801010001: DataSF record (JSON)'
    ]);
  });
});
