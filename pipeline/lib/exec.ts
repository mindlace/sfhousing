import { execFile } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a command with an argument array (never a shell). Never throws on non-zero exit. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string } = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd: opts.cwd, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr, code: 0 });
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        const code = typeof e.code === 'number' ? e.code : e.code === 'ENOENT' ? 127 : 1;
        resolve({ stdout: stdout ?? '', stderr: stderr || e.message, code });
      }
    );
    // Always end stdin so children that read it (wrangler) never wait on an open pipe.
    // A child that exits without reading stdin makes the write fail with EPIPE; that is fine.
    child.stdin?.on('error', () => {});
    child.stdin?.end(opts.input ?? '');
  });
}

/** Resolve a command on PATH, or null when absent. */
export async function which(cmd: string): Promise<string | null> {
  const r = await run('which', [cmd]);
  const out = r.stdout.trim();
  return r.code === 0 && out ? out.split('\n')[0] : null;
}
