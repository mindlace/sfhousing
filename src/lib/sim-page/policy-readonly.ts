/**
 * The policy pane's read-only state during a run (spec §1), from `PolicyPanel` to the section
 * components it renders. Each section wraps its editing controls in `ReadonlyFieldset`, so
 * controls that only show information (a stage's details, a lot lookup's Retry) stay usable.
 */
import { getContext, setContext } from 'svelte';

export interface PolicyReadonly {
  /** True during a run: the editing controls are disabled. */
  readonly on: boolean;
  /** The id of the pane's "read-only during a run" line, for `aria-describedby`. */
  readonly noteId: string | undefined;
}

const KEY = Symbol('sim-policy-readonly');
const EDITABLE: PolicyReadonly = { on: false, noteId: undefined };

/** PolicyPanel only: `get` is read live, so the getters stay reactive. */
export function provideReadonly(get: () => PolicyReadonly): void {
  setContext<PolicyReadonly>(KEY, {
    get on() {
      return get().on;
    },
    get noteId() {
      return get().noteId;
    }
  });
}

/** The pane's read-only state; editable outside a PolicyPanel. */
export function policyReadonly(): PolicyReadonly {
  return getContext<PolicyReadonly | undefined>(KEY) ?? EDITABLE;
}
