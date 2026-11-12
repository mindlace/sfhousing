/**
 * The Funding tab's one unfinished pool or programme (funding-ui spec 4.6). SimPage owns it,
 * outside the policy store, so autosave, undo, publish and the worker never see a draft, and it
 * survives a tab switch (the Dock renders only the active tab). A run discards it.
 */
import type { Draft } from './funding-edit';

export class FundingDrafts {
  /** The open draft, replaced (never mutated) on every change; null when none is open. */
  draft = $state.raw<Draft | null>(null);

  /** Opens `d`, replacing any open draft. */
  open(d: Draft): void {
    this.draft = d;
  }

  /** Drops the open draft, if any. */
  discard(): void {
    this.draft = null;
  }

  get isOpen(): boolean {
    return this.draft !== null;
  }
}
