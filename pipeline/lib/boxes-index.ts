import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic.js';
import { BOXES_FILES, BOXES_ID, type BoxesInputs } from './lidar/artifact.js';
import { canonicalJson, verifyRaw, type LockEntry, type LockFile } from './lock.js';

export interface BoxesIndexRecord {
  schema: 1;
  /** 64 hex. */
  key: string;
  /** entry.upstreamVersion, for people reading the dir. */
  upstreamVersion: string;
  /** entry.files' sha256, in entry order. */
  requires: string[];
  /** The exact building-boxes lock entry. */
  entry: LockEntry;
}

/** sha256(canonicalJson(inputs) + '\n'): the sha256 of the inputs.json a full run writes. */
export function boxesKey(inputs: BoxesInputs): string {
  return createHash('sha256')
    .update(canonicalJson(inputs) + '\n')
    .digest('hex');
}

/** The BOXES_FILES.inputs file of the entry; throws if absent. */
export function inputsFileOf(entry: LockEntry): LockFile {
  const f = entry.files.find((x) => x.name === BOXES_FILES.inputs);
  if (!f) throw new Error(`${entry.id}: no ${BOXES_FILES.inputs} in the lock entry`);
  return f;
}

export const indexFile = (indexDir: string, key: string): string => join(indexDir, `${key}.json`);
export const lockFileFor = (indexDir: string, key: string): string => join(indexDir, `${key}.lock`);

export function writeBoxesIndex(indexDir: string, key: string, entry: LockEntry): void {
  const record: BoxesIndexRecord = {
    schema: 1,
    key,
    upstreamVersion: entry.upstreamVersion,
    requires: entry.files.map((f) => f.sha256),
    entry
  };
  mkdirSync(indexDir, { recursive: true });
  writeFileAtomic(indexFile(indexDir, key), JSON.stringify(record, null, 2) + '\n');
}

export function readBoxesIndex(indexDir: string, key: string): BoxesIndexRecord | null {
  try {
    const r = JSON.parse(readFileSync(indexFile(indexDir, key), 'utf8')) as BoxesIndexRecord;
    return r && typeof r === 'object' ? r : null;
  } catch {
    return null;
  }
}

/** The recorded entry when its record is sound and every file is in raw with its sha256. */
export async function reusableEntry(
  indexDir: string,
  key: string,
  rawDir: string,
  byName: boolean
): Promise<LockEntry | null> {
  const record = readBoxesIndex(indexDir, key);
  if (!record || record.schema !== 1 || record.key !== key) return null;
  const entry = record.entry;
  if (!entry || !Array.isArray(entry.files) || !Array.isArray(record.requires)) return null;
  if (entry.id !== BOXES_ID) return null;
  try {
    if (inputsFileOf(entry).sha256 !== key) return null;
  } catch {
    return null;
  }
  const shas = entry.files.map((f) => f.sha256);
  if (shas.length !== record.requires.length || shas.some((s, i) => s !== record.requires[i])) {
    return null;
  }
  const bad = await verifyRaw({ sources: [entry] }, rawDir, { byName });
  return bad.length === 0 ? entry : null;
}
