import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { DATASET_VERSION_RE } from '../src/lib/data/manifest';
import { putLocal } from './r2-put-local';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
}

const [dirArg, version] = process.argv.slice(2);
if (!dirArg || !version || !DATASET_VERSION_RE.test(version)) {
  console.error('usage: r2-load-local.ts <dir> <version>  (version must match the I12 pattern)');
  process.exit(1);
}

const root = resolve(dirArg);
const files = walk(root)
  .filter((f) => f !== join(root, 'README.md'))
  .sort();
for (const file of files) putLocal(version, relative(root, file).split(sep).join('/'), file);
console.log(`Loaded ${files.length} object(s) into local R2 under data/${version}/`);
