// Spec 4.10.2 phase-size medians read new-construction permits only (Ruling L1, review M3).
import { describe, expect, it } from 'vitest';
import { completedUnits } from '../../project-records/assemble';
import type { LinkedProject, Permit } from '../../project-records/types';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

function permit(number: string, over: Partial<Permit>): Permit {
  return {
    number,
    type: '2',
    named: false,
    sitePermit: true,
    status: 'complete',
    statusDay: null,
    filedDay: null,
    issuedDay: null,
    fcdDay: null,
    completedDateDay: d('2018-05-01'),
    lastActivityDay: null,
    stories: null,
    existingUnits: null,
    proposedUnits: 60,
    valuation: null,
    rows: [],
    ...over
  };
}

describe('completedUnits', () => {
  it('counts completed type 1/2 permits and skips named alterations', () => {
    const proj = {
      permits: [permit('1', {}), permit('2', { type: '3', named: true, proposedUnits: 200 })],
      completions: []
    } as unknown as LinkedProject;
    expect(completedUnits([proj])).toEqual([60]);
  });
});
