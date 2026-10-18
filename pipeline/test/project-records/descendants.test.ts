import { describe, expect, it } from 'vitest';
import type { ParcelId } from '../../../src/lib/data/parcel';
import { descendantsIndex, type ParcelAttrsRow } from '../../project-records/descendants';

/** An attrs row; `added` / `dropped` are ISO days, absent = null. */
function attrs(
  blklot: string,
  o: { active: boolean | null; mapblklot?: string | null; added?: string; dropped?: string }
): ParcelAttrsRow {
  return {
    blklot,
    mapblklot: o.mapblklot === undefined ? blklot : o.mapblklot,
    active: o.active,
    added: o.added ?? null,
    dropped: o.dropped ?? null
  };
}

function index(
  rows: ParcelAttrsRow[],
  o: { parcelIds?: Iterable<ParcelId>; lineage?: Record<string, ParcelId> } = {}
) {
  const active = rows.filter((r) => r.active === true && r.mapblklot !== null);
  const parcelIds = new Set<ParcelId>(o.parcelIds ?? active.map((r) => r.mapblklot as string));
  const lineage = o.lineage ?? {};
  return descendantsIndex(rows, {
    parcelIds,
    lineage: (b) => lineage[b] ?? null
  });
}

describe('descendantsIndex (Ruling D1, revised: the subdivision chain in src_parcel_attrs)', () => {
  it('follows a two-generation chain to its active lots, plus the root lineage', () => {
    // A dropped d1 -> B (retired, dropped d2) and C (active); B -> D and E (active).
    const rows = [
      attrs('3180190', { active: false, dropped: '2022-12-20' }), // A
      attrs('3180199', { active: false, added: '2022-12-20', dropped: '2025-07-02' }), // B
      attrs('3180200', { active: true, added: '2022-12-20' }), // C
      attrs('3180204', { active: true, added: '2025-07-02' }), // D
      attrs('3180205', { active: true, added: '2025-07-02' }), // E
      // Same day, other block; same block, other day: neither descends from A.
      attrs('3181001', { active: true, added: '2022-12-20' }),
      attrs('3180206', { active: true, added: '2021-01-01' }),
      attrs('3180100', { active: true })
    ];
    const d = index(rows, { lineage: { '3180190': '3180100', '3180199': '3180206' } });
    expect(d('3180190')).toEqual(['3180100', '3180200', '3180204', '3180205']);
    // B's own lineage is not added when B is reached through the chain.
    expect(d('3180199')).toEqual(['3180204', '3180205', '3180206']);
  });

  it('matches the live 3180190 shape: only the lots added on its drop day', () => {
    const rows = [attrs('3180190', { active: false, dropped: '2022-12-20' })];
    for (let lot = 199; lot <= 203; lot++) {
      rows.push(attrs(`3180${lot}`, { active: true, added: '2022-12-20' }));
    }
    // 3180204..3180214 came on 2025-07-02, when no descendant of 3180190 was dropped.
    for (let lot = 204; lot <= 214; lot++) {
      rows.push(attrs(`3180${lot}`, { active: true, added: '2025-07-02' }));
    }
    const d = index(rows);
    expect(d('3180190')).toEqual(['3180199', '3180200', '3180201', '3180202', '3180203']);
  });

  it('gives an active tracking lot its own mapblklot only', () => {
    const rows = [
      attrs('0708023', { active: true, mapblklot: '0708021', added: '2010-01-01' }),
      attrs('0708021', { active: true, added: '2010-01-01' })
    ];
    expect(index(rows)('0708023')).toEqual(['0708021']);
  });

  it('yields only the lineage mapping for a lot with no dates or no attrs row', () => {
    const rows = [
      attrs('3512099', { active: false }),
      attrs('3512012', { active: true, added: '2024-06-30' })
    ];
    const d = index(rows, { lineage: { '3512099': '3512012', '3512098': '3512012' } });
    expect(d('3512099')).toEqual(['3512012']);
    expect(d('3512098')).toEqual(['3512012']);
    expect(d('3512097')).toEqual([]);
  });

  it('keeps a retired lot reached in the chain with no drop date by its lineage', () => {
    const rows = [
      attrs('3180190', { active: false, dropped: '2022-12-20' }),
      attrs('3180199', { active: false, added: '2022-12-20' }),
      attrs('3180200', { active: true })
    ];
    const d = index(rows, { lineage: { '3180199': '3180200' } });
    expect(d('3180190')).toEqual(['3180200']);
  });

  it('treats a null active as retired, and blocks with a letter suffix', () => {
    const rows = [
      attrs('0026T001', { active: null, dropped: '2020-05-01' }),
      attrs('0026T001A', { active: true, added: '2020-05-01' }),
      attrs('0026002', { active: true, added: '2020-05-01' })
    ];
    expect(index(rows)('0026T001')).toEqual(['0026T001A']);
  });

  it('is sorted, unique, inside parcelIds, and terminates on a cycle', () => {
    const rows = [
      attrs('3180190', { active: false, added: '2023-01-01', dropped: '2022-12-20' }),
      attrs('3180199', { active: false, added: '2022-12-20', dropped: '2023-01-01' }),
      attrs('3180201', { active: true, mapblklot: '3180200', added: '2022-12-20' }),
      attrs('3180202', { active: true, mapblklot: '3180200', added: '2022-12-20' }),
      attrs('3180203', { active: true, added: '2023-01-01' })
    ];
    const d = index(rows, { parcelIds: ['3180200'] });
    expect(d('3180190')).toEqual(['3180200']);
    expect(d('3180199')).toEqual(['3180200']);
  });

  it('does not depend on row order; a duplicate blklot keeps its active row', () => {
    const rows = [
      attrs('3180190', { active: false, dropped: '2022-12-20' }),
      attrs('3180199', { active: true, added: '2022-12-20' }),
      attrs('3180199', { active: false, added: '2022-12-20', dropped: '2024-01-01' }),
      attrs('3180200', { active: true, added: '2024-01-01' })
    ];
    const fwd = index(rows)('3180190');
    expect(fwd).toEqual(['3180199']);
    expect(index([...rows].reverse())('3180190')).toEqual(fwd);
  });
});
