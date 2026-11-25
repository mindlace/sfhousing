// G2 (contracts stub): units by kind. game-core makes it real.
import type { Units } from './state';

export function credit(_a: Units, _b: Units): Units {
  throw new Error('not implemented');
}

export function affords(_have: Units, _price: Units): boolean {
  throw new Error('not implemented');
}

export function spend(_have: Units, _price: Units): Units {
  throw new Error('not implemented');
}

export function shortBy(_have: Units, _price: Units): Units {
  throw new Error('not implemented');
}

export function total(_u: Units): number {
  throw new Error('not implemented');
}
