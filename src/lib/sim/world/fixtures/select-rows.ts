// Test support: a copy of a ScenarioParcels (and of its option table) with some of its rows, in a
// given order, under given ids. Browser-safe.
import { optionTableOf, type OptionTable } from '$lib/data/option-table';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { BUILDING_FORMS, BUILDING_TYPES, type Option } from '$lib/sim/choice/types';

/** A copy of `t` with rows `rows` of the source, in that order (as `selectRows` takes them). */
export function selectOptionRows(t: OptionTable, rows: readonly number[]): OptionTable {
  return optionTableOf(
    t.datasetVersion,
    rows.map((r) => {
      const options: Option[] = [];
      for (let j = t.offset[r]; j < t.offset[r + 1]; j++) {
        options.push({
          type: BUILDING_TYPES[t.type[j]],
          form: BUILDING_FORMS[t.form[j]],
          stories: t.stories[j],
          homes: t.homes[j],
          plates: t.plates[j]
        });
      }
      return { options, locationValue: t.locationValue[r] };
    })
  );
}

/**
 * A copy of `p` with rows `rows` of the source (in that order) and the given ids: duplicating a
 * row under a new id adds a parcel. Every column is selected by row; `cells` collapses to the
 * single cell `cellOf` names per output row (the engine never reads cells).
 */
export function selectRows(
  p: ScenarioParcels,
  rows: number[],
  ids: string[],
  cellOf: (j: number) => string
): ScenarioParcels {
  const n = rows.length;
  const pick = <
    T extends Float64Array | Float32Array | Uint8Array | Uint16Array | Uint32Array | Int16Array
  >(
    col: T,
    stride: number
  ): T => {
    const out = new (col.constructor as new (n: number) => T)(n * stride);
    for (let j = 0; j < n; j++)
      out.set(col.subarray(rows[j] * stride, (rows[j] + 1) * stride), j * stride);
    return out;
  };
  const cellIds = [...new Set(rows.map((_, j) => cellOf(j)))];
  const cell = new Uint16Array(n);
  for (let j = 0; j < n; j++) cell[j] = cellIds.indexOf(cellOf(j));
  const cells = cellIds.map((cellId, c) => {
    const start = cell.indexOf(c);
    return { cellId, start, count: cell.filter((x) => x === c).length };
  });
  const out: ScenarioParcels = {
    ...p,
    count: n,
    cells,
    id: ids,
    index: new Map(ids.map((id, j) => [id, j])),
    labelPoint: pick(p.labelPoint, 2),
    cell,
    district: pick(p.district, 1),
    envelopeStories: pick(p.envelopeStories, 1),
    baseStories: pick(p.baseStories, 1),
    localProgram: pick(p.localProgram, 1),
    hostable: pick(p.hostable, 1),
    eligible: pick(p.eligible, 1),
    split: pick(p.split, 1),
    imputed: pick(p.imputed, 1),
    baseCap: pick(p.baseCap, 1),
    existingUnits: pick(p.existingUnits, 1),
    existingFloorAreaM2: pick(p.existingFloorAreaM2, 1),
    existingStories: pick(p.existingStories, 1),
    lotAreaM2: pick(p.lotAreaM2, 1),
    yearBuilt: pick(p.yearBuilt, 1),
    improvementShare: pick(p.improvementShare, 1),
    rentControlLikely: pick(p.rentControlLikely, 1),
    landUseClass: pick(p.landUseClass, 1),
    hostableBase: pick(p.hostableBase, 1),
    fzpCap: pick(p.fzpCap, 1)
  };
  // a column added to ScenarioParcels later and not listed above would keep the source's length
  // through `...p` and misalign every row: make that loud
  const columns = (o: object, at: string): [string, ArrayBufferView & { length: number }][] =>
    Object.entries(o).flatMap(([k, v]) =>
      ArrayBuffer.isView(v)
        ? [[`${at}${k}`, v as ArrayBufferView & { length: number }]]
        : v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map)
          ? columns(v, `${at}${k}.`)
          : []
    );
  const src = new Map(columns(p, ''));
  for (const [k, col] of columns(out, '')) {
    const stride = src.get(k)!.length / p.count;
    if (col.length !== n * stride) throw new Error(`selectRows: column ${k} was not selected`);
  }
  return out;
}
