import { doctor } from './steps/doctor';

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
