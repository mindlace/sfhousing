import { describe, expect, it } from 'vitest';
import { applyGrant, GAME_TRANSIT_ID } from './grant';

describe('grant', () => {
  it('names the game transit', () => {
    expect(GAME_TRANSIT_ID).toBe('game-transit');
  });

  it('applyGrant throws until tree-catalogue writes it', () => {
    expect(() => applyGrant({} as never, {} as never, {} as never)).toThrow('not implemented');
  });
});
