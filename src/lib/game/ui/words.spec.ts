import { describe, expect, it } from 'vitest';
import { STAGE_KEY } from '$lib/map/key/rows';
import { dayFromUtc } from '$lib/fzp/time';
import { RUNGS } from '../ladder';
import * as w from './words';
import * as m from './motion';

it('units', () => {
  expect(w.unitsName(1)).toBe('1 unit');
  expect(w.unitsName(1240)).toBe('1,240 units');
  expect(w.priceText(900)).toBe('◆ 900');
  expect(w.priceText(0)).toBe('Free');
  expect(w.shortText(298)).toBe('298 short');
});
it('the goal headline', () => {
  expect(w.goalLine(61400, 82069, 'Dec 2055')).toBe('61,400 of 82,069 homes by Dec 2055');
  expect(w.goalLine(null, 82069, 'Dec 2055')).toBe('82,069 homes by Dec 2055');
  expect(w.HOMES_WORD).toBe(' homes');
  expect(w.unlocksText('Height near transit')).toBe('Unlocks: Height near transit');
  expect(w.sideMetText(1)).toBe('1 side goal met');
  expect(w.sideMetText(2)).toBe('2 side goals met');
  expect(w.progressText(600, 1000)).toBe('600 of 1,000');
  expect(w.goalMetLive(82069, 'Dec 2055')).toBe('Goal met: 82,069 homes by Dec 2055');
  expect(w.sideMetLive('1,000 homes added')).toBe('Side goal met: 1,000 homes added');
  expect(w.GOAL_MET).toBe('Goal met');
  expect(w.LAST_GOAL).toBe('Last goal');
  expect(w.SIDE_GOALS_TITLE).toBe('Side goals');
  expect(w.NO_SIDE_GOALS).toBe('None open');
  expect(w.MET).toBe('Met');
});
it('the tally', () => {
  expect(w.tallyTitle(dayFromUtc(2049, 3, 15), 'Dec 2055')).toBe('Goal met in Mar 2049');
  expect(w.tallyTitle(null, 'Dec 2055')).toBe('By Dec 2055');
  expect(w.homesOfText(61400, 82069)).toBe('61,400 of 82,069 homes');
  expect(w.changeText(3150)).toBe('+3,150');
  expect(w.changeText(-3150)).toBe('−3,150');
  expect(w.changeText(0)).toBe('No change');
  expect(w.collectedText(7300, 9100)).toBe('7,300 of 9,100 collected');
  expect(w.lumpText(2000)).toBe('+2,000 for the goal');
  expect(w.sideRewardText(500, '1,000 homes added')).toBe('+500 for 1,000 homes added');
  expect(w.notBuiltTitle('Dec 2055')).toBe('Not yet built by Dec 2055');
  expect(w.SIDE_GOAL_FALLBACK).toBe('a side goal');
  expect(w.WAITING_MONEY).toBe('Waiting for money');
  expect(w.CONTINUE).toBe('Continue');
});
it('STAGE_ROWS are the first four rows of STAGE_KEY', () => {
  expect(w.STAGE_ROWS).toEqual(
    STAGE_KEY.slice(0, 4).map(({ id, label, stages }) => ({ id, label, stages }))
  );
});
it('the tree', () => {
  expect(w.BRANCH_NAMES).toEqual({
    permitting: 'Permitting',
    zoning: 'Zoning',
    money: 'Public money',
    hands: 'Hands'
  });
  expect(w.buyText(900)).toBe('Buy · ◆ 900');
  expect(w.buyText(0)).toBe('Buy · Free');
  expect(w.editName('SB 423 clock')).toBe('Edit SB 423 clock');
  expect(w.switchName('SB 423 clock')).toBe('SB 423 clock on');
  expect(w.nextStepText('8 stories')).toBe('Next: 8 stories');
  expect(w.nextPriceText(420)).toBe('next ◆ 420');
  expect(w.boughtLive('Near BART', '8 stories')).toBe('Bought: Near BART, 8 stories');
  expect(w.balanceText(1652)).toBe('◆ 1,652 to spend');
  expect(w.balanceName(1)).toBe('1 unit to spend');
  expect(w.balanceName(1652)).toBe('1,652 units to spend');
  expect(w.takeNextText('Dec 2050')).toBe('Take the next goal: Dec 2050');
  expect(w.endingReached(dayFromUtc(2041, 3, 1))).toBe('Reached in Mar 2041');
  expect(w.endingState(dayFromUtc(2031, 1, 31))).toBe('The state asks by Jan 2031');
  expect(w.perAddedHomeText(123456)).toBe('Public money per added home: $123,456');
  expect(w.TREE_TITLE).toBe('Levers');
  expect(w.CURRENT_LAW).toBe('Current law');
  expect(w.BOUGHT).toBe('Bought');
  expect(w.EDIT).toBe('Edit');
  expect(w.ON).toBe('On');
  expect(w.OFF).toBe('off');
  expect(w.SOURCE).toBe('Source');
  expect(w.RUN).toBe('Run');
  expect(w.RUN_BUSY).toBe('Getting the forecast ready');
  expect(w.ENDING_TITLE).toBe('Every goal met');
  expect(w.ENDING_LEVERS).toBe('Levers bought');
  expect(w.ENDING_LIFTED).toBe('Every limit is lifted.');
  expect(w.PUBLISH).toBe('Publish');
});
it('the opening card', () => {
  expect(w.roomMet(82069)).toBe('Room for 82,069 homes');
  expect(w.OPENING_LINES).toEqual([
    'Next, the forecast plays today’s law to the deadline.',
    'Sweep over homes as they finish to collect them.'
  ]);
  expect(w.START).toBe('Start');
});
it('the game panel', () => {
  expect(w.entryStage('opening', 0)).toBe('Painting');
  expect(w.entryStage('runs', 1)).toBe(`Goal 2 of ${RUNGS}`);
  expect(w.renameName('Game, 4 Mar')).toBe('Rename Game, 4 Mar');
  expect(w.deleteName('Game, 4 Mar')).toBe('Delete Game, 4 Mar');
  expect(w.deleteAsk('Game, 4 Mar')).toBe('Delete Game, 4 Mar?');
  expect(w.PLAYING).toBe('Playing');
  expect(w.SAVED_GAMES).toBe('Saved games');
  expect(w.NEW_GAME_LABEL).toBe('New game');
  expect(w.NAME_LABEL).toBe('Name');
  expect(w.RENAME).toBe('Rename');
  expect(w.DELETE).toBe('Delete');
  expect(w.CANCEL).toBe('Cancel');
  expect(w.SOUND).toBe('Sound');
  expect(w.COLLECT_FOR_ME).toBe('Collect for me');
  expect(w.COLLECT_BOUGHT).toBe('Always on: bought');
});
it('the durations', () => {
  expect([m.ROLL_MS, m.TALLY_ROLL_MS, m.MET_MS, m.REVEAL_MS]).toEqual([400, 800, 1200, 300]);
});
describe('wording', () => {
  it('no text has 12 words or more', () => {
    const allTexts: string[] = [
      ...(Object.values(w) as unknown[]).filter((v): v is string => typeof v === 'string'),
      ...w.OPENING_LINES,
      ...w.STAGE_ROWS.map((r) => r.label),
      ...Object.values(w.BRANCH_NAMES),
      w.unitsName(1240),
      w.priceText(900),
      w.shortText(298),
      w.goalLine(61400, 82069, 'Dec 2055'),
      w.goalLine(null, 82069, 'Dec 2055'),
      w.unlocksText('Height near transit'),
      w.sideMetText(2),
      w.progressText(600, 1000),
      w.goalMetLive(82069, 'Dec 2055'),
      w.sideMetLive('1,000 homes added'),
      w.tallyTitle(dayFromUtc(2049, 3, 15), 'Dec 2055'),
      w.tallyTitle(null, 'Dec 2055'),
      w.homesOfText(61400, 82069),
      w.changeText(3150),
      w.changeText(-3150),
      w.changeText(0),
      w.collectedText(7300, 9100),
      w.lumpText(2000),
      w.sideRewardText(500, '1,000 homes added'),
      w.notBuiltTitle('Dec 2055'),
      w.buyText(900),
      w.buyText(0),
      w.editName('SB 423 clock'),
      w.switchName('SB 423 clock'),
      w.nextStepText('8 stories'),
      w.nextPriceText(420),
      w.boughtLive('Near BART', '8 stories'),
      w.balanceText(1652),
      w.balanceName(1652),
      w.takeNextText('Dec 2050'),
      w.endingReached(dayFromUtc(2041, 3, 1)),
      w.endingState(dayFromUtc(2031, 1, 31)),
      w.perAddedHomeText(123456),
      w.roomMet(82069),
      w.entryStage('opening', 0),
      w.entryStage('runs', 1),
      w.renameName('Game, 4 Mar'),
      w.deleteName('Game, 4 Mar'),
      w.deleteAsk('Game, 4 Mar')
    ];
    expect(allTexts.length).toBeGreaterThan(40);
    for (const t of allTexts) expect(t.split(/\s+/).filter(Boolean).length).toBeLessThan(12);
  });
});
