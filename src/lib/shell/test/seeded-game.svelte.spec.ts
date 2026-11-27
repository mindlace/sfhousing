import { describe, expect, it } from 'vitest';
import { parseGameSave } from '$lib/game/save-shape';
import { SAVES_KEY, saveKey } from '$lib/game/saves';
import { NEW_GAME } from '$lib/game/state';
import { quietSync, seededGame } from './seeded-game';

const WON = '2026-11-22T12:00:00.000Z';

describe('seededGame', () => {
  it('builds a new game in the opening, current, stored as a v2 save and indexed', () => {
    const { game, storage } = seededGame();
    expect(game.open).toBe(false);
    expect(game.state).toEqual(NEW_GAME);
    expect(game.saves).toHaveLength(1);
    expect(parseGameSave(JSON.parse(storage.getItem(saveKey(game.currentId))!))).not.toBeNull();
    const index = JSON.parse(storage.getItem(SAVES_KEY)!);
    expect(index).toMatchObject({ v: 2, current: game.currentId });
    expect(index.saves[0]).toMatchObject({ phase: 'opening', round: 0 });
  });

  it('overlays the state asked on NEW_GAME', () => {
    const { game } = seededGame({ state: { phase: 'runs', firstWinAt: WON, round: 2 } });
    expect(game.state).toEqual({
      ...NEW_GAME,
      phase: 'runs',
      firstWinAt: WON,
      round: 2
    });
    expect(game.saves[0]).toMatchObject({ phase: 'runs', round: 2 });
  });

  it('holds 12 games when asked, the others new', () => {
    const { game } = seededGame({ state: { phase: 'runs', firstWinAt: WON }, saves: 12 });
    expect(game.saves).toHaveLength(12);
    expect(game.saves.filter((s) => s.phase === 'opening')).toHaveLength(11);
  });

  it("keeps the record keys as the current game's plan and policy", () => {
    const { game } = seededGame({ plan: 'P', policy: 'Q' });
    expect(game.read(game.currentId)).toMatchObject({ plan: 'P', policy: 'Q' });
  });

  it('quietSync carries the account it is given', () => {
    expect(quietSync({ handle: 'ada', handleClaimed: true }).account?.handle).toBe('ada');
    expect(quietSync().account).toBeNull();
  });
});
