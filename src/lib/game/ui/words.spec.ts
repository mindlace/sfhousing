import { describe, expect, it } from 'vitest';
import * as w from './words';
import * as m from './motion';

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
  expect(w.entryStage('runs', 0)).toBe('Current law');
  expect(w.entryStage('runs', 2)).toBe('Round 2');
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
      w.roomMet(82069),
      w.entryStage('opening', 0),
      w.entryStage('runs', 1),
      w.renameName('Game, 4 Mar'),
      w.deleteName('Game, 4 Mar'),
      w.deleteAsk('Game, 4 Mar')
    ];
    expect(allTexts.length).toBeGreaterThan(10);
    for (const t of allTexts) expect(t.split(/\s+/).filter(Boolean).length).toBeLessThan(12);
  });
});
