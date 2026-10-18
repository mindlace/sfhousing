// stage-calibration T14 registration (spec §4.4a).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SC_RULE_IDS, type ScRuleId } from '../../lib/fzp-cal/types';
import { DATASETS, datasf } from '../../lib/fzp-cal/provenance';
import { QUALITY_RULES, kindDefaultDepartures, type QualityRule } from '../../lib/quality';
import { SC_RULES } from '../../lib/quality-rules/sc';

const common = {
  owner: 'stage-calibration',
  source: 'project-histories',
  maskBit: null,
  unitsWeighted: false,
  warnShare: 0.01,
  failShare: 0.1
} as const;

const EXPECTED: Record<ScRuleId, QualityRule> = {
  'sc.stages.gap-impute': {
    ...common,
    id: 'sc.stages.gap-impute',
    field: 'entered',
    kind: 'gap',
    action: 'default',
    tier: 2,
    valueTier: 2,
    label: "A missing stage between two recorded stages takes the next recorded stage's date",
    denominator: 'qualifying histories that contribute a spell in a pooled window',
    // conductor ruling C1 / partner DQ-4
    warnShare: 0.1,
    failShare: 0.2
  },
  // partner ruling P1 / controller ruling R13 (2026-10-18); kind-default shares for `missing`
  'sc.stages.no-fcd-duration': {
    id: 'sc.stages.no-fcd-duration',
    owner: 'stage-calibration',
    source: 'project-histories',
    field: 'entered',
    kind: 'missing',
    action: 'drop',
    tier: 2,
    valueTier: null,
    maskBit: null,
    label:
      'A completed project with no recorded construction start counts as finished, but not in the time spent in permit and construction',
    denominator: 'qualifying histories that contribute a spell in a pooled window',
    warnShare: 0.05,
    failShare: 0.1,
    unitsWeighted: false
  },
  'sc.stages.running-max': {
    ...common,
    id: 'sc.stages.running-max',
    field: 'entered',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    label: "Stage dates made non-decreasing (re-check of the project records' clamp)",
    denominator: 'qualifying histories'
  },
  'sc.exit.last-stage': {
    ...common,
    id: 'sc.exit.last-stage',
    field: 'end',
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    label:
      "An exit is placed at the last stage the project entered, no earlier than that stage's start",
    denominator: 'qualifying histories that end in an exit'
  },
  'sc.exit.purge-censor': {
    ...common,
    id: 'sc.exit.purge-censor',
    field: 'end',
    kind: 'outlier',
    action: 'replace',
    tier: 4,
    valueTier: 2,
    label:
      'An exit inside an administrative purge window counts as still open, not as a project decision',
    // conductor ruling C3
    denominator: 'exits of qualifying histories that contribute a spell in a pooled window'
  },
  'sc.revision.ratio-clamp': {
    ...common,
    id: 'sc.revision.ratio-clamp',
    field: 'unitsAt',
    kind: 'bound',
    action: 'replace',
    tier: 4,
    valueTier: 4,
    label: 'A resize outside 0.25× to 3× is clamped to that range',
    denominator: 'revised pairs'
  }
};

describe('sc.* quality rules', () => {
  it('SC_RULE_IDS lists the six ids', () => {
    expect([...SC_RULE_IDS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const id of Object.keys(EXPECTED) as ScRuleId[]) {
    it(`${id} is registered once with the spec row`, () => {
      const found = QUALITY_RULES.filter((r) => r.id === id);
      expect(found).toHaveLength(1);
      expect(found[0]).toEqual(EXPECTED[id]);
    });
  }

  it('stage-calibration owns exactly the six rules', () => {
    const ids = QUALITY_RULES.filter((r) => r.owner === 'stage-calibration')
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual([...SC_RULE_IDS].sort());
  });

  it('has six rules, one of kind missing, and departs from the kind defaults only at gap-impute', () => {
    expect(SC_RULES).toHaveLength(6);
    expect(SC_RULES.filter((r) => r.kind === 'missing').map((r) => r.id)).toEqual([
      'sc.stages.no-fcd-duration'
    ]);
    expect(kindDefaultDepartures(SC_RULES)).toEqual(['sc.stages.gap-impute']);
  });
});

describe('DATASETS', () => {
  const lock = readFileSync('pipeline/sources.lock.json', 'utf8');
  for (const [name, id] of Object.entries(DATASETS)) {
    it(`${name} (${id}) appears in a lock URL`, () => {
      expect(lock).toMatch(new RegExp(`"url": "https://data\\.sf\\.gov/[^"]*${id}`));
    });
  }

  it('datasf builds the portal URL', () => {
    const d = datasf('permits');
    expect(d.url).toBe('https://data.sf.gov/d/i98e-djp9');
    expect(d.label.length).toBeGreaterThan(0);
  });
});
