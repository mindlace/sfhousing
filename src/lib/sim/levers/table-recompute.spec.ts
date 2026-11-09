import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { decodeParcelChunk } from '$lib/data/parcel-chunk';
import { readGrossTable } from '$lib/data/gross-table';
import { readScenarioParcels } from '$lib/data/scenario-codec';
import { createTableRecompute, createYieldRecompute } from './recompute';
import type { Need } from './resolve';

const DIR = resolve(process.cwd(), 'e2e/fixtures/data/fixture-0');
const bytes = (p: string) => new Uint8Array(readFileSync(resolve(DIR, p)));

describe('table-backed recompute against the fixture dataset', () => {
  it('table-backed and recompute-backed EnvelopeRows are identical for a sweep of Needs', async () => {
    const parcels = await readScenarioParcels(bytes('scenarios/fzp/parcels.bin'));
    const table = await readGrossTable(bytes('scenarios/fzp/gross.bin'));
    const records = new Map<ParcelId, ParcelRecord>();
    for (const c of parcels.cells) {
      const json = JSON.parse(readFileSync(resolve(DIR, `parcels/${c.cellId}.json`), 'utf8'));
      for (const r of decodeParcelChunk(json)) records.set(r.id, r);
    }
    const needs: Need[] = [];
    for (let row = 0; row < parcels.count; row++) {
      const eu = parcels.existingUnits[row];
      for (const stories of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 40, 79, 80, 81, 255]) {
        for (const cap of [null, 0, eu, eu + 1, 3, 100]) needs.push({ row, stories, cap });
      }
    }
    const now = () => 0;
    const a = createTableRecompute(parcels, needs, table, { now });
    const b = createYieldRecompute(
      parcels,
      needs,
      { record: (id) => records.get(id), cellLoaded: () => true, now },
      new Map()
    );
    expect(a.step(1e9)).toBe(true);
    expect(b.step(1e9)).toBe(true);
    expect(a.result().size).toBeGreaterThan(parcels.count);
    expect(a.result()).toEqual(b.result());
    expect(a.missing).toEqual([]);
    expect(b.missing).toEqual([]);
  });
});
