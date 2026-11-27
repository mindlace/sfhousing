import { randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';

/** A unique name beside `dest`, so a rename into place stays on one volume. */
export function tempSibling(dest: string): string {
  return `${dest}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
}

/** Write to a temp sibling, then rename: readers never see a partial file. */
export function writeFileAtomic(dest: string, data: string | Uint8Array): void {
  const tmp = tempSibling(dest);
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, dest);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Move a file or directory to `dest`; across volumes copy to a temp sibling first. */
export function moveIntoPlace(src: string, dest: string): void {
  try {
    renameSync(src, dest);
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
  }
  const tmp = tempSibling(dest);
  try {
    if (statSync(src).isDirectory()) cpSync(src, tmp, { recursive: true });
    else copyFileSync(src, tmp);
    renameSync(tmp, dest);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  rmSync(src, { recursive: true, force: true });
}
