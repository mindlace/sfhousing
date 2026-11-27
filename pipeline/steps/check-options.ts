// V36 (option rows), V40 (type story ranges) and V41 (location values) over
// `scenarios/fzp/options.bin` (building-choice plan, Task 7). Kept out of check.ts beside the other
// per-file checks; checkDataset calls checkOptions after V33.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { Manifest } from '../../src/lib/data/manifest';
import {
  decodeOptionPayload,
  encodeOptionPayload,
  OPTIONS_MAX_PER_LOT,
  optionTableProblem,
  type OptionTable
} from '../../src/lib/data/option-table';
import type { ParcelId, ParcelRecord } from '../../src/lib/data/parcel';
import { scenarioRecordOf, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { fnv1a32 } from '../../src/lib/generator';
import { candidatesOf, pruneOptions } from '../../src/lib/sim/choice/options';
import {
  BUILDING_FORMS,
  BUILDING_TYPES,
  TYPE_STORIES,
  type Option
} from '../../src/lib/sim/choice/types';
import { OPTIONS_BIN } from '../lib/scenario-files';
import type { InvariantResult } from './check';

/** V36 regenerates every OPTIONS_CHECK_STRIDE-th row (every row of a table of at most 2000). */
export const OPTIONS_CHECK_STRIDE = 251;
const CHECK_ALL_MAX = 2000;
const HOMES_MAX = 0xffff;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Row `i` of `t` as options. */
export function optionsOf(t: OptionTable, i: number): Option[] {
  const out: Option[] = [];
  for (let j = t.offset[i]; j < t.offset[i + 1]; j++) {
    out.push({
      type: BUILDING_TYPES[t.type[j]],
      form: BUILDING_FORMS[t.form[j]],
      stories: t.stories[j],
      plates: t.plates[j],
      homes: t.homes[j]
    });
  }
  return out;
}

/** The first out-of-order pair of a row: (stories, type code, form code) must strictly rise. */
function unsorted(t: OptionTable, i: number): number | null {
  for (let j = t.offset[i] + 1; j < t.offset[i + 1]; j++) {
    const d =
      t.stories[j] - t.stories[j - 1] || t.type[j] - t.type[j - 1] || t.form[j] - t.form[j - 1];
    if (d <= 0) return j - t.offset[i];
  }
  return null;
}

const same = (a: Option[], b: Option[]) =>
  a.length === b.length &&
  a.every(
    (o, k) =>
      o.type === b[k].type &&
      o.form === b[k].form &&
      o.stories === b[k].stories &&
      o.plates === b[k].plates &&
      o.homes === b[k].homes
  );

/**
 * V36: the manifest names options.bin whenever it has `scenarios.fzp`; the file inflates and
 * decodes; its datasetVersion is the manifest's and it has one row per parcels.bin `p` row
 * (optionTableProblem); re-encoding is byte-identical; every row rises strictly in (stories, type,
 * form), holds at most OPTIONS_MAX_PER_LOT options and no two of the same type, form and cost
 * series where one has homes ≥ and stories ≤ the other's (pruneOptions keeps the whole row); and
 * the sampled rows equal the pruned candidates of their scenario record on the decoded chunk
 * `records` (homes clamped to 65,535; empty when the chunks lack it). V40: no Type V option above
 * 6 stories and no Type III above 8. V41: every locationValue is finite and above 0. `stableDetail`
 * leaves byte counts out. Never throws.
 */
export function checkOptions(
  outDir: string,
  m: Manifest | null,
  p: ScenarioParcels | null,
  records: ReadonlyMap<ParcelId, ParcelRecord>,
  stableDetail: boolean
): InvariantResult[] {
  const v36: string[] = [];
  const v40: string[] = [];
  const v41: string[] = [];
  const done = (ok36: string, ok40: string, ok41: string): InvariantResult[] => [
    { id: 'V36', ok: v36.length === 0, detail: v36.length === 0 ? ok36 : v36.join('; ') },
    { id: 'V40', ok: v40.length === 0, detail: v40.length === 0 ? ok40 : v40.join('; ') },
    { id: 'V41', ok: v41.length === 0, detail: v41.length === 0 ? ok41 : v41.join('; ') }
  ];
  const unchecked = (why: string) => {
    v40.push(why);
    v41.push(why);
    return done('', '', '');
  };
  const file = join(outDir, OPTIONS_BIN);
  const present = existsSync(file);
  const fzp = m?.scenarios?.fzp;
  const url = fzp?.options;
  if (!m) v36.push('no manifest to compare');
  else if (fzp && url === undefined) v36.push(`${OPTIONS_BIN} is not named in the manifest`);
  else if (url !== undefined && url !== `/data/${m.datasetVersion}/${OPTIONS_BIN}`)
    v36.push(`manifest names ${url}, not ${OPTIONS_BIN}`);
  if (!present) {
    if (m && !fzp) {
      const none = 'no scenarios in the manifest';
      return done(none, none, none);
    }
    v36.push(`${OPTIONS_BIN} is missing`);
    return unchecked(`${OPTIONS_BIN} is missing`);
  }
  if (!p) {
    v36.push(`${OPTIONS_BIN} cannot be checked: parcels.bin does not decode`);
    return unchecked('parcels.bin does not decode');
  }
  const body = readFileSync(file);
  let t: OptionTable;
  let payload: Uint8Array;
  try {
    payload = new Uint8Array(inflateRawSync(body));
    t = decodeOptionPayload(payload);
  } catch (e) {
    v36.push(`${OPTIONS_BIN} does not decode: ${(e as Error).message}`);
    return unchecked(`${OPTIONS_BIN} does not decode`);
  }
  if (m && t.datasetVersion !== m.datasetVersion)
    v36.push(`datasetVersion ${t.datasetVersion} ≠ ${m.datasetVersion}`);
  const belongs = optionTableProblem(t, p);
  if (belongs) {
    v36.push(belongs);
    return unchecked(belongs);
  }
  try {
    if (!sameBytes(encodeOptionPayload(t), payload))
      v36.push('re-encoding the decoded payload differs');
  } catch (e) {
    v36.push(`re-encoding the decoded payload fails: ${(e as Error).message}`);
  }

  // Every row: order, size, pruning, story ranges, location value.
  const [vTop, iiiTop] = [TYPE_STORIES.V[1], TYPE_STORIES.III[1]];
  let over40 = 0;
  for (let i = 0; i < t.count; i++) {
    const n = t.offset[i + 1] - t.offset[i];
    const where = `row ${i} (${p.id[i]})`;
    if (n > OPTIONS_MAX_PER_LOT && v36.length < 5)
      v36.push(`${where} has ${n} options, above ${OPTIONS_MAX_PER_LOT}`);
    const k = unsorted(t, i);
    if (k !== null && v36.length < 5) v36.push(`${where} option ${k} is out of order`);
    const row = optionsOf(t, i);
    if (pruneOptions(row).length !== n && v36.length < 5)
      v36.push(`${where} holds an option another of its type, form and cost series dominates`);
    for (const o of row) {
      const top = o.type === 'V' ? vTop : o.type === 'III' ? iiiTop : Infinity;
      if (o.stories > top) {
        over40++;
        if (v40.length < 5) v40.push(`${where} has Type ${o.type} at ${o.stories} stories`);
      }
    }
    const lv = t.locationValue[i];
    if (!(Number.isFinite(lv) && lv > 0) && v41.length < 5)
      v41.push(`${where} locationValue ${lv}`);
  }
  if (over40 > 5) v40.push(`${over40} options in all`);

  // Sampled rows: the pruned candidates of the row's scenario record.
  const stride = t.count <= CHECK_ALL_MAX ? 1 : OPTIONS_CHECK_STRIDE;
  let checked = 0;
  for (let i = 0; i < t.count; i += stride) {
    checked++;
    const rec = records.get(p.id[i] as ParcelId);
    let want: Option[] = [];
    try {
      if (rec) {
        const v = scenarioRecordOf(p, i, rec);
        want = pruneOptions(
          candidatesOf(v, fnv1a32(rec.id)).map((o) =>
            o.homes > HOMES_MAX ? { ...o, homes: HOMES_MAX } : o
          )
        );
      }
    } catch (e) {
      v36.push(`row ${i} (${p.id[i]}): ${(e as Error).message}`);
      break;
    }
    if (!same(optionsOf(t, i), want)) {
      v36.push(`row ${i} (${p.id[i]}) differs from its pruned candidates`);
      break;
    }
  }
  const bytes = stableDetail ? '' : `, ${body.length} B`;
  return done(
    `${t.count} rows, ${t.offset[t.count]} options decode${bytes}; re-encode byte-identical; ` +
      `rows sorted and pruned; ${checked} rows equal their pruned candidates`,
    `no Type V above ${vTop} stories, no Type III above ${iiiTop}`,
    `${t.count} location values finite and above 0`
  );
}
