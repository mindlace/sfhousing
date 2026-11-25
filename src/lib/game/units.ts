import { UNIT_KINDS, type UnitKind, type Units } from './state';

const amount = (u: Units, k: UnitKind): number => u[k] ?? 0;
const has = (u: Units, k: UnitKind): boolean => u[k] !== undefined;

export function credit(a: Units, b: Units): Units {
  const out: Units = {};
  for (const k of UNIT_KINDS) if (has(a, k) || has(b, k)) out[k] = amount(a, k) + amount(b, k);
  return out;
}

export function affords(have: Units, price: Units): boolean {
  return UNIT_KINDS.every((k) => amount(have, k) >= amount(price, k));
}

export function spend(have: Units, price: Units): Units {
  if (!affords(have, price)) throw new RangeError('Not enough units');
  const out: Units = {};
  for (const k of UNIT_KINDS) {
    if (has(have, k) || has(price, k)) out[k] = amount(have, k) - amount(price, k);
  }
  return out;
}

export function shortBy(have: Units, price: Units): Units {
  const out: Units = {};
  for (const k of UNIT_KINDS) {
    const d = amount(price, k) - amount(have, k);
    if (d > 0) out[k] = d;
  }
  return out;
}

export function total(u: Units): number {
  let t = 0;
  for (const k of UNIT_KINDS) t += amount(u, k);
  return t;
}
