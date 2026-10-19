import { describe, expect, it } from 'vitest';
import {
  EXIT_LABEL,
  PATHWAY_LABEL,
  TIER_LABEL,
  enteredLabel,
  inStageLabel,
  masterEnteredLabel
} from './labels';

describe('stage labels', () => {
  const rows: [string, string, string][] = [
    ['preApplication', 'Pre-application meeting requested', 'Pre-application'],
    ['filed', 'Planning application filed', 'In Planning review'],
    ['entitled', 'Planning approval', 'Approved, building permit not yet filed'],
    ['permitFiled', 'Building permit filed', 'Building permit review'],
    ['permitIssued', 'Building permit issued', 'Permit issued, not started'],
    ['construction', 'Construction started', 'Under construction'],
    ['complete', 'Completed', 'Completed']
  ];

  it.each(rows)('labels %s', (stage, entered, inStage) => {
    expect(enteredLabel(stage)).toBe(entered);
    expect(inStageLabel(stage)).toBe(inStage);
  });

  it('falls back to the stage id so new stages still render', () => {
    expect(inStageLabel('designReview')).toBe('designReview');
    expect(enteredLabel('designReview')).toBe('designReview');
    expect(masterEnteredLabel('designReview')).toBe('designReview');
  });

  it('prefixes master-plan context rows', () => {
    expect(masterEnteredLabel('entitled')).toBe('Master plan approved');
    expect(masterEnteredLabel('filed')).toBe('Master plan application filed');
    expect(masterEnteredLabel('preApplication')).toBe(
      'Master plan pre-application meeting requested'
    );
  });
});

describe('pathway, exit and tier labels', () => {
  it('labels pathways', () => {
    expect(PATHWAY_LABEL).toEqual({
      discretionary: 'Discretionary review (Planning Commission or similar)',
      streamlined: "Streamlined approval (state law or the plan's Local Program)",
      permitOnly: 'Building permit only'
    });
  });

  it('labels exits', () => {
    expect(EXIT_LABEL).toEqual({
      withdrawn: 'withdrawn',
      disapproved: 'disapproved',
      cancelled: 'cancelled',
      expired: 'permit expired'
    });
  });

  it('labels tiers', () => {
    expect(TIER_LABEL).toEqual({
      0: 'San Francisco project records',
      1: 'Official published totals',
      2: 'Inferred from San Francisco records',
      3: 'Research or literature, not SF records',
      4: 'Assumption, not data'
    });
  });
});
