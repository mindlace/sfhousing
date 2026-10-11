import { TOOL_VERSIONS } from '../config';
import { openDuck } from '../lib/duck';
import { run as realRun, which as realWhich } from '../lib/exec';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  found?: string;
  hint?: string;
}

export async function doctor(
  deps: { run: typeof realRun; which: typeof realWhich; nodeVersion?: string } = {
    run: realRun,
    which: realWhich
  }
): Promise<DoctorCheck[]> {
  const { run, which } = deps;
  const checks: DoctorCheck[] = [];

  const nodeVersion = deps.nodeVersion ?? process.version;
  const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? 0);
  checks.push({
    name: 'node',
    ok: major >= 22,
    found: nodeVersion,
    hint: major >= 22 ? undefined : 'install Node >=22 (see .nvmrc / engines in package.json)'
  });

  const tipHint = 'brew install tippecanoe';
  if (!(await which('tippecanoe'))) {
    checks.push({ name: 'tippecanoe', ok: false, hint: tipHint });
  } else {
    const r = await run('tippecanoe', ['--version']);
    const out = `${r.stdout}${r.stderr}`.trim();
    const ok = r.code === 0 && out.includes(`v${TOOL_VERSIONS.tippecanoe}`);
    checks.push({
      name: 'tippecanoe',
      ok,
      found: out || undefined,
      hint: ok ? undefined : `${tipHint} (need ${TOOL_VERSIONS.tippecanoe})`
    });
  }

  const pmHint = 'brew install pmtiles';
  if (!(await which('pmtiles'))) {
    checks.push({ name: 'pmtiles', ok: false, hint: pmHint });
  } else {
    const r = await run('pmtiles', ['version']);
    let out = `${r.stdout}${r.stderr}`.trim();
    let ok = r.code === 0 && out.includes(TOOL_VERSIONS.pmtiles);
    if (r.code === 0 && !ok && /\bdev\b/.test(out)) {
      const b = await run('brew', ['list', '--versions', 'pmtiles']);
      out = b.stdout.trim();
      ok = b.code === 0 && out.includes(TOOL_VERSIONS.pmtiles);
    }
    checks.push({
      name: 'pmtiles',
      ok,
      found: out || undefined,
      hint: ok ? undefined : `${pmHint} (need ${TOOL_VERSIONS.pmtiles})`
    });
  }

  const w = await run('npx', ['wrangler', '--version']);
  checks.push({
    name: 'wrangler',
    ok: w.code === 0,
    found: w.stdout.trim() || undefined,
    hint: w.code === 0 ? undefined : 'npm install'
  });

  for (const ext of ['spatial', 'httpfs']) {
    try {
      const db = await openDuck({ httpfs: ext === 'httpfs' });
      db.close();
      checks.push({ name: `duckdb-${ext}`, ok: true, found: `LOAD ${ext}` });
    } catch (e) {
      checks.push({
        name: `duckdb-${ext}`,
        ok: false,
        found: e instanceof Error ? e.message.split('\n')[0] : String(e),
        hint: 'npm install (needs network once to INSTALL DuckDB extensions)'
      });
    }
  }

  return checks;
}
