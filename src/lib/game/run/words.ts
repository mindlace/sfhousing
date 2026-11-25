// src/lib/game/run/words.ts
import type { RunTake } from '../run-result';
import { total } from '../units';

const fmt = (n: number): string => n.toLocaleString('en-US');

export function runOverText(take: RunTake): string {
  return `Run over. ${fmt(total(take.collected))} of ${fmt(total(take.dropped))} homes collected.`;
}

export function dropCountText(homes: number): string {
  return `+${fmt(homes)}`;
}
