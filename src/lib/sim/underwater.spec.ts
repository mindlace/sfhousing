import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeParcelChunk } from '$lib/data/parcel-chunk';
import { generate } from '$lib/generator';
import { fnv1a32 } from '$lib/generator/seed';
import { createParcelIndex } from '$lib/plan/parcel-index';
import { applyOp } from '$lib/plan/resolve';

const DIR = new URL('../../../e2e/fixtures/data/fixture-0/parcels/', import.meta.url);

function load() {
  const index = createParcelIndex();
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
    index.addChunk(f, decodeParcelChunk(JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))));
  }
  return index;
}

describe('a lot in the Bay (fixture-0)', () => {
  it('builds nothing on it, but does build on the clipped dry lot', () => {
    const index = load();
    const wet = index.get('3512016')!;
    const dry = index.get('3512015')!;
    expect(wet.underwater).toBe(true);
    expect(generate(wet, { maxStories: 6 }, fnv1a32(wet.id), 'max')).toBeNull();
    expect(generate(dry, { maxStories: 6 }, fnv1a32(dry.id), 'max')).not.toBeNull();
  });

  it('reports it as underwater coverage, not ineligible', () => {
    const index = load();
    const path = ['3512015', '3512016'].map((id) => index.get(id)!.labelPoint);
    const op = { kind: 'paint' as const, id: 's', stories: 6, radiusM: 30, path };
    const { coverage } = applyOp(new Map(), op, index);
    expect(coverage.underwater).toEqual(['3512016']);
    expect(coverage.eligible).toContain('3512015');
    expect(coverage.ineligible).toEqual([]);
  });
});
