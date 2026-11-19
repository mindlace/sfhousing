import { describe, expect, it } from 'vitest';
import { CHIP, PILL } from './pill';

const classes = (s: string) => s.split(' ');

describe('pill classes', () => {
  it('the chip is the pill, without presses and with even padding', () => {
    expect(classes(CHIP)).toContain('pointer-events-none');
    expect(classes(CHIP)).toContain('pr-4');
    expect(classes(CHIP)).not.toContain('pointer-events-auto');
    expect(classes(CHIP)).not.toContain('pr-1');
    const look = (s: string) =>
      classes(s).filter((c) => !c.startsWith('pointer-events-') && !/^pr-\d$/.test(c));
    expect(look(CHIP)).toEqual(look(PILL));
  });
});
