// The funding notices on load (funding-ui spec 4.15) and the R22 and R24 caveats.
import { describe, expect, it } from 'vitest';
import { dayOf } from '$lib/sim/scenario/dates';
import { MONTH_OFFER_CAVEAT, fundingNotices, smallProjectsCaveat } from './funding-copy';
import type { FundingLoadReport } from './funding-reconcile';

const empty: FundingLoadReport = {
  upgradedFrom: null,
  droppedScales: [],
  droppedProgrammes: [],
  unusable: false
};
const prog = (over: Partial<FundingLoadReport['droppedProgrammes'][number]>) => ({
  id: 'u-prog-1',
  label: 'Grant to homes',
  pool: 'city-x',
  reason: 'pool' as const,
  term: null,
  ...over
});

describe('fundingNotices', () => {
  it('empty report: no notices', () => {
    expect(fundingNotices(empty)).toEqual([]);
  });

  it('upgradedFrom 2', () => {
    expect(fundingNotices({ ...empty, upgradedFrom: 2 })).toEqual([
      {
        id: 'funding-added',
        text: "This policy was saved before public money could be added. It opens with today's public funding and nothing added.",
        tone: 'info'
      }
    ]);
  });

  it('dropped scale', () => {
    const [n] = fundingNotices({
      ...empty,
      droppedScales: [{ pool: 'state-x', from: dayOf(2028, 7, 1) }]
    });
    expect(n.id).toBe('funding-dropped');
    expect(n.text).toBe(
      "Some changes to public money didn't fit the data this simulation runs on and were removed."
    );
    expect(n.details).toEqual([
      'Change to state-x from July 2028: removed (this data has no such source)'
    ]);
    expect(n.tone).toBe('info');
  });

  it('programme dropped for its pool', () => {
    const [n] = fundingNotices({ ...empty, droppedProgrammes: [prog({})] });
    expect(n.details).toEqual([
      "Grant to homes: removed (it pays from city-x, which this data doesn't have)"
    ]);
  });

  it('programme dropped for its term', () => {
    const [n] = fundingNotices({
      ...empty,
      droppedProgrammes: [prog({ reason: 'term', term: 'guaranteeRateCut', label: 'Guarantee' })]
    });
    expect(n.details).toEqual([
      'Guarantee: removed (it needs guarantee rate cut, which has no source and no value you typed)'
    ]);
  });

  it('scales come first, then programmes; details are deduplicated', () => {
    const s = { pool: 'state-x', from: dayOf(2028, 7, 1) };
    const [n] = fundingNotices({
      ...empty,
      droppedScales: [s, s],
      droppedProgrammes: [prog({}), prog({})]
    });
    expect(n.details).toHaveLength(2);
    expect(n.details?.[0]).toContain('Change to state-x');
  });

  it('unusable', () => {
    expect(fundingNotices({ ...empty, unusable: true })).toEqual([
      {
        id: 'funding-off',
        text: "This data can't simulate public money, so your changes to it are kept but not used.",
        tone: 'info'
      }
    ]);
  });

  it('all three, in the order added, dropped, off', () => {
    const ids = fundingNotices({
      upgradedFrom: 2,
      droppedScales: [{ pool: 'a', from: dayOf(2028, 7, 1) }],
      droppedProgrammes: [],
      unusable: true
    }).map((n) => n.id);
    expect(ids).toEqual(['funding-added', 'funding-dropped', 'funding-off']);
  });

  it('smallProjectsCaveat and MONTH_OFFER_CAVEAT text', () => {
    expect(smallProjectsCaveat(20)).toBe(
      "Today's funding pays only for affordable projects of 20 homes or more, so smaller affordable projects get none of it and the simulation counts too few of them. A programme you add for smaller projects can reach them."
    );
    expect(MONTH_OFFER_CAVEAT).toBe(
      "A partly funded project keeps the offer it had on the first day of its month, so for up to about a month it can still draw on a source you switched off, or a programme that ended, during that month. Fully funded projects and today's funding as it stands are not affected."
    );
  });
});
