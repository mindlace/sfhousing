import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyPlan } from '$lib/plan';
import { exposeEditorForDebug, installBrushDebug } from './debug';

const state = { ops: 0, lastStats: null, ready: true, chunks: { pending: 0, failed: [] } };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('brush debug hook load', () => {
  it('loads through the exposed editor until its disposer runs', () => {
    vi.stubEnv('VITE_E2E', '1');
    const uninstall = installBrushDebug(() => state);
    const a = { load: vi.fn() };
    const b = { load: vi.fn() };
    const disposeA = exposeEditorForDebug(a);
    const plan = emptyPlan('fixture-0');
    window.__sfhBrush!.load(plan);
    expect(a.load).toHaveBeenCalledWith(plan);

    // A remount's new editor replaces it; the stale disposer leaves the new one in place.
    const disposeB = exposeEditorForDebug(b);
    disposeA();
    window.__sfhBrush!.load(plan);
    expect(b.load).toHaveBeenCalledTimes(1);

    disposeB();
    expect(() => window.__sfhBrush!.load(plan)).toThrow(/no parent/);
    uninstall();
    expect(window.__sfhBrush).toBeUndefined();
  });
});
