import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archiveKeyFor, sha256File, type LockFile } from './lock';

/** Save bytes as `<rawDir>/<sha256>` and describe them as a lock file. */
export function storeBytes(rawDir: string, name: string, url: string, bytes: Uint8Array): LockFile {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, sha256), bytes);
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
  renameSyncSafe(file, join(rawDir, sha256));
  return { url, sha256, bytes, archiveKey: archiveKeyFor(sha256, name), name };
}

function renameSyncSafe(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (e) {
    // EXDEV across volumes (tmpdir -> repo): copy then remove
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    copyFileSync(from, to);
    rmSync(from, { force: true });
  }
}
