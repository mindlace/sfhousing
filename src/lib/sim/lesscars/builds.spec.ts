import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSitesFile, type InitiativeBuild } from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON } from '$lib/data/lesscars/schedule';
import { generate } from '$lib/generator';
import type { Schedule } from '../scenario/types';
import {
  BUILD_PREFIX,
  SITES_CELL,
  buildSchedule,
  freedMassing,
  playbackCard,
  type CardEntry
} from './builds';

const DIR = join(process.cwd(), 'e2e/fixtures/data/fixture-0/scenarios/lesscars');
const sites = parseSitesFile(JSON.parse(readFileSync(join(DIR, 'sites.json'), 'utf8')));
const site = sites.sites.find((s) => s.siteId === 'lc:hwy:1')!;

const b: InitiativeBuild = {
  siteId: 'lc:hwy:1',
  projectId: 'hwy',
  parcelRow: null,
  units: 40,
  stories: 5,
  existing: 0,
  startDay: 24472,
  completeDay: 25385
};

describe('builds', () => {
  it('names the synthetic cell and the build prefix', () => {
    expect(SITES_CELL).toBe('lc-sites-cell');
    expect(BUILD_PREFIX).toBe('lc-build:');
  });

  it('buildSchedule is a simulated, permit-only schedule from build start to completion', () => {
    const s = buildSchedule(b, 'lc:hwy:1', LESSCARS_HORIZON);
    expect(s).toMatchObject({
      projectId: 'lc-build:lc:hwy:1',
      origin: 'simulated',
      parcelIds: ['lc:hwy:1'],
      pathway: 'permitOnly',
      entered: { construction: 24472, complete: 25385 },
      end: { kind: 'complete', day: 25385 },
      revisions: [{ day: 24472, units: 40, stories: 5 }],
      existingUnits: 0,
      multiPhase: false,
      phase: null
    });
    const late = buildSchedule(
      { ...b, completeDay: LESSCARS_HORIZON + 10 },
      'lc:hwy:1',
      LESSCARS_HORIZON
    );
    expect(late.end).toEqual({ kind: 'open' });
    expect(late.entered).toEqual({ construction: 24472 });
  });

  it('freedMassing falls back to the outline when the generator gives nothing', () => {
    expect('footprint' in freedMassing(b, site.rec, () => null)).toBe(true);
    const throws = (() => {
      throw new Error('boom');
    }) as unknown as typeof generate;
    expect('footprint' in freedMassing(b, site.rec, throws)).toBe(true);
  });

  it('freedMassing stamps a generated building as a scenario building', () => {
    const m = freedMassing(b, site.rec, generate);
    expect('parts' in m && m.source).toBe('scenario');
  });

  it('playbackCard reads status and plan label at the day', () => {
    const e: CardEntry = {
      kind: 'freed',
      schedule: buildSchedule(b, 'lc:hwy:1', LESSCARS_HORIZON),
      build: b,
      planLabel: 'A label'
    };
    expect(playbackCard(e, 24472)).toMatchObject({
      projectId: 'lc-build:lc:hwy:1',
      kind: 'freed',
      planLabel: 'A label',
      where: 'lc:hwy:1',
      status: 'construction',
      units: 40,
      stories: 5,
      constructionDay: 24472,
      completeDay: null
    });
    expect(playbackCard(e, 25385)).toMatchObject({ status: 'complete', completeDay: 25385 });
    expect(playbackCard(e, 24471)).toBeNull();
  });

  it('playbackCard: a market project reads Block/Lot, planning, and stopped after an exit', () => {
    const s: Schedule = {
      projectId: 'm1',
      origin: 'simulated',
      parcelIds: ['3512017'],
      pathway: 'discretionary',
      entered: { preApplication: 100, filed: 200 },
      end: { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: 300 },
      revisions: [
        { day: 100, units: 10, stories: 3 },
        { day: 250, units: 14, stories: 4 }
      ],
      existingUnits: 2,
      multiPhase: false,
      phase: null
    };
    const e: CardEntry = { kind: 'market', schedule: s };
    expect(playbackCard(e, 150)).toMatchObject({
      kind: 'market',
      planLabel: null,
      where: 'Block 3512, Lot 017',
      status: 'planning',
      units: 10,
      stories: 3,
      existingUnits: 2
    });
    expect(playbackCard(e, 300)).toMatchObject({ status: 'stopped', units: 14, stories: 4 });
  });
});
