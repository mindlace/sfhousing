/**
 * Seam for the future per-sim Durable Object. Called after a membership change that
 * leaves the sim alive, so a DO that mirrors the roster can reconcile. Today there is
 * no DO, so it does nothing. It lives in its own module so specs can replace it with
 * `vi.mock` (a spy on an export called from inside its own module never sees the call).
 */
export async function onSimRosterChanged(simId: string): Promise<void> {
  void simId;
}
