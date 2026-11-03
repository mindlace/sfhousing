/**
 * /sim's two phases (spec §1): Setup (the policy is editable, the day pinned at the present) and
 * Run (the policy read-only, the timeline playing). The page opens in Setup; the phase is never
 * persisted, so a reload, a restore and `/s/<id>` all open there.
 */
export type SimPhase = 'setup' | 'run';

export class RunPhase {
  phase = $state<SimPhase>('setup');

  /** Setup → Run (the Run button). */
  run(): void {
    this.phase = 'run';
  }

  /** Run → Setup ("Edit policy", or "Policy" on `/s/<id>`; a scrub back to Today). */
  reset(): void {
    this.phase = 'setup';
  }
}
