import { expect, it } from 'vitest';
import { mostPermissive } from './stock-layers';

it('picks the larger hostable layer; a tie or a non-hostable b keeps a', () => {
  expect(mostPermissive({ top: 10, hostable: true }, { top: 11, hostable: true })).toBe('b');
  expect(mostPermissive({ top: 10, hostable: true }, { top: 10, hostable: true })).toBe('a');
  expect(mostPermissive({ top: 0, hostable: false }, { top: 5, hostable: true })).toBe('b');
  expect(mostPermissive({ top: 3, hostable: true }, { top: 99, hostable: false })).toBe('a');
});
