import { describe, expect, it } from 'vitest';
import { roundComplete } from '$lib/game/progress';
import { parseGameSave, saveKey } from '$lib/game/saves';
import { quietSync, seededGame } from './seeded-game';

describe('seededGame', () => {
  it('builds a stored game at the level asked, current and parseable', () => {
    const { game, storage } = seededGame({ level: 3 });
    expect(game.open).toBe(false);
    expect(game.progress.level).toBe(3);
    expect(game.saves).toHaveLength(1);
    expect(parseGameSave(JSON.parse(storage.getItem(saveKey(game.currentId))!))).not.toBeNull();
  });

  it('holds 12 games when asked', () => {
    expect(seededGame({ level: 1, saves: 12 }).game.saves).toHaveLength(12);
  });

  it('completes the round when asked', () => {
    expect(roundComplete(seededGame({ level: 5, roundComplete: true }).game.progress)).toBe(true);
  });

  it("keeps the record keys as the current game's plan and policy", () => {
    const { game } = seededGame({ level: 1, plan: 'P', policy: 'Q' });
    expect(game.read(game.currentId)).toMatchObject({ plan: 'P', policy: 'Q' });
  });

  it('quietSync carries the account it is given', () => {
    expect(quietSync({ handle: 'ada', handleClaimed: true }).account?.handle).toBe('ada');
    expect(quietSync().account).toBeNull();
  });
});
