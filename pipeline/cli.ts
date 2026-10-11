import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIXTURE_PROFILE, LIVE_PROFILE } from './config';
import { build, printResults } from './steps/build';
import { checkDataset } from './steps/check';
import { doctor } from './steps/doctor';
import { fetchAll } from './steps/fetch';
import { fixture } from './steps/fixture';
import { upload } from './steps/upload';
import { verify } from './steps/verify';
import { readLock } from './lib/lock';
import { wranglerTarget } from './lib/r2';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'pipeline/out');
const LOCK = join(ROOT, 'pipeline/sources.lock.json');
const RAW = join(ROOT, 'pipeline/.cache/raw');

export interface ParsedArgs {
  cmd: string | undefined;
  positional: string[];
  flags: Record<string, string | true>;
}

/** Parse `<cmd> [positional] [--flag value|--flag]`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { cmd, positional, flags };
}

type Step = (args: ParsedArgs) => Promise<number>;

const str = (v: string | true | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

async function runBuild(args: ParsedArgs): Promise<number> {
  if (!existsSync(LOCK)) {
    console.error(`no ${LOCK}: run \`npm run pipeline -- fetch\` first`);
    return 1;
  }
  const { outDir, results } = await build({
    lockPath: LOCK,
    rawDir: RAW,
    outRoot: OUT,
    profile: LIVE_PROFILE,
    skipTiles: args.flags['skip-tiles'] === true
  });
  console.log(`wrote ${outDir}`);
  return printResults(results);
}

/** Newest dataset directory under pipeline/out (by mtime). */
function latestOut(): string | undefined {
  if (!existsSync(OUT)) return undefined;
  return readdirSync(OUT)
    .filter((d) => existsSync(join(OUT, d, 'report.json')))
    .sort((a, b) => statSync(join(OUT, b)).mtimeMs - statSync(join(OUT, a)).mtimeMs)[0];
}

const steps: Record<string, { help: string; run: Step }> = {
  doctor: {
    help: 'check required tools and DuckDB extensions',
    run: async () => {
      const checks = await doctor();
      for (const c of checks) {
        const detail = c.ok ? (c.found ?? '') : `${c.found ? `${c.found} ` : ''}-> ${c.hint ?? ''}`;
        console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${detail ? `  ${detail}` : ''}`);
      }
      return checks.every((c) => c.ok) ? 0 : 1;
    }
  },
  build: {
    help: 'verify the lock, build out/<v>/ and run the invariants (offline) [--skip-tiles]',
    run: runBuild
  },
  check: {
    help: 're-run the invariants on out/<v>/ (default: newest) [<v>]',
    run: async (args) => {
      const v = args.positional[0] ?? latestOut();
      const dir = v ? join(OUT, v) : undefined;
      if (!v || !dir || !existsSync(join(dir, 'report.json'))) {
        console.error(`no built dataset${v ? ` ${v}` : ''} under ${OUT}`);
        return 1;
      }
      const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as {
        counts: Record<string, number>;
        invariants?: { id: string; ok: boolean }[];
      };
      const fixtureV = v.startsWith('fixture-');
      const results = await checkDataset(dir, fixtureV ? FIXTURE_PROFILE : LIVE_PROFILE, {
        counts: report.counts,
        reencodeIdentical: report.invariants?.find((r) => r.id === 'V12')?.ok,
        skipTiles: fixtureV ? undefined : false
      });
      return printResults(results);
    }
  },
  fixture: {
    help: 'build the mini fixture into e2e/fixtures/data/fixture-0 [--update-golden] [--out <dir> --version fixture-<n>] [--skip-tiles]',
    run: (args) =>
      fixture({
        outDir: str(args.flags.out),
        version: str(args.flags.version),
        skipTiles: args.flags['skip-tiles'] === true,
        updateGolden: args.flags['update-golden'] === true
      })
  },
  fetch: {
    help: 'fetch live sources into .cache/raw and write the lock [--only <id,...>] [--release <rel>] [--basemap-date YYYYMMDD] | --restore [--local]',
    run: async (args) =>
      fetchAll({
        only: str(args.flags.only),
        release: str(args.flags.release),
        basemapDate: str(args.flags['basemap-date']),
        restore: args.flags.restore === true,
        local: args.flags.local === true
      })
  },
  upload: {
    help: 'publish out/<v>/ to R2, manifest last [--local]; never bumps PUBLIC_DATASET_VERSION',
    run: async (args) => {
      const v = args.positional[0];
      if (!v) {
        console.error('usage: upload <datasetVersion> [--local]');
        return 2;
      }
      const outDir = join(OUT, v);
      if (!existsSync(join(outDir, 'manifest.json'))) {
        console.error(`no built dataset ${v} under ${OUT}`);
        return 1;
      }
      const lockPath = v.startsWith('fixture-') ? undefined : LOCK;
      if (lockPath && !existsSync(lockPath)) {
        console.error(`no ${lockPath}: run \`npm run pipeline -- fetch\` first`);
        return 1;
      }
      return upload({
        outDir,
        datasetVersion: v,
        // Fixture datasets have no raw archives to publish (and skip the lockSha256 check).
        lock: lockPath ? readLock(lockPath) : { sources: [] },
        rawDir: RAW,
        target: wranglerTarget({ local: args.flags.local === true })
      });
    }
  },
  verify: {
    help: 'check a published version through a running origin <v> --origin <url>',
    run: async (args) => {
      const v = args.positional[0];
      const origin = str(args.flags.origin);
      if (!v || !origin) {
        console.error('usage: verify <datasetVersion> --origin <url>');
        return 2;
      }
      const r = await verify({ datasetVersion: v, origin });
      for (const f of r.failures) console.error(`FAIL ${f}`);
      console.log(
        r.ok ? `OK   ${v} verified against ${origin}` : `${r.failures.length} failure(s)`
      );
      return r.ok ? 0 : 1;
    }
  },
  all: {
    help: 'fetch (when the lock is missing) then build with the live profile; never uploads',
    run: async (args) => {
      if (!existsSync(LOCK)) {
        const code = await fetchAll({
          release: str(args.flags.release),
          basemapDate: str(args.flags['basemap-date'])
        });
        if (code !== 0) return code;
      }
      return runBuild(args);
    }
  }
};

function usage(): string {
  const lines = Object.entries(steps).map(([n, s]) => `  ${n.padEnd(12)} ${s.help}`);
  return `Usage: npm run pipeline -- <command> [args] [--flag value]\n\nCommands:\n${lines.join('\n')}`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const step = args.cmd ? steps[args.cmd] : undefined;
  if (!step) {
    console.error(usage());
    return 2;
  }
  return step.run(args);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  }
);
