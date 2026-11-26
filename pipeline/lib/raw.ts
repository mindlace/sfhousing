import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { moveIntoPlace, writeFileAtomic } from './atomic';
import { archiveKeyFor, sha256File, type LockFile } from './lock';

/** Save bytes as `<rawDir>/<sha256>` and describe them as a lock file. */
export function storeBytes(rawDir: string, name: string, url: string, bytes: Uint8Array): LockFile {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(rawDir, { recursive: true });
  const dest = join(rawDir, sha256);
  if (!existsSync(dest)) writeFileAtomic(dest, bytes);
  return { url, sha256, bytes: bytes.length, archiveKey: archiveKeyFor(sha256, name), name };
}

/** Move a finished file to `<rawDir>/<sha256>` and describe it as a lock file. */
export async function storeFile(
  rawDir: string,
  name: string,
  url: string,
  file: string
): Promise<LockFile> {
  const sha256 = await sha256File(file);
  const bytes = statSync(file).size;
  mkdirSync(rawDir, { recursive: true });
  const dest = join(rawDir, sha256);
  if (existsSync(dest)) rmSync(file, { force: true });
  else moveIntoPlace(file, dest);
  return { url, sha256, bytes, archiveKey: archiveKeyFor(sha256, name), name };
}
