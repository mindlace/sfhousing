import { describe, expect, it } from 'vitest';
import { affords, credit, shortBy, spend, total } from './units';

describe('units', () => {
  it('credit throws until game-core writes it', () => {
    expect(() => credit({} as never, {} as never)).toThrow('not implemented');
  });

  it('affords throws until game-core writes it', () => {
    expect(() => affords({} as never, {} as never)).toThrow('not implemented');
  });

  it('spend throws until game-core writes it', () => {
    expect(() => spend({} as never, {} as never)).toThrow('not implemented');
  });

  it('shortBy throws until game-core writes it', () => {
    expect(() => shortBy({} as never, {} as never)).toThrow('not implemented');
  });

  it('total throws until game-core writes it', () => {
    expect(() => total({} as never)).toThrow('not implemented');
  });
});
