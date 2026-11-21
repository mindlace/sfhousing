import { describe, expect, it } from 'vitest';
import { historyName } from './history';

describe('historyName', () => {
  it('names the change when the store has a label', () => {
    expect(historyName('undo', 'Allowed 8 stories')).toBe('Undo: Allowed 8 stories');
    expect(historyName('redo', 'Erased custom zoning')).toBe('Redo: Erased custom zoning');
  });

  it('is the bare word without one', () => {
    expect(historyName('undo', null)).toBe('Undo');
    expect(historyName('redo', null)).toBe('Redo');
  });
});
