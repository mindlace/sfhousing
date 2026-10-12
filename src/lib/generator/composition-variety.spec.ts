import { expect, it } from 'vitest';
import { drawComposition } from './composition-variety';
it('keeps family identity stable independently of height and other streams', () => {
  const a = drawComposition(42);
  expect(a).toEqual(drawComposition(42));
  expect(new Set(a.familyOrder).size).toBe(7);
  expect(a.splitFraction).toBeGreaterThanOrEqual(0.4);
  expect(a.splitFraction).toBeLessThanOrEqual(0.6);
  expect(a).not.toEqual(drawComposition(43));
});
