import { codePathsDirty, treeDatasetVersion } from './version';

export type Served = 'served' | 'missing' | 'unreachable';

export function manifestUrl(origin: string, v: string, now: number = Date.now()): string {
  return `${origin.replace(/\/+$/, '')}/data/${v}/manifest.json?check=${now}`;
}

/** Does `origin` serve dataset `v`? 404 is final; 5xx and network errors are retried. */
export async function datasetServed(
  v: string,
  origin: string,
  opts: { fetch?: typeof fetch; attempts?: number; delayMs?: number } = {}
): Promise<Served> {
  const doFetch = opts.fetch ?? fetch;
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 5000;
  let result: Served = 'unreachable';
  for (let i = 0; i < attempts; i++) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const res = await doFetch(manifestUrl(origin, v), { method: 'HEAD' });
      if (res.ok) return 'served';
      if (res.status === 404) return 'missing';
      result = 'unreachable';
    } catch {
      result = 'unreachable';
    }
  }
  return result;
}

export function missingDatasetHelp(v: string, origin: string): string {
  return [
    `${origin} does not serve dataset ${v}. Build and publish it:`,
    '  npm run pipeline -- build',
    `  npm run pipeline -- upload ${v}`,
    `  npm run pipeline -- verify ${v} --origin ${origin}`,
    'then re-run npm run signoff.',
    'See docs/dev/pipeline.md, "Finishing a branch that changes the dataset".'
  ].join('\n');
}

export async function versionCommand(a: {
  repoRoot: string;
  check?: string;
  fetch?: typeof fetch;
  delayMs?: number;
  out: (s: string) => void;
  err: (s: string) => void;
}): Promise<number> {
  const v = await treeDatasetVersion(a.repoRoot);
  a.out(v);
  const dirty = await codePathsDirty(a.repoRoot);
  if (a.check === undefined) {
    if (dirty.length > 0)
      a.err(
        'uncommitted changes under the code-hash paths; the committed tree computes a different version'
      );
    return 0;
  }
  if (dirty.length > 0) {
    a.err('uncommitted changes under the code-hash paths; commit them first:');
    for (const d of dirty) a.err(d);
    return 1;
  }
  const served = await datasetServed(v, a.check, { fetch: a.fetch, delayMs: a.delayMs });
  if (served === 'served') return 0;
  if (served === 'missing') a.err(missingDatasetHelp(v, a.check));
  else a.err(`could not reach ${a.check} to check ${v}`);
  return 1;
}
