import { describe, expect, it } from 'vitest';
import { RUNGS } from '../ladder';
import * as w from './words';
import * as m from './motion';

it('units', () => {
  expect(w.unitsName(1)).toBe('1 unit');
  expect(w.unitsName(1240)).toBe('1,240 units');
  expect(w.priceText(900)).toBe('◆ 900');
  expect(w.priceText(0)).toBe('Free');
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
it('the opening card', () => {
  expect(w.roomMet(82069)).toBe('Room for 82,069 homes');
  expect(w.OPENING_LINES).toEqual([
    'Next, play the forecast under today’s law.',
    'The month it reaches the goal is your date to beat.'
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
});
it('the durations', () => {
  expect([m.ROLL_MS, m.MET_MS]).toEqual([400, 1200]);
});
describe('wording', () => {
  it('no text has 12 words or more', () => {
    const allTexts: string[] = [
      ...(Object.values(w) as unknown[]).filter((v): v is string => typeof v === 'string'),
      ...w.OPENING_LINES,
      w.unitsName(1240),
      w.priceText(900),
      w.goalLine(61400, 82069, 'Dec 2055'),
      w.goalLine(null, 82069, 'Dec 2055'),
      w.unlocksText('Height near transit'),
      w.sideMetText(2),
      w.progressText(600, 1000),
      w.goalMetLive(82069, 'Dec 2055'),
      w.sideMetLive('1,000 homes added'),
      w.roomMet(82069),
      w.entryStage('opening', 0),
      w.entryStage('runs', 1),
      w.renameName('Game, 4 Mar'),
      w.deleteName('Game, 4 Mar'),
      w.deleteAsk('Game, 4 Mar')
    ];
    expect(allTexts.length).toBeGreaterThan(20);
    for (const t of allTexts) expect(t.split(/\s+/).filter(Boolean).length).toBeLessThan(12);
  });
});
