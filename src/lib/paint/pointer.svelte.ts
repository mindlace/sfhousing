// The one pointer rule for undo and redo: a device whose primary pointer is coarse (a phone or
// tablet) has no keyboard, so it gets Undo and Redo buttons; any other has Ctrl+Z and the
// Shortcuts button. `(pointer: coarse)` reports the primary pointer only, so a touch laptop whose
// main pointer is the trackpad counts as fine. The query is reactive (docking a keyboard swaps the
// two together) and neither side is true until the client has read it, so nothing the other side
// would replace is ever in the server's HTML.
import { onMount } from 'svelte';
import { MediaQuery } from 'svelte/reactivity';

export interface PrimaryPointer {
  /** The client has read the query and the primary pointer is coarse. */
  readonly coarse: boolean;
  /** The client has read the query and the primary pointer is not coarse. */
  readonly fine: boolean;
}

/** Call during a component's setup. */
export function usePrimaryPointer(): PrimaryPointer {
  const query = new MediaQuery('(pointer: coarse)');
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  return {
    get coarse() {
      return ready && query.current;
    },
    get fine() {
      return ready && !query.current;
    }
  };
}
