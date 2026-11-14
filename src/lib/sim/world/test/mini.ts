import type { SimInput } from '$lib/sim/scenario/types';
import { goldenInput } from '$lib/sim/scenario/simulate.golden.cases';

let memo: SimInput | null = null;

/** The mini city's FZP input without public money. Browser-safe. */
export function miniInput(): SimInput {
  if (!memo) {
    const { finance: _finance, ...rest } = goldenInput();
    void _finance;
    memo = rest;
  }
  return memo;
}
