import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { fnv1a32, generateForUnits, normaliseSite } from '../../src/lib/generator';
import { assembleSite } from '../../src/lib/generator/assemble';
import { domainArea } from '../../src/lib/generator/domain';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { writeChunks } from '../steps/chunks';
import { miniDuck } from './helpers';

// Two adjacent parcels in block 3512 of the mini fixture. Found by decoding every chunk and
// testing same-block pairs (same first 4 characters of id) for a shared edge: after re-framing
// one ring into the other's local frame with frameOffset, at least 2 vertices lie within 0.05 m
// of the other's boundary. Both are single-ring parcels (3512005 and 3512006 have two). 3512010
// (299.7 m2) is the smaller and has the lower id, so the larger-area anchor (3512011, 300 m2) is
// not the first id in sort order.
const SMALL_ID = '3512010';
const LARGE_ID = '3512011';

describe('assembleSite on real pipeline-quantised chunks', () => {
  let a: ParcelRecord;
  let b: ParcelRecord;
  beforeAll(async () => {
    const db = await miniDuck();
    await runSql(db);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-assembly-'));
    const outs = await writeChunks(db, dir, 'fixture-1', new Report());
    const byId = new Map<string, ParcelRecord>();
    for (const o of outs) {
      for (const r of decodeParcelChunk(fs.readFileSync(path.join(dir, o.path), 'utf8'))) {
        byId.set(r.id, r);
      }
    }
    a = byId.get(SMALL_ID)!;
    b = byId.get(LARGE_ID)!;
  });

  it('two adjacent mini-fixture parcels assemble into one component', () => {
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const assembled = assembleSite([a, b]);
    expect(assembled).not.toBeNull();
    expect(assembled!.polygon).toHaveLength(1);

    const site = normaliseSite(assembled!.polygon, 0.4);
    expect(site).not.toBeNull();
    expect(Math.abs(domainArea(site!.originalDomain) - (a.areaM2 + b.areaM2))).toBeLessThan(0.5);

    const building = generateForUnits([a, b], 4, 80, fnv1a32('mini-assembly'));
    expect(building).not.toBeNull();
    expect(building!.parcelId).toBe(a.areaM2 >= b.areaM2 ? a.id : b.id);
    expect(building!.parcelId).toBe(LARGE_ID);
  });
});
