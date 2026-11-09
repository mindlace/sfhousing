// V36 over `scenarios/fzp/gross.bin` (the gross table). Kept out of check.ts beside the other
// per-file checks; checkDataset calls checkV36 after V35.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  clampGross,
  decodeGrossPayload,
  encodeGrossPayload,
  grossAt,
  grossTableProblem,
  type GrossTable
} from '../../src/lib/data/gross-table';
import type { Manifest } from '../../src/lib/data/manifest';
import type { ParcelId, ParcelRecord } from '../../src/lib/data/parcel';
import { scenarioRecordOf, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../src/lib/data/scenario-yield';
import { GROSS_BIN } from '../lib/scenario-files';
import type { InvariantResult } from './check';

/** V36 recomputes every GROSS_CHECK_STRIDE-th row (every row of a table of at most 2000). */
export const GROSS_CHECK_STRIDE = 251;
const CHECK_ALL_MAX = 2000;
/** The story counts V36 compares at: 0..81 and 255. */
const CHECK_STORIES = [...Array.from({ length: 82 }, (_, s) => s), 255];

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * V36: the manifest names gross.bin whenever it has `scenarios.fzp`; the file inflates and
 * decodes; its datasetVersion is the manifest's and it belongs to parcels.bin `p`
 * (grossTableProblem); re-encoding is byte-identical; and the sampled rows equal
 * clampGross(scenarioYield) of their scenario record from the decoded chunk `records` (0 when the
 * chunks lack it) at every s of CHECK_STORIES. The detail names the first mismatching row and s.
 * `stableDetail` leaves byte counts out. Never throws.
 */
export function checkV36(
  outDir: string,
  m: Manifest | null,
  p: ScenarioParcels | null,
  records: ReadonlyMap<ParcelId, ParcelRecord>,
  stableDetail: boolean
): InvariantResult {
  const problems: string[] = [];
  const done = (ok: string): InvariantResult => ({
    id: 'V36',
    ok: problems.length === 0,
    detail: problems.length === 0 ? ok : problems.join('; ')
  });
  const file = join(outDir, GROSS_BIN);
  const present = existsSync(file);
  const fzp = m?.scenarios?.fzp;
  const url = fzp?.gross;
  if (!m) problems.push('no manifest to compare');
  else if (fzp && url === undefined) problems.push(`${GROSS_BIN} is not named in the manifest`);
  else if (url !== undefined && url !== `/data/${m.datasetVersion}/${GROSS_BIN}`)
    problems.push(`manifest names ${url}, not ${GROSS_BIN}`);
  if (!present) {
    if (m && !fzp) return done('no scenarios in the manifest');
    problems.push(`${GROSS_BIN} is missing`);
    return done('');
  }
  if (!p) {
    problems.push(`${GROSS_BIN} cannot be checked: parcels.bin does not decode`);
    return done('');
  }
  const body = readFileSync(file);
  let t: GrossTable;
  let payload: Uint8Array;
  try {
    payload = new Uint8Array(inflateRawSync(body));
    t = decodeGrossPayload(payload);
  } catch (e) {
    problems.push(`${GROSS_BIN} does not decode: ${(e as Error).message}`);
    return done('');
  }
  if (m && t.datasetVersion !== m.datasetVersion)
    problems.push(`datasetVersion ${t.datasetVersion} ≠ ${m.datasetVersion}`);
  const belongs = grossTableProblem(t, p);
  if (belongs) {
    problems.push(belongs);
    return done('');
  }
  try {
    if (!sameBytes(encodeGrossPayload(t), payload))
      problems.push('re-encoding the decoded payload differs');
  } catch (e) {
    problems.push(`re-encoding the decoded payload fails: ${(e as Error).message}`);
  }
  const stride = t.count <= CHECK_ALL_MAX ? 1 : GROSS_CHECK_STRIDE;
  let checked = 0;
  rows: for (let i = 0; i < t.count; i += stride) {
    checked++;
    const rec = records.get(p.id[i] as ParcelId);
    let v: ParcelRecord | undefined;
    try {
      v = rec && scenarioRecordOf(p, i, rec);
    } catch (e) {
      problems.push(`row ${i} (${p.id[i]}): ${(e as Error).message}`);
      break;
    }
    for (const s of CHECK_STORIES) {
      const want = v ? clampGross(scenarioYield(v, s, null)) : 0;
      const got = grossAt(t, i, s);
      if (got !== want) {
        problems.push(`row ${i} (${p.id[i]}) at s ${s}: gross ${got} ≠ ${want}`);
        break rows;
      }
    }
  }
  const bytes = stableDetail ? '' : `, ${body.length} B`;
  return done(
    `${t.count} rows decode${bytes}; re-encode byte-identical; ${checked} rows equal ` +
      `scenarioYield at s 0..81 and 255`
  );
}
