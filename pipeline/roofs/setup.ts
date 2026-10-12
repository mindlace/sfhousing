import { ROOF_DEPENDENCY_DIR, toolchainArchives, verifyRoofArchive } from './archives';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { run } from '../lib/exec';
import { nodeHttp } from '../lib/http';
import type { DoctorCheck } from '../steps/doctor';
import toolchain from './toolchain.json';

const ROOT = resolve(import.meta.dirname, '../..');
export const ROOF_PYTHON = join(ROOT, 'pipeline/.venv/bin/python');
export const ROOFER = join(ROOT, 'pipeline/.cache/tools/roofer/bin/roofer');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function roofToolVersions(): Record<string, string> {
  return {
    python: toolchain.python,
    roofer: toolchain.roofer.version,
    roofToolchainHash: hash(readFileSync(join(ROOT, 'pipeline/roofs/toolchain.json'))),
    roofRequirementsHash: hash(readFileSync(join(ROOT, 'pipeline/roofs/requirements.txt'))),
    ...toolchain.packages
  };
}
async function checked(cmd: string, args: string[]) {
  const result = await run(cmd, args);
  if (result.code !== 0) throw new Error(`${cmd}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
/** Explicit networked installation only; never called from build. */
export async function setupRoofs(
  python = process.env.ROOF_PYTHON ?? 'python3.14'
): Promise<number> {
  const found = await run(python, ['--version']);
  if (found.code !== 0 || found.stdout.trim() !== `Python ${toolchain.python}`) {
    throw new Error(
      `install Python ${toolchain.python} and set ROOF_PYTHON to its executable; found ${found.stdout || found.stderr}`
    );
  }
  const platform = `${process.platform}-${process.arch}` as keyof typeof toolchain.roofer.platforms;
  const artifact = toolchain.roofer.platforms[platform];
  if (!artifact) throw new Error(`unsupported roof toolchain platform: ${platform}`);
  if (!existsSync(ROOF_PYTHON)) await checked(python, ['-m', 'venv', join(ROOT, 'pipeline/.venv')]);
  const venvVersion = await checked(ROOF_PYTHON, ['--version']);
  if (venvVersion !== `Python ${toolchain.python}`)
    throw new Error('existing roof venv Python version differs; recreate pipeline/.venv');
  await checked(ROOF_PYTHON, [
    '-m',
    'pip',
    'install',
    '--require-hashes',
    '--only-binary=:all:',
    '-r',
    join(ROOT, 'pipeline/roofs/requirements.txt')
  ]);
  const cache = join(ROOT, 'pipeline/.cache/tools');
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, artifact.sha256 + '.tar.gz');
  if (!existsSync(archive)) {
    const response = await nodeHttp.get(artifact.url);
    if (response.status !== 200 || hash(response.body) !== artifact.sha256)
      throw new Error('roofer artifact download/hash failed');
    writeFileSync(archive, response.body);
  }
  if (hash(readFileSync(archive)) !== artifact.sha256)
    throw new Error('roofer archive sha256 mismatch');
  const dest = join(cache, 'roofer'),
    part = join(cache, 'roofer.part');
  rmSync(part, { recursive: true, force: true });
  mkdirSync(part, { recursive: true });
  await checked('tar', ['-xzf', archive, '-C', part]);
  rmSync(dest, { recursive: true, force: true });
  renameSync(part, dest);
  chmodSync(ROOFER, 0o755);
  const version = await run(ROOFER, ['--version'], { cwd: join(ROOT, 'pipeline/.cache/tools') });
  if (
    version.code !== 0 ||
    !`${version.stdout}${version.stderr}`.includes(toolchain.roofer.version)
  )
    throw new Error('roofer executable version mismatch');
  writeFileSync(
    join(cache, 'roofer-install.json'),
    JSON.stringify({
      archiveSha256: artifact.sha256,
      executableSha256: hash(readFileSync(ROOFER))
    }) + '\n'
  );
  mkdirSync(ROOF_DEPENDENCY_DIR, { recursive: true });
  for (const ref of toolchainArchives()) {
    const path = join(ROOF_DEPENDENCY_DIR, ref.sha256);
    if (!existsSync(path)) {
      const response = await nodeHttp.get(ref.url);
      if (
        response.status !== 200 ||
        response.body.length !== ref.bytes ||
        hash(response.body) !== ref.sha256
      )
        throw new Error(`roof dependency download/hash failed: ${ref.name}`);
      writeFileSync(path, response.body);
    }
    await verifyRoofArchive(ref, ROOF_DEPENDENCY_DIR);
  }
  const checks = await doctorRoofs();
  for (const check of checks)
    console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.found ?? check.hint}`);
  return checks.every((c) => c.ok) ? 0 : 1;
}
export async function doctorRoofs(): Promise<DoctorCheck[]> {
  const hint = 'run npm run pipeline -- setup-roofs (requires Python ' + toolchain.python + ')';
  const python = await run(ROOF_PYTHON, ['--version']);
  const checks: DoctorCheck[] = [
    {
      name: 'roof-python',
      ok: python.code === 0 && python.stdout.trim() === `Python ${toolchain.python}`,
      found: python.stdout.trim(),
      hint
    }
  ];
  const packages = await run(ROOF_PYTHON, [
    '-c',
    'import importlib.metadata,json; print(json.dumps({k:importlib.metadata.version(k) for k in ' +
      JSON.stringify(Object.keys(toolchain.packages)) +
      '}))'
  ]);
  let versions: Record<string, string> = {};
  try {
    versions = JSON.parse(packages.stdout);
  } catch {
    /* missing environment reported below */
  }
  checks.push({
    name: 'roof-packages',
    ok:
      packages.code === 0 &&
      Object.entries(toolchain.packages).every(([k, v]) => versions[k] === v),
    found: packages.stdout.trim(),
    hint
  });
  const roofer = await run(ROOFER, ['--version'], { cwd: join(ROOT, 'pipeline/.cache/tools') });
  let verified = false;
  try {
    const record = JSON.parse(
      readFileSync(join(ROOT, 'pipeline/.cache/tools/roofer-install.json'), 'utf8')
    );
    const platform =
      `${process.platform}-${process.arch}` as keyof typeof toolchain.roofer.platforms;
    verified =
      record.archiveSha256 === toolchain.roofer.platforms[platform]?.sha256 &&
      record.executableSha256 === hash(readFileSync(ROOFER));
  } catch {
    /* absent tool is reported below */
  }
  checks.push({
    name: 'roofer',
    ok:
      verified &&
      roofer.code === 0 &&
      `${roofer.stdout}${roofer.stderr}`.includes(toolchain.roofer.version),
    found: `${roofer.stdout}${roofer.stderr}`.trim(),
    hint
  });
  return checks;
}
