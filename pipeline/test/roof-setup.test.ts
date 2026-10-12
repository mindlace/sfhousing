import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import toolchain from '../roofs/toolchain.json';
import { doctorRoofs, setupRoofs, ROOFER, ROOF_PYTHON } from '../roofs/setup';
import { run } from '../lib/exec';

vi.mock('../lib/exec', () => ({ run: vi.fn() }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    chmodSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn((path, ...args) => {
      if (String(path).endsWith('roofer-install.json')) {
        return JSON.stringify({
          archiveSha256:
            toolchain.roofer.platforms[
              `${process.platform}-${process.arch}` as keyof typeof toolchain.roofer.platforms
            ].sha256,
          executableSha256: createHash('sha256').update(fs.readFileSync(ROOFER)).digest('hex')
        });
      }
      return fs.readFileSync(path, ...args);
    })
  };
});

function runtime(version: string, code = 0) {
  vi.mocked(run).mockImplementation(async (cmd, args) => ({
    code: cmd === ROOFER ? code : 0,
    stderr: '',
    stdout:
      cmd === ROOFER
        ? version
        : cmd === ROOF_PYTHON && args[0] === '--version'
          ? `Python ${toolchain.python}`
          : JSON.stringify(toolchain.packages)
  }));
}

it('requires the exact source commit, rejecting same-version and truncated identities', async () => {
  for (const identity of [
    `roofer ${toolchain.roofer.version} (0000000000000000000000000000000000000000)`,
    `roofer ${toolchain.roofer.version} (${toolchain.roofer.commit.slice(0, 7)})`,
    `roofer 11.${toolchain.roofer.version} (${toolchain.roofer.commit})`
  ]) {
    runtime(identity);
    expect((await doctorRoofs()).find((c) => c.name === 'roofer')?.ok).toBe(false);
  }
});

it('accepts the verified full identity and refuses unavailable or corrupt installed tools', async () => {
  runtime(`roofer ${toolchain.roofer.version} (${toolchain.roofer.commit})`);
  expect((await doctorRoofs()).every((c) => c.ok)).toBe(true);
  runtime('', 127);
  expect((await doctorRoofs()).find((c) => c.name === 'roofer')?.ok).toBe(false);
  runtime(`roofer ${toolchain.roofer.version} (${toolchain.roofer.commit})`);
  const original = vi.mocked(readFileSync).getMockImplementation()!;
  const valid = JSON.parse(
    String(original('pipeline/.cache/tools/roofer-install.json', { encoding: 'utf8' }))
  );
  try {
    for (const record of [
      { ...valid, archiveSha256: '0'.repeat(64) },
      { ...valid, executableSha256: '0'.repeat(64) },
      null
    ]) {
      vi.mocked(readFileSync).mockImplementation((path, ...args) => {
        if (String(path).endsWith('roofer-install.json')) {
          if (record === null) throw new Error('missing install record');
          return JSON.stringify(record);
        }
        return original(path, ...args);
      });
      expect((await doctorRoofs()).find((c) => c.name === 'roofer')?.ok).toBe(false);
    }
  } finally {
    vi.mocked(readFileSync).mockImplementation(original);
  }
});

it('setup rejects a same-version wrong-commit release before recording an installation', async () => {
  runtime(`roofer ${toolchain.roofer.version} (0000000000000000000000000000000000000000)`);
  // Filesystem mutations and the external installer are isolated above. Archive bytes
  // still come from the actual verified cache, and setup performs its real checks.
  vi.mocked(run).mockImplementation(async (cmd, args) => ({
    code: 0,
    stderr: '',
    stdout:
      cmd === ROOFER
        ? `roofer ${toolchain.roofer.version} (0000000000000000000000000000000000000000)`
        : args[0] === '--version'
          ? `Python ${toolchain.python}`
          : JSON.stringify(toolchain.packages)
  }));
  await expect(setupRoofs('test-python')).rejects.toThrow('roofer executable version mismatch');
});
