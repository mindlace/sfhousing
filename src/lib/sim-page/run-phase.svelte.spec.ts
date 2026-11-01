// RunPhase (spec §1): /sim opens in Setup; Run and Change policy (or Back to start) move between
// the two phases. Never persisted.
import { describe, expect, it } from 'vitest';
import { RunPhase } from './run-phase.svelte';

describe('RunPhase', () => {
  it('starts in setup', () => {
    expect(new RunPhase().phase).toBe('setup');
  });

  it('run() moves to run and reset() back to setup', () => {
    const r = new RunPhase();
    r.run();
    expect(r.phase).toBe('run');
    r.reset();
    expect(r.phase).toBe('setup');
  });
});
