// Runs after `vite build`: the adapter writes .svelte-kit/cloudflare/_worker.js, which exports
// only the SvelteKit handler. Wrangler's `main` must also export the SimObject class, so this
// moves the adapter's file out of the assets directory and writes an entry that re-exports both.
// Wrangler bundles the entry from source, resolving `$lib` through wrangler.jsonc's `alias`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENTRY_MARK = '// sfhousing worker entry';

export function entrySource(): string {
  return (
    ENTRY_MARK +
    ': written by scripts/worker-entry.ts after vite build; do not edit.\n' +
    "export { default } from '../cloudflare-adapter/_worker.js';\n" +
    "export { SimObject } from '../../src/lib/server/sim-object/sim-object.ts';\n"
  );
}

/** Moves the adapter's _worker.js to .svelte-kit/cloudflare-adapter/ and writes the entry. */
export function wrapWorker(root: string): void {
  const worker = join(root, '.svelte-kit/cloudflare/_worker.js');
  if (!existsSync(worker)) throw new Error('no adapter output: run vite build first');
  if (readFileSync(worker, 'utf8').startsWith(ENTRY_MARK)) {
    throw new Error('already wrapped: run vite build first');
  }
  const dir = join(root, '.svelte-kit/cloudflare-adapter');
  mkdirSync(dir, { recursive: true });
  renameSync(worker, join(dir, '_worker.js'));
  writeFileSync(worker, entrySource());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  wrapWorker(process.cwd());
}
