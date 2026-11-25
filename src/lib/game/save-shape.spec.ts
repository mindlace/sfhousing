import { describe, expect, it } from 'vitest';
import { parseGameSave } from './save-shape';

describe('save-shape', () => {
  it('parseGameSave throws until game-core writes it', () => {
    expect(() => parseGameSave({} as never)).toThrow('not implemented');
  });
});
