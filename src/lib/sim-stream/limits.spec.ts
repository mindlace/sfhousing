import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, STAMP_MAX, fitsCommit, overFrameLimit, utf8Bytes } from './limits';
import * as server from '$lib/server/sim-object/limits';

const draft = {
  id: 'c1',
  parent: 0,
  kind: 'edit',
  label: 'Rename',
  restores: null,
  datasetVersion: 'fixture-0',
  shapes: 1,
  build: 'b',
  source: 'sim.name',
  changes: [{ op: 'set', key: 'sim', field: 'name', value: 'Jardín 😀' }]
};

describe('fitsCommit', () => {
  it('admits a draft whose size plus STAMP_MAX is within commitBytes, exactly', () => {
    const size = utf8Bytes(JSON.stringify(draft));
    expect(fitsCommit(draft)).toBe(true);
    expect(fitsCommit(draft, { ...LIMITS, commitBytes: size + STAMP_MAX })).toBe(true);
    expect(fitsCommit(draft, { ...LIMITS, commitBytes: size + STAMP_MAX - 1 })).toBe(false);
  });

  it('allows for the largest stamps the server can add', () => {
    // The widest seq and at, a 64-character actor whose every character JSON escapes to six
    // bytes, and a 64-character hash.
    const stamped = {
      ...draft,
      seq: Number.MAX_SAFE_INTEGER,
      actor: '\u0001'.repeat(64),
      at: Number.MAX_SAFE_INTEGER,
      hash: 'f'.repeat(64)
    };
    const added = utf8Bytes(JSON.stringify(stamped)) - utf8Bytes(JSON.stringify(draft));
    expect(added).toBeLessThanOrEqual(STAMP_MAX);
  });

  it('keeps the append frame of a fitting draft within the frame limit', () => {
    const frameRoom = utf8Bytes(JSON.stringify({ type: 'append', commit: {} })) - 2;
    expect(LIMITS.commitBytes - STAMP_MAX + frameRoom).toBeLessThan(LIMITS.frameBytes);
  });
});

describe('the shared limits module', () => {
  it('is what the server limits module re-exports', () => {
    expect(server.LIMITS).toBe(LIMITS);
    expect(server.utf8Bytes).toBe(utf8Bytes);
    expect(server.overFrameLimit).toBe(overFrameLimit);
    expect(server.fitsCommit).toBe(fitsCommit);
  });

  it('imports nothing, so a browser can load it', () => {
    const source = readFileSync(new URL('./limits.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import /m);
  });
});
