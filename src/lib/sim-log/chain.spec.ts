import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, chainHash, commitText, verifyChain } from './chain';
import type { Commit } from './types';

const C = {
  id: 'CVBRX1eXcVRvAio3MBkuW',
  seq: 1,
  parent: 0,
  kind: 'edit',
  label: 'Renamed',
  restores: null,
  actor: 'actor-1',
  at: 1763164800000,
  datasetVersion: 'fixture-0',
  shapes: 1,
  build: 'dev',
  source: 'sim.name',
  changes: [{ op: 'set', key: 'sim', field: 'name', value: 'Mission' }]
} satisfies Omit<Commit, 'hash'>;
const TEXT =
  '{"actor":"actor-1","at":1763164800000,"build":"dev","changes":[{"field":"name","key":"sim",' +
  '"op":"set","value":"Mission"}],"datasetVersion":"fixture-0","id":"CVBRX1eXcVRvAio3MBkuW",' +
  '"kind":"edit","label":"Renamed","parent":0,"restores":null,"seq":1,"shapes":1,' +
  '"source":"sim.name"}';

describe('hash chain', () => {
  it('writes the canonical text without the hash', () => {
    expect(commitText(C)).toBe(TEXT);
    expect(commitText({ ...C, hash: 'f'.repeat(64) })).toBe(TEXT);
  });
  it('hashes the previous hash and the text with SHA-256', async () => {
    const want = createHash('sha256')
      .update(GENESIS_HASH + TEXT, 'utf8')
      .digest('hex');
    expect(want).toBe('949f77d708450cca256a9febe90b7d57a978de51360da8610f03be5daee78243');
    expect(await chainHash(GENESIS_HASH, C)).toBe(want);
  });
  it('refuses text that is not JSON', () => {
    expect(() => commitText({ ...C, label: undefined as unknown as string })).toThrow(TypeError);
    expect(() => commitText({ ...C, at: Number.NaN })).toThrow(TypeError);
    expect(() => commitText({ ...C, at: Infinity })).toThrow(TypeError);
  });
  it('refuses undefined and NaN inside a change and inside an array', () => {
    const add = (fields: Record<string, unknown>) => ({
      ...C,
      changes: [{ op: 'add' as const, key: 'k', shape: 's', fields }]
    });
    expect(() => commitText(add({ a: undefined }))).toThrow(TypeError);
    expect(() => commitText(add({ a: Number.NaN }))).toThrow(TypeError);
    expect(() => commitText(add({ p: [[1, Number.NaN]] }))).toThrow(TypeError);
    expect(() => commitText(add({ p: [1, undefined] }))).toThrow(TypeError);
    expect(commitText(add({ p: [[1, 2]] }))).toContain('"p":[[1,2]]');
  });
  async function chainOf(n: number): Promise<Commit[]> {
    const out: Commit[] = [];
    let prev = GENESIS_HASH;
    for (let seq = 1; seq <= n; seq++) {
      const c = { ...C, seq, parent: seq - 1, label: `Edit ${seq}` };
      prev = await chainHash(prev, c);
      out.push({ ...c, hash: prev });
    }
    return out;
  }
  it('verifies a chain and names the first bad commit', async () => {
    const log = await chainOf(3);
    expect(await verifyChain(log)).toBeNull();
    expect(await verifyChain(log.slice(1), { seq: 1, hash: log[0].hash })).toBeNull();
    expect(await verifyChain([log[0], { ...log[1], label: 'Edited later' }, log[2]])).toBe(2);
    expect(await verifyChain([log[0], log[2]])).toBe(3);
    expect(await verifyChain(log, { seq: 0, hash: 'f'.repeat(64) })).toBe(1);
  });
  it('verifies an empty list', async () => {
    expect(await verifyChain([])).toBeNull();
    expect(await verifyChain([], { seq: 5, hash: 'f'.repeat(64) })).toBeNull();
  });
  it('names a commit after the first whose previous hash is wrong', async () => {
    const log = await chainOf(3);
    expect(await verifyChain(log.slice(1), { seq: 1, hash: 'f'.repeat(64) })).toBe(2);
    expect(await verifyChain([log[0], log[1], { ...log[2], hash: 'f'.repeat(64) }])).toBe(3);
    const relinked = { ...log[1], hash: await chainHash('f'.repeat(64), log[1]) };
    expect(await verifyChain([log[0], relinked, log[2]])).toBe(2);
  });
});
