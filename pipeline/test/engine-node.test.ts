// The lesscars step runs the simulation engine from pipeline code under Node: prove tsx can load
// it (its `$lib` imports included) outside Vite.
import { describe, expect, it } from 'vitest';
import { run } from '../lib/exec';

describe('engine in Node', () => {
  it('tsx runs the engine from pipeline code', async () => {
    const r = await run('npx', ['tsx', 'pipeline/test/fixtures/engine-node-smoke.ts']);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { schedules: number; regime1: number };
    expect(out).toEqual({ schedules: expect.any(Number), regime1: expect.any(Number) });
    expect(out.schedules).toBeGreaterThan(0);
  }, 60_000);
});
