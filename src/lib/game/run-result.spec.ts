import { describe, expect, it } from 'vitest';
import { readRun, resultOf, settle } from './run-result';

describe('run-result', () => {
  it('readRun throws until game-core writes it', () => {
    expect(() => readRun({} as never, {} as never)).toThrow('not implemented');
  });

  it('resultOf throws until game-core writes it', () => {
    expect(() => resultOf({} as never, {} as never, {} as never, {} as never, {} as never)).toThrow(
      'not implemented'
    );
  });

  it('settle throws until game-core writes it', () => {
    expect(() => settle({} as never, {} as never)).toThrow('not implemented');
  });
});
