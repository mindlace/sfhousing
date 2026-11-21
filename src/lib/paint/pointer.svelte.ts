// The pointer rules for undo and redo. Undo and Redo buttons show while some pointer is coarse
// (`touch`: a phone, a tablet or a touch laptop), since a touch has no Ctrl+Z; the Shortcuts
// button shows while the primary pointer is fine (`fine`), since it lists keys. A touch laptop
// gets both. `(pointer: coarse)` reports the primary pointer only, `(any-pointer: coarse)` any of
// them. The queries are reactive (docking a keyboard or adding a touch screen swaps the buttons)
// and nothing is true until the client has read them, so nothing a query would remove is ever in
// the server's HTML.
import { onMount } from 'svelte';
import { MediaQuery } from 'svelte/reactivity';

export interface PrimaryPointer {
  /** The client has read the query and the primary pointer is coarse. */
  readonly coarse: boolean;
  /** The client has read the query and the primary pointer is not coarse. */
  readonly fine: boolean;
  /** The client has read the query and some pointer is coarse (`(any-pointer: coarse)`): a phone,
   *  a tablet or a touch laptop. Undo and Redo buttons show on it. */
  readonly touch: boolean;
}

/** Call during a component's setup. */
export function usePrimaryPointer(): PrimaryPointer {
  const query = new MediaQuery('(pointer: coarse)');
  const any = new MediaQuery('(any-pointer: coarse)');
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
    },
    get touch() {
      return ready && any.current;
    }
  };
}
