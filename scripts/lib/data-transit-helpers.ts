// Pure helpers for scripts/data-transit.ts, kept free of pipeline imports so tests can load them.
import type { Manifest } from '../../src/lib/data/manifest';
import type { Lock } from '../../pipeline/lib/lock';

export function devVarsVersion(text: string): string | null {
  const m = /^PUBLIC_DATASET_VERSION\s*=\s*"?([^"\s]+)"?\s*$/m.exec(text);
  return m ? m[1] : null;
}

export function withTransit(m: Manifest): Manifest {
  return { ...m, transit: `/data/${m.datasetVersion}/transit.json` };
}

export function lockDrift(committed: Lock, fetched: Lock): string[] {
  const out: string[] = [];
  for (const f of fetched.sources.filter((s) => s.id.startsWith('gtfs-'))) {
    const c = committed.sources.find((s) => s.id === f.id);
    if (!c) out.push(`${f.id}: not in pipeline/sources.lock.json`);
    else if (c.files[0]?.sha256 !== f.files[0]?.sha256)
      out.push(`${f.id}: fetched bytes differ from pipeline/sources.lock.json (feed rolled over)`);
  }
  return out;
}
