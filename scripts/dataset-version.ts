import { fileURLToPath, pathToFileURL } from 'node:url';
import { STAGING_ORIGIN } from '../pipeline/config';
import { versionCommand } from '../pipeline/lib/dataset-check';

const USAGE = 'usage: dataset-version.ts [--check [<origin>]]';

export function parseVersionArgs(argv: string[]): { check?: string } | { usage: string } {
  if (argv.length === 0) return {};
  if (argv[0] === '--check' && argv.length === 1) return { check: STAGING_ORIGIN };
  if (argv[0] === '--check' && argv.length === 2 && !argv[1].startsWith('-'))
    return { check: argv[1] };
  return { usage: USAGE };
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseVersionArgs(argv);
  if ('usage' in parsed) {
    console.error(parsed.usage);
    return 2;
  }
  return versionCommand({
    repoRoot: fileURLToPath(new URL('..', import.meta.url)),
    check: parsed.check,
    out: console.log,
    err: console.error
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).then((code) => process.exit(code));
