import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePlan, serializePlan } from '$lib/plan';
const text = readFileSync(fileURLToPath(new URL('./small.json', import.meta.url)), 'utf8');
describe('plan fixture small.json', () => {
  it('validates and is canonical (byte-for-byte round trip)', () => {
    const r = parsePlan(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ops).toHaveLength(3);
    expect(r.value.datasetVersion).toBe('fixture-0');
    expect(r.value.ops.every((o) => Number.isInteger(o.radiusM))).toBe(true);
    expect(serializePlan(r.value)).toBe(text);
  });
});
