import { fnv1a32, mulberry32 } from './seed';
import type { CompositionDraws, CompositionId } from './composition-types';
export function drawComposition(seed: number): CompositionDraws {
  const stream = (name: string) => mulberry32(fnv1a32('composition:' + name + ':' + seed));
  const family = stream('family');
  const proportions = stream('proportions');
  const roof = stream('roof');
  const tone = stream('tone');
  const familyOrder: CompositionId[] = [
    'simple',
    'terrace',
    'divided',
    'slab',
    'shouldered',
    'offset',
    'paired'
  ];
  for (let i = familyOrder.length - 1; i > 0; i--) {
    const j = Math.floor(family() * (i + 1));
    [familyOrder[i], familyOrder[j]] = [familyOrder[j], familyOrder[i]];
  }
  return {
    familyOrder,
    splitFraction: 0.4 + 0.2 * proportions(),
    setbackM: 1.5 + 1.5 * proportions(),
    shoulderFloors: proportions() < 0.5 ? 1 : 2,
    offsetSign: proportions() < 0.5 ? -1 : 1,
    capEnabled: roof() < 0.7,
    tone: Math.floor(tone() * 3) as 0 | 1 | 2
  };
}
